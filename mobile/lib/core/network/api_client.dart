import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import '../auth/auth_controller.dart';
import '../storage/session_storage.dart';
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

  static String get _baseUrl {
    const configured = String.fromEnvironment('API_BASE_URL');
    if (configured.isNotEmpty) return configured;
    // Release (mağaza) derlemeleri üretim API'sine gider; debug/profile yerelde kalır.
    // --dart-define=API_BASE_URL=... her ikisini de ezer.
    if (kReleaseMode) return 'https://api.courseintellect.xyz';
    return Platform.isAndroid
        ? 'http://10.0.2.2:5019'
        : 'http://127.0.0.1:5019';
  }

  void bindAuth(AuthController controller) => auth = controller;

  Future<dynamic> get(String path, {Map<String, dynamic>? query}) =>
      _request('GET', path, query: query);

  Future<dynamic> post(String path, [Map<String, dynamic>? body]) =>
      _request('POST', path, body: body);

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
  }) async {
    try {
      final response = await dio.request<dynamic>(
        path,
        data: body,
        queryParameters: query,
        options: Options(method: method, extra: {'public': isPublic}),
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
      throw ApiException(
        error.type == DioExceptionType.connectionError
            ? 'Backend bağlantısı kurulamadı. API adresini kontrol edin.'
            : 'İstek tamamlanamadı.',
        statusCode: error.response?.statusCode,
      );
    }
  }

  void dispose() => dio.close(force: true);
}
