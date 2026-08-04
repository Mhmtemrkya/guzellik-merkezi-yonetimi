import 'package:flutter/material.dart';

import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../consent/consent_center_sheet.dart';
import '../consent/consent_models.dart';

/// Randevu "Tamamlandı" akışı — her yüzeyde (detay sheet, onay kutusu) ortak.
///  1) "Ödeme alındı mı?" → alındı / alınmadı / vazgeç.
///  2) Alındı ise: tutar (varsayılan = açık adisyon kalanı / fiyat) + yöntem kutusu.
///  Randevu Tamamlandı yapılır; ödeme alındıysa tahsilat cariye (yöntem korunur) ya da
///  adisyon üzerinden ciroya işlenir. Tamamlandıysa true döner (çağıran yeniler/kapatır).
Future<bool> runCompleteAppointment(
    BuildContext context, ApiClient api, Map<String, dynamic> appt) async {
  // ONAM FORMU KAPISI: bu randevunun hizmetine bağlı formlar imzalı mı? Eksikse önce uyarı
  // çıkar; personel formları imzalatabilir ya da bilerek imzasız devam edebilir (kapı yumuşak).
  if (!await _consentGate(context, api, appt)) return false;
  if (!context.mounted) return false;

  final choice = await showDialog<String>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: const Text('Randevuyu tamamla'),
      content: const Text('Bu randevu için ödeme alındı mı?'),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Vazgeç')),
        TextButton(
            onPressed: () => Navigator.pop(ctx, 'unpaid'),
            child: const Text('Ödeme alınmadı')),
        FilledButton(
            onPressed: () => Navigator.pop(ctx, 'paid'),
            child: const Text('Ödeme alındı')),
      ],
    ),
  );
  if (choice == null) return false;

  final id = '${appt['id']}';
  final cid = '${appt['customerId'] ?? ''}'.trim();

  if (choice == 'unpaid') {
    try {
      await _completeAtomically(api, id, null, null);
      if (context.mounted) _snack(context, 'Randevu tamamlandı.');
      return true;
    } catch (e) {
      if (context.mounted) _snack(context, '$e');
      return false;
    }
  }

  // Ödeme alındı → varsayılan tutar (açık adisyon kalanı ya da randevu fiyatı).
  double defaultAmount = (appt['price'] as num?)?.toDouble() ?? 0;
  if (cid.isNotEmpty && cid.toLowerCase() != 'null') {
    try {
      final open = await api.get('/api/admin/adisyonlar/open/$cid');
      if (open is Map) {
        final charge = (open['chargeTotal'] as num?)?.toDouble() ?? 0;
        final paid = (open['paymentTotal'] as num?)?.toDouble() ?? 0;
        final remaining = charge - paid;
        if (remaining > 0) defaultAmount = remaining;
      }
    } catch (_) {}
  }
  if (!context.mounted) return false;
  final payment = await _askPayment(context, defaultAmount);
  if (payment == null) return false;

  // Cari hedefi biliniyorsa iletilir; bilinmiyorsa sunucu (borcu olan en eski cari →
  // yoksa adisyon defteri) kendisi çözer.
  String? accountId;
  if (cid.isNotEmpty && cid.toLowerCase() != 'null') {
    try {
      final open = await api.get('/api/admin/adisyonlar/open/$cid');
      if (open is Map &&
          open['customerAccountId'] != null &&
          '${open['customerAccountId']}' != 'null') {
        accountId = '${open['customerAccountId']}';
      }
    } catch (_) {}
  }
  try {
    await _completeAtomically(api, id, accountId, {
      'amount': payment['amount'] as double,
      'method': payment['method'] as String,
    });
    if (context.mounted) _snack(context, 'Randevu tamamlandı, tahsilat işlendi.');
    return true;
  } catch (e) {
    // TEK TRANSACTION: hata varsa randevu da tamamlanmamıştır (eskiden "tamamlandı ama
    // tahsilat işlenmedi" durumu kalıcı oluyordu ve true dönülüyordu).
    if (context.mounted) {
      _snack(context, 'Randevu tamamlanamadı; tahsilat da işlenmedi: $e');
    }
    return false;
  }
}

/// TAMAMLAMA + TAHSİLAT TEK İSTEK (sunucuda tek transaction).
///
/// Eskiden önce `/status`, sonra tahsilat çağrılıyordu; ikincisi ağda düşerse randevu
/// tamamlanmış (seans tüketilmiş) ama parası alınmamış hâlde kalıyordu. Idempotency anahtarı
/// tekrarı güvenli kılar, ATOMİKLİĞİ sağlamaz — sunucu artık ikisini birlikte uygular.
Future<void> _completeAtomically(ApiClient api, String appointmentId,
    String? accountId, Map<String, dynamic>? payment) async {
  // ANAHTAR PAYLOAD'IN TAMAMINI TEMSİL ETMELİ (web ile aynı kural): hedef cari anahtara
  // girmezse, yanlış cariyle 4xx alan istek düzeltilip tekrar gönderildiğinde sunucu aynı
  // anahtarı görüp ESKİ HATAYI replay edebiliyordu.
  final accountPart = (accountId == null || accountId.isEmpty)
      ? 'auto'
      : accountId.replaceAll('-', '').substring(0, 8);
  final base = payment == null
      ? 'apc${appointmentId.replaceAll('-', '')}'
      : 'apc${appointmentId.replaceAll('-', '')}'
          '-${((payment['amount'] as double) * 100).round()}-${payment['method']}-$accountPart';
  final idem = base.length > 52 ? base.substring(0, 52) : base;
  await api.post('/api/admin/appointments/$appointmentId/complete', {
    'reason': null,
    'payment': payment == null
        ? null
        : {
            'amount': payment['amount'],
            'method': payment['method'],
            'reference': 'Randevu tahsilatı',
            'accountId': accountId,
            'occurredAtUtc': DateTime.now().toUtc().toIso8601String(),
          },
  }, idem);
}

