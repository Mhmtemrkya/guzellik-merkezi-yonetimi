import 'package:flutter/material.dart';

import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';

/// KART DÜZELTME — yanlış girilen bilgiyi onarır, kartı yeniden BASMAZ.
///
/// KOD, TÜR ve DEĞER burada yok ve sunucu da kabul etmez: kart basılıp müşterinin eline geçer,
/// üstündeki QR o kodu kalıcı olarak kodlar. Kodu değiştirmek dolaşımdaki kartı tek hamlede
/// öldürür ve müşteri elindeki kâğıdın neden çalışmadığını asla öğrenemez. Yanlış basılmış
/// kartın doğru yolu: pasifleştirip yenisini basmaktır.
///
/// Web'deki `components/dashboard/GiftCardEditModal.tsx` ile aynı kuralları uygular.
Future<bool?> showGiftCardEditSheet(
  BuildContext context, {
  required ApiClient api,
  required Map<String, dynamic> card,
  required List<Map<String, dynamic>> services,
  required List<Map<String, dynamic>> packages,
  required List<Map<String, dynamic>> products,
}) {
  return showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _GiftCardEditSheet(
      api: api,
      card: card,
      services: services,
      packages: packages,
      products: products,
    ),
  );
}

class _GiftCardEditSheet extends StatefulWidget {
  const _GiftCardEditSheet({
    required this.api,
    required this.card,
    required this.services,
    required this.packages,
    required this.products,
  });

  final ApiClient api;
  final Map<String, dynamic> card;
  final List<Map<String, dynamic>> services;
  final List<Map<String, dynamic>> packages;
  final List<Map<String, dynamic>> products;

  @override
  State<_GiftCardEditSheet> createState() => _GiftCardEditSheetState();
}

class _GiftCardEditSheetState extends State<_GiftCardEditSheet> {
  late final TextEditingController _maxUses;
  late final TextEditingController _note;
  late final TextEditingController _scopeLabel;
  late final TextEditingController _recipientName;

  DateTime? _validFrom;
  DateTime? _validUntil;
  late String _targetKind;
  String? _targetId;

  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final c = widget.card;
    // Form kartın MEVCUT hâliyle dolar: bu bir düzeltme ekranıdır, boş bir form değil — boş
    // açılsaydı "dokunmadığın alan silinir" tuzağı kurardı.
    _maxUses = TextEditingController(
      text: (c['maxUses'] is num && (c['maxUses'] as num) > 0) ? '${c['maxUses']}' : '',
    );
    _note = TextEditingController(text: '${c['note'] ?? ''}');
    _scopeLabel = TextEditingController(text: '${c['scopeLabel'] ?? ''}');
    _recipientName = TextEditingController(text: '${c['recipientName'] ?? ''}');
    _validFrom = _parse(c['validFromUtc']);
    _validUntil = _parse(c['validUntilUtc']);

