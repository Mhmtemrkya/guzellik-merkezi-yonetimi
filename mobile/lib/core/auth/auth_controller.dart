import 'dart:async';

import 'package:flutter/foundation.dart';

import '../network/api_client.dart';
import '../network/device_identity.dart';
import '../security/screen_security.dart';
import '../storage/session_storage.dart';
import 'auth_session.dart';

enum AuthStatus { loading, signedOut, signedIn }

/// Panel girişinin 1. adım yanıtı — HENÜZ OTURUM DEĞİL.
/// Kod doğrulanana kadar hiçbir token cihazda saklanmaz.
class PanelLoginChallenge {
  const PanelLoginChallenge({
    required this.challengeId,
    required this.maskedEmail,
    this.devCode,
  });

  final String challengeId;

  /// Kodun gittiği adres, maskeli (yazım hatası fark edilsin).
  final String maskedEmail;

  /// Geliştirme ortamında kod; canlıda null.
  final String? devCode;
}

/// Müşteri doğrulama kodunun gideceği kanal — sunucudaki `CustomerOtpChannel` ile birebir.
///
/// WhatsApp TEK KANAL DEĞİLDİR: App Store 3.2.2(v) reddi tam olarak bunu söyledi ("uygulama
/// müşteri kullanıcılarını WhatsApp kullanıcılarıyla sınırlıyor"). Kod SMS ya da kayıtlı
/// e-posta adresine de gönderilebilir.
enum CustomerOtpChannel {
  auto(0, 'Otomatik'),
  whatsApp(1, 'WhatsApp'),
  sms(2, 'SMS'),
  email(3, 'E-posta');

  const CustomerOtpChannel(this.code, this.label);

  /// Sunucuya gönderilen sayı (enum sırası değişse bile bozulmasın diye açıkça yazılır).
  final int code;
  final String label;
}

/// Platformda hangi kanallar gerçekten yapılandırılmış? (İstemci yalnız çalışanları göstersin.)
class CustomerOtpChannels {
  const CustomerOtpChannels({
    required this.whatsApp,
    required this.sms,
    required this.email,
  });

  final bool whatsApp;
  final bool sms;
  final bool email;

  bool supports(CustomerOtpChannel channel) => switch (channel) {
    CustomerOtpChannel.whatsApp => whatsApp,
    CustomerOtpChannel.sms => sms,
    CustomerOtpChannel.email => email,
    CustomerOtpChannel.auto => whatsApp || sms || email,
  };

  /// Varsayılan kanal: SMS → e-posta → WhatsApp sırasıyla ilk çalışan.
  CustomerOtpChannel get preferred =>
      [CustomerOtpChannel.sms, CustomerOtpChannel.email, CustomerOtpChannel.whatsApp]
          .firstWhere(supports, orElse: () => CustomerOtpChannel.sms);

