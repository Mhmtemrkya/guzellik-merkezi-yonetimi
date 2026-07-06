import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../core/auth/auth_controller.dart';
import '../core/network/api_client.dart';
import '../core/notifications/notification_center.dart';
import '../features/accounting/on_muhasebe_screen.dart';
import '../features/appointments/appointments_screen.dart';
import '../features/approvals/approvals_screen.dart';
import '../features/auth/login_screen.dart';
import '../features/auth/register_screen.dart';
import '../features/branches/branches_screen.dart';
import '../features/campaigns/campaigns_screen.dart';
import '../features/cash/cash_screen.dart';
import '../features/cash_closing/cash_closing_screen.dart';
import '../features/commissions/commissions_screen.dart';
import '../features/customer_portal/customer_booking_screen.dart';
import '../features/customer_portal/customer_portal.dart';
import '../features/customers/consultation_form_screen.dart';
import '../features/customers/customer_detail_screen.dart';
import '../features/customers/customers_screen.dart';
import '../features/customers/treatment_journal_screen.dart';
import '../features/expense_categories/expense_categories_screen.dart';
import '../features/expenses/expenses_screen.dart';
import '../features/dashboard/dashboard_screen.dart';
import '../features/gift_cards/gift_cards_screen.dart';
import '../features/live/live_list_screen.dart';
import '../features/logs/logs_screen.dart';
import '../features/more/more_screen.dart';
import '../features/notifications/notification_inbox_screen.dart';
import '../features/notifications/notifications_screen.dart';
import '../features/packages/packages_screen.dart';
import '../features/accounting/sales_screen.dart';
import '../features/paket/paket_screen.dart';
import '../features/plans/plans_screen.dart';
import '../features/profile/profile_screen.dart';
import '../features/reports/reports_screen.dart';
import '../features/schedule/schedule_screen.dart';
import '../features/service_categories/service_categories_screen.dart';
import '../features/services/services_screen.dart';
import '../features/sessions/sessions_screen.dart';
import '../features/settings/settings_screen.dart';
import '../features/staff/staff_devices_sheet.dart';
import '../features/staff/staff_screen.dart';
import '../features/stock/stock_screen.dart';
import '../features/waitlist/waitlist_screen.dart';
import '../features/whatsapp/whatsapp_screen.dart';
import '../shared/widgets/app_shell.dart';

