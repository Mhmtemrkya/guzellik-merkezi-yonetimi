import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/json_helpers.dart';
import 'message_kit.dart';
import 'template_composer_sheet.dart' show MessageBubble;

/// MESAJ GÖNDER — web `SendMessageDialog` karşılığı.
///
/// Şablon seç → kitle seç (tüm müşteriler / seçili müşteriler / doğum günü bu hafta) → sunucunun
/// tahmini (kaç kişiye gider, kotadan/krediden ne düşer) → iki adımlı onay. Tahmin gönderimle
/// AYNI kuralı izler; para harcayan işlem olduğu için onaysız gönderim yoktur.
/// Gönderildiyse `true` döner.
Future<bool> showSendMessageSheet(
  BuildContext context, {
  required ApiClient api,
  String? initialTemplateId,
  String salonName = '',
  VoidCallback? onCreateTemplate,
}) async {
  final result = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _SendMessageSheet(
      api: api,
      initialTemplateId: initialTemplateId,
      salonName: salonName,
      onCreateTemplate: onCreateTemplate,
    ),
  );
  return result == true;
}

class _SendMessageSheet extends StatefulWidget {
  const _SendMessageSheet({
    required this.api,
    required this.initialTemplateId,
    required this.salonName,
    required this.onCreateTemplate,
  });

  final ApiClient api;
  final String? initialTemplateId;
  final String salonName;
  final VoidCallback? onCreateTemplate;

  @override
  State<_SendMessageSheet> createState() => _SendMessageSheetState();
}

class _SendMessageSheetState extends State<_SendMessageSheet> {
  List<Map<String, dynamic>> _templates = const [];
  bool _loadingTemplates = true;
  String? _templateId;
  String _mode = 'all';
  final List<Map<String, dynamic>> _picked = [];
  final TextEditingController _query = TextEditingController();
  List<Map<String, dynamic>> _results = const [];
  bool _searching = false;
  Map<String, dynamic>? _estimate;
  bool _estimating = false;
  String? _estimateError;
  bool _confirming = false;
  bool _sending = false;
  String? _error;
  Timer? _searchDebounce;
  Timer? _estimateDebounce;
  int _searchSeq = 0;
  int _estimateSeq = 0;

  /// Paketin "toplu gönderim" (notifications.bulk) özelliği. Okunana kadar açık sayılır: sunucu
  /// kitle gönderimini zaten 409 ile korur; burada amaç web'deki gibi seçeneği baştan kilitlemek.
  bool _bulkAllowed = true;

  @override
  void initState() {
    super.initState();
    _loadFeatures();
    _loadTemplates();
  }

  Future<void> _loadFeatures() async {
    try {
      final res = await widget.api.get('/api/admin/features');
      final keys = res is Map ? (res['activeFeatures'] as List? ?? const []) : const [];
      if (!mounted || keys.any((k) => '$k'.toLowerCase() == 'notifications.bulk')) return;
      setState(() => _bulkAllowed = false);
      if (_mode != 'pick') _setMode('pick');
    } catch (_) {
      // Özellikler okunamazsa kilit koyulmaz — sunucu kapısı yine korur.
    }
  }

  @override
  void dispose() {
    _searchDebounce?.cancel();
    _estimateDebounce?.cancel();
    _query.dispose();
    super.dispose();
  }

  Future<void> _loadTemplates() async {
    try {
      final res = await widget.api.get('/api/admin/notification-templates/', query: {'page': 1, 'pageSize': 200});
      final active = apiItems(res).where((t) => '${t['status']}' == 'Active').toList();
      if (!mounted) return;
      final preferred = active.firstWhere(
        (t) => '${t['id']}' == widget.initialTemplateId,
        orElse: () => active.firstWhere(
          (t) => '${t['trigger']}' == 'Manual' || '${t['trigger']}' == 'Campaign',
          orElse: () => active.isEmpty ? const {} : active.first,
        ),
      );
      setState(() {
        _templates = active;
        _templateId = preferred['id'] == null ? null : '${preferred['id']}';
        _loadingTemplates = false;
      });
      _refreshEstimate();
    } catch (e) {
      if (mounted) setState(() { _loadingTemplates = false; _error = '$e'; });
    }
  }

