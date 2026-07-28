import 'package:flutter/material.dart';

import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import 'consent_center_sheet.dart';
import 'consent_models.dart';

/// "Onam formu eksik" uyarısı (web `ConsentWarningBanner` paritesi).
///
/// Sessizdir: hiç form tanımlı değilse ya da eksik yoksa hiçbir şey çizmez
/// ([showWhenComplete] verilmedikçe). Dokununca onam merkezi açılır.
class ConsentWarningBanner extends StatefulWidget {
  const ConsentWarningBanner({
    required this.api,
    required this.customerId,
    this.customerName,
    this.appointmentId,
    this.showWhenComplete = false,
    this.margin = const EdgeInsets.only(bottom: 10),
    super.key,
  });

  final ApiClient api;
  final String customerId;
  final String? customerName;
  final String? appointmentId;
  final bool showWhenComplete;
  final EdgeInsets margin;

  @override
  State<ConsentWarningBanner> createState() => _ConsentWarningBannerState();
}

class _ConsentWarningBannerState extends State<ConsentWarningBanner> {
  ConsentStatus? _status;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (widget.customerId.trim().isEmpty) return;
    try {
      final path = widget.appointmentId != null
          ? '/api/consent/appointments/${widget.appointmentId}/status'
          : '/api/consent/customers/${widget.customerId}/status';
      final res = await widget.api.get(path);
      if (!mounted) return;
      setState(() => _status = res is Map ? ConsentStatus(res.cast<String, dynamic>()) : null);
    } catch (_) {
      // Onam özelliği kapalı ya da uç erişilemez — uyarı hiç gösterilmez.
      if (mounted) setState(() => _status = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final status = _status;
    if (status == null || status.requiredCount == 0) return const SizedBox.shrink();
    final missing = status.missing;
    final complete = missing.isEmpty;
    if (complete && !widget.showWhenComplete) return const SizedBox.shrink();

    final color = complete ? AppColors.success : AppColors.warning;
    return Padding(
      padding: widget.margin,
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: () async {
          await ConsentCenterSheet.open(
            context,
            api: widget.api,
            customerId: widget.customerId,
            customerName: widget.customerName,
            appointmentId: widget.appointmentId,
          );
          await _load();
        },
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: color.withValues(alpha: .10),
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: color.withValues(alpha: .35)),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(complete ? Icons.verified_rounded : Icons.shield_outlined, size: 18, color: color),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      complete ? 'Onam formları tamam' : '${missing.length} onam formu imzasız',
                      style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      complete
                          ? '${status.signedCount}/${status.requiredCount} form imzalı.'
                          : '${missing.map((m) => m.title).join(' · ')} — görüntülemek için dokunun.',
                      style: const TextStyle(fontSize: 11.5, color: AppColors.muted, height: 1.35),
                    ),
                  ],
                ),
              ),
              if (!complete) const Icon(Icons.chevron_right_rounded, color: AppColors.muted),
            ],
          ),
        ),
      ),
    );
  }
}
