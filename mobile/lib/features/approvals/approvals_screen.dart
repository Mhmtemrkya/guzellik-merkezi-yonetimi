import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/theme/responsive.dart';
import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/json_helpers.dart';
import '../../shared/widgets/app_background.dart';
import '../../shared/widgets/page_header.dart';
import '../../shared/widgets/sparkline.dart';
import '../appointments/calendar_theme.dart';

/// Onay Bekleyenler — web `app/admin/onaylar` sayfasının mobil paritesi:
///  • Yönetici gelen kutusu: sonucu bekleyen randevular (Tamamlandı/Gelmedi) +
///    onay bekleyen taslaklar (Onayla/Reddet)
///  • 4 istatistik kartı (Bekleyen/Onaylanan/Reddedilen/Toplam) — düne göre
///    değişim + 14 günlük sparkline
///  • Onay işlemleri (pending-operations) sekmeli liste + Onayla/Reddet +
///    genişleyebilir "onaylanınca uygulanacak" detayı (replay payload'ı Türkçe)
///  • Onay Özeti: ortalama bekleme, en uzun bekleyen, bugün onaylanan/reddedilen
class ApprovalsScreen extends StatefulWidget {
  const ApprovalsScreen({required this.api, super.key});
  final ApiClient api;

  @override
  State<ApprovalsScreen> createState() => _ApprovalsScreenState();
}

enum _Tab { all, pending, approved, rejected }

class _ApprovalsScreenState extends State<ApprovalsScreen> {
  _Tab _tab = _Tab.pending;
  bool _busy = false;
  String? _expandedId;
  late Future<_InboxData> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<_InboxData> _load() async {
    final results = await Future.wait([
      widget.api
          .get('/api/admin/appointments/inbox')
          .catchError((_) => <String, dynamic>{}),
      widget.api.get(
        '/api/admin/pending-operations/',
        query: {'page': 1, 'pageSize': 500},
      ),
      // Şube adlarını çözebilmek için (yetki/limit hatası olursa boş geçilir).
      widget.api
          .get('/api/admin/branches/', query: {'page': 1, 'pageSize': 200})
          .catchError((_) => const <dynamic>[]),
    ]);
    final inbox = results[0];
    List<Map<String, dynamic>> grab(String key) {
      if (inbox is Map && inbox[key] is List) {
        return (inbox[key] as List)
            .whereType<Map>()
            .map((e) => e.cast<String, dynamic>())
            .toList();
      }
      return const [];
    }

    final branchNames = <String, String>{};
    for (final b in apiItems(results[2])) {
      final id = '${b['id'] ?? b['branchId'] ?? ''}';
      if (id.isEmpty) continue;
      branchNames[id] = valueOf(b, const ['name', 'branchName'], fallback: 'Şube');
    }

    return _InboxData(
      awaitingOutcome: grab('awaitingOutcome'),
      awaitingApproval: grab('awaitingApproval'),
      operations: apiItems(results[1]),
      branchNames: branchNames,
    );
  }

  void _reload() => setState(() {
        _future = _load();
      });

