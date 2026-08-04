import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';

import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/json_helpers.dart';
import '../appointments/calendar_theme.dart';

/// Ortak "Tahsilat Al" alt sayfası — web `CollectionDialog` paritesi.
///
/// Web ile aynı davranışlar:
///  • Cari hesap ARANARAK seçilir (12 bin+ kayıtta dropdown kullanılmaz).
///  • Seçilince tutar, hesabın KALAN borcuna kuruşu korunarak otomatik dolar.
///  • Ödeme kırılımı: 2.000 nakit + 1.000 kart gibi birden çok satır girilebilir;
///    her yöntem AYRI tahsilat kaydı olur (kasa kapanışındaki yöntem kırılımı bozulmasın).
///  • Tarih YEREL seçilir ve gün ortası (12:00) damgasıyla gönderilir; gece yarısından
///    sonra UTC'ye çevrilince önceki güne kaymasın.
class CollectionMethod {
  const CollectionMethod(this.value, this.label);
  final String value;
  final String label;
}

/// Web METHOD_OPTIONS ile birebir (backend method string'ini normalize eder).
const collectionMethods = <CollectionMethod>[
  CollectionMethod('cash', 'Nakit'),
  CollectionMethod('card', 'Kart'),
  CollectionMethod('transfer', 'Havale / EFT'),
];

/// Tek bir tahsilat satırının gövdesi (POST /api/admin/accounts/{id}/payments).
class CollectionPayload {
  const CollectionPayload({
    required this.accountId,
    required this.amount,
    required this.method,
    required this.occurredAtUtc,
    this.reference,
  });

  final String accountId;
  final double amount;
  final String method;
  final String? reference;
  final String occurredAtUtc;

  Map<String, dynamic> get body => {
        'amount': amount,
        'method': method,
        'reference': reference,
        'occurredAtUtc': occurredAtUtc,
      };
}

/// [accounts] verilmezse cari listesi API'den çekilir.
/// [initialAccountId] verilirse o hesap seçili açılır (cari detayından geliniyorsa).
/// Kaydedilen tahsilat sayısını döndürür (0/null = vazgeçildi).
Future<int?> showCollectionSheet(
  BuildContext context, {
  required ApiClient api,
  List<Map<String, dynamic>>? accounts,
  String? initialAccountId,
  bool lockAccount = false,
  String title = 'Yeni tahsilat',
}) {
  return showModalBottomSheet<int>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _CollectionSheet(
      api: api,
      accounts: accounts,
      initialAccountId: initialAccountId,
      lockAccount: lockAccount,
      title: title,
    ),
  );
}

class _CollectionSheet extends StatefulWidget {
  const _CollectionSheet({
    required this.api,
    required this.title,
    required this.lockAccount,
    this.accounts,
    this.initialAccountId,
  });

  final ApiClient api;
  final List<Map<String, dynamic>>? accounts;
  final String? initialAccountId;
  final bool lockAccount;
  final String title;

  @override
  State<_CollectionSheet> createState() => _CollectionSheetState();
}

class _Row {
  _Row(this.amount, this.method);
  TextEditingController amount;
  String method;
}

