import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';

import '../../core/theme/responsive.dart';
import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/json_helpers.dart';
import '../../shared/widgets/app_background.dart';
import '../../shared/widgets/page_header.dart';
import '../../shared/widgets/sparkline.dart';

/// Log Kayıtları — web `app/admin/loglar` sayfasının mobil paritesi:
///  • Zaman aralığı sekmeleri (Bugün / 7 gün / 30 gün / Tümü) — sunucu taraflı süzme
///  • 4 istatistik kartı + sparkline (Toplam / Oluşturma / Güncelleme / Silme-Onay)
///  • Filtre çubuğu: arama + eylem + modül + kullanıcı (sunucuya gider)
///  • Aktivite akışı: eylem ikonu/rozeti, kullanıcı, modül, tarih + genişleyen detay
///  • Log Özeti: en yoğun saat, en aktif modül, benzersiz kullanıcı, uyarı sayısı
///  • Tüm logları sil (yalnızca kurum yöneticisi/platform)
class LogsScreen extends StatefulWidget {
  const LogsScreen({required this.api, super.key});
  final ApiClient api;

  @override
  State<LogsScreen> createState() => _LogsScreenState();
}

enum _Range { today, week, month, all }

class _LogsScreenState extends State<LogsScreen> {
  _Range _range = _Range.all;
  String _search = '';
  String? _action;
  String? _entity;
  String? _user;
  bool _busy = false;
  Timer? _debounce;
  final _searchCtrl = TextEditingController();
  late Future<_LogData> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _searchCtrl.dispose();
    super.dispose();
  }

  DateTime? _rangeFrom() {
    final now = DateTime.now();
    return switch (_range) {
      _Range.today => now.subtract(const Duration(days: 1)),
      _Range.week => now.subtract(const Duration(days: 7)),
      _Range.month => now.subtract(const Duration(days: 30)),
      _Range.all => null,
    };
  }

  Future<_LogData> _load() async {
    final q = <String, dynamic>{'page': 1, 'pageSize': 200};
    final from = _rangeFrom();
    if (from != null) q['fromUtc'] = from.toUtc().toIso8601String();
    if (_search.trim().isNotEmpty) q['search'] = _search.trim();
    if (_action != null) q['action'] = _action;
    if (_entity != null) q['entity'] = _entity;
    if (_user != null) q['actorUserId'] = _user;

    final payload = await widget.api.get('/api/admin/logs/', query: q);
    final items = apiItems(payload);
    var total = items.length;
    if (payload is Map) {
      final t = payload['total'] ?? payload['totalCount'];
      if (t is num) total = t.toInt();
    }
    return _LogData(items: items, total: total);
  }

  void _reload() => setState(() {
        _future = _load();
      });

  void _onSearchChanged(String v) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 450), () {
      _search = v;
      _reload();
    });
  }

  bool get _hasFilters =>
      _search.isNotEmpty ||
      _action != null ||
      _entity != null ||
      _user != null ||
      _range != _Range.all;

  void _clearFilters() {
    _debounce?.cancel();
    _searchCtrl.clear();
    setState(() {
      _search = '';
      _action = null;
      _entity = null;
      _user = null;
      _range = _Range.all;
      _future = _load();
    });
  }

  Future<void> _clearAll() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Tüm log kayıtları silinsin mi?'),
        content: const Text(
          'Bu işlem kurumun tüm log geçmişini kalıcı olarak temizler. '
          'Arama/filtreler dikkate alınmaz ve işlem geri alınamaz.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Vazgeç'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Evet, tümünü sil'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    setState(() => _busy = true);
    try {
      await widget.api.delete('/api/admin/logs/clear');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Log kayıtları temizlendi.')),
        );
      }
      _reload();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$e')));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppBackground(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        body: SafeArea(
          child: RefreshIndicator(
            color: AppColors.primary,
            onRefresh: () async {
              _reload();
              await _future;
            },
            child: FutureBuilder<_LogData>(
              future: _future,
              builder: (context, snapshot) {
                final data = snapshot.data;
                return ListView(
                  padding: const EdgeInsets.fromLTRB(16, 20, 16, 110),
                  children: [
                    PageHeader(
                      eyebrow: 'Güvenlik',
                      title: 'Log Kayıtları',
                      subtitle:
                          'Kullanıcı, eylem ve modül bazlı denetim kayıtları.',
                      action: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          IconButton(
                            onPressed: _busy ? null : _reload,
                            icon: const Icon(Icons.refresh_rounded),
                            color: AppColors.primaryDark,
                            tooltip: 'Yenile',
                          ),
                          IconButton(
                            onPressed: _busy ? null : _clearAll,
                            icon: const Icon(Icons.delete_sweep_rounded),
                            color: AppColors.danger,
                            tooltip: 'Tümünü sil',
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 12),
                    _rangeTabs(),
                    const SizedBox(height: 14),
                    if (snapshot.connectionState != ConnectionState.done &&
                        data == null)
                      const Padding(
                        padding: EdgeInsets.all(40),
                        child: Center(child: CircularProgressIndicator()),
                      )
                    else if (snapshot.hasError)
                      _errorBox('${snapshot.error}')
                    else ...[
                      _StatGrid(stats: _LogStats.from(data!.items, data.total)),
                      const SizedBox(height: 16),
                      _filterBar(data.items),
                      const SizedBox(height: 14),
                      _listHeader(data.total),
                      const SizedBox(height: 8),
                      ...data.items.map(_logCard),
                      if (data.items.isEmpty) _emptyBox(),
                      const SizedBox(height: 20),
                      _SummaryCard(stats: _LogStats.from(data.items, data.total)),
                    ],
                  ],
                );
              },
            ),
          ),
        ),
      ),
    );
  }

  Widget _rangeTabs() {
    final items = <(_Range, String)>[
      (_Range.today, 'Bugün'),
      (_Range.week, 'Son 7 gün'),
      (_Range.month, 'Son 30 gün'),
      (_Range.all, 'Tümü'),
    ];
    final deviceWarnActive = _action == 'Security.UnauthorizedDevice';
    return SizedBox(
      height: 38,
      child: ListView(
        scrollDirection: Axis.horizontal,
        children: [
          // Cihaz güvenliği: tanımsız cihaz giriş denemelerini tek tıkla süz.
          Padding(
            padding: const EdgeInsets.only(right: 8),
            child: GestureDetector(
              onTap: () => setState(() {
                _action = deviceWarnActive ? null : 'Security.UnauthorizedDevice';
                _future = _load();
              }),
              child: Container(
                alignment: Alignment.center,
                padding: const EdgeInsets.symmetric(horizontal: 12),
                decoration: BoxDecoration(
                  color: deviceWarnActive ? AppColors.danger : Colors.white,
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(
                    color: deviceWarnActive
                        ? AppColors.danger
                        : AppColors.danger.withValues(alpha: .4),
                  ),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.gpp_maybe_rounded,
                        size: 15,
                        color:
                            deviceWarnActive ? Colors.white : AppColors.danger),
                    const SizedBox(width: 4),
                    Text(
                      'Cihaz Uyarıları',
                      style: TextStyle(
                        color:
                            deviceWarnActive ? Colors.white : AppColors.danger,
                        fontWeight: FontWeight.w700,
                        fontSize: 13,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          for (final it in items)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: GestureDetector(
                onTap: () {
                  setState(() {
                    _range = it.$1;
                    _future = _load();
                  });
                },
                child: Container(
                  alignment: Alignment.center,
                  padding: const EdgeInsets.symmetric(horizontal: 14),
                  decoration: BoxDecoration(
                    color: _range == it.$1 ? AppColors.primary : Colors.white,
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(
                      color: _range == it.$1
                          ? AppColors.primary
                          : AppColors.border,
                    ),
                  ),
                  child: Text(
                    it.$2,
                    style: TextStyle(
                      color: _range == it.$1 ? Colors.white : AppColors.ink,
                      fontWeight: FontWeight.w700,
                      fontSize: 13,
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _filterBar(List<Map<String, dynamic>> items) {
    // Kullanıcı seçenekleri yüklenen örnekten türetilir (id → ad).
    final userOpts = <String, String>{};
    for (final l in items) {
      final id = '${l['actorUserId'] ?? ''}';
      if (id.isEmpty || userOpts.containsKey(id)) continue;
      userOpts[id] = valueOf(l, const ['actorName'], fallback: 'Kullanıcı');
    }

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          TextField(
            controller: _searchCtrl,
            onChanged: _onSearchChanged,
            decoration: InputDecoration(
              isDense: true,
              hintText: 'Eylem veya modül adı ara…',
              prefixIcon: const Icon(Icons.search_rounded, size: 18),
              suffixIcon: _searchCtrl.text.isNotEmpty
                  ? IconButton(
                      icon: const Icon(Icons.close_rounded, size: 16),
                      onPressed: () {
                        _searchCtrl.clear();
                        _search = '';
                        _reload();
                      },
                    )
                  : null,
              contentPadding:
                  const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(10),
                borderSide: const BorderSide(color: AppColors.border),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(10),
                borderSide: const BorderSide(color: AppColors.border),
              ),
            ),
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              _filterDropdown(
                'Eylem',
                _action,
                _auditActionLabels,
                (v) => setState(() {
                  _action = v;
                  _future = _load();
                }),
              ),
              _filterDropdown(
                'Modül',
                _entity,
                _auditEntityLabels,
                (v) => setState(() {
                  _entity = v;
                  _future = _load();
                }),
              ),
              _filterDropdown(
                'Kullanıcı',
                _user,
                userOpts,
                (v) => setState(() {
                  _user = v;
                  _future = _load();
                }),
              ),
              if (_hasFilters)
                ActionChip(
                  avatar: const Icon(Icons.close_rounded,
                      size: 15, color: AppColors.danger),
                  label: const Text('Temizle'),
                  labelStyle: const TextStyle(
                      fontSize: 12,
                      color: AppColors.danger,
                      fontWeight: FontWeight.w600),
                  backgroundColor: AppColors.danger.withValues(alpha: .08),
                  side: BorderSide(color: AppColors.danger.withValues(alpha: .3)),
                  onPressed: _clearFilters,
                ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _filterDropdown(
    String label,
    String? value,
    Map<String, String> options,
    ValueChanged<String?> onChanged,
  ) {
    final active = value != null;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 2),
      decoration: BoxDecoration(
        color: active
            ? AppColors.primary.withValues(alpha: .08)
            : AppColors.surfaceSoft,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: active ? AppColors.primary : AppColors.border,
        ),
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<String?>(
          value: value,
          hint: Text(label,
              style: const TextStyle(fontSize: 12.5, color: AppColors.ink)),
          isDense: true,
          borderRadius: BorderRadius.circular(14),
          menuMaxHeight: 360,
          icon: const Icon(Icons.expand_more_rounded, size: 18),
          style: const TextStyle(fontSize: 12.5, color: AppColors.ink),
          items: [
            DropdownMenuItem<String?>(
              value: null,
              child: Text('$label: Tümü'),
            ),
            ...options.entries.map(
              (e) => DropdownMenuItem<String?>(
                value: e.key,
                child: Text(e.value),
              ),
            ),
          ],
          onChanged: onChanged,
        ),
      ),
    );
  }

  Widget _listHeader(int total) => Row(
        children: [
          const Text('Aktivite Akışı',
              style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
          const SizedBox(width: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
              color: AppColors.surfaceSoft,
              borderRadius: BorderRadius.circular(99),
            ),
            child: Text('$total kayıt',
                style: const TextStyle(
                    fontSize: 11,
                    color: AppColors.primaryDark,
                    fontWeight: FontWeight.w700)),
          ),
        ],
      );

  Widget _logCard(Map<String, dynamic> log) {
    final id = '${log['id']}';
    final action = '${log['action'] ?? ''}';
    final entity = '${log['entityName'] ?? ''}';
    final (icon, color) = _actionStyle(action);
    final actorName = valueOf(log, const ['actorName'], fallback: 'Sistem');
    final actorRole = _roleLabel('${log['actorRole'] ?? ''}');
    final summary = _sanitizeSummary('${log['summary'] ?? ''}');
    final created = parseUtcToLocal(log['createdAtUtc']);
    final dateText =
        created == null ? '' : DateFormat('d MMM, HH:mm', 'tr_TR').format(created);
    final data = _decodeData(log);
    final deviceId = '${log['deviceId'] ?? ''}';
    final deviceInfo = _decodeDeviceInfo(log);
    final ip = '${log['ipAddress'] ?? ''}';
    final hasDevicePanel = deviceId.isNotEmpty || ip.isNotEmpty;
    final expanded = _expandedId == id;
    final title = summary.isNotEmpty
        ? summary
        : '${_actionLabel(action)} · ${_entityLabel(entity)}';

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          InkWell(
            borderRadius: BorderRadius.circular(16),
            onTap: data == null && !hasDevicePanel
                ? null
                : () => setState(() => _expandedId = expanded ? null : id),
            child: Padding(
              padding: const EdgeInsets.all(13),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Container(
                        width: 36,
                        height: 36,
                        decoration: BoxDecoration(
                          color: color.withValues(alpha: .12),
                          borderRadius: BorderRadius.circular(11),
                        ),
                        child: Icon(icon, color: color, size: 18),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              title,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                  fontWeight: FontWeight.w700,
                                  fontSize: 13,
                                  height: 1.25),
                            ),
                            const SizedBox(height: 3),
                            Row(
                              children: [
                                _badge(_actionLabel(action), color),
                                const SizedBox(width: 6),
                                Flexible(
                                  child: _badge(
                                      _entityLabel(entity), AppColors.primaryDark,
                                      soft: true),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                      if (data != null || hasDevicePanel)
                        Icon(
                          expanded
                              ? Icons.expand_less_rounded
                              : Icons.expand_more_rounded,
                          color: AppColors.muted,
                          size: 20,
                        ),
                    ],
                  ),
                  const SizedBox(height: 9),
                  Wrap(
                    spacing: 12,
                    runSpacing: 3,
                    children: [
                      _meta(Icons.person_outline_rounded,
                          actorRole.isEmpty ? actorName : '$actorName · $actorRole'),
                      if (dateText.isNotEmpty)
                        _meta(Icons.schedule_rounded, dateText),
                    ],
                  ),
                  // IP + cihaz kimliği + ağ bilgisi — belirgin rozetler
                  if (hasDevicePanel) ...[
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      children: [
                        if (ip.isNotEmpty)
                          _deviceChip(Icons.public_rounded, ip, _sky),
                        if (deviceId.isNotEmpty)
                          _deviceChip(
                            _deviceTypeIcon(deviceInfo?['deviceType']),
                            '${_deviceTypeLabel(deviceInfo?['deviceType'])} · ${deviceId.substring(0, deviceId.length < 8 ? deviceId.length : 8).toUpperCase()}',
                            AppColors.primaryDark,
                          ),
                        if (_networkSummary(deviceInfo) != null)
                          _deviceChip(Icons.wifi_rounded,
                              _networkSummary(deviceInfo)!, AppColors.success),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ),
          AnimatedSize(
            duration: const Duration(milliseconds: 200),
            curve: Curves.easeOut,
            child: expanded && (data != null || hasDevicePanel)
                ? Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (hasDevicePanel)
                        _devicePanel(ip, deviceId, deviceInfo),
                      if (data != null) _detail(data),
                    ],
                  )
                : const SizedBox(width: double.infinity),
          ),
        ],
      ),
    );
  }

  Widget _detail(Map<String, dynamic> data) {
    final entries = data.entries.take(12).toList();
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(13, 0, 13, 13),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Divider(height: 1, color: AppColors.border),
          const SizedBox(height: 10),
          ...entries.map((e) {
            final v = e.value;
            final val = v == null
                ? '—'
                : (v is Map || v is List ? jsonEncode(v) : '$v');
            return Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Container(
                width: double.infinity,
                padding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
                decoration: BoxDecoration(
                  color: AppColors.surfaceSoft,
                  borderRadius: BorderRadius.circular(9),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(e.key,
                        style: const TextStyle(
                            fontSize: 10,
                            color: AppColors.primaryDark,
                            fontWeight: FontWeight.w700)),
                    const SizedBox(height: 1),
                    Text(val,
                        style: const TextStyle(
                            fontSize: 12.5, color: AppColors.ink)),
                  ],
                ),
              ),
            );
          }),
        ],
      ),
    );
  }

  /// IP / cihaz / ağ rozetleri — meta satırından büyük ve belirgin.
  Widget _deviceChip(IconData icon, String text, Color color) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
        decoration: BoxDecoration(
          color: color.withValues(alpha: .08),
          borderRadius: BorderRadius.circular(99),
          border: Border.all(color: color.withValues(alpha: .35)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 14, color: color),
            const SizedBox(width: 5),
            Text(text,
                style: TextStyle(
                    color: color,
                    fontSize: 11.5,
                    fontWeight: FontWeight.w700,
                    fontFeatures: const [FontFeature.tabularFigures()])),
          ],
        ),
      );

  /// Genişleyen detaydaki "Cihaz & Bağlantı" kartı — tam kimlik + kopyalama.
  Widget _devicePanel(String ip, String deviceId, Map<String, dynamic>? info) {
    final net = _networkDetail(info);
    Widget fact(IconData icon, Color color, String label, String value,
        {bool copyable = false}) {
      return Container(
        width: double.infinity,
        margin: const EdgeInsets.only(bottom: 6),
        padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 9),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(11),
          border: Border.all(color: AppColors.border),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 34,
              height: 34,
              decoration: BoxDecoration(
                color: color.withValues(alpha: .1),
                borderRadius: BorderRadius.circular(9),
              ),
              child: Icon(icon, color: color, size: 17),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(label,
                      style: const TextStyle(
                          fontSize: 9.5,
                          color: AppColors.muted,
                          fontWeight: FontWeight.w700,
                          letterSpacing: .6)),
                  const SizedBox(height: 2),
                  Text(value,
                      style: const TextStyle(
                          fontSize: 13.5,
                          fontWeight: FontWeight.w800,
                          height: 1.3)),
                ],
              ),
            ),
            if (copyable)
              IconButton(
                visualDensity: VisualDensity.compact,
                icon: const Icon(Icons.copy_rounded,
                    size: 15, color: AppColors.muted),
                tooltip: 'Kopyala',
                onPressed: () {
                  Clipboard.setData(ClipboardData(text: value));
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Kopyalandı.')),
                  );
                },
              ),
          ],
        ),
      );
    }

    return Container(
      width: double.infinity,
      margin: const EdgeInsets.fromLTRB(13, 0, 13, 10),
      padding: const EdgeInsets.all(11),
      decoration: BoxDecoration(
        color: AppColors.surfaceSoft,
        borderRadius: BorderRadius.circular(13),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.devices_rounded,
                  size: 15, color: AppColors.primaryDark),
              SizedBox(width: 6),
              Text('CİHAZ & BAĞLANTI',
                  style: TextStyle(
                      fontSize: 10.5,
                      fontWeight: FontWeight.w800,
                      color: AppColors.primaryDark,
                      letterSpacing: .8)),
            ],
          ),
          const SizedBox(height: 9),
          if (ip.isNotEmpty)
            fact(Icons.public_rounded, _sky, 'IP ADRESİ', ip, copyable: true),
          if (deviceId.isNotEmpty)
            fact(
              _deviceTypeIcon(info?['deviceType']),
              AppColors.primaryDark,
              'CİHAZ KİMLİĞİ · ${_deviceTypeLabel(info?['deviceType']).toUpperCase()}',
              deviceId,
              copyable: true,
            ),
          if (info?['platform'] != null)
            fact(Icons.memory_rounded, _violet, 'PLATFORM',
                '${info!['platform']}'),
          if (net != null)
            fact(Icons.wifi_rounded, AppColors.success, 'AĞ / WİFİ', net),
        ],
      ),
    );
  }

  Widget _meta(IconData icon, String text) => Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 13, color: AppColors.muted),
          const SizedBox(width: 4),
          ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 240),
            child: Text(text,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 11.5, color: AppColors.muted)),
          ),
        ],
      );

  Widget _badge(String text, Color color, {bool soft = false}) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
        decoration: BoxDecoration(
          color: color.withValues(alpha: soft ? .06 : .1),
          borderRadius: BorderRadius.circular(6),
          border: Border.all(color: color.withValues(alpha: .25)),
        ),
        child: Text(text,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
                color: color, fontSize: 9.5, fontWeight: FontWeight.w700)),
      );

  Widget _emptyBox() => Padding(
        padding: const EdgeInsets.symmetric(vertical: 40),
        child: Center(
          child: Column(
            children: [
              Icon(Icons.assignment_outlined,
                  size: 40, color: AppColors.primary.withValues(alpha: .5)),
              const SizedBox(height: 10),
              Text(
                _hasFilters
                    ? 'Filtreyle eşleşen log bulunamadı.'
                    : 'Bu aralıkta henüz işlem yapılmamış.',
                textAlign: TextAlign.center,
                style: const TextStyle(color: AppColors.muted, fontSize: 13),
              ),
            ],
          ),
        ),
      );

  Widget _errorBox(String message) => Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          children: [
            const Icon(Icons.cloud_off_rounded,
                size: 40, color: AppColors.primary),
            const SizedBox(height: 10),
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: _reload,
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('Tekrar dene'),
            ),
          ],
        ),
      );

  String? _expandedId;
}

