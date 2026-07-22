import 'package:flutter/material.dart';

import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/crud/crud_options.dart';
import '../../shared/crud/crud_screen.dart';
import '../../shared/json_helpers.dart';
import '../appointments/calendar_theme.dart';

const _itemTypes = [
  CrudOption('Service', 'Hizmet'),
  CrudOption('Product', 'Ürün'),
  CrudOption('Extra', 'Ekstra'),
  CrudOption('Payment', 'Tahsilat'),
  CrudOption('Discount', 'İndirim'),
];

/// Adisyon detayı — kalemler (ekle/sil), hediye çeki, onayla/iptal.
class AdisyonDetailSheet extends StatefulWidget {
  const AdisyonDetailSheet({
    required this.api,
    required this.adisyonId,
    super.key,
  });
  final ApiClient api;
  final String adisyonId;

  @override
  State<AdisyonDetailSheet> createState() => _AdisyonDetailSheetState();
}

class _AdisyonDetailSheetState extends State<AdisyonDetailSheet> {
  Map<String, dynamic>? _adisyon;
  bool _changed = false;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final data = await widget.api.get('/api/admin/adisyonlar/${widget.adisyonId}');
      if (mounted && data is Map) {
        setState(() => _adisyon = data.cast<String, dynamic>());
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }

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
    final result = await showModalBottomSheet<CrudSheetResult>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => CrudFormSheet(
        title: 'Kalem ekle',
        icon: Icons.add_shopping_cart_rounded,
        fields: [
          const CrudField(
            key: 'type',
            label: 'Tür',
            type: CrudFieldType.select,
            options: _itemTypes,
            defaultValue: 'Service',
          ),
          const CrudField(key: 'description', label: 'Açıklama', required: true),
          const CrudField(
            key: 'quantity',
            label: 'Adet',
            type: CrudFieldType.decimal,
            defaultValue: 1,
          ),
          const CrudField(
            key: 'unitPrice',
            label: 'Birim fiyat',
            type: CrudFieldType.decimal,
            required: true,
          ),
          CrudField(
            key: 'staffMemberId',
            label: 'Personel (opsiyonel)',
            type: CrudFieldType.select,
            optionsLoader: CrudOptions(widget.api).staff,
          ),
        ],
      ),
    );
    if (result?.body == null) return;
    final b = result!.body!;
    await _run(
      () => widget.api.post('/api/admin/adisyonlar/${widget.adisyonId}/items', {
        'type': b['type'],
        'refId': null,
        'description': b['description'],
        'quantity': b['quantity'] ?? 1,
        'unitPrice': b['unitPrice'] ?? 0,
        'staffMemberId': b['staffMemberId'],
        'coveredByPackage': false,
      }),
      'Kalem eklendi.',
    );
  }

  Future<void> _applyGiftCard() async {
    final controller = TextEditingController();
    final code = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Hediye çeki uygula'),
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
          const SizedBox(height: 8),
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
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                OutlinedButton.icon(
                  onPressed: _busy ? null : _addItem,
                  icon: const Icon(Icons.add_rounded, size: 18),
                  label: const Text('Kalem ekle'),
                ),
                OutlinedButton.icon(
                  onPressed: _busy ? null : _applyGiftCard,
                  icon: const Icon(Icons.card_giftcard_rounded, size: 18),
                  label: const Text('Hediye çeki'),
                ),
              ],
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
                    onPressed: _busy
                        ? null
                        : () => _run(
                              () => widget.api.post(
                                  '/api/admin/adisyonlar/${widget.adisyonId}/cancel'),
                              'Adisyon iptal edildi.',
                              close: true,
                            ),
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
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(valueOf(it, const ['description'], fallback: '—'),
                    style: const TextStyle(fontWeight: FontWeight.w700)),
                Text(
                  '${_typeLabel('${it['type']}')} · ${(it['quantity'] as num?) ?? 1} × ${CalendarText.tl((it['unitPrice'] as num?)?.toDouble())}',
                  style: const TextStyle(fontSize: 12, color: AppColors.muted),
                ),
              ],
            ),
          ),
          Text(CalendarText.tl(line),
              style: const TextStyle(fontWeight: FontWeight.w800)),
          if (_isOpen)
            IconButton(
              visualDensity: VisualDensity.compact,
              icon: const Icon(Icons.close_rounded, size: 18, color: Colors.red),
              onPressed: _busy
                  ? null
                  : () => _run(
                        () => widget.api.delete(
                            '/api/admin/adisyonlar/${widget.adisyonId}/items/${it['id']}'),
                        'Kalem silindi.',
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

  String _typeLabel(String key) => _itemTypes
      .firstWhere((c) => c.value == key, orElse: () => CrudOption(key, key))
      .label;
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
