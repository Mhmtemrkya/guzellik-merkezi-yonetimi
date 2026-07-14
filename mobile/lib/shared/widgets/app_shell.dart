import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/auth/permissions.dart';
import '../../core/theme/app_theme.dart';

class AppShell extends StatelessWidget {
  const AppShell({
    required this.auth,
    required this.navigationShell,
    super.key,
  });

  final AuthController auth;
  final StatefulNavigationShell navigationShell;

  @override
  Widget build(BuildContext context) {
    final user = auth.user;
    final isPlatform = user?.isPlatform == true;
    final labels = isPlatform
        ? const ['Genel', 'Kurumlar', 'Finans', 'Menü']
        : const ['Genel', 'Müşteriler', 'Randevular', 'Menü'];
    final icons = isPlatform
        ? const [
            Icons.dashboard_rounded,
            Icons.apartment_rounded,
            Icons.insights_rounded,
            Icons.grid_view_rounded,
          ]
        : const [
            Icons.dashboard_rounded,
            Icons.people_alt_rounded,
            Icons.calendar_month_rounded,
            Icons.grid_view_rounded,
          ];

    // Web ROUTE_PERMISSION_GUARDS paritesi: sekme görünür kalır ama personelin
    // sayfa izni yoksa girişe İZİN VERİLMEZ (branch 1=Müşteriler, 2=Randevular).
    bool branchAllowed(int branchIndex) {
      if (isPlatform || user == null || !user.isStaff) return true;
      return switch (branchIndex) {
        1 => user.hasPage(Perm.customers),
        2 => user.hasPage(Perm.appointments),
        _ => true,
      };
    }

    return Scaffold(
      body: navigationShell,
      bottomNavigationBar: DecoratedBox(
        decoration: const BoxDecoration(
          color: Colors.white,
          border: Border(top: BorderSide(color: AppColors.border)),
        ),
        child: NavigationBar(
          selectedIndex: navigationShell.currentIndex,
          onDestinationSelected: (index) {
            if (!branchAllowed(index)) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text(
                    '${labels[index]} sayfası için yetkiniz yok. Kurum yöneticinize başvurun.',
                  ),
                ),
              );
              return;
            }
            navigationShell.goBranch(
              index,
              initialLocation: index == navigationShell.currentIndex,
            );
          },
          destinations: List.generate(
            labels.length,
            (index) => NavigationDestination(
              icon: Icon(icons[index]),
              selectedIcon: Icon(icons[index], color: AppColors.primaryDark),
              label: labels[index],
            ),
          ),
        ),
      ),
    );
  }
}
