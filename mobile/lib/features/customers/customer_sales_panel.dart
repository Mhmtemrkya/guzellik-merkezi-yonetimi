import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/json_helpers.dart';

/// Müşteri kartındaki "Paket & Hizmet Satışları" paneli (web paritesi).
///
/// Aktif / tamamlanmış (seansı biten) / iptal edilmiş satışları listeler; her satırda satış tarihi,
/// SATAN PERSONEL, seans ve ödeme durumu bulunur. Satıra dokununca satış detayı açılır (kapsam +
/// aylık taksitler; aya dokununca taksit ayrıntısı ve tahsilat). "Geçmiş satış ekle" ile yazılıma
/// geçmeden önce yapılmış satışlar da sisteme girilir.

const _statusMeta = <String, (String, Color)>{
  'Active': ('Devam ediyor', AppColors.success),
  'Completed': ('Tamamlandı', Color(0xFF3B82F6)),
  'Cancelled': ('İptal', AppColors.danger),
};

String _saleStatus(Map<String, dynamic> a) {
  final s = '${a['saleStatus'] ?? 'Active'}';
  return _statusMeta.containsKey(s) ? s : 'Active';
}

String _fmtDate(dynamic iso) {
  final d = parseUtcToLocal(iso);
  if (d == null) return '—';
  return DateFormat('d MMM yyyy', 'tr_TR').format(d);
}

String _money(num? v) => NumberFormat.currency(locale: 'tr_TR', symbol: '₺', decimalDigits: 0)
    .format(v ?? 0);

class CustomerSalesPanel extends StatefulWidget {
  const CustomerSalesPanel({
    required this.api,
    required this.customerId,
    required this.customerName,
    required this.accounts,
    required this.onChanged,
    this.canManage = true,
    super.key,
  });

  final ApiClient api;
  final String customerId;
  final String customerName;
  final List<Map<String, dynamic>> accounts;
  final Future<void> Function() onChanged;
  final bool canManage;

  @override
  State<CustomerSalesPanel> createState() => _CustomerSalesPanelState();
}

class _CustomerSalesPanelState extends State<CustomerSalesPanel> {
  String _filter = 'all';