class _CollectionSheetState extends State<_CollectionSheet> {
  List<Map<String, dynamic>> _accounts = const [];
  Map<String, dynamic>? _selected;
  final List<_Row> _rows = [];
  final _reference = TextEditingController();
  DateTime _date = DateTime.now();
  bool _loading = true;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _rows.add(_Row(TextEditingController(), 'cash'));
    _init();
  }

  Future<void> _init() async {
    var list = widget.accounts;
    if (list == null) {
      try {
        final data = await widget.api.get('/api/admin/accounts/',
            query: {'page': 1, 'pageSize': 500});
        list = apiItems(data);
      } catch (e) {
        if (mounted) setState(() => _error = '$e');
        list = const [];
      }
    }
    if (!mounted) return;
    setState(() {
      _accounts = list!;
      _loading = false;
      final initial = _accounts.firstWhere(
        (a) => '${a['id']}' == widget.initialAccountId,
        orElse: () => _accounts.isNotEmpty && !widget.lockAccount
            ? _accounts.first
            : const <String, dynamic>{},
      );
      if (initial.isNotEmpty) _pick(initial, rebuild: false);
    });
  }

  @override
  void dispose() {
    for (final r in _rows) {
      r.amount.dispose();
    }
    _reference.dispose();
    super.dispose();
  }

  double _remaining(Map<String, dynamic> a) =>
      numberOf(a, const ['remainingAmount', 'remaining']);

  /// Kuruşu korur (web roundKurus): 999,50 ₺ borç 1.000 ₺'ye yuvarlanırsa fazla tahsilat yazılır.
  double _kurus(double v) => v <= 0 ? 0 : (v * 100).round() / 100;

  void _pick(Map<String, dynamic> account, {bool rebuild = true}) {
    _selected = account;
    for (final r in _rows.skip(1)) {
      r.amount.dispose();
    }
    _rows
      ..removeRange(1, _rows.length)
      ..first.method = 'cash';
    final remaining = _kurus(_remaining(account));
    _rows.first.amount.text = remaining > 0 ? _plain(remaining) : '';
    if (rebuild) setState(() {});
  }

  static String _plain(double v) =>
      v == v.roundToDouble() ? '${v.toInt()}' : v.toStringAsFixed(2);

  double _amountOf(_Row r) =>
      double.tryParse(r.amount.text.trim().replaceAll(',', '.')) ?? 0;

  double get _total => _rows.fold<double>(0, (s, r) => s + _amountOf(r));

  double get _unallocated => _selected == null
      ? 0
      : _kurus(_remaining(_selected!) - _total).clamp(0, double.infinity);

  void _addRow() {
    final used = _rows.map((r) => r.method).toSet();
    final next = collectionMethods
        .firstWhere((m) => !used.contains(m.value),
            orElse: () => collectionMethods.first)
        .value;
    setState(() {
      final left = _unallocated;
      _rows.add(_Row(
        TextEditingController(text: left > 0 ? _plain(left) : ''),
        next,
      ));
    });
  }

  Future<void> _pickAccount() async {
    final picked = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _AccountPicker(accounts: _accounts),
    );
    if (picked != null) _pick(picked);
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _date,
      firstDate: DateTime(now.year - 3),
      lastDate: DateTime(now.year + 1, 12, 31),
    );
    if (picked != null) setState(() => _date = picked);
  }

  Future<void> _submit() async {
    final account = _selected;
    if (account == null) {
      setState(() => _error = 'Cari hesap seçimi zorunlu.');
      return;
    }
    // Aynı yöntem iki kez girilirse tek satırda toplanır (web ile aynı kural).
    final merged = <String, double>{};
    for (final r in _rows) {
      final amount = _amountOf(r);
      if (amount > 0) merged[r.method] = (merged[r.method] ?? 0) + amount;
    }
    if (merged.isEmpty) {
      setState(() => _error = 'Tutar 0’dan büyük olmalı.');
      return;
    }

    setState(() {
      _saving = true;
      _error = null;
    });
    // Gün ortası damgası: yerel gece yarısı UTC'de önceki güne kayıyordu.
    final stamp = DateTime(_date.year, _date.month, _date.day, 12)
        .toUtc()
        .toIso8601String();
    final reference =
        _reference.text.trim().isEmpty ? null : _reference.text.trim();
    var done = 0;
    try {
      for (final entry in merged.entries) {
        final payload = CollectionPayload(
          accountId: '${account['id']}',
          amount: entry.value,
          method: entry.key,
          reference: reference,
          occurredAtUtc: stamp,
        );
        await widget.api
            .post('/api/admin/accounts/${payload.accountId}/payments', payload.body);
        done++;
      }
      if (mounted) Navigator.pop(context, done);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        // Kısmi başarı gizlenmez: kaydedilenler geri alınmaz.
        _error = done > 0
            ? '$e · $done/${merged.length} ödeme kaydedildi, kalanı tekrar deneyin.'
            : '$e';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
      ),
      constraints:
          BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.92),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            _header(),
            if (_loading)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 40),
                child: CircularProgressIndicator(),
              )
            else
              Flexible(
                child: SingleChildScrollView(
                  padding: EdgeInsets.fromLTRB(
                      18, 4, 18, MediaQuery.viewInsetsOf(context).bottom + 12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _accountField(),
                      const SizedBox(height: 14),
                      _amountRows(),
                      const SizedBox(height: 14),
                      Row(
                        children: [
                          Expanded(child: _dateField()),
                          const SizedBox(width: 10),
                          Expanded(
                            child: TextField(
                              controller: _reference,
                              decoration: const InputDecoration(
                                labelText: 'Dekont / referans',
                                hintText: 'Opsiyonel',
                              ),
                            ),
                          ),
                        ],
                      ),
                      if (_error != null) ...[
                        const SizedBox(height: 12),
                        Container(
                          width: double.infinity,
                          padding: const EdgeInsets.all(10),
                          decoration: BoxDecoration(
                            color: AppColors.danger.withValues(alpha: .09),
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(
                                color: AppColors.danger.withValues(alpha: .3)),
                          ),
                          child: Text(_error!,
                              style: const TextStyle(
                                  fontSize: 12, fontWeight: FontWeight.w600)),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            _footer(),
          ],
        ),
      ),
    );
  }

  Widget _header() => Padding(
        padding: const EdgeInsets.fromLTRB(18, 14, 10, 8),
        child: Row(
          children: [
            Container(
              width: 40,
              height: 40,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: AppColors.surfaceSoft,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.border),
              ),
              child: const Icon(Icons.payments_rounded,
                  color: AppColors.primaryDark, size: 20),
            ),
            const SizedBox(width: 11),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(widget.title,
                      style: const TextStyle(
                          fontSize: 16.5, fontWeight: FontWeight.w800)),
                  const Text(
                      'Tutar, seçilen hesabın kalan borcuyla dolar; en eski vadeden başlayarak taksitlere dağıtılır.',
                      style: TextStyle(fontSize: 11, color: AppColors.muted)),
                ],
              ),
            ),
            IconButton(
              onPressed: () => Navigator.pop(context),
              icon: const Icon(Icons.close_rounded),
            ),
          ],
        ),
      );

  Widget _accountField() {
    final selected = _selected;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('Cari hesap',
            style: TextStyle(
                fontSize: 11.5,
                fontWeight: FontWeight.w700,
                color: AppColors.primaryDark)),
        const SizedBox(height: 6),
        InkWell(
          onTap: widget.lockAccount ? null : _pickAccount,
          borderRadius: BorderRadius.circular(12),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
            decoration: BoxDecoration(
              color: widget.lockAccount ? AppColors.surfaceSoft : Colors.white,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppColors.border),
            ),
            child: Row(
              children: [
                Expanded(
                  child: selected == null
                      ? const Text('Cari hesap seç…',
                          style: TextStyle(color: AppColors.muted))
                      : Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                                valueOf(selected,
                                    const ['customerName', 'name']),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                    fontWeight: FontWeight.w700,
                                    fontSize: 14)),
                            Text(
                                '${CalendarText.tl(_remaining(selected))} kalan',
                                style: const TextStyle(
                                    fontSize: 11, color: AppColors.muted)),
                          ],
                        ),
                ),
                if (!widget.lockAccount)
                  const Icon(Icons.search_rounded,
                      size: 18, color: AppColors.muted),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _amountRows() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const Text('Tutar ve yöntem',
                style: TextStyle(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w700,
                    color: AppColors.primaryDark)),
            const Spacer(),
            if (_rows.length > 1)
              Text('Toplam ${CalendarText.tl(_total)}',
                  style: const TextStyle(
                      fontSize: 11.5, fontWeight: FontWeight.w700)),
          ],
        ),
        const SizedBox(height: 6),
        for (var i = 0; i < _rows.length; i++)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _rows[i].amount,
                    keyboardType:
                        const TextInputType.numberWithOptions(decimal: true),
                    inputFormatters: [
                      FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]'))
                    ],
                    onChanged: (_) => setState(() {}),
                    decoration: const InputDecoration(
                        prefixText: '₺ ', isDense: true, labelText: 'Tutar'),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: DropdownButtonFormField<String>(
                    initialValue: _rows[i].method,
                    isExpanded: true,
                    decoration: const InputDecoration(
                        isDense: true, labelText: 'Yöntem'),
                    items: [
                      for (final m in collectionMethods)
                        DropdownMenuItem(value: m.value, child: Text(m.label)),
                    ],
                    onChanged: (v) =>
                        setState(() => _rows[i].method = v ?? _rows[i].method),
                  ),
                ),
                if (_rows.length > 1)
                  IconButton(
                    tooltip: 'Satırı kaldır',
                    onPressed: () => setState(() {
                      _rows.removeAt(i).amount.dispose();
                    }),
                    icon: const Icon(Icons.close_rounded, size: 18),
                  ),
              ],
            ),
          ),
        if (_rows.length < collectionMethods.length)
          TextButton.icon(
            onPressed: _addRow,
            icon: const Icon(Icons.add_rounded, size: 16),
            label: Text(_unallocated > 0
                ? 'Ödeme yöntemi ekle · ${CalendarText.tl(_unallocated)} kaldı'
                : 'Ödeme yöntemi ekle'),
          ),
      ],
    );
  }

  Widget _dateField() => InkWell(
        onTap: _pickDate,
        borderRadius: BorderRadius.circular(12),
        child: InputDecorator(
          decoration: const InputDecoration(
            labelText: 'Tarih',
            suffixIcon: Icon(Icons.calendar_today_rounded, size: 16),
          ),
          child: Text(DateFormat('d MMM yyyy', 'tr_TR').format(_date),
              style: const TextStyle(fontSize: 14)),
        ),
      );

  Widget _footer() => Container(
        padding: const EdgeInsets.fromLTRB(18, 10, 18, 12),
        decoration: const BoxDecoration(
          border: Border(top: BorderSide(color: AppColors.border)),
        ),
        child: Row(
          children: [
            Expanded(
              child: OutlinedButton(
                onPressed: _saving ? null : () => Navigator.pop(context),
                child: const Text('Vazgeç'),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              flex: 2,
              child: FilledButton.icon(
                onPressed: _saving || _loading ? null : _submit,
                icon: _saving
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.white))
                    : const Icon(Icons.check_rounded, size: 18),
                label: const Text('Tahsilatı kaydet'),
              ),
            ),
          ],
        ),
      );
}

