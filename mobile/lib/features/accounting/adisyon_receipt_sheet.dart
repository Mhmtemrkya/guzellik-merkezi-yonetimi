import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/json_helpers.dart';
import '../appointments/calendar_theme.dart';

// ---------------------------------------------------------------------------
// ONAYLANMIŞ / İPTAL EDİLMİŞ ADİSYON FİŞİ  (web `AdisyonReceiptModal` paritesi)
// Açık adisyon düzenlenebilir olduğu için AdisyonDetailSheet ile açılır;
// kapanmış adisyon ise değiştirilemez — burada okunur bir "fiş" olarak durur.
// ---------------------------------------------------------------------------

/// Kalem türünün ad karşılığı ('Service', 'PackageUse', …).
/// Sunucu enum'u JSON'a hem ad hem sıra numarası olarak düşebildiği için ikisi de okunur.
String adisyonItemTypeKey(dynamic rawType) {
  const order = [
    'Service',
    'Product',
    'PackageUse',
    'Extra',
    'Payment',
    'Discount',
    'PackageSale',
  ];
  final key = '$rawType';
  final asIndex = int.tryParse(key);
  if (asIndex != null && asIndex >= 0 && asIndex < order.length) {
    return order[asIndex];
  }
  return key;
}

/// Kalem türünün görünümü: etiket + ikon + zemin/mürekkep.
({String label, IconData icon, Color bg, Color ink}) adisyonItemVisual(
  dynamic rawType,
) {
  final key = adisyonItemTypeKey(rawType);
  switch (key) {
    case 'Product':
      return (
        label: 'Ürün',
        icon: Icons.inventory_2_rounded,
        bg: const Color(0xFFF3EDFF),
        ink: const Color(0xFF6B45C0),
      );
    case 'PackageUse':
      return (
        label: 'Paketten',
        icon: Icons.confirmation_number_rounded,
        bg: const Color(0xFFFFF3DC),
        ink: const Color(0xFFA3701F),
      );
    case 'Extra':
      return (
        label: 'Ek kalem',
        icon: Icons.add_circle_outline_rounded,
        bg: const Color(0xFFF1F1F4),
        ink: const Color(0xFF5A5560),
      );
    case 'Payment':
      return (
        label: 'Tahsilat',
        icon: Icons.payments_rounded,
        bg: const Color(0xFFE6F7EE),
        ink: const Color(0xFF2F7D54),
      );
    case 'Discount':
      return (
        label: 'İndirim',
        icon: Icons.percent_rounded,
        bg: const Color(0xFFFFECF1),
        ink: const Color(0xFFC0405F),
      );
    case 'PackageSale':
      return (
        label: 'Paket satışı',
        icon: Icons.workspaces_rounded,
        bg: const Color(0xFFFDE9FB),
        ink: const Color(0xFF9C3E92),
      );
    default:
      return (
        label: 'Hizmet',
        icon: Icons.auto_awesome_rounded,
        bg: const Color(0xFFE7F3FF),
        ink: const Color(0xFF2F6BA6),
      );
  }
}

String _formatDay(dynamic iso) {
  final d = parseUtcToLocal(iso);
  if (d == null) return '—';
  return DateFormat('d MMM yyyy', 'tr_TR').format(d);
}

class AdisyonReceiptSheet extends StatefulWidget {
  const AdisyonReceiptSheet({
    required this.api,
    required this.adisyonId,
    this.onShowCustomer,
    super.key,
  });
  final ApiClient api;
  final String adisyonId;

  /// "Cari hesaplarda gör" — fiş kapanır, çağıran müşteri detayına götürür.
  final VoidCallback? onShowCustomer;

  @override
  State<AdisyonReceiptSheet> createState() => _AdisyonReceiptSheetState();
}