  @override
  Widget build(BuildContext context) {
    // Satış tarihine göre yeni → eski (geçmiş kayıtlar da doğru yere oturur).
    final sorted = [...widget.accounts]
      ..sort((a, b) => '${b['soldAtUtc'] ?? b['createdAtUtc'] ?? ''}'
          .compareTo('${a['soldAtUtc'] ?? a['createdAtUtc'] ?? ''}'));
    final counts = <String, int>{'all': sorted.length, 'Active': 0, 'Completed': 0, 'Cancelled': 0};
    for (final a in sorted) {
      counts[_saleStatus(a)] = (counts[_saleStatus(a)] ?? 0) + 1;
    }
    final visible = _filter == 'all' ? sorted : sorted.where((a) => _saleStatus(a) == _filter).toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const Expanded(
              child: Text(
                'Aktif, biten ve iptal edilen satışlar',
                style: TextStyle(color: AppColors.muted, fontSize: 11.5),
              ),
            ),
            if (widget.canManage)
              TextButton.icon(
                onPressed: _openHistoricalForm,
                icon: const Icon(Icons.history_rounded, size: 16),
                label: const Text('Geçmiş satış'),
                style: TextButton.styleFrom(
                  foregroundColor: AppColors.primaryDark,
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                  visualDensity: VisualDensity.compact,
                ),
              ),
          ],
        ),
        if (sorted.isNotEmpty) ...[
          const SizedBox(height: 6),
          Wrap(
            spacing: 6,
            children: [
              for (final f in [
                ('all', 'Tümü'),
                ('Active', 'Devam eden'),
                ('Completed', 'Biten'),
                ('Cancelled', 'İptal'),
              ])
                if (f.$1 == 'all' || (counts[f.$1] ?? 0) > 0)
                  ChoiceChip(
                    label: Text('${f.$2} ${counts[f.$1] ?? 0}'),
                    selected: _filter == f.$1,
                    labelStyle: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      color: _filter == f.$1 ? Colors.white : AppColors.muted,
                    ),
                    selectedColor: AppColors.primaryDark,
                    onSelected: (_) => setState(() => _filter = f.$1),
                  ),
            ],
          ),
        ],
        const SizedBox(height: 8),
        if (visible.isEmpty)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(vertical: 18, horizontal: 12),
            decoration: BoxDecoration(
              color: AppColors.surfaceSoft,
              borderRadius: BorderRadius.circular(14),
            ),
            child: Text(
              sorted.isEmpty
                  ? 'Paket veya hizmet satışı yok. Geçmiş satışları da buradan girebilirsiniz.'
                  : 'Bu durumda satış yok.',
              textAlign: TextAlign.center,
              style: const TextStyle(color: AppColors.muted, fontSize: 12),
            ),
          )
        else
          for (final a in visible) _saleRow(a),
      ],
    );
  }

  Widget _saleRow(Map<String, dynamic> a) {
    final status = _saleStatus(a);
    final (label, color) = _statusMeta[status]!;
    final total = numberOf(a, const ['totalAmount']);
    final paid = numberOf(a, const ['paidAmount']);
    final remaining = numberOf(a, const ['remainingAmount']);
    final st = numberOf(a, const ['sessionsTotal']).toInt();
    final su = numberOf(a, const ['sessionsUsed']).toInt();
    final pct = total > 0 ? (paid / total).clamp(0.0, 1.0) : 1.0;
    final staff = '${a['soldByStaffName'] ?? ''}'.trim();
    final reason = '${a['cancellationReason'] ?? ''}'.trim();

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: status == 'Cancelled' ? AppColors.surfaceSoft : AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: () => _openDetail(a),
        child: Padding(
          padding: const EdgeInsets.all(11),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      valueOf(a, const ['name']),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13),
                    ),
                  ),
                  Text(_money(total),
                      style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 13)),
                ],
              ),
              const SizedBox(height: 5),
              Wrap(
                spacing: 6,
                runSpacing: 4,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  _pill(label, color),
                  if (a['isHistorical'] == true) _pill('Geçmiş kayıt', const Color(0xFF6B4AA0)),
                  _meta(Icons.event_rounded, _fmtDate(a['soldAtUtc'] ?? a['createdAtUtc'])),
                  if (staff.isNotEmpty) _meta(Icons.person_rounded, staff),
                  if (st > 0) _meta(Icons.confirmation_number_rounded, '$su/$st seans'),
                ],
              ),
              if (status == 'Cancelled' && reason.isNotEmpty) ...[
                const SizedBox(height: 4),
                Text('Gerekçe: $reason',
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                        fontSize: 10.5, fontStyle: FontStyle.normal, color: AppColors.danger)),
              ],
              const SizedBox(height: 7),
              Row(
                children: [
                  Expanded(
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(3),
                      child: LinearProgressIndicator(
                        value: pct,
                        minHeight: 5,
                        backgroundColor: AppColors.surfaceSoft,
                        valueColor: AlwaysStoppedAnimation(
                            remaining > 0.005 ? AppColors.primary : AppColors.success),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    remaining > 0.005 ? '${_money(remaining)} kalan' : 'Ödendi',
                    style: TextStyle(
                      fontSize: 10.5,
                      fontWeight: FontWeight.w700,
                      color: remaining > 0.005 ? AppColors.danger : AppColors.success,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _pill(String text, Color color) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
        decoration: BoxDecoration(
          color: color.withValues(alpha: .1),
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: color.withValues(alpha: .35)),
        ),
        child: Text(text,
            style: TextStyle(fontSize: 9.5, fontWeight: FontWeight.w800, color: color)),
      );

  Widget _meta(IconData icon, String text) => Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 11, color: AppColors.primaryDark),
          const SizedBox(width: 3),
          Text(text, style: const TextStyle(fontSize: 10.5, color: AppColors.muted)),
        ],
      );

  Future<void> _openDetail(Map<String, dynamic> account) async {
    final changed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => SaleDetailSheet(
        api: widget.api,
        account: account,
        customerName: widget.customerName,
        canManage: widget.canManage,
      ),
    );
    if (changed == true) await widget.onChanged();
  }

  Future<void> _openHistoricalForm() async {
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => HistoricalSaleSheet(
        api: widget.api,
        customerId: widget.customerId,
        customerName: widget.customerName,
      ),
    );
    if (saved == true) await widget.onChanged();
  }
}

// ------------------------------------------------------------------ detay ---

/// Satış detayı: kapsam (hizmet adı + tutarı) ve aylık taksitler; aya dokununca ayrıntı + tahsilat.
class SaleDetailSheet extends StatefulWidget {
  const SaleDetailSheet({
    required this.api,
    required this.account,
    required this.customerName,
    this.canManage = true,
    super.key,
  });

  final ApiClient api;
  final Map<String, dynamic> account;
  final String customerName;
  final bool canManage;

