import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/responsive.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/auth/permissions.dart';
import '../../core/notifications/notification_center.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/widgets/app_background.dart';
import '../../shared/widgets/page_header.dart';

class MoreScreen extends StatelessWidget {
  const MoreScreen({required this.auth, required this.notifications, super.key});
  final AuthController auth;
  final NotificationCenter notifications;

  @override
  Widget build(BuildContext context) {
    final user = auth.user!;
    final modules = user.isPlatform
        ? const [
            _Module('Bildirimler', Icons.notifications_rounded, '/notification-inbox'),
            _Module('Kurumlar', Icons.apartment_rounded, '/customers'),
            _Module(
              'Abonelik Planları',
              Icons.workspace_premium_rounded,
              '/plans',
            ),
            _Module('Kullanım & Limitler', Icons.insights_rounded, '/usage'),
            _Module('Özellik Kataloğu', Icons.extension_rounded, '/features'),
            _Module('Sistem Ayarları', Icons.tune_rounded, '/settings'),
            _Module(
              'Sağlık Uyarıları',
              Icons.monitor_heart_rounded,
              '/notifications',
            ),
          ]
        : [
            const _Module(
              'Bildirimler',
              Icons.notifications_rounded,
              '/notification-inbox',
            ),
            const _Module(
              'Hizmetler',
              Icons.spa_rounded,
              '/services',
              permission: 'Services',
            ),
            const _Module(
              'Paketler',
              Icons.workspaces_rounded,
              '/packages',
              permission: 'Services',
            ),
            const _Module(
              'Satış (Paket & Hizmet)',
              Icons.point_of_sale_rounded,
              '/sales',
              permission: 'Accounting',
            ),
            if (!user.isStaff)
              const _Module(
                'Şubeler',
                Icons.store_mall_directory_rounded,
                '/branches',
              ),
            const _Module(
              'Hediye Çeki',
              Icons.card_giftcard_rounded,
              '/gift-cards',
              permission: 'GiftCards',
            ),
            const _Module(
              'Bekleme Listesi',
              Icons.hourglass_top_rounded,
              '/waitlist',
              permission: 'Waitlist',
            ),
            const _Module(
              'Müşteri Bilgi ve Onay Formu',
              Icons.assignment_rounded,
              '/consultation',
              permission: 'Customers',
            ),
            const _Module(
              'Tedavi Günlüğü',
              Icons.photo_library_rounded,
              '/treatment-journal',
              permission: 'Customers',
            ),
            if (user.isStaff)
              const _Module(
                'Seanslarım',
                Icons.content_cut_rounded,
                '/sessions',
                permission: 'Services',
              ),
            const _Module(
              'Günlük Kasa',
              Icons.account_balance_wallet_rounded,
              '/cash',
              permission: 'CashRegister',
            ),
            if (!user.isStaff)
              const _Module(
                'Kasa Kapanışı',
                Icons.fact_check_rounded,
                '/cash-closing',
                permission: 'CashClosing',
              ),
            const _Module(
              'Ön Muhasebe',
              Icons.account_balance_rounded,
              '/accounting',
              permission: 'Accounting',
            ),
            const _Module(
              'Giderler',
              Icons.receipt_long_rounded,
              '/expenses',
              permission: 'Accounting',
            ),
            const _Module(
              'Gider Kategorileri',
              Icons.folder_special_rounded,
              '/expense-categories',
              permission: 'Accounting',
            ),
            // Primler: personel kendi prim/hakedişini görür — ayrı izin gerekmez.
            const _Module(
              'Primler',
              Icons.payments_rounded,
              '/commissions',
            ),
            const _Module(
              'Stok & Ürün',
              Icons.inventory_2_rounded,
              '/stock',
              permission: 'Stock',
            ),
            const _Module(
              'Stok Hareketleri',
              Icons.swap_vert_rounded,
              '/stock-movements',
              permission: 'Stock',
            ),
            if (!user.isStaff)
              const _Module('Personel & Roller', Icons.badge_rounded, '/staff'),
            if (!user.isStaff)
              const _Module(
                'İzin / Çizelge',
                Icons.event_busy_rounded,
                '/time-off',
              ),
            if (!user.isStaff)
              const _Module(
                'Onay Bekleyenler',
                Icons.approval_rounded,
                '/approvals',
              ),
            const _Module(
              'Kampanyalar',
              Icons.campaign_rounded,
              '/campaigns',
              permission: 'Services',
            ),
            const _Module(
              'Bildirimler',
              Icons.notifications_active_rounded,
              '/notifications',
              permission: 'Notifications',
            ),
            const _Module(
              'Bildirim Logları',
              Icons.mark_email_read_rounded,
              '/notification-logs',
              permission: 'Notifications',
            ),
            const _Module(
              'WhatsApp',
              Icons.chat_rounded,
              '/whatsapp',
              permission: 'Notifications',
            ),
            const _Module(
              'WhatsApp Mesajları',
              Icons.forum_rounded,
              '/whatsapp-messages',
              permission: 'Notifications',
            ),
            const _Module(
              'Raporlar',
              Icons.bar_chart_rounded,
              '/reports',
              permission: 'Reports',
            ),
            const _Module(
              'Log Kayıtları',
              Icons.history_rounded,
              '/logs',
              permission: 'Logs',
            ),
            if (!user.isStaff)
              const _Module('Ayarlar', Icons.settings_rounded, '/settings'),
            const _Module(
              'Paketim',
              Icons.workspace_premium_rounded,
              '/paket',
            ),
            const _Module('Profilim', Icons.account_circle_rounded, '/profile'),
          ];
    final visible = modules
        .where(
          (module) =>
              module.permission == null ||
              !user.isStaff ||
              user.hasPage(module.permission!),
        )
        .toList();
    return AppBackground(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        body: SafeArea(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(18, 22, 18, 110),
            children: [
              const PageHeader(
                eyebrow: 'BeautyAsist',
                title: 'Tüm modüller',
                subtitle: 'Yetkinize açık yönetim araçları.',
              ),
              const SizedBox(height: 18),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Row(
                    children: [
                      CircleAvatar(
                        radius: 25,
                        backgroundColor: AppColors.rose,
                        child: Text(
                          user.initials,
                          style: const TextStyle(
                            color: AppColors.primaryDark,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ),
                      const SizedBox(width: 13),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              user.fullName,
                              style: const TextStyle(
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            const SizedBox(height: 3),
                            Text(
                              user.email,
                              style: const TextStyle(
                                color: AppColors.muted,
                                fontSize: 12,
                              ),
                            ),
                          ],
                        ),
                      ),
                      IconButton(
                        tooltip: 'Çıkış yap',
                        onPressed: auth.signOut,
                        icon: const Icon(Icons.logout_rounded),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 18),
              GridView.builder(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                itemCount: visible.length,
                gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: gridCols(context, 2),
                  crossAxisSpacing: 11,
                  mainAxisSpacing: 11,
                  mainAxisExtent: 146,
                ),
                itemBuilder: (context, index) {
                  final module = visible[index];
                  return InkWell(
                    borderRadius: BorderRadius.circular(22),
                    onTap: () => context.push(module.path),
                    child: Card(
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            _ModuleIcon(module: module, notifications: notifications),
                            const Spacer(),
                            Text(
                              module.title,
                              style: const TextStyle(
                                fontWeight: FontWeight.w800,
                                height: 1.15,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  );
                },
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Module {
  const _Module(this.title, this.icon, this.path, {this.permission});
  final String title;
  final IconData icon;
  final String path;
  final String? permission;
}

/// Modül kartı ikonu; "Bildirimler" kartında okunmamış sayacına göre canlı rozet gösterir.
class _ModuleIcon extends StatelessWidget {
  const _ModuleIcon({required this.module, required this.notifications});
  final _Module module;
  final NotificationCenter notifications;

  @override
  Widget build(BuildContext context) {
    final box = Container(
      width: 43,
      height: 43,
      decoration: BoxDecoration(
        color: AppColors.surfaceSoft,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Icon(module.icon, color: AppColors.primaryDark, size: 22),
    );
    if (module.path != '/notification-inbox') return box;
    return AnimatedBuilder(
      animation: notifications,
      builder: (context, _) => Badge(
        isLabelVisible: notifications.unreadCount > 0,
        label: Text(
          notifications.unreadCount > 99 ? '99+' : '${notifications.unreadCount}',
        ),
        backgroundColor: const Color(0xFFB3261E),
        child: box,
      ),
    );
  }
}
