import 'dart:async';

import 'package:flutter/foundation.dart';

import '../network/api_client.dart';
import '../network/device_identity.dart';
import '../security/screen_security.dart';
import '../storage/session_storage.dart';
import 'auth_session.dart';

enum AuthStatus { loading, signedOut, signedIn }

class AuthController extends ChangeNotifier {
  AuthController({required this.api, required this.storage});

  final ApiClient api;
  final SessionStorage storage;

  AuthStatus status = AuthStatus.loading;
  AuthSession? session;

  /// "Beni hatırla" (web ile aynı): true → oturum güvenli depoda kalıcı
  /// (uygulama kapanıp açılınca da girişli kalır), false → yalnızca bellekte
  /// (uygulama tamamen kapanınca tekrar giriş gerekir).
  bool _remember = true;
  bool get remember => _remember;

  /// Geçici şifreyle girildi ve henüz değiştirilmedi → router zorunlu şifre
  /// değiştirme ekranına yönlendirir. "Daha Sonra" ile bu oturum için atlanabilir
  /// (web ile aynı davranış); bir sonraki girişte tekrar çıkar.
  bool passwordChangePending = false;

  SessionUser? get user => session?.user;

  Future<void> restore() async {
    try {
      session = await storage.read().timeout(const Duration(seconds: 3));
      if (session == null) {
        await _markSignedOut(clearStorage: false);
        return;
      }
      _remember = true; // depoda oturum bulunduysa "beni hatırla" açıktı
      final needsRefresh = session!.expiresAtUtc.isBefore(
        DateTime.now().add(const Duration(minutes: 1)),
      );
      if (needsRefresh &&
          !await refresh().timeout(
            const Duration(seconds: 8),
            onTimeout: () => false,
          )) {
        await _markSignedOut(clearStorage: true);
        return;
      }
      status = AuthStatus.signedIn;
      passwordChangePending = session?.user.mustChangePassword == true;
      notifyListeners();
      // Token süresi dolmamış olsa da açılışta oturumu tazele (best-effort):
      // kurum yöneticisinin değiştirdiği rol/sayfa izinleri yeniden giriş
      // beklemeden uygulanır (refresh yanıtı izinleri DB'den taze döndürür).
      if (!needsRefresh) {
        unawaited(refreshProfile());
      }
      // Personel ekran görüntüsü kilidi kurum ayarına göre uygulanır (bloklamadan).
      unawaited(ScreenSecurity.apply(api, session?.user));
    } catch (_) {
      await _markSignedOut(clearStorage: true);
    }
  }

  Future<List<Map<String, dynamic>>> loginScope(String email) async {
    final data = await api.postPublic('/api/auth/login-scope', {
      'email': email.trim().toLowerCase(),
      'role': null,
    });
    final result = data as Map<String, dynamic>;
    return [result];
  }

  Future<void> login({
    required String email,
    required String password,
    required String role,
    String? tenantId,
    String? branchId,
    bool remember = true,
  }) async {
    final data = await api.postPublic('/api/auth/login', {
      'email': email.trim().toLowerCase(),
      'password': password,
      'role': role,
      'tenantId': tenantId,
      'branchId': branchId,
      // Cihaz güvenliği: personel girişleri tanımlı cihaz kimliğiyle doğrulanır.
      'deviceId': await DeviceIdentity.id(),
      'device': DeviceIdentity.info(),
    });
    session = AuthSession.fromJson((data as Map).cast<String, dynamic>());
    _remember = remember;
    await _persistSession();
    status = AuthStatus.signedIn;
    passwordChangePending = session?.user.mustChangePassword == true;
    notifyListeners();
    unawaited(ScreenSecurity.apply(api, session?.user));
  }