  @override
  State<SaleDetailSheet> createState() => _SaleDetailSheetState();
}

class _SaleDetailSheetState extends State<SaleDetailSheet> {
  late Map<String, dynamic> _a = widget.account;
  String? _openInstallment;
  bool _busy = false;
  bool _changed = false;

  Future<void> _refresh() async {
    final res = await widget.api.get('/api/admin/accounts/${_a['id']}');
    if (res is Map && mounted) setState(() => _a = res.cast<String, dynamic>());
  }

  Future<void> _run(Future<void> Function() fn) async {
    setState(() => _busy = true);
    try {
      await fn();
      _changed = true;
      await _refresh();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final status = _saleStatus(_a);
    final (label, color) = _statusMeta[status]!;
    final total = numberOf(_a, const ['totalAmount']);
    final paid = numberOf(_a, const ['paidAmount']);
    final remaining = numberOf(_a, const ['remainingAmount']);
    final st = numberOf(_a, const ['sessionsTotal']).toInt();
    final su = numberOf(_a, const ['sessionsUsed']).toInt();
    final items = apiItems(_a['items']);
    final installments = apiItems(_a['installments'])
      ..sort((x, y) => numberOf(x, const ['no']).compareTo(numberOf(y, const ['no'])));
    final staff = '${_a['soldByStaffName'] ?? ''}'.trim();

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) Navigator.pop(context, _changed);
      },
      child: DraggableScrollableSheet(
        initialChildSize: .88,
        minChildSize: .5,
        maxChildSize: .95,
        expand: false,
        builder: (context, controller) => Container(
          decoration: const BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
          ),
          child: Column(
            children: [
              const SizedBox(height: 10),
              Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: AppColors.surfaceSoft,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              Expanded(
                child: ListView(
                  controller: controller,
                  padding: const EdgeInsets.fromLTRB(16, 14, 16, 20),
                  children: [
                    // Başlık
                    Wrap(
                      spacing: 6,
                      runSpacing: 4,
                      children: [
                        _chip(label, color),
                        if (_a['isHistorical'] == true) _chip('Geçmiş kayıt', const Color(0xFF6B4AA0)),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(valueOf(_a, const ['name']),
                        style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 18)),
                    const SizedBox(height: 6),
                    Wrap(
                      spacing: 12,
                      runSpacing: 4,
                      children: [
                        _metaRow(Icons.person_rounded, widget.customerName),
                        _metaRow(Icons.event_rounded, _fmtDate(_a['soldAtUtc'] ?? _a['createdAtUtc'])),
                        if (staff.isNotEmpty) _metaRow(Icons.badge_rounded, 'Satan: $staff'),
                      ],
                    ),

                    if (status == 'Cancelled') ...[
                      const SizedBox(height: 10),
                      Container(
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: AppColors.danger.withValues(alpha: .08),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: AppColors.danger.withValues(alpha: .3)),
                        ),
                        child: Text(
                          'İptal edildi · ${_fmtDate(_a['cancelledAtUtc'])}'
                          '${'${_a['cancellationReason'] ?? ''}'.trim().isEmpty ? '' : ' — ${_a['cancellationReason']}'}',
                          style: const TextStyle(fontSize: 11.5, color: AppColors.danger),
                        ),
                      ),
                    ],

                    const SizedBox(height: 14),
                    // Özet kutuları
                    Row(
                      children: [
                        Expanded(child: _stat('Tutar', _money(total))),
                        const SizedBox(width: 8),
                        Expanded(child: _stat('Tahsil', _money(paid), color: AppColors.success)),
                        const SizedBox(width: 8),
                        Expanded(child: _stat('Kalan', _money(remaining),
                            color: remaining > 0.005 ? AppColors.danger : AppColors.success)),
                        const SizedBox(width: 8),
                        Expanded(child: _stat('Seans', st > 0 ? '${st - su}/$st' : '—',
                            hint: st > 0 ? '$su kullanıldı' : null)),
                      ],
                    ),

                    const SizedBox(height: 16),
                    _sectionTitle('Kapsam', Icons.content_cut_rounded),
                    const SizedBox(height: 6),
                    if (items.isEmpty)
                      _emptyBox('Kalem bilgisi yok.')
                    else
                      for (final item in items)
                        Container(
                          margin: const EdgeInsets.only(bottom: 6),
                          padding: const EdgeInsets.all(10),
                          decoration: BoxDecoration(
                            color: AppColors.surfaceSoft,
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Row(
                            children: [
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(valueOf(item, const ['name']),
                                        style: const TextStyle(
                                            fontWeight: FontWeight.w700, fontSize: 12.5)),
                                    if (numberOf(item, const ['sessionsTotal']) > 0)
                                      Text(
                                        '${numberOf(item, const ['sessionsUsed']).toInt()}/'
                                        '${numberOf(item, const ['sessionsTotal']).toInt()} seans kullanıldı',
                                        style: const TextStyle(
                                            fontSize: 10.5, color: AppColors.muted),
                                      ),
                                  ],
                                ),
                              ),
                              Text(_money(numberOf(item, const ['amount'])),
                                  style: const TextStyle(
                                      fontWeight: FontWeight.w800, fontSize: 12.5)),
                            ],
                          ),
                        ),

                    const SizedBox(height: 14),
                    _sectionTitle('Aylık Taksitler', Icons.credit_card_rounded),
                    const SizedBox(height: 6),
                    if (installments.isEmpty)
                      _emptyBox('Taksit planı yok — satış peşin kaydedilmiş.')
                    else
                      for (final inst in installments) _installmentTile(inst),

                    if ('${_a['notes'] ?? ''}'.trim().isNotEmpty) ...[
                      const SizedBox(height: 12),
                      Container(
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: AppColors.warning.withValues(alpha: .08),
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Text('Not: ${_a['notes']}',
                            style: const TextStyle(fontSize: 11.5, color: AppColors.ink)),
                      ),
                    ],

                    if (widget.canManage) ...[
                      const SizedBox(height: 16),
                      if (status == 'Cancelled')
                        OutlinedButton.icon(
                          onPressed: _busy ? null : () => _run(() =>
                              widget.api.post('/api/admin/accounts/${_a['id']}/restore-sale', const {})),
                          icon: const Icon(Icons.replay_rounded, size: 17),
                          label: const Text('İptali geri al'),
                          style: OutlinedButton.styleFrom(
                            foregroundColor: AppColors.primaryDark,
                            minimumSize: const Size.fromHeight(44),
                          ),
                        )
                      else
                        OutlinedButton.icon(
                          onPressed: _busy ? null : _askCancel,
                          icon: const Icon(Icons.cancel_rounded, size: 17),
                          label: const Text('Satışı iptal et'),
                          style: OutlinedButton.styleFrom(
                            foregroundColor: AppColors.danger,
                            minimumSize: const Size.fromHeight(44),
                          ),
                        ),
                      const SizedBox(height: 6),
                      const Text(
                        'İptalde tahsilat geçmişi korunur.',
                        textAlign: TextAlign.center,
                        style: TextStyle(fontSize: 10.5, color: AppColors.muted),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _installmentTile(Map<String, dynamic> inst) {
    final id = '${inst['id']}';
    final isOpen = _openInstallment == id;
    final amount = numberOf(inst, const ['amount']);
    final paidAmount = numberOf(inst, const ['paidAmount']);
    final remaining = (amount - paidAmount).clamp(0, double.infinity).toDouble();
    final paid = '${inst['status']}' == 'Paid' || remaining <= 0.005;
    final due = '${inst['dueDate'] ?? ''}'.split('T').first;
    final dueDate = DateTime.tryParse(due);
    final overdue = !paid && dueDate != null && dueDate.isBefore(DateTime.now());

    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      decoration: BoxDecoration(
        color: paid
            ? AppColors.success.withValues(alpha: .06)
            : overdue
                ? AppColors.danger.withValues(alpha: .06)
                : AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: paid
              ? AppColors.success.withValues(alpha: .3)
              : overdue
                  ? AppColors.danger.withValues(alpha: .3)
                  : AppColors.border,
        ),
      ),
      child: Column(
        children: [
          InkWell(
            borderRadius: BorderRadius.circular(12),
            onTap: () => setState(() => _openInstallment = isOpen ? null : id),
            child: Padding(
              padding: const EdgeInsets.all(10),
              child: Row(
                children: [
                  Container(
                    width: 44,
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    decoration: BoxDecoration(
                      color: AppColors.surfaceSoft,
                      borderRadius: BorderRadius.circular(9),
                    ),
                    child: Column(
                      children: [
                        Text(
                          dueDate != null ? DateFormat('MMM', 'tr_TR').format(dueDate) : '—',
                          style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 11),
                        ),
                        Text(
                          dueDate != null ? '${dueDate.year}' : '',
                          style: const TextStyle(fontSize: 8.5, color: AppColors.muted),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('${numberOf(inst, const ['no']).toInt()}. taksit · ${_money(amount)}',
                            style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5)),
                        Text(
                          paid
                              ? 'Ödendi'
                              : overdue
                                  ? 'Gecikti · vade ${_fmtDate(due)}'
                                  : 'Vade ${_fmtDate(due)}',
                          style: TextStyle(
                            fontSize: 10.5,
                            fontWeight: overdue ? FontWeight.w700 : FontWeight.w400,
                            color: overdue ? AppColors.danger : AppColors.muted,
                          ),
                        ),
                      ],
                    ),
                  ),
                  Icon(
                    paid ? Icons.check_circle_rounded : (isOpen ? Icons.expand_less : Icons.expand_more),
                    size: 18,
                    color: paid ? AppColors.success : AppColors.muted,
                  ),
                ],
              ),
            ),
          ),
          if (isOpen)
            Padding(
              padding: const EdgeInsets.fromLTRB(10, 0, 10, 10),
              child: Column(
                children: [
                  Row(
                    children: [
                      Expanded(child: _stat('Taksit', _money(amount))),
                      const SizedBox(width: 6),
                      Expanded(child: _stat('Tahsil', _money(paidAmount), color: AppColors.success)),
                      const SizedBox(width: 6),
                      Expanded(child: _stat('Kalan', _money(remaining),
                          color: remaining > 0.005 ? AppColors.danger : AppColors.success)),
                    ],
                  ),
                  if (!paid && widget.canManage && _saleStatus(_a) != 'Cancelled') ...[
                    const SizedBox(height: 8),
                    FilledButton.icon(
                      style: FilledButton.styleFrom(
                        backgroundColor: AppColors.success,
                        minimumSize: const Size.fromHeight(40),
                      ),
                      onPressed: _busy
                          ? null
                          : () => _run(() => widget.api.post(
                                '/api/admin/accounts/${_a['id']}/payments',
                                {
                                  'amount': remaining,
                                  'method': 'cash',
                                  'reference': null,
                                  'occurredAtUtc': DateTime.now().toUtc().toIso8601String(),
                                },
                              )),
                      icon: const Icon(Icons.account_balance_wallet_rounded, size: 17),
                      label: Text('Bu taksiti tahsil et (${_money(remaining)})'),
                    ),
                  ],
                ],
              ),
            ),
        ],
      ),
    );
  }

  Future<void> _askCancel() async {
    final controller = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Satışı iptal et'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('İptal gerekçesini yazın (kayıtta görünür).',
                style: TextStyle(fontSize: 12.5)),
            const SizedBox(height: 10),
            TextField(
              controller: controller,
              autofocus: true,
              decoration: const InputDecoration(
                hintText: 'örn. müşteri vazgeçti, paket iade edildi',
              ),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Vazgeç')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('İptal et'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    await _run(() => widget.api.post(
          '/api/admin/accounts/${_a['id']}/cancel-sale',
          {'reason': controller.text.trim()},
        ));
  }

