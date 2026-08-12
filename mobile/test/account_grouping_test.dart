import 'package:beautyasist_mobile/features/accounting/account_grouping.dart';
import 'package:flutter_test/flutter_test.dart';

/// Ön Muhasebe listesi MÜŞTERİ bazında gruplanıyor (veri modeli değişmedi: her satış hâlâ kendi
/// cari kartını açar). Bu testler web `accountGrouping.test.ts` ile AYNI kuralları sabitler —
/// iki platform aynı rakamı göstermeli.
Map<String, dynamic> inst({
  required String dueDate,
  required double amount,
  double paidAmount = 0,
  bool overdue = false,
  String status = 'Planned',
}) =>
    {
      'id': 'i-$dueDate-$amount',
      'no': 1,
      'dueDate': dueDate,
      'amount': amount,
      'paidAmount': paidAmount,
      'status': status,
      'paidAtUtc': null,
    };

Map<String, dynamic> acc({
  required String id,
  required String customerId,
  String customerName = 'Ayşe Yılmaz',
  String servicePackageName = '',
  double? totalAmount,
  double? paidAmount,
  double? remainingAmount,
  List<Map<String, dynamic>> installments = const [],
  String? nextDueDate,
  double nextDueAmount = 0,
  String soldAtUtc = '2026-01-01T00:00:00Z',
}) {
  final total = totalAmount ?? installments.fold<double>(0, (s, i) => s + (i['amount'] as double));
  final paid = paidAmount ?? installments.fold<double>(0, (s, i) => s + (i['paidAmount'] as double));
  return {
    'id': id,
    'customerId': customerId,
    'customerName': customerName,
    'customerPhone': '0555 111 22 33',
    'name': 'Satış',
    'servicePackageName': servicePackageName,
    'totalAmount': total,
    'paidAmount': paid,
    'remainingAmount': remainingAmount ?? (total - paid < 0 ? 0.0 : total - paid),
    'installments': installments,
    'payments': const [],
    'nextDueDate': nextDueDate,
    'nextDueAmount': nextDueAmount,
    'soldAtUtc': soldAtUtc,
    'createdAtUtc': soldAtUtc,
    'sessionsTotal': 0,
    'sessionsRemaining': 0,
    'saleStatus': 'Active',
  };
}

