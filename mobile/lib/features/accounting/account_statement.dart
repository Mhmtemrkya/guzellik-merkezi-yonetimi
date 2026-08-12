import '../../shared/json_helpers.dart';
import '../../shared/payment_method.dart';
import 'account_grouping.dart';

/// CARİ HESAP EKSTRESİ — web `lib/accountStatement.ts` paritesi (AYNI test vakaları).
///
/// Eski "Tahsilat Ekstresi" yalnız TAHSİLATLARI listeliyordu: müşteri "ne kadar borçlandım,
/// hangi taksit ne zaman doğdu" sorusunun cevabını göremiyordu. Gerçek ekstre BORÇ (bizim
/// alacağımız) ile ALACAK (müşterinin ödediği) satırlarını tarih sırasına dizer ve her satırın
/// ardından YÜRÜYEN BAKİYE yazar.
///
/// BORÇ SATIŞ GÜNÜNDE TEK SATIRDA DOĞAR. Alacak satış anında tamamıyla doğar; taksit planı bir
/// ÖDEME TAKVİMİDİR, ayrı bir alacak değildir. Bir satışın TEK borç satırı vardır: satış günü,
/// `TotalAmount` kadar. Peşinat bu tutarın İÇİNDEDİR — ayrıca borç yazılmaz, yalnız tahsil
/// edildiğinde alacak satırı olur.
///
/// Vadesi gelmemiş taksitler belgeye DÜŞMEZ: müşteri henüz ödemediği taksit için ikinci kez
/// borçlandırılamaz. Taksit zamanı geldiğinde belgeye düşen şey TAHSİLATTIR. Plan bilgisi
/// kaybolmaz — "Taksit Takvimi" ızgarası hangi ay ne ödeneceğini ayrıca gösterir.
///
/// Değişmez korunur: `Σborç − Σalacak = Σ(Total − Paid)`.
///
/// İPTAL EDİLEN SATIŞ SIFIRA KAPANIR: tahsilatlar alacak, iadeler borç, aradaki fark
/// ("kurumda kalan") tek borç satırı. Net etki sıfır — iptal borç doğurmaz.
///
/// TARİH ANLAMI: tahsilat/iade bir ANDIR → YEREL güne çevrilir.
///
/// TEK SÜTUN: belgede "İşlem Türü" ile "Açıklama" ayrı sütun değildir — [StatementRow.label]
/// alanında birleşir: "Paket Satışı (9-D)", "Tahsilat (Nakit · 9-D)".

enum StatementKind {
  /// Önceki dönemden devreden bakiye (tarih süzgeci varsa).
  opening,

  /// Satış — satış günü doğan borcun TAMAMI (peşinat ve taksitler bunun içindedir).
  sale,

  /// Müşteriden alınan para.
  collection,

  /// Müşteriye geri ödenen para.
  refund,

  /// İptal edilen satıştan kurumda kalan tutar.
  cancelled,
}

/// İşlem türü sütununun yazımı — TEK KAYNAK (web ile aynı sözcükler).
const Map<StatementKind, String> statementTypeLabel = {
  StatementKind.opening: 'Devir',
  StatementKind.sale: 'Satış',
  StatementKind.collection: 'Tahsilat',
  StatementKind.refund: 'İade',
  StatementKind.cancelled: 'Satış (İptal)',
};

/// BİRLEŞİK SÜTUNUN BAŞI — PARANTEZSİZ olmalı (detay parantez içine giriyor).
/// `statementTypeLabel` doğrudan kullanılsaydı "Satış (İptal) (9-D)" gibi iç içe parantez çıkardı.
const Map<StatementKind, String> _statementHead = {
  StatementKind.opening: 'Devir',
  StatementKind.sale: 'Satış',
  StatementKind.collection: 'Tahsilat',
  StatementKind.refund: 'İade',
  StatementKind.cancelled: 'İptal Edilen Satış',
};

/// "Satış" + "9-D" → "Satış (9-D)". Detay boşsa parantez açılmaz.
String _composeLabel(String head, String detail) {
  final d = detail.trim();
  return d.isEmpty ? head : '$head ($d)';
}


