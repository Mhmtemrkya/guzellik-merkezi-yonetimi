import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';

import '../../core/network/api_client.dart';
import '../../core/network/idempotency.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/json_helpers.dart';
import '../appointments/calendar_theme.dart';
import 'account_installments.dart';

/// TEK "Tahsilat Al" alt sayfası — web `CollectionDialog` paritesi.
///
/// Eski "aylık taksit tahsilatı" sayfası buraya katıldı: taksitli hesapta taksit planı,
/// DEVİR (ödenmeyen ayın sonraki aya binmesi) ve "bu ay ödenmesi gereken" hazır tutarı
/// bu sayfa kendisi getirir; kullanıcı hangi modalı açacağına karar vermez.
///
/// Web ile aynı davranışlar:
///  • Cari hesap ARANARAK seçilir (12 bin+ kayıtta dropdown kullanılmaz).
///  • Tutar taksitli hesapta BU AY ÖDENMESİ GEREKEN, peşinde kalan borcun tamamıyla dolar
///    (kuruş korunur).
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
  /// Çift gönderim freni (bkz. core/network/idempotency.dart). Sheet her açılışta yeni bir
  /// State üretir → tuz kendiliğinden oturum başına birdir.
  final String _salt = newIdempotencySalt();
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
    // TAKSİTLİ HESAPTA "BU AY ÖDENMESİ GEREKEN" (devir dahil), peşinde kalan borcun tamamı.
    final suggested = _kurus(suggestedCollectionAmount(account));
    _rows.first.amount.text = suggested > 0 ? _plain(suggested) : '';
    if (rebuild) setState(() {});
  }

  // ---- Taksit planı + devir (yalnız taksitli hesapta) ------------------------
  List<AccountInstallment> get _plan =>
      _selected == null ? const [] : parseInstallments(_selected!).where((i) => !i.cancelled).toList();
  bool get _hasPlan => _plan.length > 1;
  List<InstallmentDueRow> get _dueRows => buildInstallmentRows(_plan);
  List<InstallmentDueRow> get _pending =>
      _dueRows.where((r) => r.item.remaining > 0.005).toList();
  double get _overdueSum =>
      _pending.where((r) => r.isOverdue).fold<double>(0, (s, r) => s + r.item.remaining);
  double get _dueNow => _hasPlan ? dueThisMonth(_plan) : 0;

  /// Girilen toplamın taksitlere vade sırasıyla dağılımı (canlı önizleme).
  Map<String, double> get _allocation {
    var pool = _total;
    final map = <String, double>{};
    for (final r in _pending) {
      final applied = pool < r.item.remaining ? pool : r.item.remaining;
      if (applied > 0.005) map[r.item.id] = applied;
      pool -= applied;
      if (pool <= 0.005) break;
    }
    return map;
  }

  /// SATIŞ SEÇİMİ MODU — liste tek bir müşterinin satışlarına daraltılmışsa (ön muhasebede
  /// çok satışlı müşteride "Tahsilat al") seçicide müşteri adı değil SATIŞ adı öne çıkar:
  /// aynı ad üç kez alt alta yazınca hangi satışa para yazıldığı okunmuyordu.
  bool get _saleMode {
    if (_accounts.length < 2) return false;
    final first = '${_accounts.first['customerId'] ?? ''}';
    if (first.isEmpty || first == 'null') return false;
    return _accounts.every((a) => '${a['customerId'] ?? ''}' == first);
  }

  /// Hazır tutar çipi: tutarı TEK satıra yazar (kırılım varsa sadeleşir).
  void _applyQuickAmount(double value) {
    for (final r in _rows.skip(1)) {
      r.amount.dispose();
    }
    setState(() {
      _rows.removeRange(1, _rows.length);
      _rows.first.amount.text = _plain(_kurus(value));
    });
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
      builder: (_) => _AccountPicker(accounts: _accounts, saleMode: _saleMode),
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
        // ANAHTAR YÖNTEMDEN TÜRER, İNDEKSTEN DEĞİL: kısmi hatadan sonra kullanıcı tekrar
        // gönderdiğinde döngü BAŞARILI olanları da yeniden gönderir (satırlar budanmıyor);
        // aynı anahtar + aynı gövde sayesinde sunucu onları yazmak yerine oynatır.
        await widget.api.post(
          '/api/admin/accounts/${payload.accountId}/payments',
          payload.body,
          idempotencyKey(_salt, [
            payload.accountId,
            entry.key,
            entry.value,
            stamp,
            reference,
          ]),
        );
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
                      if (_hasPlan) ...[
                        const SizedBox(height: 14),
                        _quickAmounts(),
                        const SizedBox(height: 14),
                        _planPanel(),
                      ],
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
        Text(_saleMode ? 'Hangi satıştan tahsilat?' : 'Cari hesap',
            style: const TextStyle(
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
                                _saleMode
                                    ? valueOf(selected,
                                        const ['servicePackageName', 'name'],
                                        fallback: 'Satış')
                                    : valueOf(selected,
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
        // Tahsilat TEK satışın carisine yazılır; bölüştürme yok. Çok satışlı müşteride
        // bunu yazmazsak "hepsinden düşer" sanılıyor.
        if (_saleMode)
          Padding(
            padding: const EdgeInsets.only(top: 5),
            child: Text(
                'Bu müşterinin ${_accounts.length} açık satışı var. Tahsilat yalnız seçili satışın taksitlerine dağıtılır.',
                style: const TextStyle(fontSize: 10.5, color: AppColors.muted)),
          ),
      ],
    );
  }

  /// HAZIR TUTARLAR — taksitli hesapta "bu ay ödenmesi gereken" öne çıkar (web paritesi).
  Widget _quickAmounts() {
    final selected = _selected;
    if (selected == null) return const SizedBox.shrink();
    final items = <(String, double)>[];
    if (_dueNow > 0.005) items.add(('Bu ay ödenmesi gereken', _kurus(_dueNow)));
    if (_overdueSum > 0.005 && (_overdueSum - _dueNow).abs() > 0.005) {
      items.add(('Yalnız gecikmiş', _kurus(_overdueSum)));
    }
    final next = _pending.isEmpty ? null : _pending.first;
    if (next != null && (next.item.remaining - _dueNow).abs() > 0.005) {
      items.add(('Sıradaki taksit', _kurus(next.item.remaining)));
    }
    final remaining = _kurus(_remaining(selected));
    if (remaining > 0.005) items.add(('Kalan borcun tamamı', remaining));
    if (items.isEmpty) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('Hazır tutarlar',
            style: TextStyle(
                fontSize: 11.5,
                fontWeight: FontWeight.w700,
                color: AppColors.primaryDark)),
        const SizedBox(height: 6),
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            for (final item in items)
              ChoiceChip(
                selected: (_total - item.$2).abs() < 0.005 && _rows.length == 1,
                onSelected: (_) => _applyQuickAmount(item.$2),
                label: Text('${item.$1} · ${CalendarText.tl(item.$2)}',
                    style: const TextStyle(fontSize: 11.5)),
              ),
          ],
        ),
        if (_overdueSum > 0.005) ...[
          const SizedBox(height: 6),
          Text(
              'Ödenmeyen aylar sonraki ayın taksitine eklenir — bu ay ödenmesi gereken ${CalendarText.tl(_dueNow)}.',
              style: const TextStyle(fontSize: 11, color: AppColors.muted)),
        ],
      ],
    );
  }

  /// TAKSİT PLANI — devir ve canlı dağıtım (web modalindeki sol panelin karşılığı).
  Widget _planPanel() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const Text('Taksit planı',
                style: TextStyle(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w700,
                    color: AppColors.primaryDark)),
            const Spacer(),
            if (_overdueSum > 0.005)
              Text('${CalendarText.tl(_overdueSum)} gecikmiş',
                  style: const TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      color: AppColors.danger)),
          ],
        ),
        const SizedBox(height: 6),
        // İÇ İÇE DİKEY KAYDIRMA YOK: sayfa zaten bir SingleChildScrollView içinde. Buraya
        // kendi ListView'ini koymak iki kaydırılabilir alanı aynı jest arenasına sokup
        // parmağın hangisini sürüklediğini belirsizleştiriyordu (bkz. jest arenası tuzağı).
        Column(
          children: [
            for (var index = 0; index < _dueRows.length; index++)
              Builder(builder: (_) {
              final r = _dueRows[index];
              final applied = _allocation[r.item.id] ?? 0;
              final paid = r.item.isPaid;
              final bg = paid
                  ? const Color(0xFFECFDF3)
                  : applied > 0.005
                      ? const Color(0xFFFFF1F6)
                      : r.isOverdue
                          ? const Color(0xFFFEF2F2)
                          : Colors.white;
              return Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                decoration: BoxDecoration(
                  color: bg,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppColors.border),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text('#${r.item.no} · ${shortDay(r.item.dueDate)}',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(fontSize: 12)),
                        ),
                        Text(CalendarText.tl(r.item.amount),
                            style: const TextStyle(
                                fontSize: 12.5, fontWeight: FontWeight.w800)),
                        const SizedBox(width: 6),
                        Text(
                          paid
                              ? 'ÖDENDİ'
                              : r.isOverdue
                                  ? 'GECİKTİ'
                                  : r.item.isPartial
                                      ? 'KISMİ'
                                      : 'BEKLİYOR',
                          style: TextStyle(
                            fontSize: 10,
                            fontWeight: FontWeight.w800,
                            color: paid
                                ? AppColors.success
                                : r.isOverdue
                                    ? AppColors.danger
                                    : AppColors.muted,
                          ),
                        ),
                      ],
                    ),
                    // DEVİR: önceki ayların ödenmemiş borcu bu ayın üstüne biner.
                    if (r.carryIn > 0.005)
                      Text(
                          '+${CalendarText.tl(r.carryIn)} devir → bu ay ${CalendarText.tl(r.expected)}',
                          style: const TextStyle(
                              fontSize: 10.5,
                              fontWeight: FontWeight.w700,
                              color: AppColors.danger)),
                    if (applied > 0.005)
                      Text(
                          'Bu ödemeden ${CalendarText.tl(applied)} düşecek'
                          '${applied >= r.item.remaining - 0.005 ? ' · kapanır' : ' · kısmi kalır'}',
                          style: const TextStyle(
                              fontSize: 10.5,
                              fontWeight: FontWeight.w700,
                              color: AppColors.primaryDark)),
                  ],
                ),
              );
              }),
          ],
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
  const _AccountPicker({required this.accounts, this.saleMode = false});
  final List<Map<String, dynamic>> accounts;

  /// true ise liste tek müşterinin satışlarıdır — başlıkta SATIŞ adı yazılır.
  final bool saleMode;

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
                '${a['customerName'] ?? ''} ${a['name'] ?? ''} ${a['servicePackageName'] ?? ''} ${a['customerPhone'] ?? ''}'
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
                decoration: InputDecoration(
                  isDense: true,
                  prefixIcon: const Icon(Icons.search_rounded, size: 18),
                  hintText: widget.saleMode
                      ? 'Satış / paket ara…'
                      : 'Müşteri adı / telefon ara…',
                ),
              ),
            ),
            Flexible(
              child: list.isEmpty
                  ? const Padding(
                      padding: EdgeInsets.symmetric(vertical: 36),
                      child: Text('Kayıt bulunamadı.',
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
                              widget.saleMode
                                  ? valueOf(a,
                                      const ['servicePackageName', 'name'],
                                      fallback: 'Satış')
                                  : valueOf(a, const ['customerName', 'name']),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                  fontWeight: FontWeight.w700, fontSize: 13.5)),
                          subtitle: Text(
                              widget.saleMode
                                  ? (a['hasOverdue'] == true
                                      ? 'GECİKMİŞ · sıradaki vade ${valueOf(a, const ['nextDueDate'], fallback: '—')}'
                                      : 'Sıradaki vade ${valueOf(a, const ['nextDueDate'], fallback: '—')}')
                                  : valueOf(a, const ['name'], fallback: ''),
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