  Widget _sectionTitle(String text, IconData icon) => Row(
        children: [
          Icon(icon, size: 15, color: AppColors.primaryDark),
          const SizedBox(width: 6),
          Text(text.toUpperCase(),
              style: const TextStyle(
                  fontSize: 10.5, fontWeight: FontWeight.w800, color: AppColors.primaryDark)),
        ],
      );

  Widget _stat(String label, String value, {Color? color, String? hint}) => Container(
        padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 6),
        decoration: BoxDecoration(
          color: AppColors.surfaceSoft,
          borderRadius: BorderRadius.circular(11),
        ),
        child: Column(
          children: [
            Text(label.toUpperCase(),
                style: const TextStyle(
                    fontSize: 8.5, fontWeight: FontWeight.w700, color: AppColors.muted)),
            const SizedBox(height: 2),
            Text(value,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                    fontSize: 12.5, fontWeight: FontWeight.w900, color: color ?? AppColors.ink)),
            if (hint != null)
              Text(hint, style: const TextStyle(fontSize: 8.5, color: AppColors.muted)),
          ],
        ),
      );

  Widget _metaRow(IconData icon, String text) => Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 12, color: AppColors.primaryDark),
          const SizedBox(width: 4),
          Text(text, style: const TextStyle(fontSize: 11.5, color: AppColors.muted)),
        ],
      );

  Widget _chip(String text, Color color) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: color.withValues(alpha: .1),
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: color.withValues(alpha: .35)),
        ),
        child: Text(text,
            style: TextStyle(fontSize: 10, fontWeight: FontWeight.w800, color: color)),
      );

  Widget _emptyBox(String text) => Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 10),
        decoration: BoxDecoration(
          color: AppColors.surfaceSoft,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Text(text,
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 11.5, color: AppColors.muted)),
      );
}