// --------------------------------------------------------------------------
// İstatistik kartları
// --------------------------------------------------------------------------

class _StatGrid extends StatelessWidget {
  const _StatGrid({required this.stats});
  final _LogStats stats;

  @override
  Widget build(BuildContext context) {
    final cards = <_StatCardData>[
      _StatCardData('Toplam İşlem', stats.total, stats.totalSeries,
          Icons.bolt_rounded, AppColors.primaryDark, null),
      _StatCardData('Oluşturma', stats.createCount, stats.createSeries,
          Icons.add_circle_outline_rounded, AppColors.success,
          'oluştur + tahsilat'),
      _StatCardData('Güncelleme', stats.updateCount, stats.updateSeries,
          Icons.edit_rounded, _violet, 'durum + plan'),
      _StatCardData('Silme / Onay', stats.deleteCount, stats.deleteSeries,
          Icons.verified_user_rounded, AppColors.danger, null),
    ];
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: cards.length,
      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: gridCols(context, 2),
        crossAxisSpacing: 10,
        mainAxisSpacing: 10,
        mainAxisExtent: 114,
      ),
      itemBuilder: (context, i) => _StatCard(data: cards[i]),
    );
  }
}

class _StatCardData {
  _StatCardData(
      this.label, this.value, this.series, this.icon, this.color, this.badge);
  final String label;
  final int value;
  final List<int> series;
  final IconData icon;
  final Color color;
  final String? badge;
}

