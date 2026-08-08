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
    'servicePackageName': '',
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

  group('buildMonthlySchedule', () {
    test('aynı ayda birden çok satışın taksitini TEK hücrede toplar', () {
      final g = groupAccountsByCustomer([
        acc(id: 'a1', customerId: 'c1', installments: [inst(dueDate: '2026-08-10', amount: 400)]),
        acc(id: 'a2', customerId: 'c1', installments: [inst(dueDate: '2026-08-25', amount: 600)]),
      ]);
      final cells = buildMonthlySchedule(g.first, '2026-08-15');
      expect(cells.length, 1);
      expect(cells.first.key, '2026-08');
      expect(cells.first.due, 1000);
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
      final byKey = {for (final c in buildMonthlySchedule(g.first, '2026-08-15')) c.key: c};
      expect(byKey['2026-06']!.status, 'paid');
      // Gecikme, kısmi ödemeye BASKIN: para hâlâ alınmadı ve vadesi geçti.
      expect(byKey['2026-07']!.status, 'overdue');
      expect(byKey['2026-09']!.status, 'partial');
      expect(byKey['2026-10']!.status, 'upcoming');
    });

    test('takvim SÜREKLİ: taksitsiz aylar boş sütun olarak durur', () {
      final g = groupAccountsByCustomer([
        acc(id: 'a1', customerId: 'c1', installments: [
          inst(dueDate: '2026-11-10', amount: 500),
          inst(dueDate: '2027-02-10', amount: 500),
        ]),
      ]);
      final cells = buildMonthlySchedule(g.first, '2026-08-15');
      expect(cells.map((c) => c.key).toList(), ['2026-11', '2026-12', '2027-01', '2027-02']);
      expect(cells[1].status, 'none');
      expect(cells[3].year, 2027);
    });

    test('taksiti olmayan müşteride takvim boştur (peşin satış)', () {
      final g = groupAccountsByCustomer([acc(id: 'a1', customerId: 'c1')]);
      expect(buildMonthlySchedule(g.first, '2026-08-15'), isEmpty);
    });
  });
}
