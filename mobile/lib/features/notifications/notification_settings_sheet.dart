import 'dart:io';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/notifications/fcm_service.dart';
import '../../core/notifications/notification_service.dart';
import '../../core/theme/app_theme.dart';

/// BİLDİRİM AYARLARI — kullanıcının bildirimleri kendi açabildiği tek yer.
///
/// Neden gerekli: bildirim izni sistem tarafından YALNIZCA BİR KEZ sorulur. Kullanıcı o an
/// "İzin verme" derse (ya da sonradan sistem ayarından kapatırsa) uygulama içinden bunu geri
/// açmanın hiçbir yolu yoktu — bildirimler sessizce hiç gelmiyor, sebebi de görünmüyordu.
/// Burada gerçek durum gösterilir ve tek dokunuşla düzeltilir.
Future<void> showNotificationSettings(BuildContext context) => showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (_) => const _NotificationSettingsSheet(),
    );

class _NotificationSettingsSheet extends StatefulWidget {
  const _NotificationSettingsSheet();

  @override
  State<_NotificationSettingsSheet> createState() => _NotificationSettingsSheetState();
}

class _NotificationSettingsSheetState extends State<_NotificationSettingsSheet>
    with WidgetsBindingObserver {
  bool? _enabled;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _refresh();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Kullanıcı sistem ayarlarından dönünce durum kendiliğinden tazelensin —
    // aksi halde izni açıp geri geldiğinde ekran hâlâ "kapalı" gösterirdi.
    if (state == AppLifecycleState.resumed) _refresh();
  }

  Future<void> _refresh() async {
    final value = await NotificationService.instance.areEnabled();
    if (mounted) setState(() => _enabled = value);
  }

  Future<void> _enable() async {
    setState(() => _busy = true);
    try {
      await NotificationService.instance.init();
      final granted = await NotificationService.instance.requestPermissions();
      await _refresh();
      if (!mounted) return;
      // Sistem diyaloğu bir kez gösterilir; kalıcı reddedilmişse istek sessizce
      // başarısız olur ve tek çözüm sistem ayarlarıdır.
      if (!granted && (_enabled != true)) await _openSystemSettings();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _openSystemSettings() async {
    try {
      if (Platform.isAndroid) {
        // Uygulamanın bildirim ayarları sayfası (Android 8+).
        final uri = Uri.parse(
          'intent://#Intent;action=android.settings.APP_NOTIFICATION_SETTINGS;'
          'S.android.provider.extra.APP_PACKAGE=com.beautyasist.app;end',
        );
        if (await launchUrl(uri, mode: LaunchMode.externalApplication)) return;
      }
      await launchUrl(Uri.parse('app-settings:'),
          mode: LaunchMode.externalApplication);
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text(
            'Ayarlar açılamadı. Telefon Ayarları → Uygulamalar → BeautyAsist → Bildirimler'),
      ));
    }
  }

  /// Android sürümüne göre "izin neden sorulmadı" açıklaması.
  /// Ek bağımlılık gerekmesin diye sürüm `Platform.operatingSystemVersion` metninden okunur
  /// (ör. "Android 13 (API 33)"); okunamazsa genel bir metin gösterilir.
  String get _androidVersionNote {
    final raw = Platform.operatingSystemVersion;
    final api = int.tryParse(RegExp(r'API (\d+)').firstMatch(raw)?.group(1) ?? '');
    if (api == null) return 'Cihaz: $raw';
    return api >= 33
        ? 'Android $api: bildirim izni uygulama açılışında sorulur. Sorulmadıysa izin '
            'zaten verilmiş demektir (sistem aynı izni ikinci kez sormaz).'
        : 'Android $api: bu sürümde ayrı bir bildirim izni YOKTUR — bildirimler kurulumla '
            'birlikte açıktır. İzin sorulmaması normaldir.';
  }

  @override
  Widget build(BuildContext context) {
    final on = _enabled == true;
    final unknown = _enabled == null;

    return Container(
      decoration: const BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Center(
            child: Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: AppColors.border,
                borderRadius: BorderRadius.circular(999),
              ),
            ),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              const Icon(Icons.notifications_active_rounded,
                  size: 20, color: AppColors.primaryDark),
              const SizedBox(width: 8),
              const Expanded(
                child: Text('Bildirimler',
                    style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
              ),
              IconButton(
                visualDensity: VisualDensity.compact,
                onPressed: () => Navigator.pop(context),
                icon: const Icon(Icons.close_rounded, size: 20),
              ),
            ],
          ),
          const SizedBox(height: 12),

          // Durum kartı
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: on
                  ? const Color(0xFFEFFAF2)
                  : (unknown ? const Color(0xFFF6F4F5) : const Color(0xFFFFF4F4)),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(
                color: on
                    ? const Color(0xFF9BDCB4)
                    : (unknown ? AppColors.border : const Color(0xFFF0BDBD)),
              ),
            ),
            child: Row(
              children: [
                Icon(
                  on
                      ? Icons.check_circle_rounded
                      : (unknown ? Icons.help_outline_rounded : Icons.cancel_rounded),
                  color: on
                      ? const Color(0xFF2E9E5B)
                      : (unknown ? AppColors.muted : const Color(0xFFD24B4B)),
                  size: 22,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        on
                            ? 'Bildirimler açık'
                            : (unknown ? 'Durum okunamadı' : 'Bildirimler kapalı'),
                        style: const TextStyle(
                            fontWeight: FontWeight.w800, fontSize: 13.5),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        on
                            ? 'Randevu, onay ve tahsilat bildirimleri telefonunuza düşer.'
                            : (unknown
                                ? 'Telefonunuz bu bilgiyi paylaşmıyor. Aşağıdan yine de açabilirsiniz.'
                                : 'Yeni randevu, onay bekleyen işlem ve hatırlatmalar size ULAŞMAZ.'),
                        style: const TextStyle(fontSize: 12, height: 1.35),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),

          if (!on)
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: _busy ? null : _enable,
                icon: _busy
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.white),
                      )
                    : const Icon(Icons.notifications_active_rounded, size: 18),
                label: const Text('Bildirimleri aç'),
              ),
            ),
          if (on)
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: _openSystemSettings,
                icon: const Icon(Icons.tune_rounded, size: 18),
                label: const Text('Sistem bildirim ayarları'),
              ),
            ),

          // TEŞHİS: "izin diyaloğu hiç çıkmadı" şikâyetinin iki farklı sebebi olabilir ve
          // ikisi de dışarıdan ayırt edilemiyordu:
          //   • Android 12 ve altı → böyle bir izin YOKTUR, bildirimler baştan açıktır
          //     (hiçbir uygulama sormaz — beklenen davranış).
          //   • Android 13+ → izin gerçekten sorulmalıydı.
          // Sürümü burada göstererek hangi durumda olunduğu tek bakışta anlaşılır.
          if (Platform.isAndroid) ...[
            const SizedBox(height: 10),
            Text(
              _androidVersionNote,
              style: const TextStyle(fontSize: 11.5, color: AppColors.muted, height: 1.35),
            ),
          ],

          const SizedBox(height: 16),
          const Text('Neler bildiriliyor?',
              style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
          const SizedBox(height: 8),
          const _Bullet(
              icon: Icons.event_available_rounded,
              text: 'Yeni randevu, iptal ve saat değişiklikleri'),
          const _Bullet(
              icon: Icons.approval_rounded,
              text: 'Onay bekleyen personel işlemleri'),
          const _Bullet(
              icon: Icons.alarm_rounded,
              text: 'Yaklaşan randevu hatırlatmaları'),
          const _Bullet(
              icon: Icons.payments_rounded,
              text: 'Tahsilat, kasa kapanışı ve vadesi gelen taksitler'),

          const SizedBox(height: 12),
          // Uzaktan push yapılandırılmadıysa kullanıcı "kapalıyken neden gelmiyor"
          // sorusunun cevabını burada görsün.
          if (!FcmService.instance.available)
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: const Color(0xFFFFF8EC),
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: const Color(0xFFF0DCB4)),
              ),
              child: const Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(Icons.info_outline_rounded,
                      size: 16, color: Color(0xFFB98A2B)),
                  SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Uzaktan bildirim bu cihazda yapılandırılmamış. Uygulama açıkken '
                      'bildirimler çalışır; tamamen kapalıyken gelmeyebilir.',
                      style: TextStyle(fontSize: 11.5, height: 1.35),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _Bullet extends StatelessWidget {
  const _Bullet({required this.icon, required this.text});
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 7),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 15, color: AppColors.primary),
          const SizedBox(width: 8),
          Expanded(
            child: Text(text,
                style: const TextStyle(fontSize: 12.5, height: 1.35)),
          ),
        ],
      ),
    );
  }
}
