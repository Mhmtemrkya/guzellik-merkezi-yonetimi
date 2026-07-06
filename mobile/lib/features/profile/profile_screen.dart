import 'package:flutter/material.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/json_helpers.dart';
import '../../shared/widgets/app_background.dart';
import '../../shared/widgets/page_header.dart';

/// Rol anahtarının Türkçe karşılığı (web login rol kartlarıyla aynı adlar).
const _roleLabels = <String, String>{
  'PlatformAdmin': 'Platform Admin',
  'InstitutionOwner': 'Kurum Yöneticisi',
  'BranchManager': 'Şube Yöneticisi',
  'Staff': 'Personel',
  'Customer': 'Müşteri',
};

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({required this.auth, required this.api, super.key});
  final AuthController auth;
  final ApiClient api;

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  String? _tenantName;
  String? _branchName;

  @override
  void initState() {
    super.initState();
    _loadNames();
  }

  /// Kurum/şube ID yerine adlarını getirir (ID kullanıcıya gösterilmez).
  Future<void> _loadNames() async {
    final user = widget.auth.user;
    if (user == null || user.isPlatform) return;
    try {
      final results = await Future.wait<dynamic>([
        widget.api.get('/api/admin/tenant/').catchError((_) => null),
        user.branchId == null
            ? Future<dynamic>.value(null)
            : widget.api.get('/api/admin/branches/').catchError((_) => null),
      ]);
      final tenant = results[0] is Map
          ? (results[0] as Map).cast<String, dynamic>()
          : null;
      String? branchName;
      if (results[1] != null) {
        final branches = apiItems(results[1]);
        for (final b in branches) {
          if ('${b['id']}' == user.branchId) {
            branchName = valueOf(b, const ['name']);
            break;
          }
        }
      }
      if (mounted) {
        setState(() {
          _tenantName = tenant?['name']?.toString();
          _branchName = branchName;
        });
      }
    } catch (_) {
      /* ad çözülemezse mevcut yedek metinler gösterilir */
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = widget.auth.user!;
    final roleLabel = _roleLabels[user.role] ?? user.role;
    final tenantLabel = user.isPlatform
        ? 'Platform'
        : (_tenantName ?? (user.tenantId == null ? 'Platform' : 'Yükleniyor...'));
    final branchLabel = user.branchId == null
        ? 'Tüm şubeler'
        : (_branchName ?? 'Yükleniyor...');
    return AppBackground(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        body: SafeArea(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(18, 22, 18, 80),
            children: [
              const PageHeader(
                eyebrow: 'Kişisel',
                title: 'Profilim',
                subtitle: 'Hesap, rol, şube ve yetki bilgileri.',
              ),
              const SizedBox(height: 20),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    children: [
                      CircleAvatar(
                        radius: 38,
                        backgroundColor: AppColors.rose,
                        child: Text(
                          user.initials,
                          style: const TextStyle(
                            color: AppColors.primaryDark,
                            fontSize: 22,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ),
                      const SizedBox(height: 14),
                      Text(
                        user.fullName,
                        style: const TextStyle(
                          fontWeight: FontWeight.w900,
                          fontSize: 18,
                        ),
                      ),
                      Text(
                        user.email,
                        style: const TextStyle(color: AppColors.muted),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 12),
              _InfoTile(
                icon: Icons.badge_rounded,
                title: 'Rol',
                value: roleLabel,
              ),
              _InfoTile(
                icon: Icons.apartment_rounded,
                title: 'Kurum',
                value: tenantLabel,
              ),
              _InfoTile(
                icon: Icons.location_on_rounded,
                title: 'Şube',
                value: branchLabel,
              ),
              _InfoTile(
                icon: Icons.security_rounded,
                title: 'Yetkiler',
                value: '${user.permissions.length} yetki',
              ),
              const SizedBox(height: 18),
              FilledButton.icon(
                onPressed: widget.auth.signOut,
                icon: const Icon(Icons.logout_rounded),
                label: const Text('Güvenli çıkış yap'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _InfoTile extends StatelessWidget {
  const _InfoTile({
    required this.icon,
    required this.title,
    required this.value,
  });
  final IconData icon;
  final String title;
  final String value;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 10),
    child: Card(
      child: ListTile(
        leading: Icon(icon, color: AppColors.primaryDark),
        title: Text(title),
        subtitle: Text(value),
      ),
    ),
  );
}
