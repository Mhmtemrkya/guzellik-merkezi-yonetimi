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

/// Bir vade satırının hangi satışlardan beslendiği — "Tümü" görünümünde satır altında yazar.
class DueDateSource {
  DueDateSource({required this.accountId, required this.label, required this.amount});

  final String accountId;

  /// Satışın adı (paket/hizmet).
  final String label;

  /// O günkü plan tutarının bu satıştan gelen kısmı.
  double amount;
}

/// TAKSİT TAKVİMİ SATIRI — satır = VADE GÜNÜ (ay değil).
///
/// Aynı GÜNE düşen taksitler TOPLANIR: müşterinin 12.08'de bir pakette 5.000, başka pakette
/// 2.000 taksiti varsa o gün tek satırda 7.000 yazar. Farklı tarihler kronolojik araya girer.
class DueDateRow {
  DueDateRow({
    required this.date,
    required this.due,
    required this.paid,
    required this.remaining,
    required this.installmentCount,
    required this.sources,
    required this.status,
  });

  /// `YYYY-MM-DD` vade tarihi — satır anahtarı.
  final String date;

  /// O günün PLAN toplamı.
  final double due;

  /// Bu vadelere dağıtılmış tahsilat.
  final double paid;

  /// Kalan (due − paid), negatife düşmez.
  final double remaining;

  /// O güne düşen taksit satırı sayısı (birden çok satıştan gelebilir).
  final int installmentCount;

  /// Katkı veren satışlar, payı büyükten küçüğe.
  final List<DueDateSource> sources;

