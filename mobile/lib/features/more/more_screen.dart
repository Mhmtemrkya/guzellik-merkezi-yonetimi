import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/responsive.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/auth/permissions.dart';
import '../../core/notifications/notification_center.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/widgets/app_background.dart';
import '../../shared/widgets/page_header.dart';

class MoreScreen extends StatefulWidget {
  const MoreScreen({required this.auth, required this.notifications, super.key});
  final AuthController auth;
  final NotificationCenter notifications;

  @override
  State<MoreScreen> createState() => _MoreScreenState();
}

class _MoreScreenState extends State<MoreScreen> {
  String _query = '';

  /// Web sidebar'ındaki gruplama: modüller yola göre bölümlere ayrılır.
  static String _groupOf(String path) {
    const business = {
      '/services',
      '/packages',
      '/sales',
      '/branches',
      '/gift-cards',
      '/waitlist',
      '/consultation',
      '/treatment-journal',
      '/sessions',
      '/stock',
      '/stock-movements',
      '/campaigns',
    };
    const finance = {
      '/cash',
      '/cash-closing',
      '/accounting',
      '/expenses',
      '/expense-categories',
      '/commissions',
      '/reports',
    };
    const management = {
      '/staff',
      '/time-off',
      '/approvals',
      '/logs',
      '/settings',
      '/whatsapp',
      '/whatsapp-messages',
      '/notifications',
      '/notification-logs',
      '/plans',
      '/features',
      '/usage',
    };
    if (business.contains(path)) return 'İşletme';
    if (finance.contains(path)) return 'Finans';
    if (management.contains(path)) return 'Yönetim';
    return 'Genel';
  }

  @override
  Widget build(BuildContext context) {
    final auth = widget.auth;
    final notifications = widget.notifications;
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
    final allowed = modules
        .where(
          (module) =>
              module.permission == null ||
              !user.isStaff ||
              user.hasPage(module.permission!),
        )
        .toList();
    // Arama: başlıkta geçenler kalır (Türkçe küçük harf).
    final needle = _query.trim().toLowerCase();
    final visible = needle.isEmpty
        ? allowed
        : allowed.where((m) => m.title.toLowerCase().contains(needle)).toList();
    // Gruplara ayır — web sidebar'ındaki bölüm başlıkları + sayaçlar.
    final grouped = <String, List<_Module>>{};
    for (final m in visible) {
      grouped.putIfAbsent(_groupOf(m.path), () => []).add(m);
    }
    const groupOrder = ['Genel', 'İşletme', 'Finans', 'Yönetim'];
    final groups = [
      for (final g in groupOrder)
        if (grouped[g]?.isNotEmpty == true) (g, grouped[g]!),
    ];
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
              // Kullanıcı bloğu — web sidebar'ının alt bloğuyla aynı dil.
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: const Color(0xFFF2E0E7)),
                ),
                child: Row(
                  children: [
                    Container(
                      width: 46,
                      height: 46,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        gradient: const LinearGradient(
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                          colors: [Color(0xFFFFE3EC), Color(0xFFFFD0E0)],
                        ),
                        borderRadius: BorderRadius.circular(15),
                      ),
                      child: Text(
                        user.initials,
                        style: const TextStyle(
                          color: Color(0xFF7B3D55),
                          fontWeight: FontWeight.w900,
                          fontSize: 15,
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
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          const SizedBox(height: 3),
                          Text(
                            user.email,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
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
                      icon: const Icon(
                        Icons.logout_rounded,
                        color: Color(0xFFA3707F),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 14),
              // Sayfa arama — web sidebar'ındaki "/" kutusunun karşılığı.
              TextField(
                decoration: InputDecoration(
                  prefixIcon: const Icon(Icons.search_rounded, size: 19),
                  hintText: 'Sayfa ara',
                  isDense: true,
                  suffixIcon: _query.isEmpty
                      ? null
                      : IconButton(
                          icon: const Icon(Icons.close_rounded, size: 18),
                          onPressed: () => setState(() => _query = ''),
                        ),
                ),
                onChanged: (v) => setState(() => _query = v),
              ),
              if (_query.trim().isNotEmpty) ...[
                const SizedBox(height: 8),
                Text(
                  visible.isEmpty
                      ? '“$_query” için sayfa bulunamadı.'
                      : '${visible.length} sayfa eşleşti',
                  style: const TextStyle(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w700,
                    color: AppColors.muted,
                  ),
                ),
              ],
              const SizedBox(height: 14),
              for (final (title, items) in groups) ...[
                Row(
                  children: [
                    Container(
                      width: 12,
                      height: 1.5,
                      color: const Color(0xFFEFBFD0),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      title,
                      style: const TextStyle(
                        fontSize: 11.5,
                        fontWeight: FontWeight.w800,
                        color: Color(0xFF8A6A79),
                        letterSpacing: .3,
                      ),
                    ),
                    const SizedBox(width: 7),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 6,
                        vertical: 2,
                      ),
                      decoration: BoxDecoration(
                        color: AppColors.surfaceSoft,
                        borderRadius: BorderRadius.circular(999),
                      ),
                      child: Text(
                        '${items.length}',
                        style: const TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.w800,
                          color: Color(0xFFB1798E),
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                GridView.builder(
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  itemCount: items.length,
                  gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: gridCols(context, 2),
                    crossAxisSpacing: 11,
                    mainAxisSpacing: 11,
                    mainAxisExtent: 132,
                  ),
                  itemBuilder: (context, index) {
                    final module = items[index];
                    return Material(
                      color: AppColors.surface,
                      borderRadius: BorderRadius.circular(20),
                      child: InkWell(
                        borderRadius: BorderRadius.circular(20),
                        onTap: () => context.push(module.path),
                        child: Container(
                          padding: const EdgeInsets.all(14),
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(20),
                            border: Border.all(color: AppColors.border),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              _ModuleIcon(
                                module: module,
                                notifications: notifications,
                              ),
                              const Spacer(),
                              Text(
                                module.title,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  fontWeight: FontWeight.w800,
                                  fontSize: 13,
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
                const SizedBox(height: 18),
              ],
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
    // Gradyan ikon çipi — web sidebar'ındaki aktif satır ikonuyla aynı dil.
    final box = Container(
      width: 42,
      height: 42,
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFFFFF1F6), Color(0xFFFFE0EB)],
        ),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFF6E3EA)),
      ),
      child: Icon(module.icon, color: const Color(0xFFC85776), size: 21),
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