class _StatCard extends StatelessWidget {
  const _StatCard({required this.data});
  final _StatCardData data;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 30,
              height: 30,
              decoration: BoxDecoration(
                color: data.color.withValues(alpha: .12),
                borderRadius: BorderRadius.circular(9),
              ),
              child: Icon(data.icon, color: data.color, size: 16),
            ),
            const Spacer(),
            Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text('${data.value}',
                    style: const TextStyle(
                        fontWeight: FontWeight.w900, fontSize: 22)),
                const Spacer(),
                SizedBox(
                  width: 56,
                  height: 26,
                  child: Sparkline(values: data.series, color: data.color),
                ),
              ],
            ),
            const SizedBox(height: 2),
            Text(data.label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(color: AppColors.muted, fontSize: 11.5)),
            if (data.badge != null)
              Text('↗ ${data.badge}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                      color: AppColors.primaryDark, fontSize: 9.5)),
          ],
        ),
      ),
    );
  }
}

// --------------------------------------------------------------------------
// Log Özeti
// --------------------------------------------------------------------------

class _SummaryCard extends StatelessWidget {
  const _SummaryCard({required this.stats});
  final _LogStats stats;

  @override
  Widget build(BuildContext context) {
    final tiles = <(IconData, Color, String, String, String)>[
      (
        Icons.schedule_rounded,
        AppColors.primaryDark,
        'En Yoğun Saat',
        stats.busiestHour,
        'En çok işlem yapılan saat',
      ),
      (
        Icons.star_rounded,
        _violet,
        'En Aktif Modül',
        stats.topModule,
        'İşlem oranı %${stats.topModulePct}',
      ),
      (
        Icons.group_rounded,
        AppColors.success,
        'Benzersiz Kullanıcı',
        '${stats.uniqueUsers}',
        'Bu filtredeki kullanıcı',
      ),
      (
        Icons.warning_amber_rounded,
        AppColors.warning,
        'Uyarı / Ret',
        '${stats.warnings}',
        'Reddetme & iptal sayısı',
      ),
    ];
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 34,
                  height: 34,
                  decoration: BoxDecoration(
                    color: AppColors.surfaceSoft,
                    borderRadius: BorderRadius.circular(11),
                  ),
                  child: const Icon(Icons.insights_rounded,
                      color: AppColors.primaryDark, size: 18),
                ),
                const SizedBox(width: 10),
                const Text('Log Özeti',
                    style:
                        TextStyle(fontWeight: FontWeight.w800, fontSize: 14.5)),
              ],
            ),
            const SizedBox(height: 14),
            AdaptiveStatGrid(
              phoneCols: 2,
              height: 112,
              children: tiles.map((t) {
                return Container(
                  padding: const EdgeInsets.all(11),
                  decoration: BoxDecoration(
                    color: AppColors.surfaceSoft,
                    borderRadius: BorderRadius.circular(13),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(t.$1, color: t.$2, size: 18),
                      const SizedBox(height: 6),
                      Text(t.$4,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                              fontWeight: FontWeight.w900, fontSize: 14.5)),
                      Text(t.$3,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                              color: AppColors.muted, fontSize: 10.5)),
                      Text(t.$5,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                              color: AppColors.primaryDark, fontSize: 9.5)),
                    ],
                  ),
                );
              }).toList(),
            ),
          ],
        ),
      ),
    );
  }
}