  Future<void> _run(Future<void> Function() task, String success) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await task();
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(success)));
      }
      _reload();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('$e')));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _rejectOp(Map<String, dynamic> op) async {
    final controller = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Reddet'),
        content: TextField(
          controller: controller,
          decoration: const InputDecoration(
            labelText: 'Red gerekçesi (opsiyonel)',
            hintText: 'Personele iletilecek kısa açıklama',
          ),
          maxLines: 2,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Vazgeç'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Reddet'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    await _run(
      () => widget.api.patch(
        '/api/admin/pending-operations/${op['id']}/reject',
        {
          'reason':
              controller.text.trim().isEmpty ? null : controller.text.trim(),
        },
      ),
      'İşlem reddedildi.',
    );
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
            child: FutureBuilder<_InboxData>(
              future: _future,
              builder: (context, snapshot) {
                final data = snapshot.data;
                return ListView(
                  padding: const EdgeInsets.fromLTRB(16, 20, 16, 110),
                  children: [
                    PageHeader(
                      eyebrow: 'Yönetim',
                      title: 'Onay Bekleyenler',
                      subtitle:
                          'Randevu sonuçları, taslak onayları ve personel işlemleri.',
                      action: IconButton(
                        onPressed: _busy ? null : _reload,
                        icon: const Icon(Icons.refresh_rounded),
                        color: AppColors.primaryDark,
                        tooltip: 'Yenile',
                      ),
                    ),
                    const SizedBox(height: 14),
                    if (snapshot.connectionState != ConnectionState.done)
                      const Padding(
                        padding: EdgeInsets.all(40),
                        child: Center(child: CircularProgressIndicator()),
                      )
                    else if (snapshot.hasError)
                      _errorBox('${snapshot.error}')
                    else ...[
                      // Gelen kutusu: saati gelen + onay bekleyen randevular
                      if (data!.awaitingOutcome.isNotEmpty) ...[
                        _sectionTitle('Sonucu bekleyen randevular',
                            data.awaitingOutcome.length, AppColors.warning),
                        for (final a in data.awaitingOutcome)
                          _appointmentCard(a, outcome: true),
                        const SizedBox(height: 8),
                      ],
                      if (data.awaitingApproval.isNotEmpty) ...[
                        _sectionTitle('Onay bekleyen taslaklar',
                            data.awaitingApproval.length, AppColors.primary),
                        for (final a in data.awaitingApproval)
                          _appointmentCard(a, outcome: false),
                        const SizedBox(height: 8),
                      ],
                      // İstatistik kartları
                      _StatGrid(stats: _OpStats.from(data.operations)),
                      const SizedBox(height: 18),
                      // Sekmeler
                      _tabs(data.operations),
                      const SizedBox(height: 12),
                      ..._filteredOps(data.operations)
                          .map((op) => _opCard(op, data.branchNames)),
                      if (_filteredOps(data.operations).isEmpty)
                        _emptyOps(),
                      const SizedBox(height: 20),
                      // Onay özeti
                      _SummaryCard(stats: _OpStats.from(data.operations)),
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

  List<Map<String, dynamic>> _filteredOps(List<Map<String, dynamic>> ops) {
    String? want;
    switch (_tab) {
      case _Tab.pending:
        want = 'pending';
      case _Tab.approved:
        want = 'approved';
      case _Tab.rejected:
        want = 'rejected';
      case _Tab.all:
        want = null;
    }
    if (want == null) return ops;
    return ops.where((o) => _opStatusKey(o['status']) == want).toList();
  }

  Widget _tabs(List<Map<String, dynamic>> ops) {
    int countOf(String s) =>
        ops.where((o) => _opStatusKey(o['status']) == s).length;
    final items = <(_Tab, String, int)>[
      (_Tab.all, 'Tümü', ops.length),
      (_Tab.pending, 'Bekleyenler', countOf('pending')),
      (_Tab.approved, 'Onaylanmış', countOf('approved')),
      (_Tab.rejected, 'Reddedilmiş', countOf('rejected')),
    ];
    return SizedBox(
      height: 38,
      child: ListView(
        scrollDirection: Axis.horizontal,
        children: [
          for (final it in items)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: GestureDetector(
                onTap: () => setState(() => _tab = it.$1),
                child: Container(
                  alignment: Alignment.center,
                  padding: const EdgeInsets.symmetric(horizontal: 14),
                  decoration: BoxDecoration(
                    color: _tab == it.$1 ? AppColors.primary : Colors.white,
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(
                      color: _tab == it.$1
                          ? AppColors.primary
                          : AppColors.border,
                    ),
                  ),
                  child: Text(
                    '${it.$2} (${it.$3})',
                    style: TextStyle(
                      color: _tab == it.$1 ? Colors.white : AppColors.ink,
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

  Widget _sectionTitle(String text, int count, Color color) => Padding(
        padding: const EdgeInsets.only(bottom: 8, top: 4),
        child: Row(
          children: [
            Container(
              width: 8,
              height: 8,
              decoration: BoxDecoration(color: color, shape: BoxShape.circle),
            ),
            const SizedBox(width: 8),
            Text(text,
                style:
                    const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
            const SizedBox(width: 6),
            Text('$count',
                style: const TextStyle(color: AppColors.muted, fontSize: 12)),
          ],
        ),
      );

  Widget _appointmentCard(Map<String, dynamic> a, {required bool outcome}) {
    final start = parseUtcToLocal(a['startUtc']);
    final time = start == null
        ? ''
        : '${CalendarText.hm(start)} · ${start.day}.${start.month}';
    final price = numberOf(a, const ['price']);
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(valueOf(a, const ['customerName', 'fullName']),
              style: const TextStyle(fontWeight: FontWeight.w800)),
          const SizedBox(height: 2),
          Text(
            '${valueOf(a, const ['serviceName'], fallback: '')} · ${valueOf(a, const ['staffName'], fallback: '')} · $time'
                '${price > 0 ? ' · ${_money(price)}' : ''}',
            style: const TextStyle(fontSize: 12, color: AppColors.muted),
          ),
          const SizedBox(height: 10),
          Row(
            children: outcome
                ? [
                    Expanded(
                      child: _btn('Tamamlandı', Icons.check_circle_rounded,
                          AppColors.success, () {
                        _run(
                          () => widget.api.patch(
                            '/api/admin/appointments/${a['id']}/status',
                            {'status': 'Completed', 'reason': null},
                          ),
                          'Randevu tamamlandı.',
                        );
                      }),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: _btn('Gelmedi', Icons.person_off_rounded,
                          AppColors.muted, () {
                        _run(
                          () => widget.api.patch(
                            '/api/admin/appointments/${a['id']}/status',
                            {'status': 'NoShow', 'reason': null},
                          ),
                          'Gelmedi olarak işaretlendi.',
                        );
                      }),
                    ),
                  ]
                : [
                    Expanded(
                      child: _btn('Onayla', Icons.check_rounded,
                          AppColors.success, () {
                        _run(
                          () => widget.api.post(
                              '/api/admin/appointments/${a['id']}/approve'),
                          'Taslak onaylandı.',
                        );
                      }),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: _btn('Reddet', Icons.close_rounded,
                          AppColors.danger, () {
                        _run(
                          () => widget.api
                              .delete('/api/admin/appointments/${a['id']}'),
                          'Taslak reddedildi.',
                        );
                      }),
                    ),
                  ],
          ),
        ],
      ),
    );
  }

  Widget _opCard(Map<String, dynamic> op, Map<String, String> branchNames) {
    final id = '${op['id']}';
    final statusKey = _opStatusKey(op['status']);
    final pending = statusKey == 'pending';
    final typeKey = _opTypeKey(op['operationType']);
    final payload = _decodePayload(op);
    final (custName, custPhone) = _extractCustomer(op, payload);
    final branchId = '${op['branchId'] ?? ''}';
    final branch = branchNames[branchId] ?? 'Merkez';
    final requestedBy =
        valueOf(op, const ['requestedByName'], fallback: 'Personel');
    final requestedAt = parseUtcToLocal(op['requestedAtUtc']);
    final dateText =
        requestedAt == null ? '' : DateFormat('d MMM, HH:mm', 'tr_TR').format(requestedAt);
    final expanded = _expandedId == id;
    final reason = valueOf(op, const ['rejectionReason'], fallback: '');

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
            onTap: () => setState(() => _expandedId = expanded ? null : id),
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        width: 36,
                        height: 36,
                        decoration: BoxDecoration(
                          color: AppColors.surfaceSoft,
                          borderRadius: BorderRadius.circular(11),
                        ),
                        child: Icon(_opTypeIcon(typeKey),
                            color: AppColors.primaryDark, size: 18),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              valueOf(op, const ['title'],
                                  fallback: _opTypeLabel(typeKey)),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                  fontWeight: FontWeight.w800, fontSize: 13.5),
                            ),
                            const SizedBox(height: 1),
                            Text(
                              _opTypeLabel(typeKey),
                              style: const TextStyle(
                                  color: AppColors.muted, fontSize: 11),
                            ),
                          ],
                        ),
                      ),
                      _statusChip(statusKey),
                      const SizedBox(width: 4),
                      Icon(
                        expanded
                            ? Icons.expand_less_rounded
                            : Icons.expand_more_rounded,
                        color: AppColors.muted,
                        size: 20,
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  // Müşteri + personel + şube + tarih meta satırı
                  Wrap(
                    spacing: 12,
                    runSpacing: 4,
                    children: [
                      _meta(Icons.person_outline_rounded,
                          custName + (custPhone.isNotEmpty ? ' · $custPhone' : '')),
                      _meta(Icons.badge_outlined, requestedBy),
                      _meta(Icons.store_mall_directory_outlined, branch),
                      if (dateText.isNotEmpty)
                        _meta(Icons.schedule_rounded, dateText),
                    ],
                  ),
                  if (pending) ...[
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Expanded(
                          child: _btn('Onayla', Icons.check_rounded,
                              AppColors.success, () {
                            _run(
                              () => widget.api.patch(
                                  '/api/admin/pending-operations/$id/approve'),
                              'İşlem onaylandı.',
                            );
                          }),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: _btn('Reddet', Icons.close_rounded,
                              AppColors.danger, () => _rejectOp(op)),
                        ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ),
          // Genişleyen detay: "onaylanınca uygulanacak" / payload alanları
          AnimatedSize(
            duration: const Duration(milliseconds: 200),
            curve: Curves.easeOut,
            child: expanded
                ? _opDetail(op, payload, typeKey, pending, reason)
                : const SizedBox(width: double.infinity),
          ),
        ],
      ),
    );
  }

  Widget _opDetail(
    Map<String, dynamic> op,
    Map<String, dynamic>? payload,
    String typeKey,
    bool pending,
    String reason,
  ) {
    final isReplay = _isReplayOp(payload);
    final fields = isReplay
        ? _replayBodyFields(payload!)
        : (payload?.entries
                .take(9)
                .map((e) => (
                      _fieldTr[e.key] ?? e.key,
                      e.value == null
                          ? '—'
                          : (e.value is Map || e.value is List
                              ? jsonEncode(e.value)
                              : '${e.value}'),
                    ))
                .toList() ??
            const <(String, String)>[]);
    final summary = valueOf(op, const ['summary'], fallback: '');
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(14, 0, 14, 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Divider(height: 1, color: AppColors.border),
          const SizedBox(height: 10),
          if (isReplay)
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(Icons.auto_awesome_rounded,
                    size: 15, color: AppColors.primary),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    'Onaylanınca uygulanacak: ${valueOf(op, const ['title'])}',
                    style: const TextStyle(
                        fontSize: 12.5, color: AppColors.ink, height: 1.3),
                  ),
                ),
              ],
            )
          else if (summary.isNotEmpty)
            Text(summary,
                style: const TextStyle(fontSize: 12.5, color: AppColors.muted)),
          if (fields.isNotEmpty) ...[
            const SizedBox(height: 10),
            ...fields.map((f) => Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Container(
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(
                        horizontal: 10, vertical: 7),
                    decoration: BoxDecoration(
                      color: AppColors.surfaceSoft,
                      borderRadius: BorderRadius.circular(9),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(f.$1,
                            style: const TextStyle(
                                fontSize: 10,
                                color: AppColors.primaryDark,
                                fontWeight: FontWeight.w700)),
                        const SizedBox(height: 1),
                        Text(f.$2,
                            style: const TextStyle(
                                fontSize: 12.5, color: AppColors.ink)),
                      ],
                    ),
                  ),
                )),
          ],
          if (!pending && reason.isNotEmpty) ...[
            const SizedBox(height: 8),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(Icons.info_outline_rounded,
                    size: 14, color: AppColors.danger),
                const SizedBox(width: 6),
                Expanded(
                  child: Text('Red gerekçesi: $reason',
                      style: const TextStyle(
                          fontSize: 12, color: AppColors.danger)),
                ),
              ],
            ),
          ],
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
            constraints: const BoxConstraints(maxWidth: 200),
            child: Text(text,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 11.5, color: AppColors.muted)),
          ),
        ],
      );

  Widget _statusChip(String key) {
    final (label, color) = switch (key) {
      'approved' => ('Onaylandı', AppColors.success),
      'rejected' => ('Reddedildi', AppColors.danger),
      'cancelled' => ('İptal', AppColors.muted),
      _ => ('Bekliyor', AppColors.warning),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: .1),
        borderRadius: BorderRadius.circular(99),
        border: Border.all(color: color.withValues(alpha: .25)),
      ),
      child: Text(label,
          style: TextStyle(
              color: color, fontSize: 10, fontWeight: FontWeight.w800)),
    );
  }

  Widget _emptyOps() => Padding(
        padding: const EdgeInsets.symmetric(vertical: 36),
        child: Center(
          child: Column(
            children: [
              Icon(Icons.check_circle_outline_rounded,
                  size: 38, color: AppColors.success.withValues(alpha: .6)),
              const SizedBox(height: 10),
              Text(
                _tab == _Tab.pending
                    ? 'Bekleyen onay yok. Tüm işlemler karara bağlanmış.'
                    : 'Bu kategoride işlem yok.',
                textAlign: TextAlign.center,
                style: const TextStyle(color: AppColors.muted, fontSize: 13),
              ),
            ],
          ),
        ),
      );

  Widget _btn(String label, IconData icon, Color color, VoidCallback onTap) {
    return OutlinedButton.icon(
      style: OutlinedButton.styleFrom(
        foregroundColor: color,
        side: BorderSide(color: color.withValues(alpha: .4)),
        minimumSize: const Size.fromHeight(42),
        padding: const EdgeInsets.symmetric(horizontal: 6),
      ),
      onPressed: _busy ? null : onTap,
      icon: Icon(icon, size: 17),
      label: Text(label,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
    );
  }

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

  String _money(double v) => NumberFormat.currency(
        locale: 'tr_TR',
        symbol: '₺',
        decimalDigits: v == v.roundToDouble() ? 0 : 2,
      ).format(v);
}