  void _setMode(String mode) {
    setState(() { _mode = mode; _confirming = false; });
    if (mode == 'pick' && _results.isEmpty) _search();
    _refreshEstimate();
  }

  /// Sunucu-taraflı müşteri araması (debounce'lu) — 12 bin+ müşteride listeyi indirmeyiz.
  void _search() {
    _searchDebounce?.cancel();
    final q = _query.text.trim();
    _searchDebounce = Timer(Duration(milliseconds: q.isEmpty ? 0 : 250), () async {
      final seq = ++_searchSeq;
      setState(() => _searching = true);
      try {
        final res = await widget.api.get('/api/admin/customers', query: {
          if (q.isNotEmpty) 'search': q,
          'page': 1,
          'pageSize': 50,
        });
        if (!mounted || seq != _searchSeq) return;
        setState(() => _results = apiItems(res));
      } catch (_) {
        if (mounted && seq == _searchSeq) setState(() => _results = const []);
      } finally {
        if (mounted && seq == _searchSeq) setState(() => _searching = false);
      }
    });
  }

  bool _isPicked(Map<String, dynamic> c) => _picked.any((p) => '${p['id']}' == '${c['id']}');

  void _togglePick(Map<String, dynamic> c) {
    setState(() {
      if (_isPicked(c)) {
        _picked.removeWhere((p) => '${p['id']}' == '${c['id']}');
      } else {
        _picked.add(c);
      }
      _confirming = false;
    });
    _refreshEstimate();
  }

  Map<String, dynamic> _requestBody() => _mode == 'pick'
      ? {'templateId': _templateId, 'customerIds': _picked.map((p) => '${p['id']}').toList()}
      : {'templateId': _templateId, 'audience': _mode};

  /// Tahmin: şablon/kitle/seçim değişince sunucuya sorulur (hiçbir şey yazmaz).
  void _refreshEstimate() {
    _estimateDebounce?.cancel();
    if (_templateId == null || (_mode == 'pick' && _picked.isEmpty)) {
      setState(() { _estimate = null; _estimateError = null; _estimating = false; });
      return;
    }
    _estimateDebounce = Timer(const Duration(milliseconds: 250), () async {
      final seq = ++_estimateSeq;
      setState(() { _estimating = true; _estimateError = null; });
      try {
        final res = await widget.api.post('/api/admin/notification-templates/estimate', _requestBody());
        if (!mounted || seq != _estimateSeq) return;
        setState(() => _estimate = res is Map ? res.cast<String, dynamic>() : null);
      } catch (e) {
        if (mounted && seq == _estimateSeq) setState(() { _estimate = null; _estimateError = '$e'; });
      } finally {
        if (mounted && seq == _estimateSeq) setState(() => _estimating = false);
      }
    });
  }

