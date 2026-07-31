import 'package:flutter/material.dart';

import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/json_helpers.dart';
import '../../shared/widgets/app_background.dart';
import '../../shared/widgets/page_header.dart';
import '../appointments/calendar_theme.dart';

/// Personel primleri — web `CommissionPanel` paritesi.
///
/// Eskiden yalnız düz bir prim kaydı listesiydi; kimin ne kadar bekleyen primi olduğu
/// görünmüyordu. Artık üstte kazanılan/bekleyen/ödenen KPI'ları, altında PERSONEL BAZLI
/// kırılım ve satır içi "Prim öde" aksiyonu var. En altta ham hareket listesi durur.
class CommissionsScreen extends StatefulWidget {
  const CommissionsScreen({required this.api, super.key});
  final ApiClient api;

  @override
  State<CommissionsScreen> createState() => _CommissionsScreenState();
}

class _CommissionsScreenState extends State<CommissionsScreen> {
  late Future<_CommissionData> _future;
  String? _paying;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<_CommissionData> _load() async {
    final results = await Future.wait([
      widget.api.get('/api/admin/commissions/summary').catchError((_) => const <String, dynamic>{}),
      widget.api.get('/api/admin/commissions/').catchError((_) => const <dynamic>[]),
    ]);
    return _CommissionData(
      summary: results[0] is Map ? (results[0] as Map).cast<String, dynamic>() : const {},
      rows: apiItems(results[1]),
    );
  }

  void _reload() => setState(() => _future = _load());

  Future<void> _pay(String staffMemberId) async {
    setState(() => _paying = staffMemberId);
    try {
      await widget.api.post('/api/admin/commissions/pay/$staffMemberId', const {});
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Primler ödendi olarak işaretlendi.')));
      }
      _reload();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    } finally {
      if (mounted) setState(() => _paying = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppBackground(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        body: SafeArea(
          child: RefreshIndicator(
            onRefresh: () async {
              _reload();
              await _future;
            },
            child: FutureBuilder<_CommissionData>(
              future: _future,
              builder: (context, snapshot) {
                if (!snapshot.hasData && !snapshot.hasError) {
                  return const Center(child: CircularProgressIndicator());
                }
                final data = snapshot.data ?? const _CommissionData(summary: {}, rows: []);
                return _body(data);
              },
            ),
          ),
        ),
      ),
    );
  }

