import '../../shared/json_helpers.dart';
import 'account_installments.dart';

/// CARİ HESAPLARI MÜŞTERİ BAZINDA TOPLAMA — web `lib/accountGrouping.ts` paritesi.
///
/// Bir müşterinin üç ayrı satışı üç ayrı cari kartı açar (tahsilat/iptal/taksit doğru satışa
/// bağlansın diye ŞART). Ama ön muhasebede kullanıcı "bu müşteri bana ne kadar borçlu" diye
/// bakar; aynı ad üç satırda üç farklı tutarla görününce toplamı kafadan yapmak gerekiyordu.
///
/// VERİ MODELİ DEĞİŞMEZ, yalnız GÖRÜNÜM gruplanır: satır = müşteri, açılınca altında kendi
/// satışları durur. Tahsilat hâlâ TEK bir satışın carisine yazılır.

/// Aylık takvim hücresi — bir müşterinin bir aydaki taksit durumu.
class MonthCell {
  MonthCell({
    required this.key,
    required this.year,
    required this.month,
    required this.due,
    required this.paid,
    required this.remaining,
    required this.status,
  });

  /// `YYYY-MM` — sütun anahtarı.
  final String key;
  final int year;

  /// 1-12.
  final int month;

  /// O ay vadesi gelen taksitlerin toplamı.
  final double due;

  /// Bu vadelere dağıtılmış tahsilat.
  final double paid;

  /// Kalan (due − paid), negatife düşmez.
  final double remaining;

  /// `none` taksit yok · `paid` ödendi · `partial` kısmi · `overdue` gecikmiş · `upcoming` bekleyen.
  final String status;
}

class CustomerAccountGroup {
  CustomerAccountGroup({required this.customerId, required this.customerName, required this.customerPhone});

  final String customerId;
  String customerName;
  String customerPhone;

  /// Bu müşterinin satışları (cari kartları) — en yeni önce.
  final List<Map<String, dynamic>> accounts = [];

  int get saleCount => accounts.length;
  double totalAmount = 0;
  double paidAmount = 0;

  /// Kalan borç — cari BAŞINA sıfırla sınırlanır (fazla ödeme başka satışın borcunu kapatmaz).
  double remainingAmount = 0;
  bool hasOverdue = false;
  double overdueAmount = 0;
  String? nextDueDate;
  double nextDueAmount = 0;
  bool hasInstallmentPlan = false;

  /// En son satış tarihi — liste sıralaması bunu kullanır (tazelik).
  String lastSaleAtUtc = '';
  int sessionsTotal = 0;
  int sessionsRemaining = 0;
}

/// `YYYY-MM` anahtarı; boş/bozuk tarihte null.
String? _monthKeyOf(String? iso) {
  final s = (iso ?? '');
  if (s.length < 7) return null;
  final k = s.substring(0, 7);
  return RegExp(r'^\d{4}-\d{2}$').hasMatch(k) ? k : null;
}