/// AYNI GÜN İÇİ SIRA: satış günü hem satış borcu hem peşinat tahsilatı düşer; borç önce
/// yazılmazsa bakiye sütunu önce eksiye düşüp sonra düzelir.
const Map<StatementKind, int> _kindRank = {
  StatementKind.opening: -1,
  StatementKind.sale: 0,
  StatementKind.cancelled: 0,
  StatementKind.collection: 2,
  StatementKind.refund: 3,
};

class StatementRow {
  StatementRow({
    required this.date,
    required this.kind,
    required this.description,
    required this.debit,
    required this.credit,
    this.label = '',
    this.balance = 0,
    this.accountId = '',
  });

  /// `YYYY-MM-DD` — yerel gün (tahsilat) ya da satış günü.
  final String date;
  final StatementKind kind;
  final String description;

  /// BELGEDE GÖSTERİLEN TEK SÜTUN: tür + detay birleşik ("Tahsilat (Nakit · 9-D)").
  final String label;
  final double debit;
  final double credit;

  /// Bu satırdan SONRAKİ yürüyen bakiye (borç pozitif).
  double balance;

  /// Satırın bağlı olduğu cari; arşiv satırlarında boş.
  final String accountId;

  String get type => statementTypeLabel[kind] ?? '';

  StatementRow copyWithBalance(double value) => StatementRow(
        date: date,
        kind: kind,
        description: description,
        label: label,
        debit: debit,
        credit: credit,
        balance: value,
        accountId: accountId,
      );
}

class AccountStatement {
  AccountStatement({
    required this.rows,
    required this.opening,
    required this.totalDebit,
    required this.totalCredit,
    required this.closing,
    required this.netAll,
    required this.firstDate,
    required this.lastDate,
    required this.totalCount,
    required this.clampDifference,
  });

  /// Gösterilen dönemin satırları (varsa Devir satırı başta).
  final List<StatementRow> rows;

  /// Dönem başı devir bakiyesi (süzgeç yoksa 0).
  final double opening;
  final double totalDebit;
  final double totalCredit;

  /// Kapanış bakiyesi. Pozitif = müşteri borçlu.
  final double closing;

  /// SÜZGEÇSİZ net bakiye — mutabakat kontrolü bunu kullanır.
  final double netAll;
  final String? firstDate;
  final String? lastDate;
  final int totalCount;

  /// KPI (cari başına sıfırlanmış kalan borç) ile belge neti arasındaki fark.
  final double clampDifference;
}

double _round2(num value) => (value * 100).round() / 100;

/// Bir ANI yerel güne çevirir. Düz tarih ("2026-09-01") olduğu gibi döner.
String localDay(dynamic value) {
  final raw = '${value ?? ''}'.trim();
  if (raw.isEmpty) return '';
  if (RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(raw)) return raw;
  final parsed = parseUtcToLocal(raw);
  if (parsed == null) return raw.length >= 10 ? raw.substring(0, 10) : raw;
  return '${parsed.year.toString().padLeft(4, '0')}-'
      '${parsed.month.toString().padLeft(2, '0')}-'
      '${parsed.day.toString().padLeft(2, '0')}';
}

class _Draft {
  _Draft({
    required this.seq,
    required this.date,
    required this.kind,
    required this.description,
    required this.head,
    required this.detail,
    required this.debit,
    required this.credit,
    required this.accountId,
  });

  final int seq;
  final String date;
  final StatementKind kind;
  final String description;

  /// Birleşik sütunun parantez ÖNCESİ başı ("Paket Satışı").
  final String head;

  /// Birleşik sütunun parantez İÇİ detayı ("Nakit · 9-D").
  final String detail;
  final double debit;
  final double credit;
  final String accountId;
}

/// Tutarın işaretine göre borç/alacak sütununa yazar (veri bozukluğunda ters kayıt üretmesin).
_Draft _signed({
  required int seq,
  required String date,
  required StatementKind kind,
  required String description,
  required String head,
  required String detail,
  required String accountId,
  required double amount,
}) {
  final v = _round2(amount);
  return _Draft(
    seq: seq,
    date: date,
    kind: kind,
    description: description,
    head: head,
    detail: detail,
    debit: v > 0 ? v : 0,
    credit: v < 0 ? -v : 0,
    accountId: accountId,
  );
}

/// Tahsilat satırının açıklaması: hangi satış · hangi yöntem · belge no.
String _collectionText(String label, String? method, String? reference) {
  final parts = <String>[label, paymentMethodLabel(method)];
  final ref = (reference ?? '').trim();
  if (ref.isNotEmpty) parts.add('Belge: $ref');
  return parts.join(' • ');
}