// --------------------------------------------------------------------------
// Veri & istatistik
// --------------------------------------------------------------------------

class _LogData {
  _LogData({required this.items, required this.total});
  final List<Map<String, dynamic>> items;
  final int total;
}

class _LogStats {
  _LogStats({
    required this.total,
    required this.createCount,
    required this.updateCount,
    required this.deleteCount,
    required this.totalSeries,
    required this.createSeries,
    required this.updateSeries,
    required this.deleteSeries,
    required this.busiestHour,
    required this.topModule,
    required this.topModulePct,
    required this.uniqueUsers,
    required this.warnings,
  });

  final int total;
  final int createCount;
  final int updateCount;
  final int deleteCount;
  final List<int> totalSeries;
  final List<int> createSeries;
  final List<int> updateSeries;
  final List<int> deleteSeries;
  final String busiestHour;
  final String topModule;
  final int topModulePct;
  final int uniqueUsers;
  final int warnings;

  static const _createGroup = {'Create', 'Submit', 'RegisterPayment'};
  static const _updateGroup = {
    'Update',
    'ChangeStatus',
    'Reschedule',
    'ChangeNotes'
  };
  static const _deleteGroup = {'Delete', 'Approve', 'Reject', 'Cancel'};

  static _LogStats from(List<Map<String, dynamic>> items, int total) {
    DateTime? at(Map<String, dynamic> l) => parseUtcToLocal(l['createdAtUtc']);
    List<DateTime> timesOf(Iterable<Map<String, dynamic>> ls) =>
        ls.map(at).whereType<DateTime>().toList();

    final createL =
        items.where((l) => _createGroup.contains('${l['action']}')).toList();
    final updateL =
        items.where((l) => _updateGroup.contains('${l['action']}')).toList();
    final deleteL =
        items.where((l) => _deleteGroup.contains('${l['action']}')).toList();

    // Log Özeti
    final byHour = List<int>.filled(24, 0);
    final byModule = <String, int>{};
    final users = <String>{};
    var warnings = 0;
    for (final l in items) {
      final d = at(l);
      if (d != null) byHour[d.hour]++;
      final mod = _entityLabel('${l['entityName'] ?? ''}');
      byModule[mod] = (byModule[mod] ?? 0) + 1;
      final actor = '${l['actorUserId'] ?? l['actorName'] ?? ''}';
      if (actor.isNotEmpty) users.add(actor);
      final a = '${l['action']}';
      if (a == 'Reject' || a == 'Cancel' || a == 'Security.UnauthorizedDevice') {
        warnings++;
      }
    }
    var topHour = 0;
    for (var h = 1; h < 24; h++) {
      if (byHour[h] > byHour[topHour]) topHour = h;
    }
    final hasHour = byHour.any((c) => c > 0);
    var topModule = '—';
    var topCount = 0;
    byModule.forEach((m, c) {
      if (c > topCount) {
        topModule = m;
        topCount = c;
      }
    });
    final pct = items.isEmpty ? 0 : ((topCount / items.length) * 100).round();
    String hh(int h) => h.toString().padLeft(2, '0');

    return _LogStats(
      total: total,
      createCount: createL.length,
      updateCount: updateL.length,
      deleteCount: deleteL.length,
      totalSeries: _bucketCounts(timesOf(items), 14),
      createSeries: _bucketCounts(timesOf(createL), 14),
      updateSeries: _bucketCounts(timesOf(updateL), 14),
      deleteSeries: _bucketCounts(timesOf(deleteL), 14),
      busiestHour: hasHour ? '${hh(topHour)}:00 – ${hh((topHour + 1) % 24)}:00' : '—',
      topModule: topModule,
      topModulePct: pct,
      uniqueUsers: users.length,
      warnings: warnings,
    );
  }
}

