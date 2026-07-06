import 'package:flutter/material.dart';

import '../../core/network/api_client.dart';
import '../../shared/crud/crud_screen.dart';

class CommissionsScreen extends StatelessWidget {
  const CommissionsScreen({required this.api, super.key});
  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return CrudListScreen(
      eyebrow: 'Personel',
      title: 'Primler',
      subtitle: 'Personel komisyonları ve ödeme durumları.',
      icon: Icons.payments_rounded,
      loader: () => api.get('/api/admin/commissions/'),
      titleKeys: const ['staffName', 'staffMemberName'],
      subtitleKeys: const ['source', 'serviceName', 'earnedAtUtc'],
      trailingKeys: const ['amount', 'commissionAmount'],
      statusKeys: const ['isPaid', 'status'],
      rowActions: [
        CrudRowAction(
          label: 'Personelin primlerini öde',
          icon: Icons.check_circle_rounded,
          color: Colors.green,
          visible: (item) => item['isPaid'] != true,
          run: (context, item) async {
            final staffId = item['staffMemberId'] ?? item['staffId'];
            if (staffId == null) return false;
            await api.post('/api/admin/commissions/pay/$staffId');
            if (context.mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Primler ödendi olarak işaretlendi.')),
              );
            }
            return true;
          },
        ),
      ],
    );
  }
}
