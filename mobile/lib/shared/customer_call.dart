import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../core/network/api_client.dart';

/// Müşteriyi cihazın telefon uygulamasıyla arar.
///
/// Personel numarayı ekranda maskeli görür; arama için ham numara
/// `/customers/{id}/dial` ucundan alınır (her erişim backend'de audit
/// log'a düşer) ve doğrudan `tel:` intent'ine verilir — numara ekranda
/// hiçbir yerde gösterilmez.
Future<void> callCustomer(
  BuildContext context,
  ApiClient api,
  Object? customerId,
) async {
  final id = '${customerId ?? ''}';
  final messenger = ScaffoldMessenger.of(context);
  if (id.isEmpty || id == 'null') {
    messenger.showSnackBar(
      const SnackBar(content: Text('Müşteri bilgisi bulunamadı.')),
    );
    return;
  }
  try {
    final data = await api.get('/api/admin/customers/$id/dial');
    final phone = data is Map ? '${data['phone'] ?? ''}' : '';
    if (phone.isEmpty) {
      messenger.showSnackBar(
        const SnackBar(content: Text('Müşterinin kayıtlı telefonu yok.')),
      );
      return;
    }
    final ok = await launchUrl(Uri(scheme: 'tel', path: phone));
    if (!ok) {
      messenger.showSnackBar(
        const SnackBar(content: Text('Bu cihazda arama başlatılamadı.')),
      );
    }
  } catch (_) {
    messenger.showSnackBar(
      const SnackBar(content: Text('Arama başlatılamadı, tekrar deneyin.')),
    );
  }
}
