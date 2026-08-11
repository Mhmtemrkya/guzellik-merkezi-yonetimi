import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/theme/app_theme.dart';
import '../../shared/json_helpers.dart';
import '../appointments/calendar_theme.dart';

// ---------------------------------------------------------------------------
// CARİ TAKSİT YARDIMCILARI (web `lib/accountGrouping.ts` paritesi)
//
// TEK TAHSİLAT SAYFASI: "genel tahsilat" ve "aylık taksit" ayrı sayfaları birleştirildi
// (bkz. collection_sheet.dart). Taksitli hesapta plan, devir ve "bu ay ödenmesi gereken"
// tutar o sayfada kendiliğinden çıkar; kullanıcıya hangi modal sorusu sorulmaz.
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

  /// Kalan borç — KURAL BACKEND İLE AYNI OLMALI (`AccountInstallment.RemainingAmount`):
  /// iptal edilmiş taksitin kalanı SIFIRDIR.
  ///
  /// Burada `cancelled` yok sayılıyordu: tahsilat dağıtımı iptal edilmişleri zaten süzdüğü için
  /// para hareketi doğruydu, ama LİSTE satırı iptal edilmiş bir taksiti "Kalan X ₺" diye
  /// gösteriyordu — aynı kayıt webde kapalı, mobilde açık borç görünüyordu. Aynı iş kuralının iki
  /// yerde ayrı yazılması tam olarak bu sapmayı üretir (bkz. web-mobil parite kuralı).
  double get remaining =>
      cancelled ? 0 : ((amount - paidAmount) < 0 ? 0 : amount - paidAmount);
  bool get isPaid => remaining <= 0.005;
  bool get isPartial => !isPaid && paidAmount > 0.005;
}

String _todayIso() => DateFormat('yyyy-MM-dd').format(DateTime.now());