  List<CustomerOtpChannel> get enabled =>
      [CustomerOtpChannel.sms, CustomerOtpChannel.email, CustomerOtpChannel.whatsApp]
          .where(supports)
          .toList();
}

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

  /// Kurum/şube kapsamı. PAROLA ZORUNLU: uç eskiden yalnız e-postayla kurum/şube/rol
  /// döndürüyordu ve geçerli hesaplar anonim keşfedilebiliyordu. Parola yanlışsa yanıt BOŞ gelir.
  Future<List<Map<String, dynamic>>> loginScope(String email, {String? password}) async {
    final data = await api.postPublic('/api/auth/login-scope', {
      'email': email.trim().toLowerCase(),
      'role': null,
      'password': password,
    });
    final result = data as Map<String, dynamic>;
    return [result];
  }

  /// PANEL GİRİŞİ ADIM 1 — parola ve tüm giriş kontrolleri.
  ///
  /// OTURUM AÇMAZ: parola doğruysa e-postaya 6 haneli kod gider ve "meydan okuma" döner.
  /// Oturum yalnız [verifyLogin]'dan çıkar. Parolanın tek engel olması, müşteri kişisel
  /// verisi + tahsilat + kasa içeren bir panel için yeterli değildi.
  Future<PanelLoginChallenge> login({
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
    // "Beni hatırla" tercihi ŞİMDİ saklanır; 2. adımda oturum ona göre kalıcılaşır.
    _remember = remember;
    final map = (data as Map).cast<String, dynamic>();
    return PanelLoginChallenge(
      challengeId: '${map['challengeId'] ?? ''}',
      maskedEmail: '${map['maskedEmail'] ?? ''}',
      devCode: map['devCode']?.toString(),
    );
  }

  /// PANEL GİRİŞİ ADIM 2 — e-postaya gelen kod doğruysa oturum kurulur.
  Future<void> verifyLogin({required String challengeId, required String code}) async {
    final data = await api.postPublic('/api/auth/login/verify', {
      'challengeId': challengeId,
      'code': code.trim(),
    });
    session = AuthSession.fromJson((data as Map).cast<String, dynamic>());
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

  /// MÜŞTERİ KİMLİK KAPISI = OTP.
  ///
  /// Doğrudan token veren `/customer/login` ve `/customer/register` uçları kapatıldı (410):
  /// ad + telefon bilinen bir müşterinin hesabı OTP'siz ele geçirilebiliyordu.
  /// Giriş de kayıt da iki adımlıdır: kod iste → kodu doğrula.
  ///
  /// KİMLİKTE DOĞUM TARİHİ YOK: App Store 5.1.1(v) gereği girişte zorunlu tutulamaz (randevu
  /// almak için gerekmez). Kayıtta yalnızca İSTEĞE BAĞLI olarak alınır.

  /// Platformda hangi kanallardan kod gönderilebilir? Çalışmayan kanalı seçenek olarak
  /// göstermemek için. Uç okunamazsa NULL döner → seçici gizlenir, kararı sunucu verir.
  Future<CustomerOtpChannels?> customerOtpChannels() async {
    try {
      final data = await api.getPublic('/api/auth/customer/otp/channels');
      final map = (data as Map).cast<String, dynamic>();
      return CustomerOtpChannels(
        whatsApp: map['whatsApp'] == true,
        sms: map['sms'] == true,
        email: map['email'] == true,
      );
    } catch (_) {
      // FAIL-OPEN DEĞİL. Eskiden hata durumunda "hepsi açık" dönülüyordu: kullanıcı SMS
      // seçiyor ama sunucu kurulu olmayan kanalı atlayıp başkasına düşüyordu — kod seçilen
      // yerden GELMİYORDU. Bilinmiyorsa seçici gizlenir, kararı sunucu verir.
      return null;
    }
  }

  /// OTP adım 1: seçilen kanaldan (SMS / e-posta / WhatsApp) 6 haneli kod gönderilir. Güvenlik
  /// için kimlik eşleşmese de aynı yanıt döner (hesap keşfi engellenir). Development ortamında
  /// kod yanıtta ('devCode') gelir.
  ///
  /// [purpose]: 0 giriş, 1 kayıt. [channel]: 0 otomatik, 1 WhatsApp, 2 SMS, 3 e-posta.
  /// [email] YALNIZCA kayıtta anlamlıdır — girişte kod, kurum kayıtlarındaki adrese gider.
  Future<Map<String, dynamic>> customerOtpRequest({
    required String fullName,
    required String phone,
    int purpose = 0,
    int channel = 0,
    String? email,
  }) async {
    final trimmedEmail = email?.trim();
    final data = await api.postPublic('/api/auth/customer/otp/request', {
      'fullName': fullName.trim(),
      'phone': phone.trim(),
      'purpose': purpose,
      'channel': channel,
      'email': (trimmedEmail == null || trimmedEmail.isEmpty) ? null : trimmedEmail,
    });
    return (data as Map).cast<String, dynamic>();
  }

  /// OTP adım 2: kod doğruysa giriş yapılır; [purpose] = 1 ise hesap açılıp giriş yapılır.
  /// gender: 0 Belirtilmemiş, 1 Kadın, 2 Erkek, 3 Diğer (Domain.Enums.Gender ile aynı).
  /// [birthDate] isteğe bağlıdır ve yalnız kayıtta profile yazılır ('yyyy-MM-dd').
  Future<void> customerOtpVerify({
    required String fullName,
    required String phone,
    required String code,
    int purpose = 0,
    int gender = 0,
    String? email,
    String? birthDate,
    bool kvkkConsent = false,
  }) async {
    final trimmedEmail = email?.trim();
    final data = await api.postPublic('/api/auth/customer/otp/verify', {
      'fullName': fullName.trim(),
      'phone': phone.trim(),
      'code': code.trim(),
      'purpose': purpose,
      'gender': gender,
      'email': (trimmedEmail == null || trimmedEmail.isEmpty) ? null : trimmedEmail,
      'birthDate': (birthDate == null || birthDate.isEmpty) ? null : birthDate,
      // KVKK açık rızası — kayıt akışında ZORUNLU; sunucu onaysız kaydı reddeder.
      'kvkkConsent': kvkkConsent,
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
