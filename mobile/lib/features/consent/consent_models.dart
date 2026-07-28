/// Onam formu veri modelleri + durum yardımcıları (web `lib/consent.ts` paritesi).
///
/// Backend enum'u JSON'da bazen string ("Signed") bazen sayı (2) gelir; tek anahtara indirgenir.
library;

const List<String> kConsentStatusOrder = ['Draft', 'AwaitingSignature', 'Signed', 'Cancelled'];

String? consentStatusKey(dynamic value) {
  if (value == null) return null;
  if (value is num) {
    final i = value.toInt();
    return (i >= 0 && i < kConsentStatusOrder.length) ? kConsentStatusOrder[i] : null;
  }
  final s = '$value';
  return kConsentStatusOrder.contains(s) ? s : null;
}

const Map<String, String> kConsentStatusLabel = {
  'Draft': 'Hazırlanıyor',
  'AwaitingSignature': 'İmza bekleniyor',
  'Signed': 'İmzalandı',
  'Cancelled': 'İptal',
};

/// Müşterinin onam formu kaydı.
class ConsentForm {
  ConsentForm(this.raw);
  final Map<String, dynamic> raw;

  String get id => '${raw['id'] ?? ''}';
  String get title => '${raw['title'] ?? 'Onam Formu'}';
  String get body => '${raw['body'] ?? ''}';
  String? get templateId => raw['templateId']?.toString();
  String? get customerName => _text(raw['customerName']);
  String? get serviceName => _text(raw['serviceName']);
  String? get staffName => _text(raw['staffName']);
  String? get staffNotes => _text(raw['staffNotes']);
  String? get stationName => _text(raw['stationName']);
  String? get sessionToken => _text(raw['sessionToken']);
  String? get signatureImage => _text(raw['signatureImage']);
  String? get signerName => _text(raw['signerName']);
  bool get requiresSignature => raw['requiresSignature'] != false;
  String? get status => consentStatusKey(raw['status']);
  bool get isSigned => status == 'Signed';
  bool get isAwaiting => status == 'AwaitingSignature';

  DateTime? get signedAt {
    final v = raw['signedAtUtc'];
    if (v == null) return null;
    final d = DateTime.tryParse('$v');
    if (d == null) return null;
    return d.isUtc ? d.toLocal() : DateTime.utc(d.year, d.month, d.day, d.hour, d.minute, d.second).toLocal();
  }

  List<String> get checkItems => _list(raw['checkItems']);
  List<String> get checkedItems => _list(raw['checkedItems']);

  static String? _text(dynamic v) {
    final s = '${v ?? ''}'.trim();
    return s.isEmpty ? null : s;
  }

  static List<String> _list(dynamic v) {
    if (v is List) return v.map((e) => '$e').where((e) => e.trim().isNotEmpty).toList();
    return const [];
  }
}

/// Bir hizmet için zorunlu onam formu ve müşterideki karşılığı.
class ConsentRequirement {
  ConsentRequirement(this.raw);
  final Map<String, dynamic> raw;

  String get templateId => '${raw['templateId'] ?? ''}';
  String get title => '${raw['title'] ?? 'Onam Formu'}';
  String? get formId => raw['formId']?.toString();
  String? get serviceName => ConsentForm._text(raw['serviceName']);
  String? get serviceDefinitionId => raw['serviceDefinitionId']?.toString();
  String? get status => consentStatusKey(raw['status']);
  bool get isSigned => status == 'Signed';
}

/// Eksik/tamam özeti — randevu tamamlama kapısı ve uyarı şeridi bunu kullanır.
class ConsentStatus {
  ConsentStatus(this.raw);
  final Map<String, dynamic> raw;

  int get requiredCount => (raw['requiredCount'] as num?)?.toInt() ?? requirements.length;
  int get signedCount => (raw['signedCount'] as num?)?.toInt() ?? requirements.where((r) => r.isSigned).length;

  List<ConsentRequirement> get requirements {
    final list = raw['requirements'];
    if (list is List) {
      return list.whereType<Map>().map((e) => ConsentRequirement(e.cast<String, dynamic>())).toList();
    }
    return const [];
  }

  List<ConsentRequirement> get missing => requirements.where((r) => !r.isSigned).toList();
  bool get complete => missing.isEmpty;
}
