import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/network/api_client.dart';
import '../../core/platform/store_policy.dart';

/// Maydi asistanı istemcisi (web `lib/assistantApi.ts` ile aynı sözleşme). Personel/yönetici
/// `/api/assistant`'a, müşteri `/api/customer/assistant`'a gider (sunucu müşteri token'ını yalnız
/// `/api/customer` altına bırakır). Kişi, rol, şube ve izin daima sunucuda oturumdan belirlenir;
/// buradan giden bağlam yalnız ekran ipucu, mağaza sürümü ve yapay zekâ onayıdır.
class AssistantApi {
  AssistantApi(this.auth);

  final AuthController auth;

  ApiClient get _api => auth.api;
  bool get isCustomer => auth.user?.isCustomer == true;
  String get _base => isCustomer ? '/api/customer/assistant' : '/api/assistant';

  /// App Store / Play mağaza sürümü: satın alma yüzeyleri (Paketim) önerilmez (3.1.1).
  bool get storeBuild => StorePolicy.hidesPurchaseFlows;

  Map<String, dynamic> _query(String? route, bool allowAi) => {
    'route': ?route,
    if (storeBuild) 'store': 'true',
    if (!allowAi) 'ai': 'false',
  };

  Future<Map<String, dynamic>> status() async => _map(await _api.get('$_base/status'));

  Future<Map<String, dynamic>> briefing({String? route, required bool allowAi}) async =>
      _map(await _api.get('$_base/briefing', query: _query(route, allowAi)));

  Future<Map<String, dynamic>> send(
    String message, {
    String? conversationId,
    String? route,
    required bool allowAi,
    required String clientMessageId,
  }) async =>
      _map(await _api.post('$_base/messages', {
        'conversationId': conversationId,
        'message': message,
        'clientMessageId': clientMessageId,
        'context': {'route': route, 'storeBuild': storeBuild, 'english': false, 'allowAi': allowAi},
      }));

  Future<List<Map<String, dynamic>>> conversations() async => _list(await _api.get('$_base/conversations'));

  Future<List<Map<String, dynamic>>> messages(String conversationId) async =>
      _list(await _api.get('$_base/conversations/$conversationId/messages'));

  Future<void> deleteConversation(String conversationId) => _api.delete('$_base/conversations/$conversationId');

  Future<void> feedback(String messageId, bool helpful) => _api.post('$_base/messages/$messageId/feedback', {'helpful': helpful});

  static Map<String, dynamic> _map(dynamic value) => value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};

  static List<Map<String, dynamic>> _list(dynamic value) =>
      value is List ? value.whereType<Map>().map((item) => Map<String, dynamic>.from(item)).toList() : const [];
}

/// Yapay zekâ onayı (App Store 5.1.2(i)): kişi başına cihazda saklanır. Onay yoksa soru buluta gitmez.
class MaydiConsent {
  static const _storage = FlutterSecureStorage();

  static String _key(String scope) => 'beautyasist.maydi.aiConsent.v2.$scope';

  /// 'granted', 'declined' ya da null (henüz sorulmadı).
  static Future<String?> read(String scope) async {
    try {
      final value = await _storage.read(key: _key(scope));
      return value == 'granted' || value == 'declined' ? value : null;
    } catch (_) {
      return null;
    }
  }

  static Future<void> write(String scope, String value) async {
    try {
      await _storage.write(key: _key(scope), value: value);
    } catch (_) {
      // Depolama erişilemezse onay yalnız bu oturumda geçerli kalır.
    }
  }
}

/// Web panelinin rotasını (sunucu cevabındaki "Sayfayı aç") mobildeki karşılığına çevirir.
/// Telefonda ayrı ekranı olmayan sayfalar "Daha fazla" menüsünden açılır; karşılığı yoksa null.
String? mobileRouteFor(String? webRoute, {required bool customer}) {
  if (webRoute == null || webRoute.isEmpty) return null;
  if (customer) {
    return webRoute.startsWith('/randevu') ? '/customer/appointments' : null;
  }
  final path = webRoute.split('?').first;
  if (path.endsWith('/randevular') || path.endsWith('/seanslar')) return '/appointments';
  if (path.endsWith('/musteriler') || path == '/imza') return '/customers';
  if (path == '/panel' || path == '/ekip') return '/home';
  // Satın alma sayfası mağaza sürümünde hiç açılmaz.
  if (path.startsWith('/panel/paket') && !path.startsWith('/panel/paketler') && StorePolicy.hidesPurchaseFlows) return null;
  if (path.startsWith('/panel/') || path.startsWith('/ekip/')) return '/more';
  return null;
}