// --------------------------------------------------------------------------
// İstatistik kartları (web 'STAT CARDS' paritesi)
// --------------------------------------------------------------------------

class _StatGrid extends StatelessWidget {
  const _StatGrid({required this.stats});
  final _OpStats stats;

  @override
  Widget build(BuildContext context) {
    final cards = <_StatCardData>[
      _StatCardData('Bekleyen', stats.pending, Icons.schedule_rounded,
          AppColors.warning),
      _StatCardData('Onaylanan', stats.approved, Icons.check_circle_rounded,
          AppColors.success),
      _StatCardData('Reddedilen', stats.rejected, Icons.cancel_rounded,
          AppColors.danger),
      _StatCardData(
          'Toplam', stats.total, Icons.layers_rounded, AppColors.primaryDark),
    ];
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: cards.length,
      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: gridCols(context, 2),
        crossAxisSpacing: 10,
        mainAxisSpacing: 10,
        mainAxisExtent: 118,
      ),
      itemBuilder: (context, i) => _StatCard(data: cards[i]),
    );
  }
}

class _StatCardData {
  _StatCardData(this.label, this.metric, this.icon, this.color);
  final String label;
  final _Metric metric;
  final IconData icon;
  final Color color;
}

class _StatCard extends StatelessWidget {
  const _StatCard({required this.data});
  final _StatCardData data;