/// Birleşik sütunun parantez içi — ÖNCE ÖDEME YÖNTEMİ ("Tahsilat (Nakit)"), sonra hangi satış,
/// sonra belge no. Yöntem `paymentMethodLabel`ten geçer: kaydedilmemişse "Yöntem Kaydedilmemiş"
/// yazar, uydurma "Nakit" YAZILMAZ.
String _collectionDetail(String label, String? method, String? reference) {
  final parts = <String>[paymentMethodLabel(method), label];
  final ref = (reference ?? '').trim();
  if (ref.isNotEmpty) parts.add('Belge: $ref');
  return parts.join(' · ');
}

/// Müşterinin BÜTÜN hareketlerini üretir (süzgeçsiz, kronolojik).
List<StatementRow> buildStatementRows(
  CustomerAccountGroup group,
  List<Map<String, dynamic>> cancelledSales,
  String todayIso,
) {
  final drafts = <_Draft>[];
  var seq = 0;

  for (final account in group.accounts) {
    final label = saleDisplayName(account);
    final soldDay = localDay(account['soldAtUtc'] ?? account['createdAtUtc']);
    final accountId = '${account['id'] ?? ''}';
    // Paket bağı olan satış "Paket Satışı" yazar. Hizmet ↔ ürün ayrımı cari DTO'sunda YOK,
    // bu yüzden paket dışındaki her satış yalın "Satış" kalır — uydurma tür etiketi yazılmaz.
    final hasPackage = '${account['servicePackageId'] ?? ''}'.isNotEmpty;
    final saleHead = hasPackage ? 'Paket Satışı' : _statementHead[StatementKind.sale]!;

    // --- BORÇ: SATIŞIN TAMAMI, SATIŞ GÜNÜNDE, TEK SATIR ---
    // Taksitler ayrıca borç yazılsaydı aynı tutar iki kez sayılırdı. Plan bilgisi kaybolmaz:
    // defterin "Taksit Takvimi" ızgarası hangi ay ne ödeneceğini gösterir.
    final total = _round2(numberOf(account, const ['totalAmount']));
    if (total.abs() > 0.005) {
      drafts.add(_signed(
        seq: seq++, date: soldDay, kind: StatementKind.sale, accountId: accountId,
        description: label, head: saleHead, detail: label,
        amount: total,
      ));
    }

    // --- ALACAK: tahsilatlar ---
    var paymentSum = 0.0;
    var lastPaymentDay = '';
    for (final raw in (account['payments'] as List? ?? const [])) {
      if (raw is! Map) continue;
      final p = raw.cast<String, dynamic>();
      final day = localDay(p['occurredAtUtc']);
      final amount = _round2(numberOf(p, const ['amount']));
      paymentSum = _round2(paymentSum + amount);
      if (day.compareTo(lastPaymentDay) > 0) lastPaymentDay = day;
      drafts.add(_Draft(
        seq: seq++, date: day, kind: StatementKind.collection, accountId: accountId,
        description: _collectionText(label, '${p['method'] ?? ''}', '${p['reference'] ?? ''}'),
        head: _statementHead[StatementKind.collection]!,
        detail: _collectionDetail(label, '${p['method'] ?? ''}', '${p['reference'] ?? ''}'),
        debit: 0, credit: amount,
      ));
    }

    // SAPMA SATIRI: sunucuda `PaidAmount = Σödeme − RefundedAmount`, ama canlı cari DTO'su
    // `RefundedAmount` TAŞIMAZ. İptali geri alınan satışta korunan iade cariye işlenir; fark
    // yazılmazsa belge tahsilatı fazla, borcu eksik gösterir.
    final drift = _round2(paymentSum - numberOf(account, const ['paidAmount']));
    if (drift.abs() > 0.005) {
      final driftIsRefund = drift > 0;
      drafts.add(_signed(
        seq: seq++,
        date: lastPaymentDay.isNotEmpty ? lastPaymentDay : soldDay,
        kind: driftIsRefund ? StatementKind.refund : StatementKind.collection,
        accountId: accountId,
        description: driftIsRefund ? '$label • iade edilen tutar' : '$label • ${paymentMethodLabel('')}',
        head: driftIsRefund
            ? _statementHead[StatementKind.refund]!
            : _statementHead[StatementKind.collection]!,
        // Sapma satırının yöntemi GERÇEKTEN bilinmiyor (DTO taşımıyor) — uydurulmaz.
        detail: driftIsRefund
            ? '$label · iade edilen tutar'
            : '${paymentMethodLabel('')} · $label',
        amount: drift,
      ));
    }
  }

  // --- İPTAL ARŞİVİ: para gerçek, borç sıfır ---
  for (final sale in cancelledSales) {
    final label = valueOf(sale, const ['name'], fallback: 'Satış');
    final soldDay = localDay(sale['soldAtUtc'] ?? sale['cancelledAtUtc']);
    final cancelDay = localDay(sale['cancelledAtUtc'] ?? sale['soldAtUtc']);

    var collected = 0.0;
    final pays = (sale['payments'] as List? ?? const []).whereType<Map>().toList();
    if (pays.isNotEmpty) {
      for (final raw in pays) {
        final p = raw.cast<String, dynamic>();
        final amount = _round2(numberOf(p, const ['amount']));
        collected = _round2(collected + amount);
        drafts.add(_Draft(
          seq: seq++, date: localDay(p['occurredAtUtc']), kind: StatementKind.collection,
          accountId: '',
          description: _collectionText('$label · İPTAL', '${p['method'] ?? ''}', '${p['reference'] ?? ''}'),
          head: _statementHead[StatementKind.collection]!,
          detail: _collectionDetail(
              '$label · iptal edilen satış', '${p['method'] ?? ''}', '${p['reference'] ?? ''}'),
          debit: 0, credit: amount,
        ));
      }
    } else if (numberOf(sale, const ['collectedAmount']) > 0.005) {
      // Eski arşiv kaydı: yöntem GERÇEKTEN bilinmiyor — uydurulmaz.
      collected = _round2(numberOf(sale, const ['collectedAmount']));
      drafts.add(_Draft(
        seq: seq++, date: soldDay.isNotEmpty ? soldDay : cancelDay,
        kind: StatementKind.collection, accountId: '',
        description: _collectionText('$label · İPTAL', '', ''),
        head: _statementHead[StatementKind.collection]!,
        detail: _collectionDetail('$label · iptal edilen satış', '', ''),
        debit: 0, credit: collected,
      ));
    }

    var refunded = 0.0;
    final refunds = (sale['refunds'] as List? ?? const []).whereType<Map>().toList();
    if (refunds.isNotEmpty) {
      for (final raw in refunds) {
        final r = raw.cast<String, dynamic>();
        final amount = _round2(numberOf(r, const ['amount']));
        refunded = _round2(refunded + amount);
        drafts.add(_Draft(
          seq: seq++, date: localDay(r['refundedAtUtc']), kind: StatementKind.refund,
          accountId: '',
          description: _collectionText('$label · İADE', '${r['method'] ?? ''}', '${r['reference'] ?? ''}'),
          head: _statementHead[StatementKind.refund]!,
          detail: _collectionDetail(
              '$label · iptal edilen satış', '${r['method'] ?? ''}', '${r['reference'] ?? ''}'),
          debit: amount, credit: 0,
        ));
      }
    } else if (numberOf(sale, const ['refundedAmount']) > 0.005) {
      refunded = _round2(numberOf(sale, const ['refundedAmount']));
      drafts.add(_Draft(
        seq: seq++, date: cancelDay, kind: StatementKind.refund, accountId: '',
        description: _collectionText('$label · İADE', '', ''),
        head: _statementHead[StatementKind.refund]!,
        detail: _collectionDetail('$label · iptal edilen satış', '', ''),
        debit: refunded, credit: 0,
      ));
    }

    // KAPATMA SATIRI — iptal edilen satış bakiyeye ETKİ ETMEZ. "Kurumda kalan" arşiv
    // skalerinden değil YAZILAN SATIRLARDAN türetilir: arşiv toplamı ile satır kopyaları
    // ayrışırsa belge kendi içinde çelişir, yürüyen bakiye sıfıra kapanmazdı.
    final retained = _round2(collected - refunded);
    if (retained.abs() > 0.005) {
      drafts.add(_signed(
        seq: seq++, date: soldDay.isNotEmpty ? soldDay : cancelDay,
        kind: StatementKind.cancelled, accountId: '',
        description: '$label • iptal edildi, kurumda kalan tutar',
        head: _statementHead[StatementKind.cancelled]!,
        detail: '$label · kurumda kalan tutar',
        amount: retained,
      ));
    }
  }

  // KRONOLOJİK ARTAN — en eski üstte, EN YENİ EN ALTTA. Ekstre yukarıdan aşağı okunur ve
  // kapanış bakiyesi son satırın devamıdır.
  // TARİHSİZ SATIR EN ALTA: eskiden en başa atılıyordu, bu da tarihi eksik yeni bir kaydın
  // belgenin TEPESİNDE belirmesi demekti. Alt da görünür alandır (kapanış bandının üstü).
  String dateRank(String d) => d.isEmpty ? '9999-99-99' : d;
  drafts.sort((a, b) {
    final byDate = dateRank(a.date).compareTo(dateRank(b.date));
    if (byDate != 0) return byDate;
    final byKind = (_kindRank[a.kind] ?? 0).compareTo(_kindRank[b.kind] ?? 0);
    if (byKind != 0) return byKind;
    return a.seq.compareTo(b.seq);
  });

  return drafts
      .map((d) => StatementRow(
            date: d.date,
            kind: d.kind,
            description: d.description,
            label: _composeLabel(d.head, d.detail),
            debit: d.debit,
            credit: d.credit,
            accountId: d.accountId,
          ))
      .toList();
}