/// Taksit listesi — durum ve GECİKME hesabı web'deki `normalizeAccount` ile aynı:
/// bir taksit, BİR SONRAKİ taksitin vade günü gelene kadar "gecikti" sayılmaz
/// (son taksit için kendi vadesine +1 ay tolerans).
/// [todayIso] dışarıdan verilebilir: gecikme hesabı burada YAPILDIĞI için (sunucu bayrağı
/// değil) sabit saate bağlanmazsa sonuç takvime göre değişir ve testler yılın ayına göre
/// farklı sonuç verir.
List<AccountInstallment> parseInstallments(
  Map<String, dynamic> account, [
  String? todayIso,
]) {
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

  final today = (todayIso != null && todayIso.length >= 10)
      ? todayIso.substring(0, 10)
      : _todayIso();
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

// ---------------------------------------------------------------------------
// DÜZENSİZ ÖDEME (DEVİR) KURALI — web `lib/accountGrouping.ts` ile AYNI kural.
//
// Ödenmeyen ayın borcu SİLİNMEZ, sonraki ayın taksitinin ÜSTÜNE biner: 5.000'lik planda
// 2. ay ödenmezse 3. ayda ödenmesi gereken 10.000 olur; 7.500 ödenirse kalan 2.500 aynı
// şekilde 4. aya devreder (4. ay = 5.000 + 2.500 = 7.500).
//
// TÜRETİLMİŞTİR, PLANI DEĞİŞTİRMEZ: sunucu tahsilatı vade sırasıyla dağıtır ve plan tutarları
// "finanse edilen / taksit sayısı" kuralıyla yeniden hizalanabilir — taksit satırına 10.000
// yazmak ilk onarım turunda geri alınırdı. Devir yalnız GÖRÜNÜM + tahsilat önerisi katmanıdır.
// ---------------------------------------------------------------------------

/// Devirli taksit satırı — bir taksitin "bu ay ödenmesi gereken" hâli.
class InstallmentDueRow {
  InstallmentDueRow({
    required this.item,
    required this.carryIn,
    required this.expected,
    required this.outstanding,
    required this.isOverdue,
  });

  final AccountInstallment item;

  /// Önceki (vadesi gelmiş) taksitlerden devreden ödenmemiş bakiye.
  final double carryIn;

  /// Bu ay ödenmesi gereken toplam: `amount + carryIn`.
  final double expected;

  /// Bu taksitten sonra devreden: `carryIn + remaining`.
  final double outstanding;
  final bool isOverdue;
}

/// Bir hesabın taksitlerini vade sırasıyla gezip devir bakiyesini hesaplar.
/// HESAP BAZINDADIR: sunucu tahsilatı hesap havuzundan dağıtır, bir satışın gecikmesi
/// başka satışın taksitine binmez.
///
/// [todayIso] DIŞARIDAN VERİLEBİLİR (web'deki eşi de öyle): içeride `DateTime.now()` sabitse
/// sonuç takvime bağımlı olur ve testler yılın hangi ayında koştuğuna göre değişirdi.
List<InstallmentDueRow> buildInstallmentRows(
  List<AccountInstallment> installments, [
  String? todayIso,
]) {
  final ordered = installments.where((i) => !i.cancelled).toList()
    ..sort((a, b) {
      final c = a.dueDate.compareTo(b.dueDate);
      return c != 0 ? c : a.no.compareTo(b.no);
    });
  final today = (todayIso != null && todayIso.length >= 10)
      ? todayIso.substring(0, 10)
      : _todayIso();
  var carry = 0.0;
  final out = <InstallmentDueRow>[];
  for (final i in ordered) {
    final carryIn = carry;
    final outstanding = carryIn + i.remaining;
    // Devre YALNIZ VADESİ GELMİŞ borç girer; yoksa düzenli ödeyen müşteride bile sonraki
    // satırlar "devir" gösterip o ayın ödenmeyeceğini varsayardı.
    if (i.dueDate.isNotEmpty && i.dueDate.compareTo(today) <= 0) carry = outstanding;
    out.add(InstallmentDueRow(
      item: i,
      carryIn: carryIn,
      expected: i.amount + carryIn,
      outstanding: outstanding,
      isOverdue: i.remaining > 0.005 &&
          (i.overdue || (i.dueDate.isNotEmpty && i.dueDate.compareTo(today) < 0)),
    ));
  }
  return out;
}

/// "Bu ay ödenmesi gereken" — gecikmiş devir + içinde bulunulan ayın taksiti.
///
/// [todayIso] dışarıdan verilebilir; verilmezse bugün. (Web'deki eşi tarihi ZORUNLU alır;
/// burada isteğe bağlı çünkü çağrı yerlerinin çoğu canlı ekrandır.)
double dueThisMonth(List<AccountInstallment> installments, [String? todayIso]) {
  final base = (todayIso != null && todayIso.length >= 7)
      ? DateTime(int.parse(todayIso.substring(0, 4)), int.parse(todayIso.substring(5, 7)))
      : DateTime.now();
  final limit = DateFormat('yyyy-MM-dd').format(DateTime(base.year, base.month + 1, 0));
  return installments
      .where((i) =>
          !i.cancelled &&
          i.remaining > 0.005 &&
          i.dueDate.isNotEmpty &&
          i.dueDate.compareTo(limit) <= 0)
      .fold<double>(0, (s, i) => s + i.remaining);
}

/// Tahsilat sayfasının açılış tutarı:
///  · taksitli hesap → BU AY ÖDENMESİ GEREKEN (devir dahil)
///  · bu ay vadesi yoksa → SIRADAKİ TAKSİT
///  · peşin hesap    → kalan borcun tamamı
///
/// Taksitlide "kalan borcun tamamı"na düşmek tehlikeliydi: bu ay vadesi olmayan bir planda
/// sayfa 25.000 ₺ ile açılıp tek dokunuşla tüm planı tahsil edebiliyordu.
double suggestedCollectionAmount(Map<String, dynamic> account) {
  final plan = parseInstallments(account).where((i) => !i.cancelled).toList();
  if (plan.length > 1) {
    final due = dueThisMonth(plan);
    if (due > 0.005) return due;
    final pending = plan.where((i) => i.remaining > 0.005).toList()
      ..sort((a, b) => a.dueDate.compareTo(b.dueDate));
    if (pending.isNotEmpty) return pending.first.remaining;
  }
  return numberOf(account, const ['remainingAmount', 'remaining']);
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