  @override
  Widget build(BuildContext context) {
    final m = data.metric;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
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
                if (m.delta != null)
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        m.delta! >= 0
                            ? Icons.trending_up_rounded
                            : Icons.trending_down_rounded,
                        size: 13,
                        color: m.delta! >= 0
                            ? AppColors.success
                            : AppColors.danger,
                      ),
                      const SizedBox(width: 2),
                      Text(
                        '%${m.delta!.abs()}',
                        style: TextStyle(
                          fontSize: 10.5,
                          fontWeight: FontWeight.w700,
                          color: m.delta! >= 0
                              ? AppColors.success
                              : AppColors.danger,
                        ),
                      ),
                    ],
                  ),
              ],
            ),
            const Spacer(),
            Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text('${m.value}',
                    style: const TextStyle(
                        fontWeight: FontWeight.w900, fontSize: 22)),
                const Spacer(),
                SizedBox(
                  width: 56,
                  height: 26,
                  child: Sparkline(values: m.series, color: data.color),
                ),
              ],
            ),
            const SizedBox(height: 2),
            Text(data.label,
                style: const TextStyle(color: AppColors.muted, fontSize: 11.5)),
            Text('Dün: ${m.yesterday}',
                style: const TextStyle(color: AppColors.muted, fontSize: 10)),
          ],
        ),
      ),
    );
  }
}