/// Belgeyi kurar: süzgeç uygular, devir satırını üretir, yürüyen bakiyeyi yazar.
AccountStatement buildAccountStatement({
  required CustomerAccountGroup group,
  List<Map<String, dynamic>> cancelledSales = const [],
  required String todayIso,
  String? from,
  String? to,
}) {
  final all = buildStatementRows(group, cancelledSales, todayIso);
  final fromDay = (from ?? '').length >= 10 ? from!.substring(0, 10) : (from ?? '');
  final toDay = (to ?? '').length >= 10 ? to!.substring(0, 10) : (to ?? '');

  var netAll = 0.0;
  for (final row in all) {
    netAll = _round2(netAll + row.debit - row.credit);
  }

  // Dönem başı devir: süzgeçten ÖNCEKİ satırların neti. Devirsiz süzülmüş ekstre bakiye
  // sütununda YANLIŞ rakam yazar — belge basılıp müşteriye verildiği için kabul edilemez.
  var opening = 0.0;
  final visible = <StatementRow>[];
  for (final row in all) {
    if (fromDay.isNotEmpty && row.date.isNotEmpty && row.date.compareTo(fromDay) < 0) {
      opening = _round2(opening + row.debit - row.credit);
      continue;
    }
    if (toDay.isNotEmpty && row.date.isNotEmpty && row.date.compareTo(toDay) > 0) continue;
    visible.add(row);
  }

  final rows = <StatementRow>[];
  var balance = opening;
  if (fromDay.isNotEmpty && opening.abs() > 0.005) {
    rows.add(StatementRow(
      date: fromDay,
      kind: StatementKind.opening,
      description: 'Önceki dönemden devreden bakiye',
      label: _composeLabel(_statementHead[StatementKind.opening]!, 'önceki dönemden devreden'),
      debit: opening > 0 ? opening : 0,
      credit: opening < 0 ? -opening : 0,
      balance: opening,
    ));
  }

  var totalDebit = 0.0;
  var totalCredit = 0.0;
  for (final row in visible) {
    balance = _round2(balance + row.debit - row.credit);
    totalDebit = _round2(totalDebit + row.debit);
    totalCredit = _round2(totalCredit + row.credit);
    rows.add(row.copyWithBalance(balance));
  }

  final dated = all.map((r) => r.date).where((d) => d.isNotEmpty).toList()..sort();

  return AccountStatement(
    rows: rows,
    opening: opening,
    totalDebit: totalDebit,
    totalCredit: totalCredit,
    closing: balance,
    netAll: netAll,
    firstDate: dated.isEmpty ? null : dated.first,
    lastDate: dated.isEmpty ? null : dated.last,
    totalCount: all.length,
    clampDifference: _round2(group.remainingAmount - netAll),
  );
}