/// Eksik onam formu varsa uyarı gösterir. Devam edilecekse true döner.
Future<bool> _consentGate(
    BuildContext context, ApiClient api, Map<String, dynamic> appt) async {
  final id = '${appt['id'] ?? ''}'.trim();
  final customerId = '${appt['customerId'] ?? ''}'.trim();
  if (id.isEmpty) return true;

  ConsentStatus? status;
  try {
    final res = await api.get('/api/consent/appointments/$id/status');
    if (res is Map) status = ConsentStatus(res.cast<String, dynamic>());
  } catch (_) {
    return true; // onam özelliği yok / uç erişilemez → akışı durdurma
  }
  final missing = status?.missing ?? const <ConsentRequirement>[];
  if (missing.isEmpty || !context.mounted) return true;

  final action = await showDialog<String>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: const Text('Onam formu eksik'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '${missing.length} onam formu imzalanmadı. Formları görüntüleyip müşterinin '
            'tabletten imzalamasını sağlayabilirsiniz.',
            style: const TextStyle(fontSize: 13, height: 1.4),
          ),
          const SizedBox(height: 10),
          for (final m in missing)
            Padding(
              padding: const EdgeInsets.only(bottom: 3),
              child: Row(
                children: [
                  const Icon(Icons.circle, size: 6, color: AppColors.warning),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(m.title,
                        style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
                  ),
                ],
              ),
            ),
          const SizedBox(height: 8),
          const Text(
            'İmzasız tamamlanan işlem, müşteri kartında ve cari/adisyon ekranlarında uyarı olarak görünür.',
            style: TextStyle(fontSize: 11.5, color: AppColors.muted, height: 1.35),
          ),
        ],
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Vazgeç')),
        TextButton(
            onPressed: () => Navigator.pop(ctx, 'skip'),
            child: const Text('İmzasız devam et')),
        FilledButton(
            onPressed: () => Navigator.pop(ctx, 'open'),
            child: const Text('Formları aç')),
      ],
    ),
  );

  if (action == null) return false;
  if (action == 'skip') return true;
  if (!context.mounted || customerId.isEmpty) return false;

  await ConsentCenterSheet.open(
    context,
    api: api,
    customerId: customerId,
    customerName: '${appt['customerName'] ?? ''}'.trim().isEmpty ? null : '${appt['customerName']}',
    appointmentId: id,
  );
  // Merkez kapandıktan sonra kapıyı yeniden değerlendir (imzalandıysa doğrudan geçer).
  if (!context.mounted) return false;
  return _consentGate(context, api, appt);
}

void _snack(BuildContext context, String msg) {
  if (!context.mounted) return;
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
}

Future<Map<String, dynamic>?> _askPayment(
    BuildContext context, double defaultAmount) {
  // KURUŞ KORUNUR: toStringAsFixed(0) 999,50 ₺ kalanı 1.000 ₺ yapıp fazla tahsilat üretiyordu.
  // Tam sayıysa ondalık gösterilmez (1000 → "1000"), kuruşluysa korunur (999,5 → "999.50").
  final amountCtrl = TextEditingController(
      text: defaultAmount <= 0
          ? ''
          : (defaultAmount == defaultAmount.roundToDouble()
              ? defaultAmount.toStringAsFixed(0)
              : defaultAmount.toStringAsFixed(2)));
  String method = 'cash';
  return showDialog<Map<String, dynamic>>(
    context: context,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, setLocal) => AlertDialog(
        title: const Text('Tahsilat al'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: amountCtrl,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: 'Tutar (₺)'),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: method,
              decoration: const InputDecoration(labelText: 'Yöntem'),
              items: const [
                DropdownMenuItem(value: 'cash', child: Text('Nakit')),
                DropdownMenuItem(value: 'card', child: Text('Kart')),
                DropdownMenuItem(value: 'transfer', child: Text('Havale / EFT')),
              ],
              onChanged: (v) => setLocal(() => method = v ?? 'cash'),
            ),
          ],
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Vazgeç')),
          FilledButton(
            onPressed: () {
              final amt =
                  double.tryParse(amountCtrl.text.replaceAll(',', '.')) ?? 0;
              if (amt <= 0) return;
              Navigator.pop(ctx, {'amount': amt, 'method': method});
            },
            child: const Text('Tahsilatı al'),
          ),
        ],
      ),
    ),
  );
}