    final packageId = '${c['servicePackageId'] ?? ''}';
    final productId = '${c['productId'] ?? ''}';
    final serviceId = '${c['serviceDefinitionId'] ?? ''}';
    _targetKind = packageId.isNotEmpty ? 'package' : (productId.isNotEmpty ? 'product' : 'service');
    final current = packageId.isNotEmpty ? packageId : (productId.isNotEmpty ? productId : serviceId);
    _targetId = current.isEmpty ? null : current;
  }

  @override
  void dispose() {
    _maxUses.dispose();
    _note.dispose();
    _scopeLabel.dispose();
    _recipientName.dispose();
    super.dispose();
  }

  static DateTime? _parse(Object? value) {
    final text = '${value ?? ''}';
    if (text.isEmpty) return null;
    return DateTime.tryParse(text)?.toLocal();
  }

  List<Map<String, dynamic>> get _list => _targetKind == 'service'
      ? widget.services
      : (_targetKind == 'package' ? widget.packages : widget.products);

  int get _usedCount => (widget.card['usedCount'] is num) ? (widget.card['usedCount'] as num).toInt() : 0;

  Future<void> _pickDate({required bool from}) async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: (from ? _validFrom : _validUntil) ?? now,
      firstDate: DateTime(now.year - 2),
      lastDate: DateTime(now.year + 5),
    );
    if (picked == null) return;
    setState(() {
      if (from) {
        _validFrom = picked;
      } else {
        _validUntil = picked;
      }
    });
  }

  Future<void> _save() async {
    // Ters aralık SESSİZCE TAKAS EDİLMEZ (sunucu da reddeder): operatör yanlışını görmeli.
    if (_validFrom != null && _validUntil != null && _validFrom!.isAfter(_validUntil!)) {
      setState(() => _error = 'Geçerlilik başlangıcı bitişten sonra olamaz.');
      return;
    }
    final uses = _maxUses.text.trim().isEmpty ? 0 : (int.tryParse(_maxUses.text.trim()) ?? 0);
    if (uses > 0 && uses < _usedCount) {
      setState(() => _error = 'Bu kart $_usedCount kez kullanılmış; kullanım hakkı bunun altına indirilemez.');
      return;
    }

    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.api.put('/api/admin/gift-cards/${widget.card['id']}', {
        'validFromUtc': _validFrom == null
            ? null
            : DateTime(_validFrom!.year, _validFrom!.month, _validFrom!.day).toUtc().toIso8601String(),
        'validUntilUtc': _validUntil == null
            ? null
            : DateTime(_validUntil!.year, _validUntil!.month, _validUntil!.day, 23, 59, 59).toUtc().toIso8601String(),
        'maxUses': uses,
        'note': _note.text.trim().isEmpty ? null : _note.text.trim(),
        'scopeLabel': _scopeLabel.text.trim().isEmpty ? null : _scopeLabel.text.trim(),
        'recipientName': _recipientName.text.trim().isEmpty ? null : _recipientName.text.trim(),
        // Müşteri bağı bu ekranda DEĞİŞMEZ: kartı müşteriye bağlama işi QR eşleştirmesinde yapılır.
        'customerId': widget.card['customerId'],
        'serviceDefinitionId': _targetKind == 'service' ? _targetId : null,
        'servicePackageId': _targetKind == 'package' ? _targetId : null,
        'productId': _targetKind == 'product' ? _targetId : null,
      });
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final inset = MediaQuery.of(context).viewInsets.bottom;
    return Padding(
      padding: EdgeInsets.only(bottom: inset),
      child: DraggableScrollableSheet(
        initialChildSize: 0.88,
        minChildSize: 0.5,
        maxChildSize: 0.95,
        expand: false,
        builder: (context, controller) => Container(
          decoration: const BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
          ),
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(18, 14, 10, 10),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('KARTI DÜZELT',
                              style: TextStyle(
                                  fontSize: 10.5, fontWeight: FontWeight.w800, letterSpacing: 1.4, color: AppColors.primary)),
                          const SizedBox(height: 2),
                          Text('${widget.card['code'] ?? ''}',
                              style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w800, color: AppColors.ink)),
                        ],
                      ),
                    ),
                    IconButton(
                      onPressed: () => Navigator.pop(context),
                      icon: const Icon(Icons.close_rounded),
                      tooltip: 'Kapat',
                    ),
                  ],
                ),
              ),
              const Divider(height: 1),
              Expanded(
                child: ListView(
                  controller: controller,
                  padding: const EdgeInsets.fromLTRB(16, 14, 16, 20),
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                      decoration: BoxDecoration(
                        color: AppColors.surfaceSoft,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: AppColors.border),
                      ),
                      child: const Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Icon(Icons.lock_outline_rounded, size: 15, color: AppColors.primary),
                          SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              'Kod, tür ve değer değiştirilemez. Kart basılıp müşteriye verilir; kodu '
                              'değiştirmek elindeki kartı geçersiz kılardı. Yanlış basılmış bir kartı '
                              'pasifleştirip yenisini basın.',
                              style: TextStyle(fontSize: 11.5, height: 1.35, color: AppColors.muted),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 14),
                    Row(
                      children: [
                        Expanded(child: _dateField('Geçerlilik başlangıcı', _validFrom, () => _pickDate(from: true))),
                        const SizedBox(width: 10),
                        Expanded(child: _dateField('Son geçerlilik', _validUntil, () => _pickDate(from: false))),
                      ],
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _maxUses,
                      keyboardType: TextInputType.number,
                      decoration: InputDecoration(
                        labelText: 'Kullanım hakkı (boş = sınırsız)',
                        isDense: true,
                        helperText: 'Bugüne kadar $_usedCount kez kullanılmış — bunun altına indirilemez.',
                        helperMaxLines: 2,
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _recipientName,
                      decoration: const InputDecoration(labelText: 'Kartta yazacak alıcı', isDense: true),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _scopeLabel,
                      decoration: const InputDecoration(labelText: 'Kartta yazacak kapsam', isDense: true),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _note,
                      decoration: const InputDecoration(labelText: 'İç not (yalnız panelde görünür)', isDense: true),
                    ),
                    const SizedBox(height: 16),
                    const Text('Hangi hizmet / paket / ürün için?',
                        style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: AppColors.muted)),
                    const SizedBox(height: 8),
                    SegmentedButton<String>(
                      style: const ButtonStyle(visualDensity: VisualDensity.compact),
                      segments: const [
                        ButtonSegment(value: 'service', label: Text('Hizmet')),
                        ButtonSegment(value: 'package', label: Text('Paket')),
                        ButtonSegment(value: 'product', label: Text('Ürün')),
                      ],
                      selected: {_targetKind},
                      onSelectionChanged: (v) => setState(() {
                        _targetKind = v.first;
                        _targetId = null;
                      }),
                    ),
                    const SizedBox(height: 10),
                    DropdownButtonFormField<String>(
                      initialValue: _list.any((x) => '${x['id']}' == _targetId) ? _targetId : null,
                      isExpanded: true,
                      decoration: const InputDecoration(labelText: 'Katalog kaydı', isDense: true),
                      items: [
                        const DropdownMenuItem<String>(value: null, child: Text('Seçilmedi')),
                        for (final x in _list)
                          DropdownMenuItem(
                            value: '${x['id']}',
                            child: Text('${x['name'] ?? '—'}', overflow: TextOverflow.ellipsis),
                          ),
                      ],
                      onChanged: (v) => setState(() => _targetId = v),
                    ),
                    if (_usedCount > 0) ...[
                      const SizedBox(height: 12),
                      _notice(
                        'Bu kart kullanılmaya başlanmış. Bağlı müşterisi buradan değiştirilemez — '
                        'bakiyesinden harcama yapılmış bir çek başka müşteriye geçerse eski satışın '
                        'iptali yeni sahibin bakiyesini şişirirdi.',
                        AppColors.warning,
                      ),
                    ],
                    if (_error != null) ...[
                      const SizedBox(height: 12),
                      _notice(_error!, AppColors.danger),
                    ],
                  ],
                ),
              ),
              const Divider(height: 1),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 10, 16, 14),
                child: Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: _busy ? null : () => Navigator.pop(context),
                        child: const Text('Vazgeç'),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: FilledButton.icon(
                        onPressed: _busy ? null : _save,
                        icon: _busy
                            ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                            : const Icon(Icons.save_rounded, size: 18),
                        label: const Text('Kaydet'),
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

  Widget _dateField(String label, DateTime? value, VoidCallback onTap) {
    final text = value == null
        ? 'Seçilmedi'
        : '${value.day.toString().padLeft(2, '0')}.${value.month.toString().padLeft(2, '0')}.${value.year}';
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: InputDecorator(
        decoration: InputDecoration(labelText: label, isDense: true),
        child: Text(text, style: const TextStyle(fontSize: 13, color: AppColors.ink)),
      ),
    );
  }

  Widget _notice(String text, Color color) => Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: color.withValues(alpha: .10),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: color.withValues(alpha: .40)),
        ),
        child: Text(text, style: TextStyle(fontSize: 11.5, height: 1.35, fontWeight: FontWeight.w600, color: color)),
      );
}