/// Zaman damgalarını n eşit kovaya bölüp her kovadaki sayıyı döndürür.
List<int> _bucketCounts(List<DateTime> times, int n) {
  if (times.isEmpty) return List<int>.filled(n, 0);
  final ms = times.map((t) => t.millisecondsSinceEpoch).toList();
  final min = ms.reduce((a, b) => a < b ? a : b);
  final max = ms.reduce((a, b) => a > b ? a : b);
  final span = (max - min) < 1 ? 1 : (max - min);
  final b = List<int>.filled(n, 0);
  for (final t in ms) {
    final idx = (((t - min) / span) * n).floor().clamp(0, n - 1);
    b[idx]++;
  }
  return b;
}

// --------------------------------------------------------------------------
// Yardımcılar (web apiMappers paritesi)
// --------------------------------------------------------------------------

Map<String, dynamic>? _decodeData(Map<String, dynamic> log) {
  final raw = log['dataJson'];
  Map<String, dynamic>? data;
  if (raw is Map) {
    data = raw.cast<String, dynamic>();
  } else if (raw is String && raw.trim().isNotEmpty) {
    try {
      final decoded = jsonDecode(raw);
      if (decoded is Map) data = decoded.cast<String, dynamic>();
    } catch (_) {
      data = null;
    }
  }
  if (data == null) return null;
  // Teknik alanlar kullanıcıya gösterilmez.
  for (final k in const ['path', 'endpoint', 'traceId', 'method']) {
    data.remove(k);
  }
  return data.isEmpty ? null : data;
}

