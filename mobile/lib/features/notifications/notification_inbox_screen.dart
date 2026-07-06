import 'package:flutter/material.dart';

import '../../core/notifications/notification_center.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/widgets/app_background.dart';
import '../../shared/widgets/page_header.dart';

/// Uygulama-içi bildirim merkezi (feed). Okundu/okunmadı, tıkla→yönlendir, tümünü okundu işaretle.
class NotificationInboxScreen extends StatefulWidget {
  const NotificationInboxScreen({required this.center, super.key});
  final NotificationCenter center;

  @override
  State<NotificationInboxScreen> createState() => _NotificationInboxScreenState();
}

class _NotificationInboxScreenState extends State<NotificationInboxScreen> {
  @override
  void initState() {
    super.initState();
    widget.center.refresh();
  }

  @override
  Widget build(BuildContext context) {
    return AppBackground(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        body: SafeArea(
          child: AnimatedBuilder(
            animation: widget.center,
            builder: (context, _) {
              final items = widget.center.items;
              return RefreshIndicator(
                onRefresh: widget.center.refresh,
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(18, 22, 18, 110),
                  children: [
                    PageHeader(
                      eyebrow: 'Bildirimler',
                      title: 'Bildirim Merkezi',
                      subtitle: widget.center.unreadCount > 0
                          ? '${widget.center.unreadCount} okunmamış bildirim'
                          : 'Tümü okundu',
                      action: widget.center.unreadCount > 0
                          ? TextButton.icon(
                              onPressed: widget.center.markAllRead,
                              icon: const Icon(Icons.done_all_rounded, size: 18),
                              label: const Text('Tümü'),
                            )
                          : null,
                    ),
                    const SizedBox(height: 14),
                    if (items.isEmpty)
                      const Padding(
                        padding: EdgeInsets.only(top: 80),
                        child: Center(
                          child: Column(
                            children: [
                              Icon(Icons.notifications_off_rounded,
                                  size: 46, color: AppColors.muted),
                              SizedBox(height: 12),
                              Text('Henüz bildirim yok',
                                  style: TextStyle(color: AppColors.muted)),
                            ],
                          ),
                        ),
                      )
                    else
                      ...items.map((n) => _NotificationTile(
                            item: n,
                            onTap: () {
                              widget.center.markRead(n.id);
                              final data = {...?n.data, 'id': n.id, 'type': n.type};
                              widget.center.onNavigate?.call(data);
                            },
                          )),
                  ],
                ),
              );
            },
          ),
        ),
      ),
    );
  }
}

class _NotificationTile extends StatelessWidget {
  const _NotificationTile({required this.item, required this.onTap});
  final AppNotificationItem item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = _severityColor(item.severity);
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Material(
        color: item.isRead ? Colors.white : color.withValues(alpha: .06),
        borderRadius: BorderRadius.circular(18),
        child: InkWell(
          borderRadius: BorderRadius.circular(18),
          onTap: onTap,
          child: Container(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: AppColors.border),
            ),
            padding: const EdgeInsets.all(14),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: color.withValues(alpha: .12),
                    borderRadius: BorderRadius.circular(13),
                  ),
                  child: Icon(_iconForType(item.type), color: color, size: 21),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              item.title,
                              style: TextStyle(
                                fontWeight: item.isRead
                                    ? FontWeight.w600
                                    : FontWeight.w800,
                                fontSize: 14,
                              ),
                            ),
                          ),
                          if (!item.isRead)
                            Container(
                              width: 9,
                              height: 9,
                              decoration: BoxDecoration(
                                color: color,
                                shape: BoxShape.circle,
                              ),
                            ),
                        ],
                      ),
                      if (item.body.isNotEmpty) ...[
                        const SizedBox(height: 3),
                        Text(
                          item.body,
                          style: const TextStyle(
                            color: AppColors.muted,
                            fontSize: 12.5,
                            height: 1.35,
                          ),
                        ),
                      ],
                      const SizedBox(height: 6),
                      Text(
                        _relative(item.createdAtUtc),
                        style: const TextStyle(
                          color: AppColors.muted,
                          fontSize: 11,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  static Color _severityColor(int severity) {
    switch (severity) {
      case 1: // Success
        return const Color(0xFF2E7D5B);
      case 2: // Warning
        return const Color(0xFFB26A00);
      case 3: // Critical
        return const Color(0xFFB3261E);
      default: // Info
        return AppColors.primaryDark;
    }
  }

  static IconData _iconForType(int type) {
    switch (type) {
      case 10:
        return Icons.approval_rounded;
      case 30:
        return Icons.gpp_maybe_rounded;
      case 40:
        return Icons.point_of_sale_rounded;
      case 41:
        return Icons.request_quote_rounded;
      case 50:
        return Icons.bar_chart_rounded;
      case 4:
        return Icons.alarm_rounded;
      case 20:
        return Icons.hourglass_top_rounded;
      case 21:
        return Icons.event_available_rounded;
      case 22:
        return Icons.chat_rounded;
      case 2:
        return Icons.event_busy_rounded;
      case 1:
      case 3:
        return Icons.event_rounded;
      default:
        return Icons.notifications_rounded;
    }
  }

  static String _relative(DateTime utc) {
    final diff = DateTime.now().toUtc().difference(utc);
    if (diff.inMinutes < 1) return 'az önce';
    if (diff.inMinutes < 60) return '${diff.inMinutes} dk önce';
    if (diff.inHours < 24) return '${diff.inHours} sa önce';
    if (diff.inDays < 7) return '${diff.inDays} gün önce';
    final local = utc.toLocal();
    return '${local.day.toString().padLeft(2, '0')}.${local.month.toString().padLeft(2, '0')}.${local.year}';
  }
}

/// Ekran header'larına konan, okunmamış sayaçlı zil. Bildirim merkezine götürür.
class NotificationBell extends StatelessWidget {
  const NotificationBell({required this.center, required this.onOpen, super.key});
  final NotificationCenter center;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: center,
      builder: (context, _) {
        final count = center.unreadCount;
        return IconButton(
          tooltip: 'Bildirimler',
          onPressed: onOpen,
          icon: Badge(
            isLabelVisible: count > 0,
            label: Text(count > 99 ? '99+' : '$count'),
            backgroundColor: const Color(0xFFB3261E),
            child: const Icon(Icons.notifications_rounded),
          ),
        );
      },
    );
  }
}