// --------------------------------------------------------------------------
// Onay Özeti (web 'ONAY ÖZETİ' paritesi)
// --------------------------------------------------------------------------

class _SummaryCard extends StatelessWidget {
  const _SummaryCard({required this.stats});
  final _OpStats stats;

  @override
  Widget build(BuildContext context) {
    final tiles = <(IconData, Color, String, String, String)>[
      (
        Icons.timer_outlined,
        AppColors.primaryDark,
        'Ort. Bekleme Süresi',
        _fmtDur(stats.avgWaitMs),
        'Dün: ${_fmtDur(stats.yesterdayAvgWaitMs)}',
      ),
      (
        Icons.hourglass_bottom_rounded,
        AppColors.warning,
        'En Uzun Bekleyen',
        _fmtDur(stats.longestPendingMs),
        stats.longestPendingLabel,
      ),
      (
        Icons.check_circle_outline_rounded,
        AppColors.success,
        'Bugün Onaylanan',
        '${stats.todayApproved}',
        '%${stats.successRate} başarı oranı',
      ),
      (
        Icons.highlight_off_rounded,
        AppColors.danger,
        'Bugün Reddedilen',
        '${stats.todayRejected}',
        '%${stats.rejectRate} ret oranı',
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
                const Text('Onay Özeti',
                    style: TextStyle(
                        fontWeight: FontWeight.w800, fontSize: 14.5)),
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
                              fontWeight: FontWeight.w900, fontSize: 15)),
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
// Veri & istatistik hesaplama
// --------------------------------------------------------------------------

class _InboxData {
  _InboxData({
    required this.awaitingOutcome,
    required this.awaitingApproval,
    required this.operations,
    required this.branchNames,
  });
  final List<Map<String, dynamic>> awaitingOutcome;
  final List<Map<String, dynamic>> awaitingApproval;
  final List<Map<String, dynamic>> operations;
  final Map<String, String> branchNames;
}

class _Metric {
  _Metric(this.value, this.yesterday, this.delta, this.series);
  final int value;
  final int yesterday;
  final int? delta; // % değişim (dün 0 ise null)
  final List<int> series; // son 14 gün
}

/// Onay işlemlerinden web ile aynı istatistikleri türetir.
class _OpStats {
  _OpStats({
    required this.pending,
    required this.approved,
    required this.rejected,
    required this.total,
    required this.avgWaitMs,
    required this.yesterdayAvgWaitMs,
    required this.longestPendingMs,
    required this.longestPendingLabel,
    required this.todayApproved,
    required this.todayRejected,
    required this.successRate,
    required this.rejectRate,
  });

  final _Metric pending;
  final _Metric approved;
  final _Metric rejected;
  final _Metric total;
  final double avgWaitMs;
  final double yesterdayAvgWaitMs;
  final double longestPendingMs;
  final String longestPendingLabel;
  final int todayApproved;
  final int todayRejected;
  final int successRate;
  final int rejectRate;

  static _OpStats from(List<Map<String, dynamic>> ops) {
    final now = DateTime.now();
    String dayKey(DateTime d) => '${d.year}-${d.month}-${d.day}';
    final todayKey = dayKey(now);
    final yKey = dayKey(now.subtract(const Duration(days: 1)));

    List<int> bucket(List<DateTime> times) {
      const n = 14;
      final start = now.subtract(const Duration(days: n));
      final b = List<int>.filled(n, 0);
      for (final t in times) {
        if (t.isBefore(start) || t.isAfter(now)) continue;
        final idx = t.difference(start).inDays.clamp(0, n - 1);
        b[idx]++;
      }
      return b;
    }

    _Metric metric(
        List<Map<String, dynamic>> list, DateTime? Function(Map<String, dynamic>) dateOf) {
      final times = list.map(dateOf).whereType<DateTime>().toList();
      final today = times.where((t) => dayKey(t) == todayKey).length;
      final yest = times.where((t) => dayKey(t) == yKey).length;
      return _Metric(
        list.length,
        yest,
        yest > 0 ? (((today - yest) / yest) * 100).round() : null,
        bucket(times),
      );
    }

    final pending =
        ops.where((o) => _opStatusKey(o['status']) == 'pending').toList();
    final approved =
        ops.where((o) => _opStatusKey(o['status']) == 'approved').toList();
    final rejected =
        ops.where((o) => _opStatusKey(o['status']) == 'rejected').toList();

    DateTime? reqAt(Map<String, dynamic> o) => parseUtcToLocal(o['requestedAtUtc']);
    DateTime? decAt(Map<String, dynamic> o) => parseUtcToLocal(o['decidedAtUtc']);

    // Ortalama bekleme (karara bağlananlar: decided - requested)
    final decided = [...approved, ...rejected];
    final waits = <double>[];
    final yWaits = <double>[];
    for (final o in decided) {
      final r = reqAt(o);
      final d = decAt(o);
      if (r == null || d == null) continue;
      final w = d.difference(r).inMilliseconds.toDouble();
      if (w < 0) continue;
      waits.add(w);
      if (dayKey(d) == yKey) yWaits.add(w);
    }
    double avg(List<double> xs) =>
        xs.isEmpty ? 0 : xs.reduce((a, b) => a + b) / xs.length;

    // En uzun bekleyen (pending: now - requested)
    var longest = 0.0;
    var longestLabel = '—';
    for (final o in pending) {
      final r = reqAt(o);
      if (r == null) continue;
      final w = now.difference(r).inMilliseconds.toDouble();
      if (w > longest) {
        longest = w;
        longestLabel = _opTypeLabel(_opTypeKey(o['operationType']));
      }
    }

    final todayApproved =
        approved.where((o) => decAt(o) != null && dayKey(decAt(o)!) == todayKey).length;
    final todayRejected =
        rejected.where((o) => decAt(o) != null && dayKey(decAt(o)!) == todayKey).length;
    final todayDecided = todayApproved + todayRejected;

    return _OpStats(
      pending: metric(pending, reqAt),
      approved: metric(approved, decAt),
      rejected: metric(rejected, decAt),
      total: metric(ops, reqAt),
      avgWaitMs: avg(waits),
      yesterdayAvgWaitMs: avg(yWaits),
      longestPendingMs: longest,
      longestPendingLabel: longestLabel,
      todayApproved: todayApproved,
      todayRejected: todayRejected,
      successRate:
          todayDecided > 0 ? ((todayApproved / todayDecided) * 100).round() : 0,
      rejectRate:
          todayDecided > 0 ? ((todayRejected / todayDecided) * 100).round() : 0,
    );
  }
}

// --------------------------------------------------------------------------
// Yardımcılar (web apiMappers / onaylar sayfası paritesi)
// --------------------------------------------------------------------------

String _fmtDur(double ms) {
  if (ms <= 0 || ms.isNaN) return '—';
  final h = (ms / 3600000).floor();
  final m = ((ms % 3600000) / 60000).floor();
  return h > 0 ? '${h}s ${m}dk' : '${m}dk';
}

/// Backend enum'u int (varsayılan) veya string gelebilir → tür anahtarı.
const _opTypeByInt = <int, String>{
  0: 'createcustomer',
  1: 'updatecustomer',
  2: 'deletecustomer',
  10: 'createappointment',
  11: 'updateappointment',
  12: 'changeappointmentstatus',
  13: 'deleteappointment',
  20: 'createexpense',
  21: 'deleteexpense',
  30: 'createaccount',
  31: 'registeraccountpayment',
  32: 'rescheduleaccount',
  40: 'createstockmovement',
  41: 'createproduct',
  100: 'httpreplay',
  99: 'other',
};

String _opTypeKey(dynamic value) {
  if (value is num) return _opTypeByInt[value.toInt()] ?? 'other';
  final s = '$value';
  final asInt = int.tryParse(s);
  if (asInt != null) return _opTypeByInt[asInt] ?? 'other';
  return s.toLowerCase();
}

const _opTypeLabels = <String, String>{
  'createcustomer': 'Müşteri ekleme',
  'updatecustomer': 'Müşteri güncelleme',
  'deletecustomer': 'Müşteri silme',
  'createappointment': 'Yeni randevu',
  'updateappointment': 'Randevu güncelleme',
  'changeappointmentstatus': 'Randevu durumu',
  'deleteappointment': 'Randevu silme',
  'createexpense': 'Gider ekleme',
  'deleteexpense': 'Gider silme',
  'createaccount': 'Cari hesap aç',
  'registeraccountpayment': 'Tahsilat al',
  'rescheduleaccount': 'Taksit değiştir',
  'createstockmovement': 'Stok hareketi',
  'createproduct': 'Ürün ekleme',
  'httpreplay': 'Personel işlemi',
  'other': 'Diğer',
};

String _opTypeLabel(String key) => _opTypeLabels[key] ?? 'Diğer';

IconData _opTypeIcon(String key) {
  if (key.contains('customer')) return Icons.person_rounded;
  if (key.contains('appointment')) return Icons.event_rounded;
  if (key.contains('expense')) return Icons.account_balance_wallet_rounded;
  if (key.contains('account') || key.contains('payment')) {
    return Icons.credit_card_rounded;
  }
  if (key.contains('stock') || key.contains('product')) {
    return Icons.inventory_2_rounded;
  }
  return Icons.description_rounded;
}

/// Backend enum'u int (0..3) veya string gelebilir → durum anahtarı.
String _opStatusKey(dynamic value) {
  if (value is num) {
    const m = {0: 'pending', 1: 'approved', 2: 'rejected', 3: 'cancelled'};
    return m[value.toInt()] ?? 'pending';
  }
  final s = '$value';
  final asInt = int.tryParse(s);
  if (asInt != null) {
    const m = {0: 'pending', 1: 'approved', 2: 'rejected', 3: 'cancelled'};
    return m[asInt] ?? 'pending';
  }
  return s.toLowerCase();
}

Map<String, dynamic>? _decodePayload(Map<String, dynamic> op) {
  final raw = op['payloadJson'];
  if (raw is Map) return raw.cast<String, dynamic>();
  if (raw is String && raw.trim().isNotEmpty) {
    try {
      final decoded = jsonDecode(raw);
      if (decoded is Map) return decoded.cast<String, dynamic>();
    } catch (_) {}
  }
  return null;
}

bool _isReplayOp(Map<String, dynamic>? payload) =>
    payload != null && payload['path'] is String && payload['method'] is String;

const _statusTr = <String, String>{
  'Completed': 'Tamamlandı',
  'Cancelled': 'İptal',
  'Canceled': 'İptal',
  'Confirmed': 'Onaylandı',
  'Scheduled': 'Planlandı',
  'NoShow': 'Gelmedi',
  'Draft': 'Taslak',
};

const _fieldTr = <String, String>{
  'status': 'Yeni durum',
  'reason': 'Gerekçe',
  'notes': 'Not',
  'note': 'Not',
  'fullName': 'Ad Soyad',
  'name': 'Ad',
  'phone': 'Telefon',
  'email': 'E-posta',
  'title': 'Unvan',
  'specialties': 'Uzmanlık',
  'amount': 'Tutar',
  'price': 'Fiyat',
  'isActive': 'Aktif',
  'branchId': 'Şube',
};

/// HttpReplay payload'ındaki body alanlarını okunur Türkçe (etiket, değer) listesi yapar.
List<(String, String)> _replayBodyFields(Map<String, dynamic> payload) {
  Map<String, dynamic> body = const {};
  final raw = payload['body'];
  try {
    if (raw is String && raw.isNotEmpty) {
      final decoded = jsonDecode(raw);
      if (decoded is Map) body = decoded.cast<String, dynamic>();
    } else if (raw is Map) {
      body = raw.cast<String, dynamic>();
    }
  } catch (_) {
    body = const {};
  }
  final out = <(String, String)>[];
  body.forEach((k, v) {
    if (v == null || '$v'.isEmpty) return;
    var val = v is bool
        ? (v ? 'Evet' : 'Hayır')
        : (v is Map || v is List ? jsonEncode(v) : '$v');
    if (k == 'status') val = _statusTr[val] ?? val;
    out.add((_fieldTr[k] ?? k, val));
  });
  return out;
}

bool _looksPhone(String s) => RegExp(r'\d{6,}').hasMatch(s.replaceAll(' ', ''));

/// İşlemden müşteri ad/telefonunu çıkarır (web extractCustomer paritesi).
(String, String) _extractCustomer(
    Map<String, dynamic> op, Map<String, dynamic>? payload) {
  final p = payload ?? const {};
  String str(dynamic v) => v is String ? v : '';
  var name = str(p['fullName']);
  if (name.isEmpty) name = str(p['customerName']);
  if (name.isEmpty) name = str(p['name']);
  final title = '${op['title'] ?? ''}';
  if (name.isEmpty && title.contains(':')) {
    name = title.split(':').skip(1).join(':').trim();
  }
  final summary = '${op['summary'] ?? ''}';
  var phone = str(p['phone']);
  if (phone.isEmpty) phone = str(p['customerPhone']);
  if (phone.isEmpty && _looksPhone(summary)) phone = summary;
  return (name.isEmpty ? '—' : name, phone);
}
