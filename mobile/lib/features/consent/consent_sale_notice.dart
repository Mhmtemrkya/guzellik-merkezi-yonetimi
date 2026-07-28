import 'package:flutter/material.dart';

import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/json_helpers.dart';

/// Satış ekranlarında "bu kalemin onam formu var" bilgisi (web `ConsentSaleNotice` paritesi).
///
/// Satışı ENGELLEMEZ — imza, işlem/randevu tamamlanırken istenir. Amaç personelin baştan
/// haberdar olması: müşteri hâlâ salondayken imzalatmak sonradan peşine düşmekten kolaydır.
/// Bağlı form yoksa hiçbir şey çizmez.
class ConsentSaleNotice extends StatefulWidget {
  const ConsentSaleNotice({
    required this.api,
    this.packageId,
    this.serviceId,
    super.key,
  });

  final ApiClient api;
  final String? packageId;
  final String? serviceId;

  @override
  State<ConsentSaleNotice> createState() => _ConsentSaleNoticeState();
}

class _ConsentSaleNoticeState extends State<ConsentSaleNotice> {
  List<String> _titles = const [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(ConsentSaleNotice old) {
    super.didUpdateWidget(old);
    if (old.packageId != widget.packageId || old.serviceId != widget.serviceId) _load();
  }

  Future<void> _load() async {
    final pkg = (widget.packageId ?? '').trim();
    final svc = (widget.serviceId ?? '').trim();
    if (pkg.isEmpty && svc.isEmpty) {
      if (mounted) setState(() => _titles = const []);
      return;
    }
    try {
      final list = apiItems(await widget.api.get('/api/admin/consent-templates/'));
      if (!mounted) return;
      final matched = list.where((t) {
        if (t['isActive'] == false) return false;
        final pkgIds = (t['packageIds'] as List?)?.map((e) => '$e') ?? const <String>[];
        final svcIds = (t['serviceIds'] as List?)?.map((e) => '$e') ?? const <String>[];
        return (pkg.isNotEmpty && pkgIds.contains(pkg)) || (svc.isNotEmpty && svcIds.contains(svc));
      }).map((t) => '${t['title'] ?? 'Onam formu'}').toList();
      setState(() => _titles = matched);
    } catch (_) {
      if (mounted) setState(() => _titles = const []);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_titles.isEmpty) return const SizedBox.shrink();
    return Container(
      margin: const EdgeInsets.only(top: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.warning.withValues(alpha: .10),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.warning.withValues(alpha: .35)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.assignment_turned_in_rounded, size: 18, color: AppColors.warning),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Bu satışta ${_titles.length} onam formu isteniyor',
                    style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800)),
                const SizedBox(height: 3),
                Text(
                  '${_titles.join(' · ')} — müşteri salondayken imzalatmanız önerilir. '
                  'İmzalanmadan işlem tamamlanmaya çalışılırsa uyarı çıkar.',
                  style: const TextStyle(fontSize: 11.5, color: AppColors.muted, height: 1.35),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