  Future<void> _send() async {
    final template = _templates.firstWhere((t) => '${t['id']}' == _templateId, orElse: () => const {});
    setState(() { _sending = true; _error = null; });
    try {
      final res = await widget.api.post('/api/admin/notification-templates/send', _requestBody());
      if (!mounted) return;
      String message;
      if (res is Map && res['pendingApproval'] == true) {
        message = 'Gönderim onaya gönderildi. Yönetici onayladıktan sonra iletilecek.';
      } else {
        final r = res is Map ? res : const {};
        final parts = <String>['${r['sent'] ?? 0} mesaj gönderildi'];
        if ((r['failed'] ?? 0) is num && (r['failed'] as num) > 0) parts.add('${r['failed']} gönderilemedi');
        if ((r['skipped'] ?? 0) is num && (r['skipped'] as num) > 0) parts.add('${r['skipped']} kişide iletişim bilgisi yok');
        message = '"${template['name'] ?? 'Şablon'}" — ${parts.join(' · ')}.';
      }
      final messenger = ScaffoldMessenger.of(context);
      Navigator.pop(context, true);
      messenger.showSnackBar(SnackBar(content: Text(message)));
    } catch (e) {
      if (mounted) setState(() { _error = '$e'; _confirming = false; });
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final template = _templates.firstWhere((t) => '${t['id']}' == _templateId, orElse: () => const {});
    final channel = '${template['channel'] ?? 'Sms'}';
    final e = _estimate;
    final reachable = e == null ? 0 : (e['reachable'] as num? ?? 0).toInt();
    final canSend = _templateId != null && !_estimating && reachable > 0 && !(_mode == 'pick' && _picked.isEmpty);
    final warnings = e == null ? const <dynamic>[] : (e['warnings'] as List? ?? const []);

    return DraggableScrollableSheet(
      initialChildSize: .95,
      minChildSize: .5,
      maxChildSize: .97,
      expand: false,
      builder: (context, scroll) => Container(
        decoration: const BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 14, 8, 6),
              child: Row(
                children: [
                  const Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('MESAJ GÖNDER',
                            style: TextStyle(fontSize: 10.5, letterSpacing: 1.2, fontWeight: FontWeight.w800, color: AppColors.primary)),
                        SizedBox(height: 2),
                        Text('Kime, hangi mesaj?', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: AppColors.ink)),
                      ],
                    ),
                  ),
                  IconButton(onPressed: _sending ? null : () => Navigator.pop(context, false), icon: const Icon(Icons.close_rounded)),
                ],
              ),
            ),
            const Divider(height: 1),
            Expanded(
              child: ListView(
                controller: scroll,
                padding: const EdgeInsets.fromLTRB(18, 14, 18, 24),
                children: [
                  const Text('1 · Mesaj', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800)),
                  const SizedBox(height: 8),
                  if (_loadingTemplates)
                    const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator()))
                  else if (_templates.isEmpty)
                    Container(
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: AppColors.surfaceSoft,
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(color: AppColors.border),
                      ),
                      child: Column(
                        children: [
                          const Text('Gönderilebilir (aktif) şablon yok.', style: TextStyle(color: AppColors.muted)),
                          if (widget.onCreateTemplate != null)
                            TextButton(
                              onPressed: () {
                                Navigator.pop(context, false);
                                widget.onCreateTemplate!();
                              },
                              child: const Text('Hemen bir şablon oluştur'),
                            ),
                        ],
                      ),
                    )
                  else
                    DropdownButtonFormField<String>(
                      initialValue: _templateId,
                      isExpanded: true,
                      decoration: const InputDecoration(isDense: true),
                      items: [
                        for (final t in _templates)
                          DropdownMenuItem(
                            value: '${t['id']}',
                            child: Text('${channelTitle('${t['channel']}')} · ${t['name']}', overflow: TextOverflow.ellipsis),
                          ),
                      ],
                      onChanged: (v) {
                        setState(() { _templateId = v; _confirming = false; });
                        _refreshEstimate();
                      },
                    ),
                  const SizedBox(height: 16),

                  const Text('2 · Kime?', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800)),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      ChoiceChip(
                        avatar: Icon(_bulkAllowed ? Icons.groups_rounded : Icons.lock_rounded, size: 16),
                        label: const Text('Tüm müşteriler'),
                        selected: _mode == 'all',
                        onSelected: _bulkAllowed ? (_) => _setMode('all') : null,
                      ),
                      ChoiceChip(
                        avatar: const Icon(Icons.how_to_reg_rounded, size: 16),
                        label: const Text('Müşteri seç'),
                        selected: _mode == 'pick',
                        onSelected: (_) => _setMode('pick'),
                      ),
                      ChoiceChip(
                        avatar: Icon(_bulkAllowed ? Icons.cake_rounded : Icons.lock_rounded, size: 16),
                        label: const Text('Doğum günü bu hafta'),
                        selected: _mode == 'birthdayWeek',
                        onSelected: _bulkAllowed ? (_) => _setMode('birthdayWeek') : null,
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    switch (_mode) {
                      'all' => 'Kara listedekiler hariç tüm müşteriler.',
                      'birthdayWeek' => 'Önümüzdeki 7 gün içinde doğum günü olanlar.',
                      _ => 'İsim ya da telefonla arayıp istediğin kişileri seç.',
                    },
                    style: const TextStyle(fontSize: 11.5, color: AppColors.muted),
                  ),
                  if (!_bulkAllowed)
                    const Padding(
                      padding: EdgeInsets.only(top: 2),
                      child: Text(
                        'Tüm müşterilere toplu gönderim paketinizde yok — müşteri seçerek gönderebilirsiniz.',
                        style: TextStyle(fontSize: 11.5, color: AppColors.muted, fontWeight: FontWeight.w600),
                      ),
                    ),
                  if (_mode == 'pick') ...[
                    const SizedBox(height: 10),
                    if (_picked.isNotEmpty)
                      Wrap(
                        spacing: 6,
                        runSpacing: 6,
                        children: [
                          for (final p in _picked)
                            InputChip(
                              label: Text(valueOf(p, const ['fullName', 'name'], fallback: 'Müşteri')),
                              onDeleted: () => _togglePick(p),
                            ),
                        ],
                      ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: _query,
                      onChanged: (_) => _search(),
                      decoration: const InputDecoration(
                        isDense: true,
                        prefixIcon: Icon(Icons.search_rounded),
                        hintText: 'İsim veya telefonla ara…',
                      ),
                    ),
                    const SizedBox(height: 6),
                    if (_searching && _results.isEmpty)
                      const Padding(padding: EdgeInsets.all(12), child: Center(child: Text('Aranıyor…', style: TextStyle(color: AppColors.muted))))
                    else if (_results.isEmpty)
                      const Padding(padding: EdgeInsets.all(12), child: Center(child: Text('Eşleşen müşteri yok.', style: TextStyle(color: AppColors.muted))))
                    else
                      for (final c in _results)
                        CheckboxListTile(
                          dense: true,
                          contentPadding: EdgeInsets.zero,
                          controlAffinity: ListTileControlAffinity.leading,
                          value: _isPicked(c),
                          onChanged: (_) => _togglePick(c),
                          title: Text(valueOf(c, const ['fullName', 'name'], fallback: 'Müşteri'),
                              style: const TextStyle(fontWeight: FontWeight.w600)),
                          subtitle: Text(valueOf(c, const ['phone'], fallback: '')),
                        ),
                    Text('${_picked.length} kişi seçili · ilk 50 eşleşme gösterilir',
                        style: const TextStyle(fontSize: 11, color: AppColors.muted)),
                  ],
                  const SizedBox(height: 16),

                  const Text('Önizleme', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800)),
                  const SizedBox(height: 8),
                  MessageBubble(
                    channel: channel,
                    text: '${e?['sampleBody'] ?? template['body'] ?? ''}',
                    salonName: widget.salonName,
                  ),
                  const SizedBox(height: 12),
                  Container(
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: AppColors.border),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Row(
                          children: [
                            const Expanded(child: Text('Gönderim özeti', style: TextStyle(fontWeight: FontWeight.w800))),
                            if (_estimating) const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)),
                          ],
                        ),
                        const SizedBox(height: 8),
                        if (_mode == 'pick' && _picked.isEmpty)
                          const Text('Göndermek için en az bir müşteri seç.', style: TextStyle(color: AppColors.muted))
                        else if (_estimateError != null)
                          Text(_estimateError!, style: const TextStyle(color: AppColors.danger))
                        else if (e == null)
                          Text(_templateId == null ? 'Önce bir mesaj seç.' : 'Hesaplanıyor…', style: const TextStyle(color: AppColors.muted))
                        else ...[
                          _row('Kitledeki müşteri', thousands((e['recipients'] as num? ?? 0).toInt())),
                          _row(channel == 'Email' ? 'E-postası olan' : 'Telefonu olan', thousands(reachable), strong: true),
                          if (channel == 'Sms')
                            _row('SMS parçası', '${thousands((e['totalSmsParts'] as num? ?? 0).toInt())} (kişi başı en çok ${e['maxSmsParts'] ?? 0})'),
                          // Kurumun kendi SMS hesabı: kota/kredi satırları anlamsız — ücreti sağlayıcı keser.
                          if (channel != 'Email' && e['ownAccount'] == true)
                            Container(
                              margin: const EdgeInsets.only(top: 4),
                              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                              decoration: BoxDecoration(
                                color: const Color(0xFFECFDF5),
                                borderRadius: BorderRadius.circular(10),
                                border: Border.all(color: const Color(0xFFA7F3D0)),
                              ),
                              child: const Text(
                                'Kendi SMS hesabınızdan gider — BeautyAsist kotası ve mesaj krediniz düşmez, ücreti sağlayıcınız keser.',
                                style: TextStyle(fontSize: 12, color: Color(0xFF065F46), height: 1.35),
                              ),
                            ),
                          if (channel != 'Email' && e['ownAccount'] != true) ...[
                            _row(
                              'Paket kotasından',
                              '${thousands((e['quotaCovered'] as num? ?? 0).toInt())} mesaj'
                                  '${(e['quotaRemaining'] as num? ?? 0) >= 0 ? ' (kalan ${thousands((e['quotaRemaining'] as num).toInt())})' : ' (sınırsız)'}',
                            ),
                            if ((e['creditMessages'] as num? ?? 0) > 0)
                              _row('Mesaj kredisinden',
                                  '${thousands((e['creditMessages'] as num).toInt())} mesaj · ${formatCredits(e['creditsNeeded'] as num?)} kredi'),
                            _row('Kullanılabilir kredi', formatCredits(e['availableCredits'] as num?)),
                          ],
                          const SizedBox(height: 6),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                            decoration: BoxDecoration(color: const Color(0xFFFDF1F5), borderRadius: BorderRadius.circular(10)),
                            child: Row(
                              children: [
                                const Expanded(child: Text('Gitmesi beklenen', style: TextStyle(fontWeight: FontWeight.w700))),
                                Text(thousands((e['expectedToSend'] as num? ?? 0).toInt()),
                                    style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: AppColors.primaryDark)),
                              ],
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                  for (final w in warnings)
                    Container(
                      margin: const EdgeInsets.only(top: 8),
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                      decoration: BoxDecoration(
                        color: const Color(0xFFFEF6E7),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: const Color(0xFFF3D9A0)),
                      ),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Icon(Icons.warning_amber_rounded, size: 16, color: Color(0xFFB7791F)),
                          const SizedBox(width: 6),
                          Expanded(child: Text('$w', style: const TextStyle(fontSize: 11.5, height: 1.35, color: Color(0xFF8A6414)))),
                        ],
                      ),
                    ),
                  if (_error != null) ...[
                    const SizedBox(height: 8),
                    Text(_error!, style: const TextStyle(color: AppColors.danger, fontWeight: FontWeight.w600)),
                  ],
                ],
              ),
            ),
            const Divider(height: 1),
            SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
                child: _confirming && e != null
                    ? Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Text(
                            '${thousands(reachable)} kişiye ${channelTitle(channel)} gönderilecek'
                            '${(e['creditsNeeded'] as num? ?? 0) > 0 ? ' · en çok ${formatCredits(e['creditsNeeded'] as num?)} kredi düşebilir' : ''}. Onaylıyor musun?',
                            style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600),
                          ),
                          const SizedBox(height: 8),
                          Row(
                            children: [
                              Expanded(
                                child: OutlinedButton(
                                  style: OutlinedButton.styleFrom(minimumSize: const Size(0, 46)),
                                  onPressed: _sending ? null : () => setState(() => _confirming = false),
                                  child: const Text('Geri'),
                                ),
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: FilledButton.icon(
                                  style: FilledButton.styleFrom(backgroundColor: AppColors.primaryDark, minimumSize: const Size(0, 46)),
                                  onPressed: _sending ? null : _send,
                                  icon: _sending
                                      ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                                      : const Icon(Icons.check_rounded, size: 18),
                                  label: const Text('Evet, gönder'),
                                ),
                              ),
                            ],
                          ),
                        ],
                      )
                    : SizedBox(
                        width: double.infinity,
                        child: FilledButton.icon(
                          style: FilledButton.styleFrom(backgroundColor: AppColors.primaryDark, minimumSize: const Size(0, 48)),
                          onPressed: canSend ? () => setState(() => _confirming = true) : null,
                          icon: const Icon(Icons.send_rounded, size: 18),
                          label: Text(reachable > 0 ? '${thousands(reachable)} kişiye gönder' : 'Gönder'),
                        ),
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _row(String label, String value, {bool strong = false}) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Row(
          children: [
            Expanded(child: Text(label, style: const TextStyle(fontSize: 12.5, color: AppColors.muted))),
            Flexible(
              child: Text(value,
                  textAlign: TextAlign.right,
                  style: TextStyle(fontSize: 12.5, fontWeight: strong ? FontWeight.w800 : FontWeight.w700)),
            ),
          ],
        ),
      );
}
