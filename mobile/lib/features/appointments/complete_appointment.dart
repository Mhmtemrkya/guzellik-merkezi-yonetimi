import 'package:flutter/material.dart';

import '../../core/network/api_client.dart';
import '../../shared/json_helpers.dart';

/// Randevu "Tamamlandı" akışı — her yüzeyde (detay sheet, onay kutusu) ortak.
///  1) "Ödeme alındı mı?" → alındı / alınmadı / vazgeç.
///  2) Alındı ise: tutar (varsayılan = açık adisyon kalanı / fiyat) + yöntem kutusu.
///  Randevu Tamamlandı yapılır; ödeme alındıysa tahsilat cariye (yöntem korunur) ya da
///  adisyon üzerinden ciroya işlenir. Tamamlandıysa true döner (çağıran yeniler/kapatır).
Future<bool> runCompleteAppointment(
    BuildContext context, ApiClient api, Map<String, dynamic> appt) async {
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
      await api.patch('/api/admin/appointments/$id/status',
          {'status': 'Completed', 'reason': null});
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

  final customerName = '${appt['customerName'] ?? ''}';
  try {
    await api.patch('/api/admin/appointments/$id/status',
        {'status': 'Completed', 'reason': null});
    await _collect(api, cid, customerName, payment['amount'] as double,
        payment['method'] as String);
    if (context.mounted) _snack(context, 'Randevu tamamlandı, tahsilat işlendi.');
    return true;
  } catch (e) {
    if (context.mounted) {
      _snack(context, 'Randevu tamamlandı fakat tahsilat işlenemedi: $e');
    }
    return true; // randevu tamamlandı; çağıran yine de yenilesin
  }
}

void _snack(BuildContext context, String msg) {
  if (!context.mounted) return;
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
}

Future<Map<String, dynamic>?> _askPayment(
    BuildContext context, double defaultAmount) {
  final amountCtrl = TextEditingController(
      text: defaultAmount > 0 ? defaultAmount.toStringAsFixed(0) : '');
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

/// Tahsilatı işle: önce cari hesap (yöntem korunur), yoksa adisyon üzerinden ciroya.
Future<void> _collect(ApiClient api, String customerId, String customerName,
    double amount, String method) async {
  final nowIso = DateTime.now().toUtc().toIso8601String();
  String? accountId;
  try {
    final open = await api.get('/api/admin/adisyonlar/open/$customerId');
    if (open is Map &&
        open['customerAccountId'] != null &&
        '${open['customerAccountId']}' != 'null') {
      accountId = '${open['customerAccountId']}';
    }
  } catch (_) {}
  if (accountId == null && customerId.isNotEmpty) {
    try {
      final res = await api.get('/api/admin/accounts/',
          query: {'search': customerName, 'page': 1, 'pageSize': 50});
      final items = apiItems(res);
      final match = items.firstWhere(
          (a) => '${a['customerId']}' == customerId,
          orElse: () => const {});
      if (match.isNotEmpty) accountId = '${match['id']}';
    } catch (_) {}
  }
  if (accountId != null && accountId.isNotEmpty && accountId != 'null') {
    await api.post('/api/admin/accounts/$accountId/payments', {
      'amount': amount,
      'method': method,
      'reference': 'Randevu tahsilatı',
      'occurredAtUtc': nowIso,
    });
    return;
  }
  if (customerId.isEmpty) return;
  String? adisyonId;
  try {
    final open = await api.get('/api/admin/adisyonlar/open/$customerId');
    if (open is Map && open['id'] != null) adisyonId = '${open['id']}';
  } catch (_) {}
  if (adisyonId == null || adisyonId.isEmpty || adisyonId == 'null') {
    final created = await api.post('/api/admin/adisyonlar/', {
      'customerId': customerId,
      'customerAccountId': null,
      'notes': 'Randevu tahsilatı',
    });
    adisyonId = created is Map ? '${created['id']}' : null;
  }
  if (adisyonId == null || adisyonId.isEmpty || adisyonId == 'null') return;
  await api.post('/api/admin/adisyonlar/$adisyonId/items', {
    'type': 'Payment',
    'refId': null,
    'description': 'Randevu tahsilatı',
    'quantity': 1,
    'unitPrice': amount,
    'staffMemberId': null,
    'coveredByPackage': false,
    'method': method,
  });
  await api.post('/api/admin/adisyonlar/$adisyonId/approve', {});
}
