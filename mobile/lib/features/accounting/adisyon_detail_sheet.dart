import 'package:flutter/material.dart';

import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/json_helpers.dart';
import '../appointments/calendar_theme.dart';
import 'adisyon_item_sheet.dart';
import 'adisyon_receipt_sheet.dart';

/// Kalem açıklamasındaki "· {N}P" işareti harcanan sadakat puanını taşır (web POINT_MARKER):
/// kalem silinir / adisyon iptal edilirse puan otomatik iade edilir.
final _pointMarker = RegExp(r'·\s(\d+)P$');
int _pointsOf(String description) {
  final m = _pointMarker.firstMatch(description.trim());
  return m == null ? 0 : int.tryParse(m.group(1) ?? '') ?? 0;
}

/// Adisyon detayı — web `AdisyonPanel` paritesi: kalemler (katalogdan ekle/sil),
/// sadakat puanı ile indirim/hediye, hediye çeki-kupon, onayla/iptal/sil.
class AdisyonDetailSheet extends StatefulWidget {
  const AdisyonDetailSheet({
    required this.api,
    required this.adisyonId,
    this.defaultStaffMemberId,
    super.key,
  });
  final ApiClient api;
  final String adisyonId;

  /// Adisyon bir RANDEVUDAN açıldıysa o randevunun personeli — kalem formunda hazır gelir.
  /// Boş bırakıldığında prim tahakkuk etmiyor ve satış "Kurum Yöneticisi"ne yazılıyordu.
  final String? defaultStaffMemberId;

  @override
  State<AdisyonDetailSheet> createState() => _AdisyonDetailSheetState();
}

class _AdisyonDetailSheetState extends State<AdisyonDetailSheet> {
  Map<String, dynamic>? _adisyon;
  bool _changed = false;
  bool _busy = false;

  // Kalem formunun katalogları + sadakat bakiyesi (web AdisyonPanel ile aynı kaynaklar).
  List<Map<String, dynamic>> _services = const [];
  List<Map<String, dynamic>> _products = const [];
  List<Map<String, dynamic>> _packages = const [];
  List<Map<String, dynamic>> _staff = const [];
  int _loyaltyBalance = 0;
  bool _perksOpen = false;

  @override
  void initState() {
    super.initState();
    _load();
    _loadCatalogs();
  }

