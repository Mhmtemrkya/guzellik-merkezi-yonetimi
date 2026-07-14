import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../auth/auth_session.dart';

class SessionStorage {
  const SessionStorage();

  static const _storage = FlutterSecureStorage();
  static const _sessionKey = 'beautyasist.session';

  Future<AuthSession?> read() async {
    try {
      final value = await _storage.read(key: _sessionKey);
      if (value == null || value.isEmpty) return null;
      return AuthSession.fromJson(jsonDecode(value) as Map<String, dynamic>);
    } catch (_) {
      await clear();
      return null;
    }
  }

  Future<void> write(AuthSession session) async {
    try {
      await _storage.write(
        key: _sessionKey,
        value: jsonEncode(session.toJson()),
      );
    } catch (error) {
      // iOS simulator/Xcode imzalama ayarları bazen Keychain entitlement
      // hazır olmadan -34018 döndürebiliyor. Login başarılıysa kullanıcıyı
      // ekranda bırakmak yerine oturumu bellekte sürdürmesine izin veriyoruz.
      debugPrint('SessionStorage.write skipped: $error');
    }
  }

  Future<void> clear() async {
    try {
      await _storage.delete(key: _sessionKey);
    } catch (_) {}
  }
}