void main() {
  group('groupAccountsByCustomer', () {
    test('aynı müşterinin üç satışını TEK satırda toplar', () {
      final g = groupAccountsByCustomer([
        acc(id: 'a1', customerId: 'c1', totalAmount: 3000, paidAmount: 1000, remainingAmount: 2000),
        acc(id: 'a2', customerId: 'c1', totalAmount: 1500, paidAmount: 1500, remainingAmount: 0),
        acc(id: 'a3', customerId: 'c1', totalAmount: 500, paidAmount: 0, remainingAmount: 500),
      ]);
      expect(g.length, 1);
      expect(g.first.saleCount, 3);
      expect(g.first.totalAmount, 5000);
      expect(g.first.paidAmount, 2500);
      expect(g.first.remainingAmount, 2500);
    });

    test('FAZLA ÖDEME başka satışın borcunu kapatmaz', () {
      // Ham toplama (Σtotal − Σpaid) 600 verirdi; doğrusu 800.
      final g = groupAccountsByCustomer([
        acc(id: 'a1', customerId: 'c1', totalAmount: 1000, paidAmount: 1200, remainingAmount: 0),
        acc(id: 'a2', customerId: 'c1', totalAmount: 800, paidAmount: 0, remainingAmount: 800),
      ]);
      expect(g.first.remainingAmount, 800);
    });

    test('İPTAL edilen taksit borç/gecikme doğurmaz', () {
      final g = groupAccountsByCustomer([
        acc(id: 'a1', customerId: 'c1', installments: [
          inst(dueDate: '2026-07-10', amount: 500, overdue: true, status: 'Cancelled'),
          inst(dueDate: '2026-08-10', amount: 500),
        ]),
      ]);
      expect(g.first.hasOverdue, isFalse);
      expect(g.first.overdueAmount, 0);
      // Tek AKTİF taksit kaldı → taksitli sayılmaz.
      expect(g.first.hasInstallmentPlan, isFalse);
    });

    test('en yakın vade tüm satışlar arasından seçilir', () {
      final g = groupAccountsByCustomer([
        acc(id: 'a1', customerId: 'c1', nextDueDate: '2026-09-10', nextDueAmount: 500),
        acc(id: 'a2', customerId: 'c1', nextDueDate: '2026-08-05', nextDueAmount: 300),
      ]);
      expect(g.first.nextDueDate, '2026-08-05');
      expect(g.first.nextDueAmount, 300);
    });
  });

  group('buildDueDateSchedule', () {
    test('AYNI GÜNE düşen taksitleri tek satırda TOPLAR, kaynağını dökümler', () {
      // Kullanıcı senaryosu: 12.08'de bir pakette 5.000, başka pakette 2.000 → o gün 7.000.
      final g = groupAccountsByCustomer([
        acc(id: 'a1', customerId: 'c1', servicePackageName: 'Cilt Bakımı',
            installments: [inst(dueDate: '2026-08-12', amount: 5000)]),
        acc(id: 'a2', customerId: 'c1', servicePackageName: 'Lazer',
            installments: [inst(dueDate: '2026-08-12', amount: 2000)]),
      ]);
      final rows = buildDueDateSchedule(g.first, '2026-08-01');
      expect(rows.length, 1);
      expect(rows.first.date, '2026-08-12');
      expect(rows.first.due, 7000);
      expect(rows.first.installmentCount, 2);
      // Payı büyük olan önce; hangi satıştan geldiği satır altında yazar.
      expect(rows.first.sources.map((s) => s.label).toList(), ['Cilt Bakımı', 'Lazer']);
      expect(rows.first.sources.first.amount, 5000);
    });

    test('farklı tarihler KRONOLOJİK araya girer (12 → 15 → 17)', () {
      // Üçüncü paket iki takvimin ORTASINA denk geliyor: 15'i araya girmeli.
      final g = groupAccountsByCustomer([
        acc(id: 'a1', customerId: 'c1', installments: [inst(dueDate: '2026-08-12', amount: 500)]),
        acc(id: 'a2', customerId: 'c1', installments: [inst(dueDate: '2026-08-17', amount: 700)]),
        acc(id: 'a3', customerId: 'c1', installments: [inst(dueDate: '2026-08-15', amount: 900)]),
      ]);
      expect(buildDueDateSchedule(g.first, '2026-08-01').map((r) => r.date).toList(),
          ['2026-08-12', '2026-08-15', '2026-08-17']);
    });

    test('satış seçilince takvim YALNIZ o satışa daralır', () {
      final g = groupAccountsByCustomer([
        acc(id: 'a1', customerId: 'c1', installments: [inst(dueDate: '2026-08-12', amount: 5000)]),
        acc(id: 'a2', customerId: 'c1', installments: [inst(dueDate: '2026-08-12', amount: 2000)]),
      ]);
      final only = buildDueDateSchedule(g.first, '2026-08-01', 'a2');
      expect(only.length, 1);
      expect(only.first.due, 2000);
      expect(only.first.sources.length, 1);
    });

    test('durum renkleri: ödendi / kısmi / gecikmiş / bekleyen', () {
      final g = groupAccountsByCustomer([
        acc(id: 'a1', customerId: 'c1', installments: [
          inst(dueDate: '2026-06-10', amount: 500, paidAmount: 500),
          inst(dueDate: '2026-07-10', amount: 500, paidAmount: 200, overdue: true),
          inst(dueDate: '2026-09-10', amount: 500, paidAmount: 100),
          inst(dueDate: '2026-10-10', amount: 500),
        ]),
      ]);
      final byDate = {for (final r in buildDueDateSchedule(g.first, '2026-08-15')) r.date: r};
      expect(byDate['2026-06-10']!.status, 'paid');
      // Gecikme, kısmi ödemeye BASKIN: para hâlâ alınmadı ve vadesi geçti.
      expect(byDate['2026-07-10']!.status, 'overdue');
      expect(byDate['2026-09-10']!.status, 'partial');
      expect(byDate['2026-10-10']!.status, 'upcoming');
    });

    test('vadesiz gün SATIR ÜRETMEZ (aylık ızgaradaki boş sütunlar kalktı)', () {
      final g = groupAccountsByCustomer([
        acc(id: 'a1', customerId: 'c1', installments: [
          inst(dueDate: '2026-11-10', amount: 500),
          inst(dueDate: '2027-02-10', amount: 500),
        ]),
      ]);
      expect(buildDueDateSchedule(g.first, '2026-08-15').map((r) => r.date).toList(),
          ['2026-11-10', '2027-02-10']);
    });

    test('vadesi geçmiş gün, taksit "overdue" işaretlenmemiş olsa da kırmızıdır', () {
      final g = groupAccountsByCustomer([
        acc(id: 'a1', customerId: 'c1', installments: [inst(dueDate: '2026-07-10', amount: 500)]),
      ]);
      expect(buildDueDateSchedule(g.first, '2026-08-15').first.status, 'overdue');
    });

    test('taksiti olmayan müşteride takvim boştur (peşin satış)', () {
      final g = groupAccountsByCustomer([acc(id: 'a1', customerId: 'c1')]);
      expect(buildDueDateSchedule(g.first, '2026-08-15'), isEmpty);
    });
  });
}
