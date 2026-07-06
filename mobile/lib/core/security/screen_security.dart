import 'package:flutter/services.dart';

import '../auth/auth_session.dart';
import '../network/api_client.dart';

/// Personel ekran görüntüsü kilidi (FLAG_SECURE).
///
/// Kurum yöneticisi ayarlar sayfasından "personel ekran görüntüsü alabilsin"
/// iznini yönetir. İzin kapalıyken personel cihazında ekran görüntüsü ve
/// ekran kaydı engellenir; yönetici/platform kullanıcıları etkilenmez.
class ScreenSecurity {
  static const _channel = MethodChannel('beautyasist/screen_security');

  static Future<void> apply(ApiClient api, SessionUser? user) async {
    var secure = false;
    if (user?.isStaff == true) {
      try {
        final data = await api.get('/api/admin/security/screenshots');
        secure = !(data is Map && data['allowStaffScreenshots'] == true);
      } catch (_) {
        // Ayar okunamazsa güvenli tarafta kal: personelde engel açık.
        secure = true;
      }
    }
    try {
      await _channel.invokeMethod('setSecure', {'secure': secure});
    } catch (_) {
      // Platform desteklemiyorsa (iOS/desktop) sessizce geç.
    }
  }

  static Future<void> reset() async {
    try {
      await _channel.invokeMethod('setSecure', {'secure': false});
    } catch (_) {}
  }
}
