import 'package:dio/dio.dart';

import '../auth/auth_controller.dart';
import '../storage/session_storage.dart';
import 'api_config.dart';
import 'device_identity.dart';

class ApiException implements Exception {
  const ApiException(this.message, {this.statusCode, this.code});
  final String message;
  final int? statusCode;
  final String? code;
  @override
  String toString() => message;
}

class ApiClient {
  ApiClient(this.storage)
    : dio = Dio(
        BaseOptions(
          baseUrl: _baseUrl,
          connectTimeout: const Duration(seconds: 15),
          receiveTimeout: const Duration(seconds: 25),
          headers: const {'Accept': 'application/json'},
        ),
      ) {
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          // Cihaz güvenliği + log zenginleştirme: her isteğe cihaz kimliği/bilgisi
          // eklenir (backend, özellik kapalıyken bu header'ları yok sayar).
          try {
            options.headers['X-Device-Id'] = await DeviceIdentity.id();
            options.headers['X-Device-Info'] = DeviceIdentity.infoHeader();
          } catch (_) {}
          final session = auth?.session ?? await storage.read();
          if (session != null && options.extra['public'] != true) {
            options.headers['Authorization'] = 'Bearer ${session.accessToken}';
            if (session.user.tenantId != null) {
              options.headers['X-Tenant-Id'] = session.user.tenantId;
              if (options.path.startsWith('/api/admin/')) {
                options.queryParameters.putIfAbsent(
                  'tenantId',
                  () => session.user.tenantId,
                );
              }
            }
            if (session.user.branchId != null) {
              options.headers['X-Branch-Id'] = session.user.branchId;
            }
          }
          handler.next(options);
        },
        onError: (error, handler) async {
          final request = error.requestOptions;
          if (error.response?.statusCode == 401 &&
              request.extra['retried'] != true &&
              request.extra['public'] != true &&
              await (auth?.refresh() ?? Future.value(false))) {
            request.extra['retried'] = true;
            request.headers['Authorization'] =
                'Bearer ${auth!.session!.accessToken}';
            try {
              return handler.resolve(await dio.fetch(request));
            } catch (_) {}
          }
          handler.next(error);
        },
      ),
    );
  }

  final Dio dio;
  final SessionStorage storage;
  AuthController? auth;

  /// Bkz. [ApiConfig] — adres tek yerde tanımlıdır (arka plan yoklayıcısı da onu kullanır).
  static String get _baseUrl => ApiConfig.baseUrl;

  void bindAuth(AuthController controller) => auth = controller;

  Future<dynamic> get(String path, {Map<String, dynamic>? query}) =>
      _request('GET', path, query: query);

  /// Sayfalı bir listeyi totalCount'a ulaşana kadar 1000'lik sayfalarla çekip
  /// TÜM kayıtları döndürür ({'items': [...], 'totalCount': n} — apiItems uyumlu).
  /// Büyük listelerde (12 bin+ müşteri) tek sayfa tavanına takılmamak için.
  Future<Map<String, dynamic>> getAllPaged(
    String path, {
    Map<String, dynamic>? query,
    int pageSize = 1000,
  }) async {
    final items = <dynamic>[];
    var page = 1;
    var total = 0;
    var exhausted = false;
    // Tavan SONSUZ DÖNGÜYE karşıdır, veri sınırı değildir (bkz. aşağıdaki kontrol).
    while (page <= _maxPages) {
      final res = await get(
        path,
        query: {...?query, 'page': page, 'pageSize': pageSize},
      );
      final batch = res is Map ? (res['items'] as List? ?? const []) : const [];
      total = res is Map ? (res['totalCount'] as num? ?? 0).toInt() : 0;
      items.addAll(batch);
      if (batch.isEmpty || items.length >= total) {
        exhausted = true;
        break;
      }
      page++;
    }

    // TAVANA ÇARPIP EKSİK DÖNMEK SESSİZ VERİ KAYBIDIR. Eskiden döngü `page <= 100` ile
    // durunca liste HATASIZ ama EKSİK dönüyordu; ekran bunu gerçek toplam sanıp daha küçük
    // bir borç gösteriyordu. Tavanı yükseltmek tek başına yetmez — yükseltilmiş tavan da
    // aynı sessiz kesmeyi daha ileride yapar.
    if (!exhausted && items.length < total) {
      throw StateError(
        'Liste eksik alındı (${items.length}/$total). Sayfalama tavanına ulaşıldı; '
        'rakamlar eksik olacağı için gösterilmiyor.',
      );
    }
    return {'items': items, 'totalCount': total > 0 ? total : items.length};
  }

  /// Sayfalama güvenlik tavanı — 1.000'lik varsayılan sayfayla 500.000 kayda kadar yeter.
  static const int _maxPages = 500;

  /// [idempotencyKey] verilirse istek `Idempotency-Key` başlığıyla gider: ağ hatası sonrası
  /// tekrar denemede sunucu işi İKİNCİ KEZ yapmaz, ilk yanıtı aynen döndürür. Aynı akıştaki
  /// farklı çağrılara FARKLI anahtar verilmeli — anahtar yola değil (kullanıcı + anahtar)
  /// çiftine bağlıdır, aynısı kullanılırsa ikinci çağrı birincinin yanıtını replay eder.
  Future<dynamic> post(
    String path, [
    Map<String, dynamic>? body,
    String? idempotencyKey,
  ]) =>
      _request('POST', path, body: body, idempotencyKey: idempotencyKey);

  Future<dynamic> postPublic(String path, Map<String, dynamic> body) =>
      _request('POST', path, body: body, isPublic: true);

  Future<dynamic> put(String path, Map<String, dynamic> body) =>
      _request('PUT', path, body: body);

  Future<dynamic> patch(String path, [Map<String, dynamic>? body]) =>
      _request('PATCH', path, body: body);

  Future<dynamic> delete(String path) => _request('DELETE', path);

  Future<dynamic> _request(
    String method,
    String path, {
    Map<String, dynamic>? body,
    Map<String, dynamic>? query,
    bool isPublic = false,
    String? idempotencyKey,
  }) async {
    try {
      final response = await dio.request<dynamic>(
        path,
        data: body,
        queryParameters: query,
        options: Options(
          method: method,
          extra: {'public': isPublic},
          headers: idempotencyKey == null
              ? null
              : {'Idempotency-Key': idempotencyKey},
        ),
      );
      final payload = response.data;
      if (payload is Map && payload.containsKey('success')) {
        if (payload['success'] == true) return payload['data'];
        final error = payload['error'] as Map?;
        throw ApiException(
          '${error?['message'] ?? 'İşlem tamamlanamadı.'}',
          statusCode: response.statusCode,
          code: error?['code']?.toString(),
        );
      }
      return payload;
    } on DioException catch (error) {
      final payload = error.response?.data;
      if (payload is Map) {
        final apiError = payload['error'] as Map?;
        throw ApiException(
          '${apiError?['message'] ?? payload['message'] ?? 'Sunucuya bağlanılamadı.'}',
          statusCode: error.response?.statusCode,
          code: apiError?['code']?.toString(),
        );
      }
      // GÖVDESİZ / JSON OLMAYAN HATA. Buraya düşen istekte sunucu yapılandırılmış bir
      // hata zarfı döndürmemiştir: model bağlama hatası (400, gövdesiz), proxy hatası
      // (502/504, HTML) ya da zaman aşımı. Eskiden hepsi tek bir "İstek tamamlanamadı."
      // ile gösteriliyordu; kullanıcı da geliştirici de nedeni GÖREMİYORDU. En azından
      // durum kodunu ve türünü yüzeye çıkar.
      final status = error.response?.statusCode;
      final message = switch (error.type) {
        DioExceptionType.connectionError =>
          'Backend bağlantısı kurulamadı. İnternet bağlantınızı kontrol edin.',
        DioExceptionType.connectionTimeout ||
        DioExceptionType.sendTimeout ||
        DioExceptionType.receiveTimeout =>
          'Sunucu zamanında yanıt vermedi. Lütfen tekrar deneyin.',
        _ when status == 400 =>
          'İstek sunucu tarafından reddedildi (400). Zorunlu bir alan eksik ya da geçersiz olabilir.',
        _ when status == 401 || status == 403 =>
          'Bu işlem için yetkiniz yok ya da oturumunuz sona ermiş.',
        _ when status != null && status >= 500 =>
          'Sunucu hatası ($status). Sorun sürerse yöneticinize bildirin.',
        _ => 'İstek tamamlanamadı${status == null ? '' : ' ($status)'}.',
      };
      throw ApiException(message, statusCode: status);
    }
  }

  void dispose() => dio.close(force: true);
}