/// Aranabilir cari hesap seçici (web'deki dropdown + arama kutusunun karşılığı).
class _AccountPicker extends StatefulWidget {
  const _AccountPicker({required this.accounts});
  final List<Map<String, dynamic>> accounts;

  @override
  State<_AccountPicker> createState() => _AccountPickerState();
}

class _AccountPickerState extends State<_AccountPicker> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final q = _query.trim().toLowerCase();
    final list = q.isEmpty
        ? widget.accounts
        : widget.accounts.where((a) {
            final hay =
                '${a['customerName'] ?? ''} ${a['name'] ?? ''} ${a['customerPhone'] ?? ''}'
                    .toLowerCase();
            return hay.contains(q);
          }).toList();
    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
      ),
      constraints:
          BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.85),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: EdgeInsets.fromLTRB(
                  18, 14, 18, MediaQuery.viewInsetsOf(context).bottom + 8),
              child: TextField(
                autofocus: true,
                onChanged: (v) => setState(() => _query = v),
                decoration: const InputDecoration(
                  isDense: true,
                  prefixIcon: Icon(Icons.search_rounded, size: 18),
                  hintText: 'Müşteri adı / telefon ara…',
                ),
              ),
            ),
            Flexible(
              child: list.isEmpty
                  ? const Padding(
                      padding: EdgeInsets.symmetric(vertical: 36),
                      child: Text('Cari hesap bulunamadı.',
                          style: TextStyle(color: AppColors.muted)),
                    )
                  : ListView.separated(
                      padding: const EdgeInsets.fromLTRB(10, 0, 10, 16),
                      itemCount: list.length,
                      separatorBuilder: (_, _) =>
                          const Divider(height: 1, color: AppColors.border),
                      itemBuilder: (_, i) {
                        final a = list[i];
                        final remaining =
                            numberOf(a, const ['remainingAmount', 'remaining']);
                        return ListTile(
                          dense: true,
                          title: Text(
                              valueOf(a, const ['customerName', 'name']),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                  fontWeight: FontWeight.w700, fontSize: 13.5)),
                          subtitle: Text(valueOf(a, const ['name'], fallback: ''),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                  fontSize: 11, color: AppColors.muted)),
                          trailing: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              Text(CalendarText.tl(remaining),
                                  style: TextStyle(
                                      fontWeight: FontWeight.w800,
                                      fontSize: 13,
                                      color: remaining > 0
                                          ? AppColors.danger
                                          : AppColors.success)),
                              const Text('kalan',
                                  style: TextStyle(
                                      fontSize: 9, color: AppColors.muted)),
                            ],
                          ),
                          onTap: () => Navigator.pop(context, a),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
