import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/json_helpers.dart';
import '../appointments/calendar_theme.dart';

// ---------------------------------------------------------------------------
// CARİ TAKSİT YARDIMCILARI + AYLIK TAKSİT TAHSİLATI (web paritesi)
//
// Web'de olduğu gibi: "genel tahsilat" tüm kalan borcu alır, "aylık taksit"
// bu ay (ve gecikmiş önceki aylar) vadesi gelen taksitleri alır.
//
// ÖNEMLİ (allocation modeli): sunucu tahsilatı taksite değil hesaba yazar ve
// VADE SIRASIYLA dağıtır — "şu taksiti öde" seçimi yoktur. Ekran bunu gizlemez,
// girilen tutarın hangi taksitleri kapatacağını canlı gösterir.
// ---------------------------------------------------------------------------

/// Tek taksit — sunucudan gelen ham JSON'un okunabilir hali.
class AccountInstallment {
  AccountInstallment({
    required this.id,
    required this.no,
    required this.dueDate,
    required this.amount,
    required this.paidAmount,
    required this.cancelled,
    required this.overdue,
  });

  final String id;
  final int no;
  final String dueDate; // YYYY-MM-DD
  final double amount;
  final double paidAmount;
  final bool cancelled;
  final bool overdue;

  double get remaining => (amount - paidAmount) < 0 ? 0 : amount - paidAmount;
  bool get isPaid => remaining <= 0.005;
  bool get isPartial => !isPaid && paidAmount > 0.005;
}

String _todayIso() => DateFormat('yyyy-MM-dd').format(DateTime.now());

/// Taksit listesi — durum ve GECİKME hesabı web'deki `normalizeAccount` ile aynı:
/// bir taksit, BİR SONRAKİ taksitin vade günü gelene kadar "gecikti" sayılmaz
/// (son taksit için kendi vadesine +1 ay tolerans).
List<AccountInstallment> parseInstallments(Map<String, dynamic> account) {
  final raw = (account['installments'] as List? ?? const [])
      .whereType<Map>()
      .map((e) => e.cast<String, dynamic>())
      .toList();

  final dues = raw
      .map((i) => '${i['dueDate'] ?? ''}')
      .map((s) => s.length >= 10 ? s.substring(0, 10) : s)
      .where((s) => s.isNotEmpty)
      .toList()
    ..sort();

  String graceDeadline(String due) {
    final next = dues.where((d) => d.compareTo(due) > 0);
    if (next.isNotEmpty) return next.first;
    final parsed = DateTime.tryParse(due);
    if (parsed == null) return due;
    return DateFormat('yyyy-MM-dd')
        .format(DateTime(parsed.year, parsed.month + 1, parsed.day));
  }

  final today = _todayIso();
  final list = <AccountInstallment>[];
  for (var idx = 0; idx < raw.length; idx++) {
    final i = raw[idx];
    final status = '${i['status'] ?? ''}'.toLowerCase();
    final cancelled = status == 'cancelled' || status == '2';
    final dueRaw = '${i['dueDate'] ?? ''}';
    final due = dueRaw.length >= 10 ? dueRaw.substring(0, 10) : dueRaw;
    final amount = numberOf(i, const ['amount']);
    final paid = numberOf(i, const ['paidAmount']).clamp(0, amount).toDouble();
    final remaining = amount - paid;
    list.add(AccountInstallment(
      id: '${i['id'] ?? 'inst-$idx'}',
      no: numberOf(i, const ['no']).toInt() == 0 ? idx + 1 : numberOf(i, const ['no']).toInt(),
      dueDate: due,
      amount: amount,
      paidAmount: paid,
      cancelled: cancelled,
      overdue: !cancelled &&
          remaining > 0.005 &&
          due.isNotEmpty &&
          graceDeadline(due).compareTo(today) <= 0,
    ));
  }
  list.sort((a, b) => a.no.compareTo(b.no));
  return list;
}

/// Taksitli mi? (Tek taksit ya da taksitsiz satış "peşin" sayılır.)
bool isInstallmentAccount(Map<String, dynamic> account) =>
    parseInstallments(account).where((i) => !i.cancelled).length > 1;