// --------------------------------------------------------------- geçmiş ---

/// Geçmiş satış girişi: yazılıma geçmeden önce satılmış paket/hizmet kaydı.
class HistoricalSaleSheet extends StatefulWidget {
  const HistoricalSaleSheet({
    required this.api,
    required this.customerId,
    required this.customerName,
    super.key,
  });

  final ApiClient api;
  final String customerId;
  final String customerName;

  @override
  State<HistoricalSaleSheet> createState() => _HistoricalSaleSheetState();
}

class _HistoricalSaleSheetState extends State<HistoricalSaleSheet> {
  String _kind = 'package'; // package | service | free
  List<Map<String, dynamic>> _packages = const [];
  List<Map<String, dynamic>> _services = const [];
  List<Map<String, dynamic>> _staff = const [];
  String? _packageId;
  String? _serviceId;
  String? _staffId;
  DateTime? _soldAt;
  DateTime? _firstDue;
  final _name = TextEditingController();
  final _total = TextEditingController();
  final _paid = TextEditingController();
  final _sessionsTotal = TextEditingController();
  final _sessionsUsed = TextEditingController();
  final _installments = TextEditingController(text: '0');
  final _notes = TextEditingController();
  bool _loading = true;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadLookups();
  }

  @override
  void dispose() {
    for (final c in [_name, _total, _paid, _sessionsTotal, _sessionsUsed, _installments, _notes]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _loadLookups() async {
    final res = await Future.wait<dynamic>([
      widget.api.get('/api/admin/packages/', query: {'page': 1, 'pageSize': 200})
          .catchError((_) => const <dynamic>[]),
      widget.api.get('/api/admin/services/', query: {'page': 1, 'pageSize': 200})
          .catchError((_) => const <dynamic>[]),
      widget.api.get('/api/admin/staff/', query: {'page': 1, 'pageSize': 200})
          .catchError((_) => const <dynamic>[]),
    ]);
    if (!mounted) return;
    setState(() {
      _packages = apiItems(res[0]);
      _services = apiItems(res[1]);
      _staff = apiItems(res[2]);
      _loading = false;
    });
  }

  double get _totalNum => double.tryParse(_total.text.replaceAll(',', '.')) ?? 0;
  double get _paidNum => double.tryParse(_paid.text.replaceAll(',', '.')) ?? 0;
  double get _remaining => (_totalNum - _paidNum.clamp(0, _totalNum)).clamp(0, double.infinity);

  Future<void> _save() async {
    final name = _name.text.trim();
    if (name.isEmpty) { setState(() => _error = 'Paket / hizmet adı zorunludur.'); return; }
    if (_soldAt == null) { setState(() => _error = 'Satış tarihi zorunludur.'); return; }
    if (_totalNum <= 0) { setState(() => _error = 'Tutar sıfırdan büyük olmalı.'); return; }
    if (_paidNum > _totalNum) { setState(() => _error = 'Tahsil edilen tutar toplamdan fazla olamaz.'); return; }
    final st = int.tryParse(_sessionsTotal.text) ?? 0;
    final su = int.tryParse(_sessionsUsed.text) ?? 0;
    if (su > st) { setState(() => _error = 'Kullanılan seans toplamdan fazla olamaz.'); return; }
    // Seans takibi bir hizmete bağlıdır (paket seçilirse kalemlerinden gelir).
    if (st > 0 && _kind != 'package' && _serviceId == null) {
      setState(() => _error = 'Seans takibi için hizmet seçin.');
      return;
    }

    setState(() { _saving = true; _error = null; });
    try {
      await widget.api.post('/api/admin/accounts/historical', {
        'customerId': widget.customerId,
        'name': name,
        'soldAtUtc': DateTime.utc(_soldAt!.year, _soldAt!.month, _soldAt!.day, 12).toIso8601String(),
        'totalAmount': _totalNum,
        'paidAmount': _paidNum.clamp(0, _totalNum),
        'soldByStaffMemberId': _staffId,
        'servicePackageId': _kind == 'package' ? _packageId : null,
        'serviceDefinitionId': _kind != 'package' ? _serviceId : null,
        'sessionsTotal': st,
        'sessionsUsed': su,
        'installmentCount': _remaining > 0 ? (int.tryParse(_installments.text) ?? 0) : 0,
        'firstDueDate': _firstDue == null
            ? null
            : DateFormat('yyyy-MM-dd').format(_firstDue!),
        'notes': _notes.text.trim().isEmpty ? null : _notes.text.trim(),
      });
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      initialChildSize: .9,
      minChildSize: .5,
      maxChildSize: .95,
      expand: false,
      builder: (context, controller) => Container(
        decoration: const BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : Column(
                children: [
                  const SizedBox(height: 10),
                  Container(
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(
                      color: AppColors.surfaceSoft,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                  Expanded(
                    child: ListView(
                      controller: controller,
                      padding: const EdgeInsets.fromLTRB(16, 14, 16, 20),
                      children: [
                        const Text('Geçmiş satış ekle',
                            style: TextStyle(fontWeight: FontWeight.w900, fontSize: 17)),
                        const SizedBox(height: 2),
                        Text(
                          '${widget.customerName} · yazılıma geçmeden önce yapılmış satışı sisteme işleyin',
                          style: const TextStyle(fontSize: 11.5, color: AppColors.muted),
                        ),
                        const SizedBox(height: 14),

                        SegmentedButton<String>(
                          segments: const [
                            ButtonSegment(value: 'package', label: Text('Paket')),
                            ButtonSegment(value: 'service', label: Text('Hizmet')),
                            ButtonSegment(value: 'free', label: Text('Elle yaz')),
                          ],
                          selected: {_kind},
                          showSelectedIcon: false,
                          onSelectionChanged: (s) => setState(() => _kind = s.first),
                        ),
                        const SizedBox(height: 10),

                        if (_kind == 'package')
                          DropdownButtonFormField<String>(
                            initialValue: _packageId,
                            isExpanded: true,
                            decoration: const InputDecoration(labelText: 'Paket'),
                            items: [
                              for (final p in _packages)
                                DropdownMenuItem(
                                  value: '${p['id']}',
                                  child: Text(valueOf(p, const ['name']),
                                      overflow: TextOverflow.ellipsis),
                                ),
                            ],
                            onChanged: (v) => setState(() {
                              _packageId = v;
                              final p = _packages.firstWhere((x) => '${x['id']}' == v,
                                  orElse: () => const {});
                              if (p.isNotEmpty) {
                                _name.text = valueOf(p, const ['name']);
                                if (_total.text.isEmpty) {
                                  _total.text = '${numberOf(p, const ['totalPrice']).toInt()}';
                                }
                              }
                            }),
                          ),
                        if (_kind == 'service')
                          DropdownButtonFormField<String>(
                            initialValue: _serviceId,
                            isExpanded: true,
                            decoration: const InputDecoration(labelText: 'Hizmet'),
                            items: [
                              for (final s in _services)
                                DropdownMenuItem(
                                  value: '${s['id']}',
                                  child: Text(valueOf(s, const ['name']),
                                      overflow: TextOverflow.ellipsis),
                                ),
                            ],
                            onChanged: (v) => setState(() {
                              _serviceId = v;
                              final s = _services.firstWhere((x) => '${x['id']}' == v,
                                  orElse: () => const {});
                              if (s.isNotEmpty) {
                                _name.text = valueOf(s, const ['name']);
                                if (_total.text.isEmpty) {
                                  _total.text = '${numberOf(s, const ['price']).toInt()}';
                                }
                              }
                            }),
                          ),
                        const SizedBox(height: 10),
                        TextField(
                          controller: _name,
                          decoration: const InputDecoration(
                            labelText: 'Paket / hizmet adı *',
                            hintText: 'örn. 2023 Lazer Epilasyon Paketi',
                          ),
                        ),
                        const SizedBox(height: 10),

                        _dateField('Satış tarihi *', _soldAt, (d) => setState(() => _soldAt = d),
                            lastDate: DateTime.now()),
                        const SizedBox(height: 10),
                        DropdownButtonFormField<String>(
                          initialValue: _staffId,
                          isExpanded: true,
                          decoration: const InputDecoration(labelText: 'Satan personel'),
                          items: [
                            const DropdownMenuItem(value: null, child: Text('Belirtilmedi')),
                            for (final s in _staff)
                              DropdownMenuItem(
                                value: '${s['id']}',
                                child: Text(valueOf(s, const ['fullName', 'name']),
                                    overflow: TextOverflow.ellipsis),
                              ),
                          ],
                          onChanged: (v) => setState(() => _staffId = v),
                        ),
                        const SizedBox(height: 10),

                        Row(
                          children: [
                            Expanded(
                              child: TextField(
                                controller: _total,
                                keyboardType: TextInputType.number,
                                onChanged: (_) => setState(() {}),
                                decoration: const InputDecoration(labelText: 'Toplam tutar (₺) *'),
                              ),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: TextField(
                                controller: _paid,
                                keyboardType: TextInputType.number,
                                onChanged: (_) => setState(() {}),
                                decoration: const InputDecoration(labelText: 'Tahsil edilen (₺)'),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 10),
                        Row(
                          children: [
                            Expanded(
                              child: TextField(
                                controller: _sessionsTotal,
                                keyboardType: TextInputType.number,
                                onChanged: (_) => setState(() {}),
                                decoration: const InputDecoration(labelText: 'Toplam seans'),
                              ),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: TextField(
                                controller: _sessionsUsed,
                                keyboardType: TextInputType.number,
                                decoration: const InputDecoration(labelText: 'Kullanılan seans'),
                              ),
                            ),
                          ],
                        ),

                        // Serbest kayıtta seans girilecekse hangi hizmetten düşeceği seçilir.
                        if (_kind == 'free' && (int.tryParse(_sessionsTotal.text) ?? 0) > 0) ...[
                          const SizedBox(height: 10),
                          DropdownButtonFormField<String>(
                            initialValue: _serviceId,
                            isExpanded: true,
                            decoration: const InputDecoration(
                              labelText: 'Seanslar hangi hizmetten düşülsün? *',
                            ),
                            items: [
                              for (final s in _services)
                                DropdownMenuItem(
                                  value: '${s['id']}',
                                  child: Text(valueOf(s, const ['name']),
                                      overflow: TextOverflow.ellipsis),
                                ),
                            ],
                            onChanged: (v) => setState(() => _serviceId = v),
                          ),
                        ],

                        if (_remaining > 0) ...[
                          const SizedBox(height: 14),
                          Container(
                            padding: const EdgeInsets.all(11),
                            decoration: BoxDecoration(
                              color: AppColors.surfaceSoft,
                              borderRadius: BorderRadius.circular(13),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text('Kalan borç: ${_money(_remaining)}',
                                    style: const TextStyle(
                                        fontWeight: FontWeight.w800, fontSize: 12)),
                                const SizedBox(height: 8),
                                TextField(
                                  controller: _installments,
                                  keyboardType: TextInputType.number,
                                  decoration: const InputDecoration(labelText: 'Taksit sayısı'),
                                ),
                                const SizedBox(height: 8),
                                _dateField('İlk vade (opsiyonel)', _firstDue,
                                    (d) => setState(() => _firstDue = d),
                                    lastDate: DateTime.now().add(const Duration(days: 3650))),
                              ],
                            ),
                          ),
                        ],

                        const SizedBox(height: 10),
                        TextField(
                          controller: _notes,
                          decoration: const InputDecoration(labelText: 'Not (opsiyonel)'),
                        ),

                        if (_error != null) ...[
                          const SizedBox(height: 10),
                          Text(_error!,
                              style: const TextStyle(color: AppColors.danger, fontSize: 11.5)),
                        ],

                        const SizedBox(height: 16),
                        FilledButton.icon(
                          onPressed: _saving ? null : _save,
                          icon: _saving
                              ? const SizedBox(
                                  width: 16,
                                  height: 16,
                                  child: CircularProgressIndicator(
                                      strokeWidth: 2, color: Colors.white))
                              : const Icon(Icons.check_rounded, size: 18),
                          label: const Text('Kaydet'),
                          style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(46)),
                        ),
                        const SizedBox(height: 6),
                        const Text('Kayıt "Geçmiş kayıt" olarak işaretlenir.',
                            textAlign: TextAlign.center,
                            style: TextStyle(fontSize: 10.5, color: AppColors.muted)),
                      ],
                    ),
                  ),
                ],
              ),
      ),
    );
  }

  Widget _dateField(String label, DateTime? value, ValueChanged<DateTime> onPick,
      {DateTime? lastDate}) {
    return InkWell(
      onTap: () async {
        final now = DateTime.now();
        final picked = await showDatePicker(
          context: context,
          initialDate: value ?? now,
          firstDate: DateTime(2000),
          lastDate: lastDate ?? now,
        );
        if (picked != null) onPick(picked);
      },
      child: InputDecorator(
        decoration: InputDecoration(labelText: label),
        child: Text(
          value == null ? 'Seçiniz' : DateFormat('d MMMM yyyy', 'tr_TR').format(value),
          style: TextStyle(
            fontSize: 13,
            color: value == null ? AppColors.muted : AppColors.ink,
          ),
        ),
      ),
    );
  }
}
