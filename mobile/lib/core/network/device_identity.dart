import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'dart:ui' as ui;

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Cihaz güvenliği: kalıcı cihaz kimliği + cihaz/ağ bilgisi (web deviceIdentity.ts eşleniği).
/// Kimlik secure storage'da tutulur; uygulama silinirse cihaz "yeni" sayılır
/// (kurum yöneticisi panelden eski kaydı silebilir).
class DeviceIdentity {
  DeviceIdentity._();

  static const _storage = FlutterSecureStorage();
  static const _idKey = 'beautyassist.deviceId';
  static String? _cachedId;
  static String? _cachedInfoHeader;

  /// Kalıcı cihaz kimliği (UUID v4). İlk çağrıda üretilip saklanır.
  static Future<String> id() async {
    if (_cachedId != null) return _cachedId!;
    try {
      var value = await _storage.read(key: _idKey);
      if (value == null || value.isEmpty) {
        value = _generateUuid();
        await _storage.write(key: _idKey, value: value);
      }
      _cachedId = value;
      return value;
    } catch (_) {
      // Secure storage kullanılamazsa oturum boyunca sabit bellek-içi kimlik.
      _cachedId ??= _generateUuid();
      return _cachedId!;
    }
  }

  static String get deviceType {
    if (Platform.isAndroid || Platform.isIOS) return 'mobile';
    return 'pc';
  }

  /// Login body'sindeki `device` alanı (backend LoginDeviceDto ile aynı şema).
  static Map<String, dynamic> info() {
    final locale = ui.PlatformDispatcher.instance.locale.toLanguageTag();
    final screen = ui.PlatformDispatcher.instance.views.isNotEmpty
        ? ui.PlatformDispatcher.instance.views.first.physicalSize
        : null;
    return {
      'name': null,
      'deviceType': deviceType,
      'platform': '${Platform.operatingSystem} ${Platform.operatingSystemVersion}',
      'userAgent': 'BeautyAssistMobile/1.0 (${Platform.operatingSystem})',
      'networkInfoJson': jsonEncode({
        'connectionType': null,
        'effectiveType': null,
        'online': true,
        'language': locale,
        'screen': screen != null
            ? '${screen.width.round()}x${screen.height.round()}'
            : null,
        'timeZone': DateTime.now().timeZoneName,
      }),
    };
  }

  /// X-Device-Info header değeri: base64(UTF-8 JSON). Header'lar ASCII olmak zorunda.
  static String infoHeader() =>
      _cachedInfoHeader ??= base64Encode(utf8.encode(jsonEncode(info())));

  static String _generateUuid() {
    final random = Random.secure();
    final bytes = List<int>.generate(16, (_) => random.nextInt(256));
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant
    String hex(int start, int end) => bytes
        .sublist(start, end)
        .map((b) => b.toRadixString(16).padLeft(2, '0'))
        .join();
    return '${hex(0, 4)}-${hex(4, 6)}-${hex(6, 8)}-${hex(8, 10)}-${hex(10, 16)}';
  }
}