String shortDay(String iso) {
  final d = DateTime.tryParse(iso);
  if (d == null) return '—';
  return DateFormat('d MMM yyyy', 'tr_TR').format(d);
}

/// Aylık taksit tahsilatı alt-sayfası.
class InstallmentPaymentSheet extends StatefulWidget {
  const InstallmentPaymentSheet({
    required this.api,
    required this.account,
    super.key,
  });

  final ApiClient api;
  final Map<String, dynamic> account;

  @override
  State<InstallmentPaymentSheet> createState() => _InstallmentPaymentSheetState();
}

class _InstallmentPaymentSheetState extends State<InstallmentPaymentSheet> {
  late final List<AccountInstallment> _all = parseInstallments(widget.account);
  late final List<AccountInstallment> _pending =
      _all.where((i) => !i.cancelled && i.remaining > 0.005).toList()
        ..sort((a, b) => a.dueDate.compareTo(b.dueDate));

  final _amountCtrl = TextEditingController();
  String _method = 'Cash';

  /// İKİNCİ ÖDEME YÖNTEMİ (kırılım) — 3.000 ₺ borcun 2.000'i nakit + 1.000'i kart alınabilsin.
  /// Boşken davranış eskisi gibi tek tahsilattır. Dolu olduğunda her yöntem AYRI tahsilat kaydı
  /// olur; tek satırda toplamak kasa kapanışındaki yöntem kırılımını bozardı.
  final _splitAmountCtrl = TextEditingController();
  String _splitMethod = 'Card';
  bool _splitOn = false;

  double get _splitAmount =>
      double.tryParse(_splitAmountCtrl.text.replaceAll(',', '.')) ?? 0;
  DateTime _date = DateTime.now();
  final _referenceCtrl = TextEditingController();
  int _count = 1;
  bool _saving = false;
  String _error = '';

  @override
  void initState() {
    super.initState();
    _count = _dueNowCount.clamp(1, _pending.isEmpty ? 1 : _pending.length);
    _amountCtrl.text = _sumOf(_count).toStringAsFixed(0);
    _amountCtrl.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _amountCtrl.dispose();
    _splitAmountCtrl.dispose();
    _referenceCtrl.dispose();
    super.dispose();
  }

  /// Bu ay (ve gecikmiş önceki aylar) vadesi gelmiş taksit sayısı.
  int get _dueNowCount {
    final now = DateTime.now();
    final lastDay = DateTime(now.year, now.month + 1, 0);
    final limit = DateFormat('yyyy-MM-dd').format(lastDay);
    final n = _pending.where((i) => i.dueDate.isNotEmpty && i.dueDate.compareTo(limit) <= 0).length;
    return n < 1 ? 1 : n;
  }

  double _sumOf(int n) =>
      _pending.take(n < 0 ? 0 : n).fold<double>(0, (s, i) => s + i.remaining);

  double get _amount => double.tryParse(_amountCtrl.text.replaceAll(',', '.')) ?? 0;

  /// Girilen tutarın taksitlere vade sırasıyla dağılımı (canlı önizleme).
  Map<String, double> get _allocation {
    var pool = _amount;
    final map = <String, double>{};
    for (final i in _pending) {
      final applied = pool < i.remaining ? pool : i.remaining;
      if (applied > 0) map[i.id] = applied;
      pool -= applied;
      if (pool <= 0) break;
    }
    return map;
  }

  double get _leftover {
    final used = _allocation.values.fold<double>(0, (s, v) => s + v);
    final left = _amount - used;
    return left < 0.005 ? 0 : left;
  }

