import 'package:beautyasist_mobile/shared/tier_fee.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, dynamic> _allowance({
  int count = 9600,
  int? capacity = 10000,
  bool allowed = true,
  bool trial = false,
  String period = 'monthly',
  double? quoteTotal,
  String? invoice,
}) =>
    {
      'dimension': 'ConsentDocuments',
      'allowed': allowed,
      'count': count,
      'capacity': capacity,
      'chargeMethod': 'Invoice',
      'openInvoiceNumber': invoice,
      'quote': quoteTotal == null ? null : {'total': quoteTotal},
      'impact': {
        'trial': trial,
        'period': period,
        'above': 10000,
        'currentTotal': period == 'yearly' ? 12000 : 1200,
        'nextTotal': period == 'yearly' ? 15000 : 1500,
        'increase': period == 'yearly' ? 3000 : 300,
        'increaseNet': period == 'yearly' ? 2500 : 250,
      },
    };

void main() {
  test('silent far from the limit and on unlimited packages', () {
    expect(tierFeeText(_allowance(count: 9400), 'consents'), isNull);
    expect(tierFeeText(_allowance(capacity: null), 'consents'), isNull);
    expect(tierFeeText(null, 'consents'), isNull);
  });

  test('near the limit tells the fee impact (web parity)', () {
    expect(
      tierFeeText(_allowance(), 'consents'),
      'İmzalı onam formu sınırınıza yaklaşıyorsunuz: 9.600 / 10.000 (400 kaldı).\n'
      '10.000 imzalı onam formu sınırı aşıldığında aylık ücretinize +₺300,00 (KDV dahil) yansıyacak: ₺1.200,00 → ₺1.500,00.',
    );
  });

  test('reached: prorated charge today, open invoice, trial and yearly wording', () {
    final reached = tierFeeText(_allowance(count: 10000, allowed: false, quoteTotal: 150), 'consents')!;
    expect(reached, startsWith('Ödenmiş imzalı onam formu kapasiteniz doldu (10.000 / 10.000).'));
    expect(reached, endsWith('bugün ₺150,00 (KDV dahil, dönem sonuna kadar orantılı) faturalanır.'));

    final invoice = tierFeeText(_allowance(quoteTotal: 150, invoice: 'BA-2026-000009', period: 'yearly'), 'consents', reached: true)!;
    expect(invoice, contains('yıllık ücretinize +₺3.000,00'));
    expect(invoice, endsWith('BA-2026-000009 numaralı fatura ödeme bekliyor; ödeme alındığında kademe açılır.'));

    final trial = tierFeeText(_allowance(trial: true, quoteTotal: 150), 'customers', reached: true)!;
    expect(trial, contains('Paket satın aldığınızda 10.000 kayıtlı müşteri üzeri kademe aylık ücretinize +₺300,00 (KDV dahil) yansır.'));
    expect(trial, isNot(contains('bugün')));
  });

  test('helpers', () {
    expect(nearThreshold(2), 10);
    expect(nearThreshold(10000), 500);
    expect(groupThousands(1234567), '1.234.567');
    expect(groupThousands(999), '999');
  });
}