/// Cihaz güvenliği: deviceInfoJson'u çözer; iç içe networkInfoJson da açılır.
Map<String, dynamic>? _decodeDeviceInfo(Map<String, dynamic> log) {
  final raw = log['deviceInfoJson'];
  if (raw is! String || raw.trim().isEmpty) return null;
  try {
    final decoded = jsonDecode(raw);
    if (decoded is! Map) return null;
    final info = decoded.cast<String, dynamic>();
    final netRaw = info['networkInfoJson'];
    if (netRaw is String && netRaw.trim().isNotEmpty) {
      try {
        final net = jsonDecode(netRaw);
        if (net is Map) info['network'] = net.cast<String, dynamic>();
      } catch (_) {}
      info.remove('networkInfoJson');
    }
    return info;
  } catch (_) {
    return null;
  }
}

String? _networkSummary(Map<String, dynamic>? info) {
  final net = info?['network'];
  if (net is! Map) return null;
  final parts = <String>[
    if (net['effectiveType'] != null) '${net['effectiveType']}',
    if (net['connectionType'] != null) '${net['connectionType']}',
    if (net['downlinkMbps'] != null) '${net['downlinkMbps']} Mbps',
  ];
  return parts.isEmpty ? null : parts.join(' · ');
}

String? _networkDetail(Map<String, dynamic>? info) {
  final net = info?['network'];
  if (net is! Map) return null;
  final parts = <String>[
    if (net['effectiveType'] != null) 'Hız sınıfı: ${net['effectiveType']}',
    if (net['connectionType'] != null) 'Bağlantı: ${net['connectionType']}',
    if (net['downlinkMbps'] != null) '${net['downlinkMbps']} Mbps',
    if (net['rttMs'] != null) '${net['rttMs']} ms gecikme',
    if (net['screen'] != null) 'Ekran ${net['screen']}',
    if (net['timeZone'] != null) '${net['timeZone']}',
  ];
  return parts.isEmpty ? null : parts.join(' · ');
}