  Future<void> _submit() async {
    setState(() {
      _error = '';
      _saving = true;
    });
    if (_amount <= 0) {
      setState(() {
        _error = 'Tutar 0’dan büyük olmalı.';
        _saving = false;
      });
      return;
    }
    // Kırılım: her yöntem AYRI kayıt. Aynı yöntem iki kez girildiyse tek satırda toplanır.
    final parts = <String, double>{_method: _amount};
    if (_splitOn && _splitAmount > 0) {
      parts[_splitMethod] = (parts[_splitMethod] ?? 0) + _splitAmount;
    }

    final occurredAt =
        DateTime(_date.year, _date.month, _date.day, 12).toUtc().toIso8601String();
    final reference =
        _referenceCtrl.text.trim().isEmpty ? null : _referenceCtrl.text.trim();
    var done = 0;
    try {
      for (final entry in parts.entries) {
        await widget.api
            .post('/api/admin/accounts/${widget.account['id']}/payments', {
          'amount': entry.value,
          'method': entry.key,
          'reference': reference,
          'occurredAtUtc': occurredAt,
        });
        done++;
      }
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) {
        setState(() {
          // Kısmi başarı gizlenmez: kaydedilenler geri alınmaz, kullanıcı ne kaldığını bilmeli.
          _error = done > 0
              ? '$e · $done/${parts.length} ödeme kaydedildi; kalanı tekrar deneyin.'
              : '$e';
          _saving = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final alloc = _allocation;
    final covered = _pending.where((i) => (alloc[i.id] ?? 0) >= i.remaining - 0.005).length;
    final partial = _pending.where((i) {
      final v = alloc[i.id] ?? 0;
      return v > 0 && v < i.remaining - 0.005;
    }).toList();
    final overdueCount = _pending.where((i) => i.overdue).length;
    final next = _pending.isEmpty ? null : _pending.first;
    final counts = <int>{1, 2, 3, _dueNowCount, _pending.length}
        .where((n) => n >= 1 && n <= _pending.length)
        .toList()
      ..sort();

    return Padding(
      padding: EdgeInsets.fromLTRB(
          18, 16, 18, MediaQuery.viewInsetsOf(context).bottom + 18),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                Container(
                  width: 38,
                  height: 38,
                  decoration: BoxDecoration(
                    color: AppColors.surfaceSoft,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Icon(Icons.event_available_rounded,
                      color: AppColors.primaryDark, size: 20),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Aylık taksit tahsilatı',
                          style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                      Text(
                        '${valueOf(widget.account, const ['customerName', 'name'])} · ${_pending.length} taksit ödenmedi',
                        style: const TextStyle(fontSize: 11.5, color: AppColors.muted),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),

            // Sıradaki taksit
            if (next != null)
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppColors.surfaceSoft,
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const Text('SIRADAKİ TAKSİT',
                            style: TextStyle(
                                fontSize: 9.5,
                                letterSpacing: 1.1,
                                fontWeight: FontWeight.w700,
                                color: AppColors.primaryDark)),
                        const Spacer(),
                        if (next.overdue)
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                            decoration: BoxDecoration(
                              color: AppColors.danger.withValues(alpha: .12),
                              borderRadius: BorderRadius.circular(6),
                            ),
                            child: const Text('GECİKTİ',
                                style: TextStyle(
                                    fontSize: 9,
                                    fontWeight: FontWeight.w800,
                                    color: AppColors.danger)),
                          ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(CalendarText.tl(next.remaining),
                        style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
                    Text('${shortDay(next.dueDate)} · #${next.no}',
                        style: const TextStyle(fontSize: 11.5, color: AppColors.muted)),
                  ],
                ),
              ),
            const SizedBox(height: 12),

            // Kaç taksit
            if (_pending.length > 1) ...[
              const Text('Kaç taksit tahsil edilecek?',
                  style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700)),
              const SizedBox(height: 6),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  for (final n in counts)
                    ChoiceChip(
                      selected: _count == n,
                      label: Text(
                        n == _pending.length && n > 1
                            ? 'Tümü ($n) ${CalendarText.tl(_sumOf(n))}'
                            : '$n taksit ${CalendarText.tl(_sumOf(n))}',
                        style: const TextStyle(fontSize: 11),
                      ),
                      onSelected: (_) => setState(() {
                        _count = n;
                        _amountCtrl.text = _sumOf(n).toStringAsFixed(0);
                      }),
                    ),
                ],
              ),
              if (_dueNowCount > 1)
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Text('Bu ay dahil $_dueNowCount taksitin vadesi gelmiş.',
                      style: const TextStyle(fontSize: 11, color: AppColors.muted)),
                ),
              const SizedBox(height: 12),
            ],

            // Tutar + yöntem
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _amountCtrl,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    decoration: const InputDecoration(labelText: 'Tutar', prefixText: '₺ '),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: DropdownButtonFormField<String>(
                    initialValue: _method,
                    decoration: const InputDecoration(labelText: 'Yöntem'),
                    items: const [
                      DropdownMenuItem(value: 'Cash', child: Text('Nakit')),
                      DropdownMenuItem(value: 'Card', child: Text('Kart')),
                      DropdownMenuItem(value: 'BankTransfer', child: Text('Havale/EFT')),
                    ],
                    onChanged: (v) => setState(() => _method = v ?? 'Cash'),
                  ),
                ),
              ],
            ),

            // ÖDEME KIRILIMI — ikinci yöntem (ör. 2.000 nakit + 1.000 kart).
            if (_splitOn) ...[
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _splitAmountCtrl,
                      keyboardType:
                          const TextInputType.numberWithOptions(decimal: true),
                      decoration: const InputDecoration(
                          labelText: 'Tutar (2. yöntem)', prefixText: '₺ '),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: DropdownButtonFormField<String>(
                      initialValue: _splitMethod,
                      decoration: const InputDecoration(labelText: 'Yöntem'),
                      items: const [
                        DropdownMenuItem(value: 'Cash', child: Text('Nakit')),
                        DropdownMenuItem(value: 'Card', child: Text('Kart')),
                        DropdownMenuItem(
                            value: 'BankTransfer', child: Text('Havale/EFT')),
                      ],
                      onChanged: (v) => setState(() => _splitMethod = v ?? 'Card'),
                    ),
                  ),
                  IconButton(
                    tooltip: 'Kırılımı kaldır',
                    icon: const Icon(Icons.close_rounded, size: 18),
                    onPressed: () => setState(() {
                      _splitOn = false;
                      _splitAmountCtrl.clear();
                    }),
                  ),
                ],
              ),
            ] else
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  onPressed: () => setState(() => _splitOn = true),
                  icon: const Icon(Icons.add_rounded, size: 16),
                  label: const Text('Ödeme yöntemi ekle'),
                ),
              ),
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: InkWell(
                    onTap: () async {
                      final picked = await showDatePicker(
                        context: context,
                        initialDate: _date,
                        firstDate: DateTime(DateTime.now().year - 3),
                        lastDate: DateTime(DateTime.now().year + 3),
                      );
                      if (picked != null) setState(() => _date = picked);
                    },
                    child: InputDecorator(
                      decoration: const InputDecoration(labelText: 'Tarih'),
                      child: Text(DateFormat('dd.MM.yyyy').format(_date)),
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: TextField(
                    controller: _referenceCtrl,
                    decoration: const InputDecoration(labelText: 'Dekont / referans'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),

            // Taksit planı + canlı dağıtım
            const Text('Taksit planı',
                style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700)),
            if (overdueCount > 0)
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Text('$overdueCount taksit gecikmiş',
                    style: const TextStyle(fontSize: 11, color: AppColors.danger)),
              ),
            const SizedBox(height: 6),
            for (final i in _all)
              _installmentTile(i, applied: alloc[i.id] ?? 0),
            const SizedBox(height: 12),

            // Ne olacak özeti
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppColors.surfaceSoft.withValues(alpha: .6),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('BU ÖDEME NE YAPACAK?',
                      style: TextStyle(
                          fontSize: 9.5,
                          letterSpacing: 1.1,
                          fontWeight: FontWeight.w700,
                          color: AppColors.primaryDark)),
                  const SizedBox(height: 4),
                  Text(
                    covered > 0
                        ? '$covered taksit tamamen kapanır'
                        : 'Hiçbir taksit tamamen kapanmaz',
                    style: const TextStyle(fontSize: 12),
                  ),
                  if (partial.isNotEmpty)
                    Text(
                      '#${partial.first.no} taksite ${CalendarText.tl(alloc[partial.first.id])} kısmi düşer',
                      style: const TextStyle(fontSize: 12),
                    ),
                  if (_leftover > 0.005)
                    Text('${CalendarText.tl(_leftover)} fazla ödeme (kredi) olarak kalır',
                        style: const TextStyle(fontSize: 12)),
                  const Text('Tahsilat en eski vadeli taksitten başlayarak dağıtılır.',
                      style: TextStyle(fontSize: 11, color: AppColors.muted)),
                ],
              ),
            ),

            if (_error.isNotEmpty) ...[
              const SizedBox(height: 10),
              Text(_error, style: const TextStyle(fontSize: 12, color: AppColors.danger)),
            ],
            const SizedBox(height: 14),
            Row(
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
                    onPressed: _saving ? null : _submit,
                    icon: _saving
                        ? const SizedBox(
                            width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                        : const Icon(Icons.check_rounded),
                    label: Text('${CalendarText.tl(_amount)} tahsil et'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _installmentTile(AccountInstallment i, {required double applied}) {
    final willApply = applied > 0;
    final bg = i.isPaid
        ? AppColors.success.withValues(alpha: .07)
        : willApply
            ? AppColors.surfaceSoft
            : i.overdue
                ? AppColors.danger.withValues(alpha: .07)
                : AppColors.surface;
    final label = i.isPaid
        ? 'ÖDENDİ'
        : i.overdue
            ? 'GECİKTİ'
            : i.isPartial
                ? 'KISMİ'
                : 'BEKLİYOR';
    final labelColor = i.isPaid
        ? AppColors.success
        : i.overdue
            ? AppColors.danger
            : AppColors.warning;
    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(
          color: willApply ? AppColors.primary.withValues(alpha: .45) : AppColors.border,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text('#${i.no}',
                  style: const TextStyle(
                      fontSize: 11, fontWeight: FontWeight.w700, color: AppColors.muted)),
              const SizedBox(width: 8),
              Expanded(
                child: Text(shortDay(i.dueDate),
                    style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600)),
              ),
              Text(CalendarText.tl(i.amount),
                  style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800)),
              const SizedBox(width: 6),
              Text(label,
                  style: TextStyle(
                      fontSize: 9, fontWeight: FontWeight.w800, color: labelColor)),
            ],
          ),
          if (i.isPartial)
            Padding(
              padding: const EdgeInsets.only(top: 3),
              child: Text(
                'Ödendi ${CalendarText.tl(i.paidAmount)} · Kalan ${CalendarText.tl(i.remaining)}',
                style: const TextStyle(fontSize: 11, color: AppColors.muted),
              ),
            ),
          if (willApply)
            Padding(
              padding: const EdgeInsets.only(top: 3),
              child: Text(
                'Bu ödemeden ${CalendarText.tl(applied)} düşecek'
                '${applied >= i.remaining - 0.005 ? ' · kapanır' : ' · kısmi kalır'}',
                style: const TextStyle(
                    fontSize: 11, fontWeight: FontWeight.w700, color: AppColors.primaryDark),
              ),
            ),
        ],
      ),
    );
  }
}