class _AdisyonReceiptSheetState extends State<AdisyonReceiptSheet> {
  Map<String, dynamic>? _adisyon;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final data = await widget.api.get(
        '/api/admin/adisyonlar/${widget.adisyonId}',
      );
      if (!mounted) return;
      setState(() {
        _adisyon = data is Map ? data.cast<String, dynamic>() : null;
        _error = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = '$e');
    }
  }

  @override
  Widget build(BuildContext context) {
    final a = _adisyon;
    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
      ),
      constraints: BoxConstraints(
        maxHeight: MediaQuery.sizeOf(context).height * 0.9,
      ),
      clipBehavior: Clip.antiAlias,
      child: SafeArea(
        top: false,
        child: _error != null
            ? SizedBox(
                height: 220,
                child: Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Text(
                      _error!,
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: AppColors.muted),
                    ),
                  ),
                ),
              )
            : a == null
            ? const SizedBox(
                height: 220,
                child: Center(child: CircularProgressIndicator()),
              )
            : _content(a),
      ),
    );
  }

  Widget _content(Map<String, dynamic> a) {
    final approved = '${a['status']}' == 'Approved';
    final charge = (a['chargeTotal'] as num?)?.toDouble() ?? 0;
    final payment = (a['paymentTotal'] as num?)?.toDouble() ?? 0;
    final net = charge - payment;
    final items = (a['items'] as List? ?? const []);
    final planned = (a['plannedInstallmentCount'] as num?)?.toInt() ?? 0;

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        // ---- Fiş başlığı ----
        Container(
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                Color(0xFFFFF5F8),
                Color(0xFFFFFFFF),
                Color(0xFFFFF1F6),
              ],
            ),
            border: Border(bottom: BorderSide(color: Color(0xFFF2E2E9))),
          ),
          child: Column(
            children: [
              // Altın hairline
              Container(
                height: 3,
                decoration: const BoxDecoration(
                  gradient: LinearGradient(
                    colors: [
                      Color(0x00FFD3DF),
                      Color(0xFFFFD3DF),
                      Color(0xFFD9A441),
                      Color(0xFFFFD3DF),
                      Color(0x00FFD3DF),
                    ],
                    stops: [0, .22, .5, .78, 1],
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(18, 12, 12, 14),
                child: Column(
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Container(
                          width: 40,
                          height: 40,
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(13),
                            border: Border.all(color: const Color(0xFFF0D9E2)),
                          ),
                          child: const Icon(
                            Icons.receipt_long_rounded,
                            color: Color(0xFFC05277),
                            size: 21,
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text(
                                'ADİSYON FİŞİ',
                                style: TextStyle(
                                  fontSize: 10,
                                  letterSpacing: 1.4,
                                  fontWeight: FontWeight.w800,
                                  color: Color(0xFFA3576F),
                                ),
                              ),
                              Text(
                                valueOf(
                                  a,
                                  const ['customerName'],
                                  fallback: 'Müşteri',
                                ),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  fontSize: 17,
                                  fontWeight: FontWeight.w900,
                                ),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                'Açılış ${_formatDay(a['openedAtUtc'])}'
                                '${a['approvedAtUtc'] != null ? ' · Onay ${_formatDay(a['approvedAtUtc'])}' : ''}'
                                ' · ${items.length} kalem',
                                style: const TextStyle(
                                  fontSize: 11,
                                  color: AppColors.muted,
                                ),
                              ),
                            ],
                          ),
                        ),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 4,
                          ),
                          decoration: BoxDecoration(
                            color: approved
                                ? const Color(0xFFDCF5E7)
                                : const Color(0xFFFFE1E6),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Text(
                            approved ? 'ONAYLANDI' : 'İPTAL',
                            style: TextStyle(
                              fontSize: 10,
                              fontWeight: FontWeight.w900,
                              color: approved
                                  ? const Color(0xFF2F7D54)
                                  : const Color(0xFFC0405F),
                            ),
                          ),
                        ),
                        IconButton(
                          onPressed: () => Navigator.pop(context),
                          icon: const Icon(Icons.close_rounded),
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    // Toplamlar
                    Container(
                      decoration: BoxDecoration(
                        color: const Color(0xFFF7E9EE),
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(color: const Color(0xFFF0DAE2)),
                      ),
                      clipBehavior: Clip.antiAlias,
                      child: Row(
                        children: [
                          _total('Borç', charge, const Color(0xFFC0405F)),
                          const SizedBox(width: 1),
                          _total('Tahsilat', payment, const Color(0xFF2F7D54)),
                          const SizedBox(width: 1),
                          _total(
                            net >= 0 ? 'Kalan' : 'Fazla',
                            net.abs(),
                            AppColors.ink,
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),

        // ---- Kalemler ----
        Flexible(
          child: ListView(
            shrinkWrap: true,
            padding: const EdgeInsets.fromLTRB(18, 14, 18, 8),
            children: [
              Container(
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: const Color(0xFFF0E0E6)),
                ),
                clipBehavior: Clip.antiAlias,
                child: items.isEmpty
                    ? const Padding(
                        padding: EdgeInsets.symmetric(vertical: 22),
                        child: Center(
                          child: Text(
                            'Kalem yok.',
                            style: TextStyle(
                              color: AppColors.muted,
                              fontSize: 12,
                            ),
                          ),
                        ),
                      )
                    : Column(
                        children: [
                          for (var i = 0; i < items.length; i++)
                            if (items[i] is Map)
                              _itemRow(
                                (items[i] as Map).cast<String, dynamic>(),
                                first: i == 0,
                              ),
                        ],
                      ),
              ),
              if (approved) ...[
                const SizedBox(height: 10),
                _note(
                  icon: Icons.check_circle_rounded,
                  bg: const Color(0xFFEAF8F0),
                  border: const Color(0xFFBFE6D2),
                  ink: const Color(0xFF2F7D54),
                  text:
                      'Borç cariye, tahsilat kasaya işlendi. Değişiklik için adisyonu '
                      'silip yeniden oluşturmak gerekir.',
                ),
              ],
              if (planned > 0) ...[
                const SizedBox(height: 8),
                _note(
                  icon: Icons.credit_card_rounded,
                  bg: const Color(0xFFFFF1F6),
                  border: const Color(0xFFEFBFD0),
                  ink: const Color(0xFFB14D6C),
                  text:
                      'Taksitli satış: $planned taksit'
                      '${a['plannedFirstDueDate'] != null ? ' · ilk vade ${_formatDay(a['plannedFirstDueDate'])}' : ''}',
                ),
              ],
            ],
          ),
        ),

        // ---- Aksiyon ----
        if (widget.onShowCustomer != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(18, 6, 18, 14),
            child: SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size.fromHeight(48),
                  foregroundColor: const Color(0xFF2F7D54),
                  side: const BorderSide(color: Color(0xFFBFE6D2)),
                  backgroundColor: const Color(0xFFEAF8F0),
                ),
                onPressed: () {
                  Navigator.pop(context);
                  widget.onShowCustomer!();
                },
                icon: const Icon(Icons.person_rounded, size: 18),
                label: const Text('Cari hesaplarda gör'),
              ),
            ),
          ),
      ],
    );
  }

  Widget _total(String label, double value, Color color) => Expanded(
    child: Container(
      color: Colors.white,
      padding: const EdgeInsets.symmetric(vertical: 9),
      child: Column(
        children: [
          Text(
            label.toUpperCase(),
            style: const TextStyle(
              fontSize: 9.5,
              letterSpacing: .8,
              fontWeight: FontWeight.w800,
              color: Color(0xFFA3576F),
            ),
          ),
          const SizedBox(height: 2),
          Text(
            CalendarText.tl(value),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w900,
              color: color,
            ),
          ),
        ],
      ),
    ),
  );

  Widget _itemRow(Map<String, dynamic> it, {required bool first}) {
    final v = adisyonItemVisual(it['type']);
    final covered = it['coveredByPackage'] == true;
    final line = (it['lineTotal'] as num?)?.toDouble() ?? 0;
    final qty = (it['quantity'] as num?)?.toDouble() ?? 1;
    final staff = '${it['staffName'] ?? ''}'.trim();
    final isPayment = v.label == 'Tahsilat';
    final isDiscount = v.label == 'İndirim';

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 9),
      decoration: BoxDecoration(
        color: Colors.white,
        border: first
            ? null
            : const Border(top: BorderSide(color: Color(0xFFF6EBEF))),
      ),
      child: Row(
        children: [
          Container(
            width: 28,
            height: 28,
            decoration: BoxDecoration(
              color: v.bg,
              borderRadius: BorderRadius.circular(9),
            ),
            child: Icon(v.icon, size: 15, color: v.ink),
          ),
          const SizedBox(width: 9),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  valueOf(it, const ['description'], fallback: '—'),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                    fontSize: 12.5,
                  ),
                ),
                Text(
                  '${v.label}'
                  '${qty > 1 ? ' · ${qty.toStringAsFixed(qty == qty.roundToDouble() ? 0 : 1)} adet × ${CalendarText.tl((it['unitPrice'] as num?)?.toDouble())}' : ''}'
                  '${staff.isNotEmpty ? ' · $staff' : ''}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 10.5, color: AppColors.muted),
                ),
              ],
            ),
          ),
          const SizedBox(width: 6),
          Text(
            covered
                ? 'paketten'
                : '${isPayment ? '+' : isDiscount ? '−' : ''}${CalendarText.tl(line)}',
            style: TextStyle(
              fontWeight: FontWeight.w900,
              fontSize: 13,
              color: covered
                  ? const Color(0xFFA3701F)
                  : isPayment
                  ? const Color(0xFF2F7D54)
                  : isDiscount
                  ? const Color(0xFFC0405F)
                  : AppColors.ink,
            ),
          ),
        ],
      ),
    );
  }

  Widget _note({
    required IconData icon,
    required Color bg,
    required Color border,
    required Color ink,
    required String text,
  }) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 9),
    decoration: BoxDecoration(
      color: bg,
      borderRadius: BorderRadius.circular(12),
      border: Border.all(color: border),
    ),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 15, color: ink),
        const SizedBox(width: 7),
        Expanded(
          child: Text(
            text,
            style: TextStyle(fontSize: 11, color: ink, height: 1.35),
          ),
        ),
      ],
    ),
  );
}