  /// Geçici/mevcut şifreyi yenisiyle değiştirir (web /change-password paritesi).
  /// Başarılıysa zorunlu değiştirme bayrağı kapanır ve oturum tazelenir.
  Future<void> changePassword({
    required String currentPassword,
    required String newPassword,
  }) async {
    await api.post('/api/auth/change-password', {
      'currentPassword': currentPassword,
      'newPassword': newPassword,
    });
    passwordChangePending = false;
    notifyListeners();
    // mustChangePassword bayrağını DB'den taze almak için oturumu sessizce yenile.
    unawaited(refreshProfile());
  }

  /// "Daha Sonra": bu oturum için zorunlu ekranı atlar; bayrak sunucuda kaldığı
  /// için bir sonraki girişte tekrar sorulur.
  void skipPasswordChange() {
    passwordChangePending = false;
    notifyListeners();
  }

  /// Online portal müşteri girişi: ad soyad + telefon (baştaki 0 ile) + doğum tarihi (YYYY-MM-DD).
  Future<void> customerLogin({
    required String fullName,
    required String phone,
    required String birthDate,
  }) async {
    final data = await api.postPublic('/api/auth/customer/login', {
      'fullName': fullName.trim(),
      'phone': phone.trim(),
      'birthDate': birthDate,
    });
    session = AuthSession.fromJson((data as Map).cast<String, dynamic>());
    _remember = true;
    await _persistSession();
    status = AuthStatus.signedIn;
    notifyListeners();
  }

  /// Kuruma bağlı olmayan müşteri kaydı (kayıt ol). Başarılıysa otomatik giriş yapılır.
  /// gender: 0 Belirtilmemiş, 1 Kadın, 2 Erkek, 3 Diğer (Domain.Enums.Gender ile aynı).
  Future<void> customerRegister({
    required String fullName,
    required String phone,
    required String birthDate,
    required int gender,
    String? email,
  }) async {
    final trimmedEmail = email?.trim();
    final data = await api.postPublic('/api/auth/customer/register', {
      'fullName': fullName.trim(),
      'phone': phone.trim(),
      'birthDate': birthDate,
      'gender': gender,
      'email': (trimmedEmail == null || trimmedEmail.isEmpty) ? null : trimmedEmail,
    });
    session = AuthSession.fromJson((data as Map).cast<String, dynamic>());
    _remember = true;
    await _persistSession();
    status = AuthStatus.signedIn;
    notifyListeners();
  }

  Future<bool> refresh() async {
    final current = session;
    if (current == null || current.refreshToken.isEmpty) return false;
    try {
      final data = await api.postPublic('/api/auth/refresh', {
        'refreshToken': current.refreshToken,
      });
      session = AuthSession.fromJson((data as Map).cast<String, dynamic>());
      if (_remember) await storage.write(session!);
      status = AuthStatus.signedIn;
      notifyListeners();
      return true;
    } catch (_) {
      return false;
    }
  }

  /// Oturumu sessizce tazeler (izin değişikliklerini almak için).
  /// Başarısız olsa da mevcut oturuma dokunmaz.
  Future<void> refreshProfile() async {
    try {
      await refresh().timeout(const Duration(seconds: 8), onTimeout: () => false);
    } catch (_) {}
  }

  Future<void> signOut({bool localOnly = false}) async {
    final refreshToken = session?.refreshToken;
    if (!localOnly && refreshToken != null) {
      try {
        await api.post('/api/auth/logout', {'refreshToken': refreshToken});
      } catch (_) {}
    }
    await _markSignedOut(clearStorage: true);
  }

  /// "Beni hatırla" tercihine göre oturumu kalıcı saklar ya da depodan siler.
  Future<void> _persistSession() async {
    if (_remember && session != null) {
      await storage.write(session!);
    } else {
      await storage.clear();
    }
  }

  Future<void> _markSignedOut({required bool clearStorage}) async {
    session = null;
    status = AuthStatus.signedOut;
    if (clearStorage) {
      try {
        await storage.clear().timeout(const Duration(seconds: 2));
      } catch (_) {}
    }
    notifyListeners();
    // Çıkışta ekran görüntüsü kilidi kaldırılır (giriş ekranı hassas değil).
    unawaited(ScreenSecurity.reset());
  }
}
