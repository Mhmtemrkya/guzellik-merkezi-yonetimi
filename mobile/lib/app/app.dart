import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import '../core/auth/auth_controller.dart';
import '../core/network/api_client.dart';
import '../core/notifications/background_poller.dart';
import '../core/notifications/notification_center.dart';
import '../core/storage/session_storage.dart';
import '../core/theme/app_theme.dart';
import 'router.dart';

class BeautyAsistApp extends StatefulWidget {
  const BeautyAsistApp({super.key});

  @override
  State<BeautyAsistApp> createState() => _BeautyAsistAppState();
}

class _BeautyAsistAppState extends State<BeautyAsistApp> with WidgetsBindingObserver {
  late final SessionStorage storage;
  late final ApiClient api;
  late final AuthController auth;
  late final NotificationCenter notifications;
  late final AppRouter appRouter;

  bool _notificationsActive = false;

  // Bildirim data.route → geçerli mobil rota eşlemesi (backend web rotaları farklı olabilir).
  static const _routeAliases = <String, String>{
    '/appointments/inbox': '/appointments',
    '/accounts': '/accounting',
  };
  static const _shellTabs = <String>{'/home', '/customers', '/appointments', '/more'};
  static const _pushTargets = <String>{
    '/approvals', '/cash-closing', '/logs', '/reports', '/accounting',
  };

  @override
  void initState() {
    super.initState();
    storage = const SessionStorage();
    api = ApiClient(storage);
    auth = AuthController(api: api, storage: storage);
    api.bindAuth(auth);
    notifications = NotificationCenter(api: api, auth: auth);
    appRouter = AppRouter(auth: auth, api: api, notifications: notifications);
    notifications.onNavigate = _handleNotificationNavigate;

    WidgetsBinding.instance.addObserver(this);
    BackgroundPoller.configure();

    auth.addListener(_onAuthChanged);
    auth.restore();
  }

  /// Girişte bildirimleri başlat, çıkışta durdur (yalnızca personel/yönetici; müşteri portalı hariç).
  void _onAuthChanged() {
    final signedIn =
        auth.status == AuthStatus.signedIn && auth.user?.isCustomer != true;
    if (signedIn && !_notificationsActive) {
      _notificationsActive = true;
      notifications.start();
    } else if (!signedIn && _notificationsActive) {
      _notificationsActive = false;
      notifications.stop();
      BackgroundPoller.stop();
    }
  }

  void _handleNotificationNavigate(Map<String, dynamic> data) {
    final raw = data['route'];
    if (raw is! String || raw.isEmpty) return;
    final target = _routeAliases[raw] ?? raw;
    try {
      if (_shellTabs.contains(target)) {
        appRouter.router.go(target);
      } else if (_pushTargets.contains(target)) {
        appRouter.router.push(target);
      } else {
        appRouter.router.push('/notification-inbox');
      }
    } catch (_) {}
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (!_notificationsActive) return;
    if (state == AppLifecycleState.resumed) {
      // Ön plana dönüldü: arka plan servisini durdur, in-app yoklama devralsın + rozeti tazele.
      BackgroundPoller.stop();
      notifications.onResume();
    } else if (state == AppLifecycleState.paused) {
      // Arka plana geçildi/kapanıyor: LAN yoklamasını ön plan servisine devret.
      BackgroundPoller.start();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    auth.removeListener(_onAuthChanged);
    appRouter.dispose();
    notifications.dispose();
    auth.dispose();
    api.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'BeautyAsist',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      locale: const Locale('tr', 'TR'),
      supportedLocales: const [Locale('tr', 'TR'), Locale('en', 'US')],
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      routerConfig: appRouter.router,
    );
  }
}