/// Cari listesini müşteriye göre gruplar. `customerId` boş olan kayıt (veri bozukluğu) kendi
/// grubunda kalır — sessizce yutmak yerine görünür olsun.
List<CustomerAccountGroup> groupAccountsByCustomer(List<Map<String, dynamic>> accounts) {
  final map = <String, CustomerAccountGroup>{};

  for (final a in accounts) {
    final cid = '${a['customerId'] ?? ''}';
    final key = cid.isEmpty || cid == 'null' ? '__acc:${a['id']}' : cid;
    final g = map[key] ??= CustomerAccountGroup(
      customerId: cid == 'null' ? '' : cid,
      customerName: valueOf(a, const ['customerName', 'name'], fallback: 'Müşteri'),
      customerPhone: valueOf(a, const ['customerPhone'], fallback: ''),
    );

    g.accounts.add(a);
    g.totalAmount += numberOf(a, const ['totalAmount']);
    g.paidAmount += numberOf(a, const ['paidAmount']);
    // Cari BAŞINA sıfır tabanı: bir satıştaki fazla ödeme (kredi bakiyesi) diğerinin borcunu
    // kapatmaz — sunucu da tahsilatı hesap bazında tutar.
    final rem = numberOf(a, const ['remainingAmount']);
    g.remainingAmount += rem > 0 ? rem : 0;
    g.sessionsTotal += numberOf(a, const ['sessionsTotal']).toInt();
    g.sessionsRemaining += numberOf(a, const ['sessionsRemaining']).toInt();

    final insts = parseInstallments(a).where((i) => !i.cancelled).toList();
    if (insts.length > 1) g.hasInstallmentPlan = true;
    for (final i in insts) {
      if (i.overdue && i.remaining > 0.005) {
        g.hasOverdue = true;
        g.overdueAmount += i.remaining;
      }
    }

    final nd = valueOf(a, const ['nextDueDate'], fallback: '');
    if (nd.isNotEmpty && (g.nextDueDate == null || nd.compareTo(g.nextDueDate!) < 0)) {
      g.nextDueDate = nd;
      g.nextDueAmount = numberOf(a, const ['nextDueAmount']);
    }
    final soldAt = valueOf(a, const ['soldAtUtc', 'createdAtUtc'], fallback: '');
    if (soldAt.compareTo(g.lastSaleAtUtc) > 0) g.lastSaleAtUtc = soldAt;
  }

  for (final g in map.values) {
    // Grup içinde en yeni satış üstte — müşteri açılınca en güncel iş ilk görünsün.
    g.accounts.sort((x, y) => valueOf(y, const ['soldAtUtc', 'createdAtUtc'], fallback: '')
        .compareTo(valueOf(x, const ['soldAtUtc', 'createdAtUtc'], fallback: '')));
  }

  return map.values.toList();
}

/// Bir müşterinin AY AY taksit takvimi (Excel'deki "aylık ödeme ızgarası" karşılığı).
///
/// Aynı ayda birden çok satışın taksiti olabilir — hepsi tek hücrede toplanır. `todayIso`
/// dışarıdan verilir: "bugün" hesabı YEREL güne göre yapılmalı (UTC gününe geçmek ay sınırında
/// hücreyi kaydırır).
List<MonthCell> buildMonthlySchedule(CustomerAccountGroup group, String todayIso) {
  final byMonth = <String, List<double>>{}; // [due, paid, remaining, anyOverdue(0/1)]

  for (final a in group.accounts) {
    for (final i in parseInstallments(a).where((i) => !i.cancelled)) {
      final key = _monthKeyOf(i.dueDate);
      if (key == null) continue;
      final cur = byMonth[key] ??= [0, 0, 0, 0];
      cur[0] += i.amount;
      cur[1] += i.paidAmount;
      cur[2] += i.remaining > 0 ? i.remaining : 0;
      if (i.overdue && i.remaining > 0.005) cur[3] = 1;
    }
  }

  if (byMonth.isEmpty) return const [];

  // Takvim SÜREKLİ olmalı: taksiti olmayan aylar da sütun olarak durur, yoksa "Mart→Haziran"
  // gibi atlayan bir şerit çıkıp ödeme ritmi okunmaz hâle gelir.
  final keys = byMonth.keys.toList()..sort();
  final first = keys.first.split('-');
  final last = keys.last.split('-');
  final minY = int.parse(first[0]), minM = int.parse(first[1]);
  final maxY = int.parse(last[0]), maxM = int.parse(last[1]);
  final nowKey = todayIso.length >= 7 ? todayIso.substring(0, 7) : '';

  final cells = <MonthCell>[];
  var y = minY, m = minM;
  while (y < maxY || (y == maxY && m <= maxM)) {
    final key = '$y-${m.toString().padLeft(2, '0')}';
    final v = byMonth[key];
    if (v == null) {
      cells.add(MonthCell(key: key, year: y, month: m, due: 0, paid: 0, remaining: 0, status: 'none'));
    } else {
      final String status;
      if (v[2] <= 0.005) {
        status = 'paid';
      } else if (v[3] == 1 || (nowKey.isNotEmpty && key.compareTo(nowKey) < 0)) {
        status = 'overdue';
      } else if (v[1] > 0.005) {
        status = 'partial';
      } else {
        status = 'upcoming';
      }
      cells.add(MonthCell(key: key, year: y, month: m, due: v[0], paid: v[1], remaining: v[2], status: status));
    }
    if (m == 12) {
      m = 1;
      y += 1;
    } else {
      m += 1;
    }
  }
  return cells;
}