  /// `paid` ödendi · `overdue` RESMEN gecikti (kanonik bayrak) · `grace` vadesi geçti ama
  /// tolerans sürüyor · `partial` kısmi · `upcoming` bekleyen.
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

/// SATIŞIN EKRANDAKİ ADI — TEK KAYNAK (ekstre, taksit takvimi, tahsilat seçicisi).
///
/// Adisyondan açılan carilerde `servicePackageName` "Paket satışı: X + Y" biçiminde geliyor;
/// bu ön ek her yerde gereksiz tekrar üretiyordu. YALNIZ bu bilinen ön ek kırpılır — genel bir
/// "baş metinle başlıyorsa kes" kuralı, adı gerçekten "Satış Danışmanlığı" olan paketi bozardı.
String saleDisplayName(Map<String, dynamic> account) {
  final raw = valueOf(account, const ['servicePackageName', 'name'], fallback: 'Satış');
  final trimmed =
      raw.replaceFirst(RegExp(r'^\s*paket\s+satışı\s*:\s*', caseSensitive: false), '').trim();
  return trimmed.isEmpty ? raw : trimmed;
}

/// `YYYY-MM-DD` gün anahtarı; boş/bozuk tarihte null. Taksit vadesi TAKVİM tarihidir.
String? _dayKeyOf(String? iso) {
  final s = (iso ?? '');
  if (s.length < 10) return null;
  final k = s.substring(0, 10);
  return RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(k) ? k : null;
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

    // EN YAKIN VADE — aynı güne düşen borçlar TOPLANIR (web ile aynı kural).
    //
    // Eskiden yalnız "daha erken" olan kazanıyordu: aynı gün vadeli 500 ve 700 ₺'lik iki
    // satışta ikincisi hiç sayılmıyor, o gün ödenmesi gereken 1.200 ₺ ekranda 500 (ya da
    // API sırasına göre 700) görünüyordu.
    final nd = valueOf(a, const ['nextDueDate'], fallback: '');
    if (nd.isNotEmpty) {
      if (g.nextDueDate == null || nd.compareTo(g.nextDueDate!) < 0) {
        g.nextDueDate = nd;
        g.nextDueAmount = numberOf(a, const ['nextDueAmount']);
      } else if (nd == g.nextDueDate) {
        g.nextDueAmount += numberOf(a, const ['nextDueAmount']);
      }
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

/// Bir müşterinin TARİH TARİH taksit takvimi (web `buildDueDateSchedule` paritesi).
///
/// Satır = vade GÜNÜ, ay değil. Aynı güne düşen taksitler toplanır; hangi satıştan geldiği
/// `sources`ta durur. `accountId` verilirse takvim YALNIZ o satışa daralır ("Tümü" = null).
///
/// `todayIso` dışarıdan verilir: "bugün" hesabı YEREL güne göre yapılmalı (UTC gününe geçmek
/// gün sınırında satırın rengini kaydırır).
///
/// DEVİR (carry) YOKTUR: aylık ızgaradaki devir "Kalan" sütununda gösteriliyordu, o sütun
/// kaldırıldı. Ayrıca devir HESAP bazlıdır (bir satışın gecikmesi başkasının taksitine binmez),
/// bu görünüm ise birden çok satışı birleştirebiliyor.
List<DueDateRow> buildDueDateSchedule(
  CustomerAccountGroup group,
  String todayIso, [
  String? accountId,
]) {
  final today = todayIso.length >= 10 ? todayIso.substring(0, 10) : todayIso;
  final scope = (accountId == null || accountId.isEmpty)
      ? group.accounts
      : group.accounts.where((a) => '${a['id'] ?? ''}' == accountId).toList();

  // [due, paid, remaining, anyOverdue(0/1), count]
  final byDay = <String, List<double>>{};
  final sources = <String, Map<String, DueDateSource>>{};

  for (final a in scope) {
    final label = saleDisplayName(a);
    final aid = '${a['id'] ?? ''}';
    // TARİH GEÇİRİLİR: parser gecikmeyi kendi hesaplar; geçirilmezse takvim, verilen
    // todayIso ile değil GERÇEK bugünle boyanır (web'de bu bayrak sunucudan gelir).
    for (final i in parseInstallments(a, todayIso).where((i) => !i.cancelled)) {
      final key = _dayKeyOf(i.dueDate);
      if (key == null) continue;
      final cur = byDay[key] ??= [0, 0, 0, 0, 0];
      cur[0] += i.amount;
      cur[1] += i.paidAmount;
      cur[2] += i.remaining > 0 ? i.remaining : 0;
      if (i.overdue && i.remaining > 0.005) cur[3] = 1;
      cur[4] += 1;
      final bucket = sources[key] ??= <String, DueDateSource>{};
      final src = bucket[aid] ??= DueDateSource(accountId: aid, label: label, amount: 0);
      src.amount += i.amount;
    }
  }

  final keys = byDay.keys.toList()..sort();
  return keys.map((date) {
    final v = byDay[date]!;
    // "GECİKTİ" SÖZÜ TEK KAYNAKTAN — ama geçmiş vade görünür kalır (BEŞİNCİ DURUM: `grace`).
    //
    // Eskiden ham `date < today` ile kırmızı "Gecikti" yazılıyordu; kurumun resmi gecikme kuralı
    // ise toleranslıdır (`account_installments.graceDeadline`). Sonuç: cari kartı "gecikme yok"
    // derken bu tablo aynı borç için "Gecikti" yazıyordu. Artık iki soru ayrı:
    //   `overdue` → yalnız kanonik bayrak ("Gecikti", kırmızı, özet toplamına girer)
    //   `grace`   → vadesi geçti ama tolerans sürüyor ("Vadesi geçti", amber)
    // SIRA: `grace`, `partial`ın üstünde — kısmi ödenmiş geçmiş gün "Kısmi" yazsaydı geçmişte
    // kaldığı bilgisi kaybolurdu. (Web `accountGrouping.ts` ile birebir aynı kural.)
    final String status;
    if (v[2] <= 0.005) {
      status = 'paid';
    } else if (v[3] == 1) {
      status = 'overdue';
    } else if (date.compareTo(today) < 0) {
      status = 'grace';
    } else if (v[1] > 0.005) {
      status = 'partial';
    } else {
      status = 'upcoming';
    }
    final list = (sources[date]?.values.toList() ?? <DueDateSource>[])
      ..sort((p, q) => q.amount.compareTo(p.amount));
    return DueDateRow(
      date: date,
      due: v[0],
      paid: v[1],
      remaining: v[2],
      installmentCount: v[4].toInt(),
      sources: list,
      status: status,
    );
  }).toList();
}

// ---------------------------------------------------------------------------
// "TÜMÜ" — MÜŞTERİNİN BÜTÜN SATIŞLARINA TEK SEFERDE TAHSİLAT
// (web `lib/accountGrouping.ts` içindeki aynı adlı fonksiyonların paritesi)
// ---------------------------------------------------------------------------

/// Tümü modunda birleşik vade kuyruğundaki tek sıra.
class GlobalDueRow {
  GlobalDueRow({
    required this.accountId,
    required this.accountLabel,
    required this.installmentNo,
    required this.dueDate,
    required this.remaining,
    required this.isOverdue,
  });

  final String accountId;

  /// Satış adı — birleşik kuyrukta hangi satıştan geldiği yazılmalı.
  final String accountLabel;

  /// Taksit sırası; peşin satışın kalanı için null (sentetik satır).
  final int? installmentNo;
  final String dueDate;
  final double remaining;
  final bool isOverdue;
}

/// Tümü modunun özeti — sayfadaki rakamlar buradan okunur.
class AllAccountsSummary {
  AllAccountsSummary({
    required this.remaining,
    required this.dueNow,
    required this.overdue,
    required this.openCount,
    required this.queue,
  });

  final double remaining;
  final double dueNow;
  final double overdue;
  final int openCount;
  final List<GlobalDueRow> queue;
}

double _accountRemaining(Map<String, dynamic> a) {
  final v = numberOf(a, const ['remainingAmount', 'remaining']);
  return v > 0 ? v : 0;
}

String _saleLabelOf(Map<String, dynamic> a) =>
    valueOf(a, const ['servicePackageName', 'name'], fallback: 'Satış');

/// Tüm satışların vadelerini TEK KUYRUKTA, global vade sırasıyla birleştirir.
///
/// Peşin satışın (taksit satırı olmayan) kalan borcu da kuyruğa girer: parası satış anında
/// istenmiştir, yani vadesi satış günüdür. Kuyruğa alınmasaydı Tümü ile ödenen para peşin
/// satışın borcunu hiç kapatmazdı.
///
/// Kuyruk hesap başına remainingAmount ile SINIRLANIR — taksit kalanları toplamı kredi
/// bakiyesi yüzünden daha büyük olabilir ve sunucu fazlasını borç saymaz.
List<GlobalDueRow> buildGlobalDueQueue(
    List<Map<String, dynamic>> accounts, String todayIso) {
  final today = todayIso.length >= 10 ? todayIso.substring(0, 10) : todayIso;
  final rows = <GlobalDueRow>[];

  for (final a in accounts) {
    var budget = _accountRemaining(a);
    if (budget <= 0.005) continue;
    final label = _saleLabelOf(a);
    final insts = parseInstallments(a, todayIso)
        .where((i) => !i.cancelled && i.remaining > 0.005)
        .toList()
      ..sort((x, y) {
        final c = x.dueDate.compareTo(y.dueDate);
        return c != 0 ? c : x.no.compareTo(y.no);
      });

    for (final i in insts) {
      if (budget <= 0.005) break;
      final take = budget < i.remaining ? budget : i.remaining;
      budget -= take;
      rows.add(GlobalDueRow(
        accountId: '${a['id']}',
        accountLabel: label,
        installmentNo: i.no,
        dueDate: i.dueDate,
        remaining: take,
        // GECİKME TEK KAYNAKTAN: `i.overdue` aylık toleransı zaten uygular; ham tarih
        // karşılaştırması eklemek toleransı deler (web `accountGrouping.ts` ile aynı kural).
        isOverdue: i.overdue,
      ));
    }

    // Taksitle karşılanmayan kalan (peşin satış ya da plan dışı bakiye) — vadesi satış günü.
    if (budget > 0.005) {
      final soldRaw = valueOf(a, const ['soldAtUtc', 'createdAtUtc'], fallback: '');
      final soldDay = soldRaw.length >= 10 ? soldRaw.substring(0, 10) : soldRaw;
      rows.add(GlobalDueRow(
        accountId: '${a['id']}',
        accountLabel: label,
        installmentNo: null,
        dueDate: soldDay,
        remaining: budget,
        isOverdue: soldDay.isEmpty || soldDay.compareTo(today) < 0,
      ));
    }
  }

  // GLOBAL VADE SIRASI: en eski borç önce kapanır. Tarihsiz satır (bozuk veri) en başa alınır.
  //
  // EŞİT VADEDE SIRA DETERMİNİSTİK OLMALI (web ile aynı kural): yalnız tarihe göre sıralamak,
  // aynı gün vadeli iki satışta hangisinin önce kapanacağını API'nin döndürme sırasına
  // bırakıyordu. Hesap kimliği + taksit numarası bağı kesin ve kararlı çözer.
  rows.sort((x, y) {
    final c = (x.dueDate.isEmpty ? '0000-00-00' : x.dueDate)
        .compareTo(y.dueDate.isEmpty ? '0000-00-00' : y.dueDate);
    if (c != 0) return c;
    final a = x.accountId.compareTo(y.accountId);
    if (a != 0) return a;
    return (x.installmentNo ?? 0).compareTo(y.installmentNo ?? 0);
  });
  return rows;
}

/// Tümü modunun özet rakamları.
AllAccountsSummary summarizeAllAccounts(
    List<Map<String, dynamic>> accounts, String todayIso) {
  final open = accounts.where((a) => _accountRemaining(a) > 0.005).toList();
  final queue = buildGlobalDueQueue(accounts, todayIso);
  var dueNow = 0.0;
  for (final a in open) {
    final plan = parseInstallments(a, todayIso).where((i) => !i.cancelled).toList();
    // TARİH GEÇİRİLİR: geçirilmezse dueThisMonth bugüne bakar ve özet, verilen todayIso ile
    // tutmaz (testte 2.500 yerine 5.000 çıkmıştı — sessiz bir web/mobil sapması).
    dueNow += plan.isNotEmpty ? dueThisMonth(plan, todayIso) : _accountRemaining(a);
  }
  return AllAccountsSummary(
    remaining: open.fold<double>(0, (s, a) => s + _accountRemaining(a)),
    dueNow: dueNow,
    overdue:
        queue.where((r) => r.isOverdue).fold<double>(0, (s, r) => s + r.remaining),
    openCount: open.length,
    queue: queue,
  );
}

/// Dağıtım sonucu — satış başına yazılacak tahsilat tutarı.
class AccountAllocation {
  AccountAllocation({
    required this.accountId,
    required this.accountLabel,
    required this.amount,
  });

  final String accountId;
  final String accountLabel;
  double amount;
}

double _round2(double v) => (v * 100).round() / 100;

/// Bir tutarı BİRDEN ÇOK satışa, GLOBAL VADE SIRASIYLA dağıtır.
///
/// Sunucu tahsilatı tek bir hesaba yazar; müşteri düzeyinde "hepsine öde" ucu yok. Bu yüzden
/// bölüştürme İSTEMCİDE yapılır ve her satış için AYRI tahsilat çağrısı gider.
///
/// Kuruş artığı son satıra eklenir: dağıtılan toplam girilen tutara birebir eşit kalmalı.
List<AccountAllocation> allocateAcrossAccounts(
    List<Map<String, dynamic>> accounts, double amount, String todayIso) {
  var pool = _round2(amount);
  if (pool <= 0.005) return const [];

  final byAccount = <String, AccountAllocation>{};
  for (final row in buildGlobalDueQueue(accounts, todayIso)) {
    if (pool <= 0.005) break;
    final take = pool < row.remaining ? pool : row.remaining;
    if (take <= 0.005) continue;
    pool -= take;
    final cur = byAccount[row.accountId];
    if (cur != null) {
      cur.amount += take;
    } else {
      byAccount[row.accountId] = AccountAllocation(
          accountId: row.accountId, accountLabel: row.accountLabel, amount: take);
    }
  }

  final out = byAccount.values.toList();
  for (final r in out) {
    r.amount = _round2(r.amount);
  }
  if (out.isEmpty) return out;

  // FAZLA ÖDEME yutulmaz: borçtan büyük tutar artan son satışa yazılır (sunucuda kredi olur).
  final distributed = out.fold<double>(0, (s, r) => s + r.amount);
  final drift = _round2(_round2(amount) - distributed);
  if (drift.abs() > 0.001) out.last.amount = _round2(out.last.amount + drift);

  return out.where((r) => r.amount > 0.005).toList();
}

/// Sunucuya gidecek TEK tahsilat çağrısı (satış x yöntem).
class CollectionCall {
  CollectionCall({
    required this.accountId,
    required this.accountLabel,
    required this.method,
    required this.amount,
  });

  final String accountId;
  final String accountLabel;
  final String method;
  double amount;
}

class _MethodPool {
  _MethodPool(this.method, this.left);
  final String method;
  double left;
}

/// Satış dağıtımı ile ödeme yöntemi kırılımını ÇAKIŞTIRIR.
///
/// Yöntemleri tek tek dağıtmak borcu ÇİFT SAYAR: 1.500 borçlu A ve 2.000 borçlu B varken
/// "2.000 nakit + 1.000 kart" girildiğinde her yöntem kuyruğun başından dağıtılsaydı A'ya hem
/// nakitten 1.500 hem karttan 1.000 yazılırdı. Doğrusu: önce TOPLAM satışlara dağıtılır,
/// sonra yöntem havuzları bu paylara sırayla doldurulur.
List<CollectionCall> planCollectionCalls(
  List<AccountAllocation> allocations,
  List<MethodAmount> methodRows,
) {
  final pools = methodRows
      .map((r) => _MethodPool(r.method, _round2(r.amount)))
      .where((r) => r.left > 0.005)
      .toList();
  final calls = <CollectionCall>[];

  for (final alloc in allocations) {
    var need = _round2(alloc.amount);
    for (final pool in pools) {
      if (need <= 0.005) break;
      if (pool.left <= 0.005) continue;
      final take = _round2(need < pool.left ? need : pool.left);
      pool.left = _round2(pool.left - take);
      need = _round2(need - take);
      // Aynı satış + aynı yöntem tek çağrıda toplanır.
      final existing = calls
          .where((c) => c.accountId == alloc.accountId && c.method == pool.method)
          .toList();
      if (existing.isNotEmpty) {
        existing.first.amount = _round2(existing.first.amount + take);
      } else {
        calls.add(CollectionCall(
            accountId: alloc.accountId,
            accountLabel: alloc.accountLabel,
            method: pool.method,
            amount: take));
      }
    }
  }

  return calls.where((c) => c.amount > 0.005).toList();
}

/// Tahsilat sayfasındaki tek ödeme satırı (tutar + yöntem).
class MethodAmount {
  const MethodAmount(this.method, this.amount);
  final String method;
  final double amount;
}