IconData _deviceTypeIcon(dynamic type) =>
    '${type ?? ''}'.toLowerCase() == 'mobile'
        ? Icons.smartphone_rounded
        : Icons.computer_rounded;

String _deviceTypeLabel(dynamic type) => switch ('${type ?? ''}'.toLowerCase()) {
      'mobile' => 'Cep Telefonu',
      'tablet' => 'Tablet',
      'pc' || 'desktop' => 'Bilgisayar',
      _ => 'Cihaz',
    };

/// Eski özetlerde gömülü "GET /api/..." gibi teknik kısımları gizler.
String _sanitizeSummary(String s) => s
    .replaceAll(
        RegExp(r'\b(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+/\S+\s*',
            caseSensitive: false),
        '')
    .replaceAll(RegExp(r'/api/\S+', caseSensitive: false), '')
    .replaceAll(RegExp(r'\s{2,}'), ' ')
    .trim();

const _auditActionLabels = <String, String>{
  'Create': 'Oluşturma',
  'Update': 'Güncelleme',
  'Delete': 'Silme',
  'View': 'Görüntüleme',
  'Change': 'Değişiklik',
  'Reschedule': 'Yeniden planlama',
  'ChangeStatus': 'Durum değişikliği',
  'ChangeNotes': 'Not güncelleme',
  'ChangePassword': 'Parola değişikliği',
  'ResetPassword': 'Şifre sıfırlama',
  'RegisterPayment': 'Tahsilat',
  'StockMovement': 'Stok hareketi',
  'PayCommission': 'Prim ödemesi',
  'AdjustLoyalty': 'Puan düzenleme',
  'Submit': 'Onaya gönderme',
  'Approve': 'Onaylama',
  'Reject': 'Reddetme',
  'Cancel': 'İptal',
  'Send': 'Gönderim',
  'Upgrade': 'Yükseltme',
  'Login': 'Giriş',
  'Logout': 'Çıkış',
  'Security.UnauthorizedDevice': 'Farklı Cihaz Girişimi',
  'Security.DeviceRegistered': 'Cihaz Tanımlandı',
  'Security.DeviceRemoved': 'Cihaz Silindi',
  'Security.DeviceLimitChanged': 'Cihaz Limiti',
  'Security.DeviceControlEnabled': 'Cihaz Güvenliği Açıldı',
  'Security.DeviceControlDisabled': 'Cihaz Güvenliği Kapatıldı',
};