// ---------------------------------------------------------------------------
// TUTARIN YAZIYLA OKUNUŞU
// ---------------------------------------------------------------------------

const _ones = ['', 'Bir', 'İki', 'Üç', 'Dört', 'Beş', 'Altı', 'Yedi', 'Sekiz', 'Dokuz'];
const _tens = ['', 'On', 'Yirmi', 'Otuz', 'Kırk', 'Elli', 'Altmış', 'Yetmiş', 'Seksen', 'Doksan'];
const _scales = ['', 'Bin', 'Milyon', 'Milyar', 'Trilyon'];

String _tripletToWords(int value) {
  final hundreds = value ~/ 100;
  final tens = (value % 100) ~/ 10;
  final ones = value % 10;
  final buffer = StringBuffer();
  // "BirYüz" denmez: 100 → "Yüz", 200 → "İkiYüz".
  if (hundreds > 0) buffer.write('${hundreds == 1 ? '' : _ones[hundreds]}Yüz');
  if (tens > 0) buffer.write(_tens[tens]);
  if (ones > 0) buffer.write(_ones[ones]);
  return buffer.toString();
}

/// Tam sayının Türkçe okunuşu ("430000" → "DörtYüzOtuzBin").
String turkishNumberToWords(num value) {
  final n = value.abs().floor();
  if (n == 0) return 'Sıfır';
  if (n >= 1000000000000000) return '';

  final groups = <int>[];
  var rest = n;
  while (rest > 0) {
    groups.add(rest % 1000);
    rest = rest ~/ 1000;
  }

  final buffer = StringBuffer();
  for (var i = groups.length - 1; i >= 0; i--) {
    final g = groups[i];
    if (g == 0) continue;
    // "BirBin" denmez: 1000 → "Bin", 2000 → "İkiBin". Milyon/milyar için istisna YOKTUR.
    if (i == 1 && g == 1) {
      buffer.write('Bin');
    } else {
      buffer.write('${_tripletToWords(g)}${_scales[i]}');
    }
  }
  return buffer.toString();
}