/// İPTAL ARŞİVİ (cancelled_sales). İptalde cari kaydı taksit/tahsilat/seanslarıyla birlikte
/// canlı tablolardan silinip arşive taşınır — finansal iz kaybolmaz, yer değiştirir. Bu yüzden
/// liste cari listesinden süzülmez; `/api/admin/accounts/cancelled` ucundan gelir.
/// İKİ SEKME: tüm iptaller ve yalnızca PARA GERİ ÖDENENLER (iade).
class CancelledSalesSheet extends StatefulWidget {
  const CancelledSalesSheet({
    required this.sales,
    this.onRestore,
    this.initialRefundTab = false,
    super.key,
  });

  final List<Map<String, dynamic>> sales;

  /// İptali geri al — yedekten cari, taksit, tahsilat ve seanslar aynı Id'lerle kurulur.
  /// [voidRefund]: iade FİİLEN yapılmamışsa (yanlış kayıt) true; kasa çıkışı da geri alınır
  /// (gerekçe zorunlu, [voidReason] yalnız o durumda dolar).
  final Future<void> Function(String originalAccountId, bool voidRefund, String? voidReason)?
      onRestore;

  /// true → "İade Edilenler" sekmesiyle açılır (Ön Muhasebe'deki ayrı buton).
  final bool initialRefundTab;

