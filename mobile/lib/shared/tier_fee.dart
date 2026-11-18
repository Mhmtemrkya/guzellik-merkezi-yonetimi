import '../core/network/api_client.dart';
import '../core/platform/store_policy.dart';
import '../features/appointments/calendar_theme.dart';
import 'json_helpers.dart';

/// KADEME ÜCRET UYARISI — web `lib/tierFee.ts` paritesi (kullanıcı isteği 18 Kas 2026: "10 bin onam formu gibi ek
/// ücret gereken yerlerde 'ücretinize bu kadar yansıyacak' uyarısı"). Tutarları SUNUCU hesaplar (`allowance.impact`).
///
/// [dimension]: `customers` | `consents`. Sınır doluysa ([reached] ya da `allowed: false`) "kapasiteniz doldu",
/// sınıra yakınsa (kalan ≤ max(10, kapasitenin %5'i)) "yaklaşıyorsunuz" metni; uzaksa / sınırsızsa null.
String? tierFeeText(Map<String, dynamic>? allowance, String dimension, {bool reached = false}) {
  if (allowance == null || allowance['capacity'] == null) return null;
  final capacity = numberOf(allowance, const ['capacity']).toInt();
  final count = numberOf(allowance, const ['count']).toInt();
  final remaining = capacity - count < 0 ? 0 : capacity - count;
  final full = reached || allowance['allowed'] == false || remaining == 0;
  if (!full && remaining > nearThreshold(capacity)) return null;

  final customers = dimension == 'customers';
  final unit = customers ? 'kayıtlı müşteri' : 'imzalı onam formu';
  final unitTitle = customers ? 'Kayıtlı müşteri' : 'İmzalı onam formu';
  final lines = <String>[
    full
        ? 'Ödenmiş $unit kapasiteniz doldu (${groupThousands(count)} / ${groupThousands(capacity)}).'
        : '$unitTitle sınırınıza yaklaşıyorsunuz: ${groupThousands(count)} / ${groupThousands(capacity)} (${groupThousands(remaining)} kaldı).',
  ];

  final impact = allowance['impact'] is Map ? (allowance['impact'] as Map).cast<String, dynamic>() : null;
  final trial = impact?['trial'] == true;
  if (impact != null) {
    final increase = numberOf(impact, const ['increase']);
    final above = groupThousands(numberOf(impact, const ['above']).toInt());
    final period = '${impact['period'] ?? ''}' == 'yearly' ? 'yıllık' : 'aylık';
    if (increase > 0) {
      lines.add(trial
          ? 'Paket satın aldığınızda $above $unit üzeri kademe $period ücretinize +${CalendarText.tl(increase)} (KDV dahil) yansır.'
          : '$above $unit sınırı aşıldığında $period ücretinize +${CalendarText.tl(increase)} (KDV dahil) yansıyacak: '
              '${CalendarText.tl(numberOf(impact, const ['currentTotal']))} → ${CalendarText.tl(numberOf(impact, const ['nextTotal']))}.');
    }
  }

  final invoice = '${allowance['openInvoiceNumber'] ?? ''}'.trim();
  final quote = allowance['quote'] is Map ? (allowance['quote'] as Map).cast<String, dynamic>() : const <String, dynamic>{};
  final total = numberOf(quote, const ['total']);
  if (invoice.isNotEmpty) {
    lines.add('$invoice numaralı fatura ödeme bekliyor; ödeme alındığında kademe açılır.');
  } else if (!trial && total > 0) {
    lines.add('Kademeyi şimdi açarsanız bugün ${CalendarText.tl(total)} (KDV dahil, dönem sonuna kadar orantılı) '
        '${allowance['chargeMethod'] == 'Card' ? 'kayıtlı kartınızdan çekilir' : 'faturalanır'}.');
  }
  return lines.join('\n');
}

int nearThreshold(int capacity) {
  final five = (capacity * 0.05).ceil();
  return five > 10 ? five : 10;
}

/// 10000 → "10.000".
String groupThousands(int value) {
  final digits = value.abs().toString();
  final buffer = StringBuffer(value < 0 ? '-' : '');
  for (var i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) buffer.write('.');
    buffer.write(digits[i]);
  }
  return buffer.toString();
}

/// Kademenin ücrete etkisini sunucudan okur. iOS'ta (App Store 3.1.1: fiyat / satın alma yüzeyi yok) ve faturalama
/// yetkisi olmayan kullanıcıda (uç 403 döner) null — çağıran nötr metne düşer.
Future<String?> loadTierFeeText(ApiClient api, String dimension, {bool reached = false}) async {
  if (StorePolicy.hidesPurchaseFlows) return null;
  try {
    final data = await api.get(dimension == 'customers'
        ? '/api/admin/billing/customer-allowance'
        : '/api/admin/billing/consent-allowance');
    return data is Map ? tierFeeText(data.cast<String, dynamic>(), dimension, reached: reached) : null;
  } catch (_) {
    return null;
  }
}