/// "Yalnız …" satırı: 430000 → "DörtYüzOtuzBin TL", 12,45 → "Onİki TL KırkBeş Kr".
String turkishAmountInWords(num amount) {
  final value = _round2(amount);
  final abs = value.abs();
  final lira = (abs + 1e-9).floor();
  final kurus = ((abs - lira) * 100).round();
  final words = turkishNumberToWords(lira);
  if (words.isEmpty) return '';
  var out = '$words TL';
  if (kurus > 0) out = '$out ${turkishNumberToWords(kurus)} Kr';
  return value < 0 ? 'Eksi $out' : out;
}

// ---------------------------------------------------------------------------
// BELGE KİMLİĞİ / BİÇİMLENDİRME
// ---------------------------------------------------------------------------

/// Cari kodu — veritabanında böyle bir alan YOK, müşterinin kendi kimliğinden TÜRETİLİR:
/// aynı müşteri her belgede aynı kodu alır, iki müşteri aynı kodu almaz.
String cariCode(String? customerId) {
  final hex = (customerId ?? '').replaceAll(RegExp(r'[^0-9a-fA-F]'), '');
  if (hex.isEmpty) return 'CR-000000';
  return 'CR-${hex.substring(0, hex.length < 6 ? hex.length : 6).toUpperCase()}';
}

/// Ekstre tablosunun sayı biçimi: "150.000,00" — para birimi sütun başlığında yazar.
String formatStatementAmount(num? value) {
  final v = (value ?? 0).toDouble();
  final negative = v < 0;
  final parts = v.abs().toStringAsFixed(2).split('.');
  final intPart = parts[0];
  final buffer = StringBuffer();
  for (var i = 0; i < intPart.length; i++) {
    if (i > 0 && (intPart.length - i) % 3 == 0) buffer.write('.');
    buffer.write(intPart[i]);
  }
  return '${negative ? '-' : ''}$buffer,${parts[1]}';
}

/// "2026-06-18" → "18.06.2026".
String formatDocDate(String? iso) {
  final raw = (iso ?? '');
  final s = raw.length >= 10 ? raw.substring(0, 10) : raw;
  final parts = s.split('-');
  if (parts.length != 3) return '—';
  return '${parts[2]}.${parts[1]}.${parts[0]}';
}

/// "11.08.2026 17:30" — düzenleme tarihi.
String formatDocDateTime(DateTime date) {
  String p(int n) => n.toString().padLeft(2, '0');
  return '${p(date.day)}.${p(date.month)}.${date.year} ${p(date.hour)}:${p(date.minute)}';
}