  @override
  State<CancelledSalesSheet> createState() => _CancelledSalesSheetState();
}

class _CancelledSalesSheetState extends State<CancelledSalesSheet> {
  String? _restoring;
  late bool _refundTab = widget.initialRefundTab;

  /// İptali geri al. İADE VARSA KARAR YÖNETİCİNİN: müşteriye fiilen ödenmiş para geri alma
  /// yüzünden kendiliğinden "olmamış" sayılamaz — dünkü kasa çıkışı bugünkü bir düzeltmeyle
  /// raporlardan silinirse mali iz bozulur. Yanlış girilmişse ayrıca seçilir.
  Future<void> _restore(Map<String, dynamic> sale) async {
    final id = '${sale['originalAccountId']}';
    final refunded = numberOf(sale, const ['refundedAmount']);

    var voidRefund = false;
    String? voidReason;
    if (refunded > 0.005) {
      final reasonCtrl = TextEditingController();
      final choice = await showDialog<String>(
        context: context,
        // StatefulBuilder: gerekçe yazıldıkça "Hayır" butonu etkinleşmeli. Aksi hâlde buton
        // durumu ilk build'de donuyor ve kullanıcı gerekçeyi yazsa bile ilerleyemiyordu.
        builder: (ctx) => StatefulBuilder(
          builder: (ctx, setLocal) => AlertDialog(
          title: const Text('İptali geri al'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Bu iptalde müşteriye ${CalendarText.tl(refunded)} iade edilmişti. '
                  'Para gerçekten ödendi mi?',
                  style: const TextStyle(fontSize: 12.5),
                ),
                const SizedBox(height: 6),
                const Text(
                  '"Evet" derseniz kasa çıkışı korunur ve bu tutar müşteri borcuna geri yazılır.',
                  style: TextStyle(fontSize: 10.5, color: AppColors.muted),
                ),
                const SizedBox(height: 10),
                // "Hayır" gerçek bir kasa hareketini siler → gerekçe zorunlu (denetim izi).
                TextField(
                  controller: reasonCtrl,
                  onChanged: (_) => setLocal(() {}),
                  decoration: const InputDecoration(
                    hintText: 'Yanlış girildiyse gerekçe yazın',
                    isDense: true,
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Vazgeç')),
            TextButton(
              onPressed: reasonCtrl.text.trim().isEmpty
                  ? null
                  : () => Navigator.pop(ctx, 'void'),
              child: const Text('Hayır, yanlış girilmiş'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(ctx, 'keep'),
              child: const Text('Evet, ödendi'),
            ),
          ],
          ),
        ),
      );
      if (choice == null) return;
      voidRefund = choice == 'void';
      voidReason = voidRefund ? reasonCtrl.text.trim() : null;
    }

    setState(() => _restoring = id);
    try {
      await widget.onRestore!(id, voidRefund, voidReason);
      if (mounted) Navigator.pop(context);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    } finally {
      if (mounted) setState(() => _restoring = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final all = [...widget.sales]
      ..sort((a, b) => '${b['cancelledAtUtc']}'.compareTo('${a['cancelledAtUtc']}'));
    final refundedRows =
        all.where((a) => numberOf(a, const ['refundedAmount']) > 0.005).toList();
    final list = _refundTab ? refundedRows : all;

    final total = list.fold<double>(0, (s, a) => s + numberOf(a, const ['totalAmount']));
    final refunded = list.fold<double>(0, (s, a) => s + numberOf(a, const ['refundedAmount']));
    final retained = list.fold<double>(0, (s, a) => s + numberOf(a, const ['retainedAmount']));

    return Padding(
      padding: const EdgeInsets.fromLTRB(18, 16, 18, 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  color: (_refundTab ? AppColors.warning : AppColors.danger)
                      .withValues(alpha: .10),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(_refundTab ? Icons.undo_rounded : Icons.block_rounded,
                    color: _refundTab ? AppColors.warning : AppColors.danger, size: 20),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(_refundTab ? 'İade edilen satışlar' : 'İptal edilen satışlar',
                        style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                    Text(
                        _refundTab
                            ? '${list.length} kayıt · iade ${CalendarText.tl(refunded)}'
                                ' · kurumda ${CalendarText.tl(retained)}'
                            : '${list.length} kayıt · toplam ${CalendarText.tl(total)}'
                                '${refunded > 0.005 ? ' · iade ${CalendarText.tl(refunded)}' : ''}',
                        style: const TextStyle(fontSize: 11.5, color: AppColors.muted)),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          // Sekmeler
          Container(
            padding: const EdgeInsets.all(3),
            decoration: BoxDecoration(
              color: AppColors.surfaceSoft,
              borderRadius: BorderRadius.circular(999),
              border: Border.all(color: AppColors.border),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                for (final t in [
                  (false, 'İptal Edilenler', all.length),
                  (true, 'İade Edilenler', refundedRows.length),
                ])
                  GestureDetector(
                    onTap: () => setState(() => _refundTab = t.$1),
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 160),
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                      decoration: BoxDecoration(
                        color: _refundTab == t.$1 ? AppColors.primary : Colors.transparent,
                        borderRadius: BorderRadius.circular(999),
                      ),
                      child: Text(
                        '${t.$2} ${t.$3}',
                        style: TextStyle(
                          fontSize: 11.5,
                          fontWeight: FontWeight.w800,
                          color: _refundTab == t.$1 ? Colors.white : AppColors.muted,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          if (list.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 28),
              child: Center(
                child: Text(
                    _refundTab
                        ? 'Müşteriye iade edilmiş tutar yok.\nİade, satış iptal edilirken girilir.'
                        : 'İptal edilmiş satış yok.',
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: AppColors.muted)),
              ),
            ),
          Flexible(
            child: ListView(
              shrinkWrap: true,
              children: [
                for (final a in list)
                  Container(
                    margin: const EdgeInsets.only(bottom: 8),
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: AppColors.surface,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: AppColors.border),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                valueOf(a, const ['customerName', 'name']),
                                style: const TextStyle(fontWeight: FontWeight.w700),
                              ),
                            ),
                            // İade sekmesinde başrol iade tutarı; satış toplamı ikinci planda.
                            Text(
                                _refundTab
                                    ? '−${CalendarText.tl(numberOf(a, const ['refundedAmount']))}'
                                    : CalendarText.tl(numberOf(a, const ['totalAmount'])),
                                style: TextStyle(
                                    fontWeight: FontWeight.w800,
                                    color: _refundTab ? AppColors.danger : AppColors.ink)),
                          ],
                        ),
                        Text(valueOf(a, const ['name'], fallback: ''),
                            style: const TextStyle(fontSize: 11.5, color: AppColors.muted)),
                        Text(
                          _refundTab
                              ? 'Tahsil ${CalendarText.tl(numberOf(a, const ['collectedAmount']))}'
                                  ' · kurumda ${CalendarText.tl(numberOf(a, const ['retainedAmount']))}'
                              : 'Tahsil ${CalendarText.tl(numberOf(a, const ['collectedAmount']))}'
                                  '${numberOf(a, const ['refundedAmount']) > 0.005 ? ' · iade ${CalendarText.tl(numberOf(a, const ['refundedAmount']))}' : ''}',
                          style: const TextStyle(fontSize: 11, color: AppColors.muted),
                        ),
                        const SizedBox(height: 6),
                        Container(
                          width: double.infinity,
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                          decoration: BoxDecoration(
                            color: (_refundTab ? AppColors.warning : AppColors.danger)
                                .withValues(alpha: .07),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Text(
                            _refundTab
                                ? 'İade · ${shortDay('${a['cancelledAtUtc']}'.split('T').first)}'
                                    '${numberOf(a, const ['refundedAmount']) >= numberOf(a, const ['collectedAmount']) - 0.005 ? ' — tamamı iade edildi' : ' — kısmi iade'}'
                                : 'İptal · ${shortDay('${a['cancelledAtUtc']}'.split('T').first)}'
                                    ' — ${valueOf(a, const ['cancellationReason'], fallback: 'gerekçe belirtilmemiş')}',
                            style: TextStyle(
                                fontSize: 11,
                                color: _refundTab ? AppColors.warning : AppColors.danger),
                          ),
                        ),
                        if (widget.onRestore != null)
                          Align(
                            alignment: Alignment.centerRight,
                            child: TextButton.icon(
                              onPressed: _restoring != null
                                  ? null
                                  : () => _restore(a),
                              icon: const Icon(Icons.undo_rounded, size: 16),
                              label: const Text('İptali geri al', style: TextStyle(fontSize: 12)),
                            ),
                          ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