const _auditEntityLabels = <String, String>{
  'Customer': 'Müşteri',
  'Appointment': 'Randevu',
  'Expense': 'Gider',
  'ExpenseCategory': 'Gider kategorisi',
  'Product': 'Ürün',
  'Staff': 'Personel',
  'StaffCommission': 'Prim',
  'StaffTimeOff': 'İzin',
  'CustomerAccount': 'Cari hesap',
  'AccountPayment': 'Tahsilat',
  'PendingOperation': 'Onay isteği',
  'Branch': 'Şube',
  'CashFlow': 'Kasa',
  'Feature': 'Özellik',
  'AuditLog': 'Log kayıtları',
  'Notification': 'Bildirim',
  'NotificationLog': 'Bildirim logu',
  'NotificationTemplate': 'Bildirim şablonu',
  'Service': 'Hizmet',
  'ServiceCategory': 'Hizmet kategorisi',
  'ServicePackage': 'Paket',
  'StockMovement': 'Stok hareketi',
  'Tenant': 'Kurum',
  'Usage': 'Kullanım',
  'Auth': 'Oturum',
  'ApiRequest': 'API isteği',
  'Adisyon': 'Adisyon',
  'Adisyonlar': 'Adisyon',
  'Campaign': 'Kampanya',
  'Campaigns': 'Kampanya',
  'LoyaltyTransaction': 'Sadakat puanı',
  'Loyalty': 'Sadakat',
  'Commissions': 'Prim',
  'Schedule': 'Çizelge',
  'Rating': 'Müşteri puanlama',
  'WhatsApp': 'WhatsApp',
  'SubscriptionPlan': 'Abonelik planı',
  'Security': 'Güvenlik',
};

const _auditRoleLabels = <String, String>{
  'PlatformAdmin': 'Platform Admin',
  'InstitutionOwner': 'Kurum Yöneticisi',
  'BranchManager': 'Şube Yöneticisi',
  'Staff': 'Personel',
};

String _actionLabel(String action) => _auditActionLabels[action] ?? action;
String _entityLabel(String entity) => _auditEntityLabels[entity] ?? entity;
String _roleLabel(String role) => _auditRoleLabels[role] ?? role;

const _violet = Color(0xFF8B5CF6);
const _sky = Color(0xFF3B82F6);
const _indigo = Color(0xFF6366F1);

(IconData, Color) _actionStyle(String action) => switch (action) {
      'Create' => (Icons.add_circle_outline_rounded, AppColors.success),
      'Update' => (Icons.edit_rounded, _violet),
      'Delete' => (Icons.delete_outline_rounded, AppColors.danger),
      'ChangeStatus' => (Icons.sync_rounded, AppColors.warning),
      'Reschedule' => (Icons.event_repeat_rounded, AppColors.warning),
      'ChangeNotes' => (Icons.notes_rounded, _violet),
      'RegisterPayment' => (Icons.payments_rounded, AppColors.success),
      'StockMovement' => (Icons.inventory_2_rounded, _sky),
      'Submit' => (Icons.outbox_rounded, AppColors.primary),
      'Approve' => (Icons.verified_user_rounded, _indigo),
      'Reject' => (Icons.report_gmailerrorred_rounded, AppColors.danger),
      'Cancel' => (Icons.cancel_outlined, AppColors.muted),
      'View' => (Icons.visibility_outlined, _sky),
      'ChangePassword' => (Icons.password_rounded, AppColors.warning),
      'ResetPassword' => (Icons.lock_reset_rounded, AppColors.warning),
      'PayCommission' => (Icons.payments_rounded, AppColors.success),
      'AdjustLoyalty' => (Icons.stars_rounded, _violet),
      'Send' => (Icons.send_rounded, _sky),
      'Upgrade' => (Icons.upgrade_rounded, AppColors.primary),
      'Login' => (Icons.login_rounded, AppColors.muted),
      'Logout' => (Icons.logout_rounded, AppColors.muted),
      'Security.UnauthorizedDevice' => (Icons.gpp_maybe_rounded, AppColors.danger),
      'Security.DeviceRegistered' => (Icons.devices_rounded, AppColors.success),
      'Security.DeviceRemoved' => (Icons.devices_rounded, AppColors.warning),
      'Security.DeviceLimitChanged' => (Icons.devices_rounded, _violet),
      'Security.DeviceControlEnabled' => (Icons.security_rounded, _indigo),
      'Security.DeviceControlDisabled' => (Icons.security_rounded, AppColors.muted),
      _ => (Icons.bolt_rounded, AppColors.primaryDark),
    };