  Widget _body(_CommissionData data) {
    final earned = numberOf(data.summary, const ['earnedTotal']);
    final unpaid = numberOf(data.summary, const ['unpaidTotal']);
    final paid = numberOf(data.summary, const ['paidTotal']);
    // byStaff yoksa (eski sunucu) ham kayıtlardan türet — ekran boş kalmasın.
    final byStaff = _byStaff(data);

    return ListView(
      padding: const EdgeInsets.fromLTRB(18, 22, 18, 24),
      children: [
        const PageHeader(
          eyebrow: 'Personel',
          title: 'Primler',
          subtitle: 'Kazanılan ve bekleyen komisyonlar; personel bazında ödeme yapılır.',
        ),
        const SizedBox(height: 14),

        // KPI şeridi
        Row(
          children: [
            _kpi('Kazanılan', earned, AppColors.ink),
            const SizedBox(width: 8),
            _kpi('Bekleyen', unpaid, AppColors.warning),
            const SizedBox(width: 8),
            _kpi('Ödenen', paid, AppColors.success),
          ],
        ),
        const SizedBox(height: 16),

        const Text('Personel bazında',
            style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
        const SizedBox(height: 8),
        if (byStaff.isEmpty)
          Container(
            padding: const EdgeInsets.symmetric(vertical: 22, horizontal: 14),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: AppColors.border, style: BorderStyle.solid),
              color: AppColors.surface,
            ),
            child: const Text(
              'Henüz prim yok. Adisyon onaylandığında personele atanmış kalemler buraya düşer.',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 12.5, color: AppColors.muted),
            ),
          )
        else
          for (final s in byStaff) _staffRow(s),

        const SizedBox(height: 18),
        const Text('Prim hareketleri',
            style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
        const SizedBox(height: 8),
        if (data.rows.isEmpty)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 18),
            child: Center(
              child: Text('Kayıt yok.', style: TextStyle(color: AppColors.muted)),
            ),
          )
        else
          for (final r in data.rows.take(50)) _movementRow(r),
      ],
    );
  }

  Widget _kpi(String label, double value, Color tone) => Expanded(
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 10),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: AppColors.border),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(CalendarText.tl(value),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                      fontWeight: FontWeight.w900, fontSize: 15, color: tone)),
              const SizedBox(height: 2),
              Text(label,
                  style: const TextStyle(fontSize: 10.5, color: AppColors.muted)),
            ],
          ),
        ),
      );

  Widget _staffRow(_StaffCommission s) {
    final busy = _paying == s.staffMemberId;
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(s.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                const SizedBox(height: 2),
                Text('${s.count} kalem · ödenen ${CalendarText.tl(s.paid)}',
                    style: const TextStyle(fontSize: 11, color: AppColors.muted)),
              ],
            ),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(CalendarText.tl(s.unpaid),
                  style: TextStyle(
                      fontWeight: FontWeight.w900,
                      fontSize: 13.5,
                      color: s.unpaid > 0 ? AppColors.warning : AppColors.muted)),
              const Text('bekleyen',
                  style: TextStyle(fontSize: 9.5, color: AppColors.muted)),
            ],
          ),
          const SizedBox(width: 8),
          SizedBox(
            height: 32,
            child: FilledButton.icon(
              style: FilledButton.styleFrom(
                backgroundColor: AppColors.success,
                padding: const EdgeInsets.symmetric(horizontal: 10),
                visualDensity: VisualDensity.compact,
              ),
              onPressed: (busy || s.unpaid <= 0 || s.staffMemberId.isEmpty)
                  ? null
                  : () => _pay(s.staffMemberId),
              icon: busy
                  ? const SizedBox(
                      width: 12,
                      height: 12,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : const Icon(Icons.account_balance_wallet_rounded, size: 14),
              label: const Text('Öde', style: TextStyle(fontSize: 11)),
            ),
          ),
        ],
      ),
    );
  }

  Widget _movementRow(Map<String, dynamic> r) {
    final paid = r['isPaid'] == true;
    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(valueOf(r, const ['staffName', 'staffMemberName'], fallback: 'Personel'),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600)),
                Text(valueOf(r, const ['source', 'serviceName'], fallback: ''),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 11, color: AppColors.muted)),
              ],
            ),
          ),
          Text(CalendarText.tl(numberOf(r, const ['amount', 'commissionAmount'])),
              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5)),
          const SizedBox(width: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
            decoration: BoxDecoration(
              color: (paid ? AppColors.success : AppColors.warning).withValues(alpha: .12),
              borderRadius: BorderRadius.circular(999),
            ),
            child: Text(paid ? 'Ödendi' : 'Bekliyor',
                style: TextStyle(
                    fontSize: 9.5,
                    fontWeight: FontWeight.w800,
                    color: paid ? AppColors.success : AppColors.warning)),
          ),
        ],
      ),
    );
  }

  /// Özet uçtaki byStaff; yoksa ham prim kayıtlarından personel bazında toplanır.
  List<_StaffCommission> _byStaff(_CommissionData data) {
    final raw = data.summary['byStaff'];
    if (raw is List && raw.isNotEmpty) {
      return raw
          .whereType<Map>()
          .map((e) => e.cast<String, dynamic>())
          .map((e) => _StaffCommission(
                staffMemberId: '${e['staffMemberId'] ?? ''}',
                name: valueOf(e, const ['staffName'], fallback: 'Personel'),
                count: numberOf(e, const ['count']).toInt(),
                paid: numberOf(e, const ['paidTotal']),
                unpaid: numberOf(e, const ['unpaidTotal']),
              ))
          .where((s) => s.count > 0)
          .toList();
    }

    final map = <String, _StaffCommission>{};
    for (final r in data.rows) {
      final id = '${r['staffMemberId'] ?? r['staffId'] ?? ''}';
      final name = valueOf(r, const ['staffName', 'staffMemberName'], fallback: 'Personel');
      final amount = numberOf(r, const ['amount', 'commissionAmount']);
      final isPaid = r['isPaid'] == true;
      final cur = map[id] ?? _StaffCommission(staffMemberId: id, name: name);
      map[id] = cur.copyWith(
        count: cur.count + 1,
        paid: cur.paid + (isPaid ? amount : 0),
        unpaid: cur.unpaid + (isPaid ? 0 : amount),
      );
    }
    return map.values.toList()..sort((a, b) => b.unpaid.compareTo(a.unpaid));
  }
}

class _CommissionData {
  const _CommissionData({required this.summary, required this.rows});
  final Map<String, dynamic> summary;
  final List<Map<String, dynamic>> rows;
}

class _StaffCommission {
  const _StaffCommission({
    required this.staffMemberId,
    required this.name,
    this.count = 0,
    this.paid = 0,
    this.unpaid = 0,
  });
  final String staffMemberId;
  final String name;
  final int count;
  final double paid;
  final double unpaid;

  _StaffCommission copyWith({int? count, double? paid, double? unpaid}) => _StaffCommission(
        staffMemberId: staffMemberId,
        name: name,
        count: count ?? this.count,
        paid: paid ?? this.paid,
        unpaid: unpaid ?? this.unpaid,
      );
}