  Future<void> _load() async {
    try {
      final data = await widget.api.get('/api/admin/adisyonlar/${widget.adisyonId}');
      if (mounted && data is Map) {
        setState(() => _adisyon = data.cast<String, dynamic>());
        await _loadLoyalty();
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }

  Future<void> _loadCatalogs() async {
    const q = {'page': 1, 'pageSize': 200};
    final results = await Future.wait<dynamic>([
      widget.api.get('/api/admin/services/', query: q).catchError((_) => const <dynamic>[]),
      widget.api.get('/api/admin/products/', query: q).catchError((_) => const <dynamic>[]),
      widget.api.get('/api/admin/packages/', query: q).catchError((_) => const <dynamic>[]),
      widget.api.get('/api/admin/staff/', query: q).catchError((_) => const <dynamic>[]),
    ]);
    if (!mounted) return;
    setState(() {
      _services = apiItems(results[0]).where((s) => s['isActive'] != false).toList();
      _products = apiItems(results[1]).where((p) => p['isActive'] != false).toList();
      _packages = apiItems(results[2]).where((p) => p['isActive'] != false).toList();
      _staff = apiItems(results[3]).where((s) => s['isActive'] != false).toList();
    });
  }

  String get _customerId => '${_adisyon?['customerId'] ?? ''}';

  Future<void> _loadLoyalty() async {
    final id = _customerId;
    if (id.isEmpty) return;
    try {
      final data = await widget.api.get('/api/admin/loyalty/$id');
      if (!mounted || data is! Map) return;
      setState(() => _loyaltyBalance =
          (data['balance'] as num?)?.toInt() ?? (data['points'] as num?)?.toInt() ?? 0);
    } catch (_) {
      // Sadakat modülü kapalıysa bölüm 0 puanla görünür.
    }
  }

  /// Sadakat puanı ekle/düş (negatif = harca). Hata yutulmaz; çağıran geri alır.
  Future<void> _adjustLoyalty(int points, String description) =>
      widget.api.post('/api/admin/loyalty/adjust', {
        'customerId': _customerId,
        'points': points,
        'description': description,
      });

  bool get _isOpen => '${_adisyon?['status']}' == 'Open';

  Future<void> _run(Future<void> Function() task, String ok,
      {bool close = false}) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await task();
      _changed = true;
      if (close && mounted) {
        Navigator.pop(context, true);
        return;
      }
      await _load();
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(ok)));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$e')));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _addItem() async {
    // Web paritesi: tür çipleri + katalogdan seçim (refId dolu gider → ürün stoktan düşer,
    // paket satışında seans açılır) + tahsilat yöntemi + adet/fiyat önizlemesi.
    final body = await showAdisyonItemSheet(
      context,
      api: widget.api,
      services: _services,
      products: _products,
      packages: _packages,
      staff: _staff,
      defaultStaffMemberId: widget.defaultStaffMemberId,
    );
    if (body == null) return;
    await _run(
      () => widget.api
          .post('/api/admin/adisyonlar/${widget.adisyonId}/items', body),
      'Kalem eklendi.',
    );
  }

  /// Sadakat puanıyla indirim (1P = 1₺) — web redeemDiscount.
  Future<void> _redeemDiscount() async {
    final a = _adisyon;
    if (a == null) return;
    final charge = numberOf(a, const ['chargeTotal']);
    final payment = numberOf(a, const ['paymentTotal']);
    final maxByDebt = (charge - payment).ceil().clamp(0, 1 << 30);
    final controller = TextEditingController();
    final points = await showDialog<int>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Sadakat puanı ile indirim'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Bakiye $_loyaltyBalance P · 1 puan = 1 ₺ indirim',
                style: const TextStyle(fontSize: 12, color: AppColors.muted)),
            const SizedBox(height: 10),
            TextField(
              controller: controller,
              autofocus: true,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: 'Kullanılacak puan'),
            ),
          ],
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx), child: const Text('Vazgeç')),
          FilledButton(
            onPressed: () =>
                Navigator.pop(ctx, int.tryParse(controller.text.trim()) ?? 0),
            child: const Text('İndirim uygula'),
          ),
        ],
      ),
    );
    if (points == null || points <= 0) return;
    if (points > _loyaltyBalance) {
      _toast('Yetersiz puan — bakiye $_loyaltyBalance P');
      return;
    }
    if (points > maxByDebt) {
      _toast('İndirim kalan borcu aşamaz (en çok $maxByDebt P)');
      return;
    }
    await _run(() async {
      await _adjustLoyalty(-points, 'Adisyon indirimi');
      try {
        await widget.api
            .post('/api/admin/adisyonlar/${widget.adisyonId}/items', {
          'type': 'Discount',
          'refId': null,
          'description': 'Sadakat indirimi · ${points}P',
          'quantity': 1,
          'unitPrice': points,
          'staffMemberId': null,
          'coveredByPackage': false,
        });
      } catch (e) {
        // Kalem yazılamadıysa puan geri yüklenir (web ile aynı telafi).
        await _adjustLoyalty(points, 'İndirim iadesi (hata)').catchError((_) {});
        rethrow;
      }
    }, 'İndirim uygulandı.');
  }

  /// Sadakat puanıyla hediye hizmet/paket — web redeemGift.
  Future<void> _redeemGift() async {
    final giftServices = _services
        .where((s) => numberOf(s, const ['loyaltyPointCost']) > 0)
        .toList()
      ..sort((a, b) => numberOf(a, const ['loyaltyPointCost'])
          .compareTo(numberOf(b, const ['loyaltyPointCost'])));
    final giftPackages = _packages
        .where((p) => numberOf(p, const ['loyaltyPointCost']) > 0)
        .toList()
      ..sort((a, b) => numberOf(a, const ['loyaltyPointCost'])
          .compareTo(numberOf(b, const ['loyaltyPointCost'])));
    if (giftServices.isEmpty && giftPackages.isEmpty) {
      _toast('Hediye edilebilir hizmet/paket yok. Katalogda sadakat puanı belirleyin.');
      return;
    }
    final picked = await showModalBottomSheet<(String, Map<String, dynamic>)>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(18, 14, 18, 6),
              child: Text('Hediye seç',
                  style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            ),
            for (final (kind, list) in [('svc', giftServices), ('pkg', giftPackages)])
              for (final item in list)
                Builder(builder: (_) {
                  final cost = numberOf(item, const ['loyaltyPointCost']).toInt();
                  final enough = cost <= _loyaltyBalance;
                  return ListTile(
                    dense: true,
                    enabled: enough,
                    leading: Icon(
                        kind == 'svc'
                            ? Icons.spa_rounded
                            : Icons.card_giftcard_rounded,
                        size: 18,
                        color: enough ? AppColors.primary : AppColors.muted),
                    title: Text(valueOf(item, const ['name'], fallback: '—'),
                        style: const TextStyle(
                            fontSize: 13.5, fontWeight: FontWeight.w700)),
                    subtitle: Text(
                        '$cost P${enough ? '' : ' · yetersiz'}',
                        style: const TextStyle(
                            fontSize: 11, color: AppColors.muted)),
                    onTap: enough ? () => Navigator.pop(context, (kind, item)) : null,
                  );
                }),
            const SizedBox(height: 12),
          ],
        ),
      ),
    );
    if (picked == null) return;
    final (kind, item) = picked;
    final cost = numberOf(item, const ['loyaltyPointCost']).toInt();
    final name = valueOf(item, const ['name'], fallback: 'Hediye');
    await _run(() async {
      await _adjustLoyalty(-cost, 'Hediye: $name');
      try {
        await widget.api
            .post('/api/admin/adisyonlar/${widget.adisyonId}/items', {
          'type': kind == 'svc' ? 'Service' : 'PackageSale',
          'refId': item['id'],
          'description': 'Hediye: $name · ${cost}P',
          'quantity': 1,
          'unitPrice': 0,
          'staffMemberId': null,
          'coveredByPackage': false,
        });
      } catch (e) {
        await _adjustLoyalty(cost, 'Hediye iadesi (hata)').catchError((_) {});
        rethrow;
      }
    }, 'Hediye eklendi.');
  }

  void _toast(String msg) {
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
    }
  }

  /// Kalem silme — açıklamada "· NP" işareti varsa harcanan puan iade edilir (web removeItemWithRefund).
  Future<void> _removeItem(Map<String, dynamic> item) async {
    final points = _pointsOf('${item['description'] ?? ''}');
    await _run(() async {
      await widget.api.delete(
          '/api/admin/adisyonlar/${widget.adisyonId}/items/${item['id']}');
      if (points > 0) {
        await _adjustLoyalty(points, 'Kalem silindi — puan iadesi')
            .catchError((_) {});
      }
    }, 'Kalem silindi.');
  }

  /// Adisyon iptali — kalemlerde harcanmış tüm sadakat puanı iade edilir (web cancelWithRefund).
  Future<void> _cancelAdisyon() async {
    final refund = (_adisyon?['items'] as List? ?? const []).fold<int>(
        0,
        (sum, it) =>
            sum + (it is Map ? _pointsOf('${it['description'] ?? ''}') : 0));
    await _run(() async {
      await widget.api
          .post('/api/admin/adisyonlar/${widget.adisyonId}/cancel');
      if (refund > 0) {
        await _adjustLoyalty(refund, 'Adisyon iptal — puan iadesi')
            .catchError((_) {});
      }
    }, 'Adisyon iptal edildi.', close: true);
  }

  Future<void> _applyGiftCard() async {
    final controller = TextEditingController();
    final code = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Hediye çeki / kupon uygula'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(labelText: 'Çek kodu'),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Vazgeç')),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, controller.text.trim()),
              child: const Text('Uygula')),
        ],
      ),
    );
    if (code == null || code.isEmpty) return;
    await _run(
      () => widget.api.post(
          '/api/admin/adisyonlar/${widget.adisyonId}/gift-card', {'code': code}),
      'Hediye çeki uygulandı.',
    );
  }

  /// Adisyonu tamamen sil — onaylıda backend cari/kasa/prim/sadakat/stok/seans geri alır (yönetici-only).
  Future<void> _deleteAdisyon() async {
    final approved = '${_adisyon?['status']}' == 'Approved';
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Adisyonu sil'),
        content: Text(approved
            ? 'Bu ONAYLI adisyon silinince: bu satışa ait cari hesap (varsa) silinir, satılan hizmet/paket seansları ve ilgili randevular (planlı/onaylı) geri alınır, prim/sadakat/stok geri alınır. Bu işlem geri alınamaz.'
            : 'Bu adisyon ve kalemleri kalıcı olarak silinecek. Bu işlem geri alınamaz.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Vazgeç')),
          FilledButton(
              style: FilledButton.styleFrom(backgroundColor: Colors.red),
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Sil')),
        ],
      ),
    );
    if (ok != true) return;
    await _tryDelete(force: false);
  }

  /// force=false ilk deneme; kullanılmış seans engeli (AdisyonSessionUsed) gelirse "zorla sil"
  /// onayına yükseltir → force=true (kullanılmış seanslar korunur, kalan tüm bedel iade edilir).
  Future<void> _tryDelete({required bool force}) async {
    if (_busy) return;
    setState(() => _busy = true);
    String? sessionUsedMsg;
    try {
      final path =
          '/api/admin/adisyonlar/${widget.adisyonId}${force ? '?force=true' : ''}';
      await widget.api.delete(path);
      _changed = true;
      if (mounted) Navigator.pop(context, true);
      return;
    } on ApiException catch (e) {
      if (!force && e.code == 'AdisyonSessionUsed') {
        sessionUsedMsg = e.message;
      } else if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.message)));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$e')));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
    // Kullanılmış seans → ekstra "zorla sil" onayı (busy artık kapalı; ikinci diyalog güvenli).
    if (sessionUsedMsg != null && mounted) {
      final force2 = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Kullanılmış seans var — zorla sil'),
          content: Text(
              '$sessionUsedMsg\n\nKullanılmış seanslar korunur; kullanılmamışlar geri alınır; borç, tahsilat, prim, sadakat ve stok tamamen iade edilir. Müşteri kullandığı hizmetlerin bedelini de geri almış olur; cariyi kontrol et. Bu işlem geri alınamaz.'),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('Vazgeç')),
            FilledButton(
                style: FilledButton.styleFrom(backgroundColor: Colors.red),
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text('Yine de zorla sil')),
          ],
        ),
      );
      if (force2 == true) await _tryDelete(force: true);
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
      constraints:
          BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.9),
      child: SafeArea(
        top: false,
        child: a == null
            ? const SizedBox(
                height: 240, child: Center(child: CircularProgressIndicator()))
            : _content(a),
      ),
    );
  }

  Widget _content(Map<String, dynamic> a) {
    final items = (a['items'] as List? ?? const []);
    final charge = (a['chargeTotal'] as num?)?.toDouble() ?? 0;
    final payment = (a['paymentTotal'] as num?)?.toDouble() ?? 0;
    // Web başlığındaki büyük rakam: ödenecek (fazla tahsilatta "fazla tahsilat") + ilerleme.
    final due = (charge - payment).clamp(0, double.infinity);
    final overpaid = (payment - charge).clamp(0, double.infinity);
    final paidPct =
        charge > 0 ? ((payment / charge) * 100).round().clamp(0, 100) : 0;
    return SingleChildScrollView(
      padding: EdgeInsets.fromLTRB(
          20, 12, 20, MediaQuery.viewInsetsOf(context).bottom + 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(valueOf(a, const ['customerName'], fallback: 'Adisyon'),
                    style: Theme.of(context)
                        .textTheme
                        .titleLarge
                        ?.copyWith(fontWeight: FontWeight.w800)),
              ),
              StatusBadgePill(status: '${a['status']}'),
              IconButton(
                onPressed: () => Navigator.pop(context, _changed),
                icon: const Icon(Icons.close_rounded),
              ),
            ],
          ),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Expanded(
                child: Text('${items.length} kalem',
                    style: const TextStyle(
                        fontSize: 12, color: AppColors.muted)),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(overpaid > 0 ? 'Fazla tahsilat' : 'Ödenecek',
                      style: const TextStyle(
                          fontSize: 9.5,
                          letterSpacing: 1.2,
                          fontWeight: FontWeight.w700,
                          color: AppColors.muted)),
                  Text(CalendarText.tl(overpaid > 0 ? overpaid : due),
                      style: TextStyle(
                          fontSize: 24,
                          fontWeight: FontWeight.w800,
                          color: overpaid > 0
                              ? const Color(0xFF2A7A50)
                              : AppColors.ink)),
                ],
              ),
            ],
          ),
          if (charge > 0) ...[
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(20),
                    child: LinearProgressIndicator(
                      value: paidPct / 100,
                      minHeight: 6,
                      backgroundColor: AppColors.surfaceSoft,
                      valueColor: const AlwaysStoppedAnimation(Color(0xFF2A7A50)),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Text('%$paidPct tahsil edildi',
                    style: const TextStyle(
                        fontSize: 10.5,
                        fontWeight: FontWeight.w700,
                        color: AppColors.muted)),
              ],
            ),
          ],
          const SizedBox(height: 10),
          Row(
            children: [
              _tot('Borç', charge, AppColors.ink),
              _tot('Tahsilat', payment, const Color(0xFF2A7A50)),
              _tot('Net', charge - payment, AppColors.primaryDark),
            ],
          ),
          const SizedBox(height: 14),
          const Text('Kalemler', style: TextStyle(fontWeight: FontWeight.w800)),
          const SizedBox(height: 8),
          if (items.isEmpty)
            const Text('Henüz kalem yok.',
                style: TextStyle(color: AppColors.muted)),
          for (final it in items)
            if (it is Map) _itemRow(it.cast<String, dynamic>()),
          const SizedBox(height: 14),
          if (_isOpen) ...[
            _perksCard(),
            const SizedBox(height: 10),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                style: OutlinedButton.styleFrom(
                    minimumSize: const Size.fromHeight(46)),
                onPressed: _busy ? null : _addItem,
                icon: const Icon(Icons.add_rounded, size: 18),
                label: const Text('Kalem ekle'),
              ),
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: FilledButton.icon(
                    onPressed: _busy
                        ? null
                        : () => _run(
                              () => widget.api.post(
                                  '/api/admin/adisyonlar/${widget.adisyonId}/approve'),
                              'Adisyon onaylandı.',
                              close: true,
                            ),
                    icon: const Icon(Icons.check_circle_rounded),
                    label: const Text('Onayla'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(
                      foregroundColor: Colors.red,
                      side: const BorderSide(color: Color(0x55D34D68)),
                      minimumSize: const Size.fromHeight(50),
                    ),
                    onPressed: _busy ? null : _cancelAdisyon,
                    icon: const Icon(Icons.cancel_rounded),
                    label: const Text('İptal et'),
                  ),
                ),
              ],
            ),
          ],
          const SizedBox(height: 10),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              style: OutlinedButton.styleFrom(
                foregroundColor: Colors.red,
                side: const BorderSide(color: Color(0x55D34D68)),
                minimumSize: const Size.fromHeight(48),
              ),
              onPressed: _busy ? null : _deleteAdisyon,
              icon: const Icon(Icons.delete_outline_rounded, size: 18),
              label: Text('${a['status']}' == 'Approved'
                  ? 'Adisyonu sil (geri al)'
                  : 'Adisyonu sil'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _itemRow(Map<String, dynamic> it) {
    final line = (it['lineTotal'] as num?)?.toDouble() ?? 0;
    // Fişteki kalem dili burada da geçerli: türün ikonu + tonu.
    final covered = it['coveredByPackage'] == true;
    final v = adisyonItemVisual(it['type'], coveredByPackage: covered);
    final staff = '${it['staffName'] ?? ''}'.trim();
    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surfaceSoft,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          Container(
            width: 30,
            height: 30,
            decoration: BoxDecoration(
              color: v.bg,
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(v.icon, size: 16, color: v.ink),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(valueOf(it, const ['description'], fallback: '—'),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontWeight: FontWeight.w700)),
                Text(
                  '${v.label} · ${(it['quantity'] as num?) ?? 1} × ${CalendarText.tl((it['unitPrice'] as num?)?.toDouble())}'
                  '${staff.isNotEmpty ? ' · $staff' : ''}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 12, color: AppColors.muted),
                ),
              ],
            ),
          ),
          Text(covered ? 'paketten' : CalendarText.tl(line),
              style: TextStyle(
                fontWeight: FontWeight.w800,
                color: covered ? const Color(0xFFA3701F) : v.ink,
              )),
          if (_isOpen)
            IconButton(
              visualDensity: VisualDensity.compact,
              icon: const Icon(Icons.close_rounded, size: 18, color: Colors.red),
              onPressed: _busy ? null : () => _removeItem(it),
            ),
        ],
      ),
    );
  }

  /// İndirim & hediye bölümü (web "İndirim & hediye" açılır kartı):
  /// sadakat puanı ile indirim, puanla hediye hizmet/paket, hediye çeki/kupon.
  Widget _perksCard() {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        children: [
          InkWell(
            borderRadius: BorderRadius.circular(14),
            onTap: () => setState(() => _perksOpen = !_perksOpen),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
              child: Row(
                children: [
                  const Icon(Icons.card_giftcard_rounded,
                      size: 17, color: AppColors.primary),
                  const SizedBox(width: 8),
                  const Expanded(
                    child: Text('İndirim & hediye',
                        style: TextStyle(
                            fontSize: 13, fontWeight: FontWeight.w700)),
                  ),
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFFF3DC),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Text('$_loyaltyBalance P',
                        style: const TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w800,
                            color: Color(0xFFA3701F))),
                  ),
                  const SizedBox(width: 4),
                  Icon(
                      _perksOpen
                          ? Icons.expand_less_rounded
                          : Icons.expand_more_rounded,
                      size: 20,
                      color: AppColors.muted),
                ],
              ),
            ),
          ),
          if (_perksOpen)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (_loyaltyBalance <= 0)
                    const Text(
                        'Puan yok — her 10₺ onaylı tahsilat 1 puan kazandırır.',
                        style:
                            TextStyle(fontSize: 11.5, color: AppColors.muted))
                  else
                    Row(
                      children: [
                        Expanded(
                          child: OutlinedButton.icon(
                            onPressed: _busy ? null : _redeemDiscount,
                            icon: const Icon(Icons.percent_rounded, size: 16),
                            label: const Text('Puanla indirim'),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: OutlinedButton.icon(
                            onPressed: _busy ? null : _redeemGift,
                            icon: const Icon(Icons.redeem_rounded, size: 16),
                            label: const Text('Hediye et'),
                          ),
                        ),
                      ],
                    ),
                  const SizedBox(height: 8),
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton.icon(
                      onPressed: _busy ? null : _applyGiftCard,
                      icon: const Icon(Icons.confirmation_number_rounded,
                          size: 16),
                      label: const Text('Hediye çeki / kupon uygula'),
                    ),
                  ),
                  const SizedBox(height: 6),
                  const Text(
                      'Kupon indirim kalemi olarak eklenir; adisyon onaylanınca kod kullanılmış sayılır.',
                      style: TextStyle(fontSize: 10.5, color: AppColors.muted)),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _tot(String label, double value, Color color) => Expanded(
        child: Column(
          children: [
            Text(label,
                style: const TextStyle(fontSize: 11, color: AppColors.muted)),
            const SizedBox(height: 2),
            Text(CalendarText.tl(value),
                style: TextStyle(
                    fontWeight: FontWeight.w800, fontSize: 15, color: color)),
          ],
        ),
      );

}

/// Adisyon durumu için küçük rozet.
class StatusBadgePill extends StatelessWidget {
  const StatusBadgePill({required this.status, super.key});
  final String status;

  @override
  Widget build(BuildContext context) {
    final (color, label) = switch (status) {
      'Open' => (const Color(0xFF2F5FA6), 'Açık'),
      'Approved' => (const Color(0xFF2A7A50), 'Onaylı'),
      'Cancelled' => (const Color(0xFFD34D68), 'İptal'),
      _ => (AppColors.muted, status),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: .12),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(label,
          style: TextStyle(
              color: color, fontSize: 12, fontWeight: FontWeight.w700)),
    );
  }
}
