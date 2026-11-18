import 'package:beautyasist_mobile/features/branches/branch_fee.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, dynamic> _impact({bool trial = false, String? period}) => {
      'planName': 'BeautyAsist',
      'trial': trial,
      'branches': 1,
      'unitMonthly': 1000,
      'unitYearly': 10000,
      'vatRate': 0.2,
      'currentMonthly': {'total': 1200},
      'nextMonthly': {'total': 2400},
      'nextYearly': {'total': 24000},
      'period': period,
    };

void main() {
  group('BranchFeeView.from', () {
    test('trial shows the fee impact without any charge', () {
      final v = BranchFeeView.from({
        'chargeRequired': false,
        'canPurchase': true,
        'reason': 'Deneme süresinde şube eklemek ücretsizdir.',
        'chargeMethod': 'None',
        'impact': _impact(trial: true),
      });
      expect(v.chargeRequired, isFalse);
      expect(v.chargeTotal, isNull);
      expect(v.trial, isTrue);
      expect(v.worthShowing, isTrue);
      expect(v.branches, 1);
      expect((v.unitMonthly, v.unitYearly), (1000.0, 10000.0));
      expect((v.currentMonthly, v.nextMonthly, v.nextYearly), (1200.0, 2400.0, 24000.0));
      expect(v.nextPeriodTotal, 2400.0);
    });

    test('paid yearly period by invoice that can be paid on the web', () {
      final v = BranchFeeView.from({
        'chargeRequired': true,
        'canPurchase': true,
        'quote': {'total': 580.64},
        'chargeMethod': 'Invoice',
        'invoicePayOnline': true,
        'cardMasked': '',
        'impact': _impact(period: 'yearly'),
      });
      expect(v.chargeTotal, 580.64);
      expect((v.byInvoice, v.payOnline, v.yearly), (true, true, true));
      expect(v.cardMasked, isNull);
      expect(v.nextPeriodTotal, 24000.0);
    });

    test('a package without per-branch pricing and no charge shows nothing', () {
      final v = BranchFeeView.from({'chargeRequired': false, 'canPurchase': true, 'chargeMethod': 'None', 'impact': null});
      expect(v.hasImpact, isFalse);
      expect(v.worthShowing, isFalse);
      expect(v.payOnline, isFalse);
    });
  });

  group('findBranchInvoice', () {
    // Benzer ad ("Kadıköy 2") listede ÖNCE: fatura sıraya değil ada göre seçilmeli.
    final invoices = <Map<String, dynamic>>[
      {'id': 'paid', 'number': 'BA-2026-000001', 'status': 'Paid', 'notes': 'BeautyAsist · Ek şube · Kadıköy (ödenince açılacak)'},
      {'id': 'kadikoy-2', 'number': 'BA-2026-000003', 'status': 'Overdue', 'notes': 'BeautyAsist · Ek şube · Kadıköy 2 (ödenince açılacak)'},
      {'id': 'kadikoy', 'number': 'BA-2026-000002', 'status': 'Sent', 'notes': 'BeautyAsist · Ek şube · Kadıköy (ödenince açılacak)'},
    ];

    test('uses the invoice number in the server message first', () {
      const message = 'Şube talebiniz alındı: 580,64 ₺ (KDV dahil) için BA-2026-000002 numaralı fatura kesildi.';
      expect(findBranchInvoice(invoices, message, 'Kadıköy 2')?['id'], 'kadikoy');
    });

    test('falls back to the exact branch name and only open invoices', () {
      expect(findBranchInvoice(invoices, 'Şube talebiniz alındı.', 'Kadıköy')?['id'], 'kadikoy');
      expect(findBranchInvoice(invoices, 'Şube talebiniz alındı.', ' Kadıköy 2 ')?['id'], 'kadikoy-2');
      expect(findBranchInvoice(invoices, 'Şube talebiniz alındı.', 'Kadı'), isNull);
      expect(findBranchInvoice(invoices, 'BA-2026-000001 numaralı fatura', 'Yok'), isNull);
      expect(findBranchInvoice(invoices, 'mesaj', '  '), isNull);
    });
  });

  test('listPrice drops kuruş only for whole liras', () {
    expect(listPrice(1000), '₺1.000');
    expect(listPrice(580.64), '₺580,64');
  });
}
