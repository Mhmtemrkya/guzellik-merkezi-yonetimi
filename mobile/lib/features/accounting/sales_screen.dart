import 'package:flutter/material.dart';

import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/widgets/app_background.dart';
import '../../shared/widgets/page_header.dart';
import 'package_sale_sheet.dart';

/// Satış sayfası — web'deki paket/hizmet "Sat" akışlarının menüden erişilen
/// mobil karşılığı. Müşteri seçilir, paket ya da hizmet satışı adisyona düşer;
/// kurum yöneticisi onaylayınca cariye (+paketse seans bakiyesine) işlenir.
class SalesScreen extends StatelessWidget {
  const SalesScreen({required this.api, super.key});
  final ApiClient api;

  Future<void> _openSale(BuildContext context, {required bool serviceSale}) async {
    final sold = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => PackageSaleSheet(api: api, serviceSale: serviceSale),
    );
    if (sold == true && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text(
              'Satış adisyona eklendi. Yönetici onaylayınca cariye işlenir.')));
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppBackground(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        body: SafeArea(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(18, 22, 18, 24),
            children: [
              const PageHeader(
                eyebrow: 'İşletme',
                title: 'Satış',
                subtitle:
                    'Paket veya hizmet satışı yap; satış adisyona eklenir, onayda cariye ve seans bakiyesine işlenir.',
              ),
              const SizedBox(height: 16),
              _SaleCard(
                icon: Icons.workspaces_rounded,
                title: 'Paket Satışı',
                subtitle:
                    'Seans paketi sat — onayda müşteriye seans bakiyesi, cariye borç/taksit planı yazılır.',
                onTap: () => _openSale(context, serviceSale: false),
              ),
              const SizedBox(height: 12),
              _SaleCard(
                icon: Icons.spa_rounded,
                title: 'Hizmet Satışı',
                subtitle:
                    'Tekil hizmet sat — adet ve fiyat belirlenir, onayda cariye işlenir.',
                onTap: () => _openSale(context, serviceSale: true),
              ),
              const SizedBox(height: 18),
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: .75),
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: AppColors.border),
                ),
                child: const Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(Icons.info_outline_rounded,
                        size: 18, color: AppColors.muted),
                    SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        'Peşin ya da taksitli plan seçebilirsin; peşinat girilirse tahsilat kalemi olarak eklenir. '
                        'Satışlar müşteri kartındaki Adisyon & İşlemler sekmesinden takip edilir.',
                        style: TextStyle(fontSize: 12.5, color: AppColors.muted),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SaleCard extends StatelessWidget {
  const _SaleCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Container(
                width: 52,
                height: 52,
                decoration: BoxDecoration(
                  color: AppColors.surfaceSoft,
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Icon(icon, color: AppColors.primaryDark, size: 26),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title,
                        style: const TextStyle(
                            fontWeight: FontWeight.w800, fontSize: 15)),
                    const SizedBox(height: 4),
                    Text(subtitle,
                        style: const TextStyle(
                            fontSize: 12, color: AppColors.muted)),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right_rounded, color: AppColors.muted),
            ],
          ),
        ),
      ),
    );
  }
}
