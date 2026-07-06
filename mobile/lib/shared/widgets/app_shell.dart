import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/auth/auth_controller.dart';
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
    final isPlatform = auth.user?.isPlatform == true;
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
    return Scaffold(
      body: navigationShell,
      bottomNavigationBar: DecoratedBox(
        decoration: const BoxDecoration(
          color: Colors.white,
          border: Border(top: BorderSide(color: AppColors.border)),
        ),
        child: NavigationBar(
          selectedIndex: navigationShell.currentIndex,
          onDestinationSelected: (index) => navigationShell.goBranch(
            index,
            initialLocation: index == navigationShell.currentIndex,
          ),
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