class AppRouter {
  AppRouter({required this.auth, required this.api, required this.notifications}) {
    router = GoRouter(
      initialLocation: '/splash',
      refreshListenable: auth,
      redirect: (context, state) {
        final location = state.matchedLocation;
        if (auth.status == AuthStatus.loading) {
          return location == '/splash' ? null : '/splash';
        }
        if (auth.status == AuthStatus.signedOut) {
          return (location == '/login' || location == '/register')
              ? null
              : '/login';
        }
        // Müşteri rolü: yalnızca /customer/ alanı.
        // NOT: prefix '/customer/' (sondaki / ile) — aksi halde personel '/customers' sayfasını da yakalardı.
        if (auth.user?.isCustomer == true) {
          if (!location.startsWith('/customer/')) return '/customer/home';
          return null;
        }
        // Personel/yönetici müşteri portalına giremez (ama /customers personel sayfasıdır, engelleme).
        if (location.startsWith('/customer/')) return '/home';
        if (location == '/login' || location == '/splash' || location == '/') {
          return '/home';
        }
        return null;
      },
      routes: [
        GoRoute(path: '/', redirect: (_, _) => '/home'),
        GoRoute(path: '/splash', builder: (_, _) => const _SplashScreen()),
        GoRoute(
          path: '/login',
          builder: (_, _) => LoginScreen(auth: auth),
        ),
        GoRoute(
          path: '/register',
          builder: (_, _) => RegisterScreen(auth: auth),
        ),
        // ---- Online randevu müşteri portalı ----
        GoRoute(
          path: '/customer/booking',
          builder: (_, state) => CustomerBookingScreen(
            api: api,
            branch:
                ((state.extra as Map?)?['branch'] as Map?)
                    ?.cast<String, dynamic>() ??
                const {},
          ),
        ),
        StatefulShellRoute.indexedStack(
          builder: (context, state, navigationShell) =>
              CustomerShell(navigationShell: navigationShell),
          branches: [
            StatefulShellBranch(
              routes: [
                GoRoute(
                  path: '/customer/home',
                  builder: (_, _) => CustomerHomeScreen(api: api, auth: auth),
                ),
              ],
            ),
            StatefulShellBranch(
              routes: [
                GoRoute(
                  path: '/customer/appointments',
                  builder: (_, _) => CustomerAppointmentsScreen(api: api),
                ),
              ],
            ),
            StatefulShellBranch(
              routes: [
                GoRoute(
                  path: '/customer/profile',
                  builder: (_, _) => CustomerProfileScreen(auth: auth),
                ),
              ],
            ),
          ],
        ),
        StatefulShellRoute.indexedStack(
          builder: (context, state, navigationShell) =>
              AppShell(auth: auth, navigationShell: navigationShell),
          branches: [
            StatefulShellBranch(
              routes: [
                GoRoute(
                  path: '/home',
                  builder: (_, _) =>
                      DashboardScreen(api: api, auth: auth, notifications: notifications),
                ),
              ],
            ),
            StatefulShellBranch(
              routes: [
                GoRoute(
                  path: '/customers',
                  builder: (_, _) => CustomersScreen(api: api, auth: auth),
                ),
              ],
            ),
            StatefulShellBranch(
              routes: [
                GoRoute(
                  path: '/appointments',
                  builder: (_, _) => AppointmentsScreen(api: api, auth: auth),
                ),
              ],
            ),
            StatefulShellBranch(
              routes: [
                GoRoute(
                  path: '/more',
                  builder: (_, _) => MoreScreen(auth: auth, notifications: notifications),
                ),
              ],
            ),
          ],
        ),
        _page('/services', ServicesScreen(api: api)),
        _page('/packages', PackagesScreen(api: api)),
        _page('/sales', SalesScreen(api: api)),
        _page('/branches', BranchesScreen(api: api)),
        _page('/service-categories', ServiceCategoriesScreen(api: api)),
        _page('/gift-cards', GiftCardsScreen(api: api)),
        _page('/waitlist', WaitlistScreen(api: api)),
        // Müşteri-bağlamlı klinik ekranlar: bağlam state.extra ile gelir
        // (müşteri kartından), yoksa ekran müşteri seçtirir (menüden).
        GoRoute(
          path: '/consultation',
          builder: (context, state) {
            final e = state.extra as Map?;
            return ConsultationFormScreen(
              api: api,
              customerId: e?['customerId'] as String?,
              customerName: e?['customerName'] as String?,
              startInCreateMode: e?['startInCreateMode'] == true,
            );
          },
        ),
        GoRoute(
          path: '/treatment-journal',
          builder: (context, state) {
            final e = state.extra as Map?;
            return TreatmentJournalScreen(
              api: api,
              customerId: e?['customerId'] as String?,
              customerName: e?['customerName'] as String?,
            );
          },
        ),
        // Zengin müşteri detayı (web CustomerDetailModal): Müşteriler ve
        // Ön Muhasebe sayfalarından açılır.
        GoRoute(
          path: '/customer-detail',
          builder: (context, state) {
            final e = state.extra as Map?;
            final tabRaw = '${e?['initialTab'] ?? 'overview'}';
            return CustomerDetailScreen(
              api: api,
              customerId: '${e?['customerId'] ?? ''}',
              customer: (e?['customer'] as Map?)?.cast<String, dynamic>(),
              initialTab: CustomerTab.values.firstWhere(
                (t) => t.name == tabRaw,
                orElse: () => CustomerTab.overview,
              ),
            );
          },
        ),
        // Cihaz güvenliği: personel detayından açılır (tenantUserId + ad extra ile).
        GoRoute(
          path: '/staff-devices',
          builder: (context, state) {
            final e = state.extra as Map?;
            return StaffDevicesScreen(
              api: api,
              tenantUserId: '${e?['tenantUserId'] ?? ''}',
              staffName: '${e?['staffName'] ?? 'Personel'}',
            );
          },
        ),
        _page('/sessions', SessionsScreen(api: api)),
        _page('/cash', CashScreen(api: api)),
        _page('/cash-closing', CashClosingScreen(api: api)),
        _page('/accounting', OnMuhasebeScreen(api: api)),
        _page('/expenses', ExpensesScreen(api: api)),
        _page('/expense-categories', ExpenseCategoriesScreen(api: api)),
        _page('/commissions', CommissionsScreen(api: api)),
        _page('/stock', StockScreen(api: api)),
        _page(
          '/stock-movements',
          LiveListScreen(
            api: api,
            eyebrow: 'Stok',
            title: 'Stok Hareketleri',
            subtitle: 'Ürün giriş/çıkış hareketleri.',
            icon: Icons.swap_vert_rounded,
            endpoint: '/api/admin/stock-movements/',
            query: pageQuery,
            titleKeys: const ['productName', 'type'],
            subtitleKeys: const ['reason', 'createdAtUtc', 'note'],
            trailingKeys: const ['quantity'],
            statusKeys: const ['type'],
          ),
        ),
        _page('/staff', StaffScreen(api: api)),
        _page('/time-off', ScheduleScreen(api: api)),
        _page('/approvals', ApprovalsScreen(api: api)),
        _page('/campaigns', CampaignsScreen(api: api)),
        _page('/reports', ReportsScreen(api: api)),
        _page('/notification-inbox', NotificationInboxScreen(center: notifications)),
        _page('/notifications', NotificationsScreen(api: api, auth: auth)),
        _page(
          '/notification-logs',
          LiveListScreen(
            api: api,
            eyebrow: 'İletişim',
            title: 'Bildirim Logları',
            subtitle: 'Gönderim geçmişi ve sonuçları.',
            icon: Icons.mark_email_read_rounded,
            endpoint: '/api/admin/notification-logs/',
            query: pageQuery,
            titleKeys: const ['customerName', 'recipient', 'channel'],
            subtitleKeys: const ['templateName', 'sentAtUtc', 'errorMessage'],
            statusKeys: const ['status', 'channel'],
          ),
        ),
        _page('/whatsapp', WhatsAppScreen(api: api)),
        _page(
          '/whatsapp-messages',
          WhatsAppScreen(api: api, initialTab: WhatsAppTab.messages),
        ),
        _page('/logs', LogsScreen(api: api)),
        _page('/settings', SettingsScreen(api: api, auth: auth)),
        _page(
          '/features',
          LiveListScreen(
            api: api,
            eyebrow: 'Yetkiler',
            title: 'Özellikler',
            subtitle: 'Aktif modül ve özellik bilgileri.',
            icon: Icons.extension_rounded,
            endpoint: '/api/admin/features',
            loader: (api) async {
              if (api.auth?.user?.isPlatform == true) {
                return api.get('/api/platform/features-catalog');
              }
              return api.get('/api/admin/features');
            },
            titleKeys: const ['name', 'key', 'featureKey'],
            subtitleKeys: const ['description', 'module', 'enabled'],
            statusKeys: const ['enabled', 'isActive'],
          ),
        ),
        _page(
          '/usage',
          LiveListScreen(
            api: api,
            eyebrow: 'Kullanım',
            title: 'Kullanım ve Limitler',
            subtitle: 'Plan kullanımı ve platform metrikleri.',
            icon: Icons.insights_rounded,
            endpoint: '/api/admin/usage',
            loader: (api) async => [
              await api.get(
                api.auth?.user?.isPlatform == true
                    ? '/api/platform/usage'
                    : '/api/admin/usage',
              ),
            ],
            titleKeys: const ['tenantName', 'planName', 'plan'],
            subtitleKeys: const ['period', 'status', 'usage'],
            trailingKeys: const ['used', 'limit'],
            statusKeys: const ['status'],
          ),
        ),
        _page('/plans', PlansScreen(api: api, auth: auth)),
        _page('/paket', PaketScreen(api: api)),
        _page('/profile', ProfileScreen(auth: auth, api: api)),
      ],
    );
  }

  final AuthController auth;
  final ApiClient api;
  final NotificationCenter notifications;
  late final GoRouter router;

  GoRoute _page(String path, Widget child) => GoRoute(
    path: path,
    pageBuilder: (context, state) => MaterialPage<void>(
      key: state.pageKey,
      child: _BackOverlay(child: child),
    ),
  );

  void dispose() => router.dispose();
}

class _SplashScreen extends StatelessWidget {
  const _SplashScreen();

  @override
  Widget build(BuildContext context) => const Scaffold(
    body: Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Image(image: AssetImage('assets/images/logo.png'), height: 74),
          SizedBox(height: 24),
          CircularProgressIndicator(),
        ],
      ),
    ),
  );
}

class _BackOverlay extends StatelessWidget {
  const _BackOverlay({required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) => Stack(
    children: [
      child,
      Positioned(
        top: MediaQuery.paddingOf(context).top + 8,
        right: 12,
        child: Material(
          color: Colors.white.withValues(alpha: .92),
          shape: const CircleBorder(),
          elevation: 1,
          child: IconButton(
            tooltip: 'Geri',
            onPressed: context.pop,
            icon: const Icon(Icons.close_rounded),
          ),
        ),
      ),
    ],
  );
}
