import 'package:beautyasist_mobile/features/accounting/account_grouping.dart';
import 'package:flutter_test/flutter_test.dart';

/// "TÜMÜ" — bir tutarın müşterinin BÜTÜN satışlarına dağıtılması.
///
/// Aynı iş kuralı web'de de yazılı (`lib/accountGrouping.ts` + testleri). İki dilde duran
/// para mantığının sapması sessizdir; buradaki testler web'dekilerin birebir eşidir.
void main() {
  Map<String, dynamic> inst({
    required String id,
    required int no,
    required String due,
    required double amount,
    double paid = 0,
    String status = 'pending',
  }) =>
      <String, dynamic>{
        'id': id,
        'no': no,
        'dueDate': due,
        'amount': amount,
        'paidAmount': paid,
        'status': status,
      };

  Map<String, dynamic> account({
    required String id,
    required double remaining,
    String label = 'Satış',
    String soldAt = '2026-01-01T00:00:00Z',
    List<Map<String, dynamic>> installments = const [],
  }) =>
      <String, dynamic>{
        'id': id,
        'customerId': 'c1',
        'servicePackageName': label,
        'name': label,
        'remainingAmount': remaining,
        'soldAtUtc': soldAt,
        'installments': installments,
      };

  List<Map<String, dynamic>> twoSales() => [
        account(id: 'a1', label: 'Lazer Paketi', remaining: 3000, installments: [
          inst(id: 'a1-1', no: 1, due: '2026-01-10', amount: 1500),
          inst(id: 'a1-2', no: 2, due: '2026-03-10', amount: 1500),
        ]),
        account(id: 'a2', label: 'Cilt Bakımı', remaining: 2000, installments: [
          inst(id: 'a2-1', no: 1, due: '2026-02-10', amount: 1000),
          inst(id: 'a2-2', no: 2, due: '2026-04-10', amount: 1000),
        ]),
      ];

  group('allocateAcrossAccounts (Tümü)', () {
    test('GLOBAL vade sırası: en eski borç hangi satışta olursa olsun önce kapanır', () {
      final queue = buildGlobalDueQueue(twoSales(), '2026-05-15');
      expect(queue.map((r) => '${r.accountId}:${r.dueDate}').toList(), [
        'a1:2026-01-10',
        'a2:2026-02-10',
        'a1:2026-03-10',
        'a2:2026-04-10',
      ]);
    });

    test('2.500 ödeme iki satışa bölünür: a1 1.500 + a2 1.000', () {
      final out = allocateAcrossAccounts(twoSales(), 2500, '2026-05-15');
      expect(out.length, 2);
      expect(out.firstWhere((r) => r.accountId == 'a1').amount, 1500);
      expect(out.firstWhere((r) => r.accountId == 'a2').amount, 1000);
    });

    test('dağıtılan toplam girilen tutara BİREBİR eşittir (kuruş kaybı yok)', () {
      final out = allocateAcrossAccounts(twoSales(), 3333.33, '2026-05-15');
      final sum = out.fold<double>(0, (s, r) => s + r.amount);
      expect((sum * 100).round() / 100, 3333.33);
    });

    test('borçtan büyük ödeme yutulmaz — artan son satışa (kredi) yazılır', () {
      final out = allocateAcrossAccounts(twoSales(), 6000, '2026-05-15');
      expect(out.fold<double>(0, (s, r) => s + r.amount), 6000);
    });

    test('PEŞİN satışın kalanı da kuyruğa girer (taksit satırı yok ama borç var)', () {
      final list = [
        account(id: 'p1', label: 'Ürün satışı', remaining: 800, soldAt: '2026-01-05T00:00:00Z'),
        account(id: 'p2', remaining: 1000, installments: [
          inst(id: 'p2-1', no: 1, due: '2026-03-10', amount: 1000),
        ]),
      ];
      final out = allocateAcrossAccounts(list, 800, '2026-05-15');
      expect(out.length, 1);
      expect(out.first.accountId, 'p1');
      expect(out.first.amount, 800);
    });

    test('kapanmış satışa para yazılmaz', () {
      final list = [
        account(id: 'k1', remaining: 0),
        account(id: 'k2', remaining: 500, installments: [
          inst(id: 'k2-1', no: 1, due: '2026-03-10', amount: 500),
        ]),
      ];
      final out = allocateAcrossAccounts(list, 500, '2026-05-15');
      expect(out.map((r) => r.accountId).toList(), ['k2']);
    });

    test('dağıtım hesabın kalan borcunu AŞMAZ (kredi bakiyeli satış)', () {
      final list = [
        account(id: 'x1', remaining: 400, installments: [
          inst(id: 'x1-1', no: 1, due: '2026-01-10', amount: 500),
          inst(id: 'x1-2', no: 2, due: '2026-02-10', amount: 500),
        ]),
        account(id: 'x2', remaining: 900, installments: [
          inst(id: 'x2-1', no: 1, due: '2026-03-10', amount: 900),
        ]),
      ];
      final out = allocateAcrossAccounts(list, 1300, '2026-05-15');
      expect(out.firstWhere((r) => r.accountId == 'x1').amount, 400);
      expect(out.firstWhere((r) => r.accountId == 'x2').amount, 900);
    });

    test('özet: kalan / bu ay ödenmesi gereken / gecikmiş ayrı ayrı toplanır', () {
      // 5 Şubat: 10 Şub taksiti BU AY ödenecek ama henüz GECİKMEDİ — iki kavram ayrıdır.
      final s = summarizeAllAccounts(twoSales(), '2026-02-05');
      expect(s.remaining, 5000);
      expect(s.openCount, 2);
      expect(s.dueNow, 2500);
      expect(s.overdue, 1500);
    });

    test('tutar 0 ise hiç çağrı üretilmez', () {
      expect(allocateAcrossAccounts(twoSales(), 0, '2026-05-15'), isEmpty);
    });
  });

  group('planCollectionCalls', () {
    test('ÇİFT SAYIM YOK: iki yöntem iki satışa doğru bölünür', () {
      final calls = planCollectionCalls(
        [
          AccountAllocation(accountId: 'a', accountLabel: 'A', amount: 1500),
          AccountAllocation(accountId: 'b', accountLabel: 'B', amount: 1500),
        ],
        const [MethodAmount('cash', 2000), MethodAmount('card', 1000)],
      );
      expect(calls.length, 3);
      expect(calls[0].accountId, 'a');
      expect(calls[0].method, 'cash');
      expect(calls[0].amount, 1500);
      expect(calls[1].accountId, 'b');
      expect(calls[1].method, 'cash');
      expect(calls[1].amount, 500);
      expect(calls[2].accountId, 'b');
      expect(calls[2].method, 'card');
      expect(calls[2].amount, 1000);
    });

    test('satış payları ve yöntem toplamları AYNI ANDA korunur', () {
      final calls = planCollectionCalls(
        [
          AccountAllocation(accountId: 'a', accountLabel: 'A', amount: 1200),
          AccountAllocation(accountId: 'b', accountLabel: 'B', amount: 800),
        ],
        const [MethodAmount('cash', 1500), MethodAmount('transfer', 500)],
      );
      double perAccount(String id) => calls
          .where((c) => c.accountId == id)
          .fold<double>(0, (s, c) => s + c.amount);
      double perMethod(String m) =>
          calls.where((c) => c.method == m).fold<double>(0, (s, c) => s + c.amount);
      expect(perAccount('a'), 1200);
      expect(perAccount('b'), 800);
      expect(perMethod('cash'), 1500);
      expect(perMethod('transfer'), 500);
    });

    test('tek satış + tek yöntem: çıktı girdinin aynısıdır (klasik tahsilat)', () {
      final calls = planCollectionCalls(
        [AccountAllocation(accountId: 'a', accountLabel: 'A', amount: 750)],
        const [MethodAmount('cash', 750)],
      );
      expect(calls.length, 1);
      expect(calls.first.amount, 750);
    });
  });
}
