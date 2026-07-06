List<Map<String, dynamic>> apiItems(dynamic payload) {
  if (payload is List) {
    return payload
        .whereType<Map>()
        .map((e) => e.cast<String, dynamic>())
        .toList();
  }
  if (payload is Map) {
    final raw = payload['items'];
    if (raw is List) {
      return raw
          .whereType<Map>()
          .map((e) => e.cast<String, dynamic>())
          .toList();
    }
  }
  return const [];
}

String valueOf(
  Map<String, dynamic> item,
  List<String> keys, {
  String fallback = '—',
}) {
  for (final key in keys) {
    final value = item[key];
    if (value != null && '$value'.trim().isNotEmpty) return '$value';
  }
  return fallback;
}

/// API UTC tarih/saat değerini cihaz yerel saatine çevirir.
///
/// Backend tarihleri UTC'dir, ancak bazı uçlar (DB'den okunan, Kind=Unspecified) değeri
/// 'Z' eki OLMADAN gönderir (ör. "2026-06-26T06:00:00"). Bu durumda [DateTime.parse]
/// değeri YEREL kabul eder ve [DateTime.toLocal] hiçbir şey yapmaz → saat yanlış görünür.
/// Bu yardımcı, 'Z' yoksa değeri UTC kabul edip ardından yerele çevirir (her iki formatı da doğru işler).
DateTime? parseUtcToLocal(dynamic value) {
  final s = value?.toString();
  if (s == null || s.trim().isEmpty) return null;
  var d = DateTime.tryParse(s);
  if (d == null) return null;
  if (!d.isUtc) {
    d = DateTime.utc(d.year, d.month, d.day, d.hour, d.minute, d.second, d.millisecond, d.microsecond);
  }
  return d.toLocal();
}

double numberOf(Map<String, dynamic> item, List<String> keys) {
  for (final key in keys) {
    final value = item[key];
    if (value is num) return value.toDouble();
    final parsed = double.tryParse('$value');
    if (parsed != null) return parsed;
  }
  return 0;
}
