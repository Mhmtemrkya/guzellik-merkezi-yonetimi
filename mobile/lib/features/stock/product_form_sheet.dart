import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';

import '../../core/theme/app_theme.dart';
import '../../core/theme/responsive.dart';
import '../../shared/photo_utils.dart';
import '../../shared/widgets/barcode_scanner_sheet.dart';
import '../appointments/calendar_theme.dart';

/// Ürün kategorileri — backend `ProductCategory` enum'u (web `productCategoryLabels` ile birebir).
const productCategories = <(String, String)>[
  ('SkinCare', 'Cilt Bakım'),
  ('Consumable', 'Sarf Malzeme'),
  ('Sale', 'Satış Ürünü'),
  ('HairCare', 'Saç Bakım'),
  ('Makeup', 'Makyaj'),
  ('NailCare', 'Tırnak Bakım'),
  ('Other', 'Diğer'),
];

/// Web ProductFormDialog'daki birim listesi.
const _units = ['adet', 'kutu', 'paket', 'set', 'gr', 'ml'];

String productCategoryLabel(String? key) => productCategories
    .firstWhere((c) => c.$1 == key, orElse: () => productCategories.last)
    .$2;

/// Ürün ekle/düzenle formu — web `ProductFormDialog` paritesi.
///
/// Web'deki iki sütunlu düzen (canlı önizleme + form) burada da korunur: tablette
/// yan yana, telefonda önizleme üstte. Görsel, barkod okutma, birim listesi ve
/// kâr marjı göstergesi web ile aynıdır.
Future<Map<String, dynamic>?> showProductFormSheet(
  BuildContext context, {
  Map<String, dynamic>? product,
}) {
  return showModalBottomSheet<Map<String, dynamic>>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _ProductFormSheet(product: product),
  );
}

class _ProductFormSheet extends StatefulWidget {
  const _ProductFormSheet({this.product});
  final Map<String, dynamic>? product;

  @override
  State<_ProductFormSheet> createState() => _ProductFormSheetState();
}

class _ProductFormSheetState extends State<_ProductFormSheet> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _name;
  late final TextEditingController _barcode;
  late final TextEditingController _brand;
  late final TextEditingController _location;
  late final TextEditingController _lot;
  late final TextEditingController _cost;
  late final TextEditingController _salePrice;
  late final TextEditingController _minStock;

  String _category = 'SkinCare';
  String _unit = 'adet';
  String _imageUrl = '';
  DateTime? _expiry;
  bool _isActive = true;
  bool _saving = false;

  bool get _isEdit => widget.product != null;

  @override
  void initState() {
    super.initState();
    final p = widget.product;
    String s(String key) {
      final v = '${p?[key] ?? ''}';
      return v == 'null' ? '' : v;
    }

    _name = TextEditingController(text: s('name'));
    _barcode = TextEditingController(text: s('barcode'));
    _brand = TextEditingController(text: s('brand'));
    _location = TextEditingController(text: s('location'));
    _lot = TextEditingController(text: s('lotNumber'));
    _cost = TextEditingController(text: _numText(p?['cost']));
    _salePrice = TextEditingController(text: _numText(p?['salePrice']));
    _minStock = TextEditingController(text: _numText(p?['minStockLevel']));
    _imageUrl = s('imageUrl');
    final rawCategory = s('category');
    _category = productCategories.any((c) => c.$1 == rawCategory)
        ? rawCategory
        : 'SkinCare';
    final rawUnit = s('unit').toLowerCase();
    _unit = _units.contains(rawUnit) ? rawUnit : 'adet';
    _expiry = DateTime.tryParse(s('expiryDate'));
    _isActive = p?['isActive'] != false;
  }

  static String _numText(dynamic raw) {
    final n = (raw as num?)?.toDouble();
    if (n == null) return '';
    return n == n.roundToDouble() ? '${n.toInt()}' : '$n';
  }

  @override
  void dispose() {
    for (final c in [
      _name,
      _barcode,
      _brand,
      _location,
      _lot,
      _cost,
      _salePrice,
      _minStock,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  double _d(TextEditingController c) =>
      double.tryParse(c.text.trim().replaceAll(',', '.')) ?? 0;

  Future<void> _pickImage() async {
    final result =
        await pickPhotoDataUrl(context, allowRemove: _imageUrl.isNotEmpty);
    if (result == null) return;
    setState(() => _imageUrl = result);
  }

  Future<void> _scan() async {
    final code = await showBarcodeScannerSheet(context);
    if (!mounted || code == null || code.isEmpty) return;
    setState(() => _barcode.text = code);
  }

  Future<void> _pickExpiry() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _expiry ?? now,
      firstDate: DateTime(now.year - 5),
      lastDate: DateTime(now.year + 15),
    );
    if (picked != null) setState(() => _expiry = picked);
  }

  void _submit() {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _saving = true);
    final body = <String, dynamic>{
      'name': _name.text.trim(),
      'category': _category,
      'unit': _unit,
      'brand': _brand.text.trim().isEmpty ? null : _brand.text.trim(),
      'location': _location.text.trim().isEmpty ? null : _location.text.trim(),
      'lotNumber': _lot.text.trim().isEmpty ? null : _lot.text.trim(),
      'barcode': _barcode.text.trim().isEmpty ? null : _barcode.text.trim(),
      'imageUrl': _imageUrl.isEmpty ? null : _imageUrl,
      'expiryDate':
          _expiry == null ? null : DateFormat('yyyy-MM-dd').format(_expiry!),
      'cost': _d(_cost),
      'salePrice': _d(_salePrice),
      'minStockLevel': _d(_minStock),
      'isActive': _isActive,
    };
    Navigator.pop(context, body);
  }

  @override
  Widget build(BuildContext context) {
    final wide = context.isWide;
    final preview = _preview();
    final form = _form();
    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
      ),
      constraints:
          BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.94),
      child: SafeArea(
        top: false,
        // Gövde kaydırılabilir, başlık ve alt butonlar sabit kalır (kırpılma olmasın).
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            _header(),
            Flexible(
              child: SingleChildScrollView(
                padding: EdgeInsets.fromLTRB(
                    18, 4, 18, MediaQuery.viewInsetsOf(context).bottom + 12),
                child: Form(
                  key: _formKey,
                  child: wide
                      ? Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            SizedBox(width: 300, child: preview),
                            const SizedBox(width: 18),
                            Expanded(child: form),
                          ],
                        )
                      : Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            preview,
                            const SizedBox(height: 16),
                            form,
                          ],
                        ),
                ),
              ),
            ),
            _footer(),
          ],
        ),
      ),
    );
  }

  Widget _header() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(18, 14, 12, 10),
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: AppColors.surfaceSoft,
              shape: BoxShape.circle,
              border: Border.all(color: AppColors.primary.withValues(alpha: .4)),
            ),
            child: const Icon(Icons.add_box_rounded,
                color: AppColors.primaryDark, size: 22),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('ÜRÜN · ${_isEdit ? 'DÜZENLE' : 'YENİ TANIM'}',
                    style: const TextStyle(
                      fontSize: 9.5,
                      letterSpacing: 1.6,
                      fontWeight: FontWeight.w800,
                      color: AppColors.muted,
                    )),
                const SizedBox(height: 2),
                Text(_isEdit ? 'Ürünü Düzenle' : 'Yeni Ürün Tanımla',
                    style: const TextStyle(
                        fontSize: 19, fontWeight: FontWeight.w800)),
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
    );
  }

  /// Web'deki krem önizleme sütununun karşılığı — girilen değerler anında yansır.
  Widget _preview() {
    final cost = _d(_cost);
    final sale = _d(_salePrice);
    final margin = sale > 0 ? ((sale - cost) / sale * 100).round() : 0;
    final image = imageProviderOf(_imageUrl);
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surfaceSoft.withValues(alpha: .55),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('ÖNİZLEME',
              style: TextStyle(
                fontSize: 9,
                letterSpacing: 1.6,
                fontWeight: FontWeight.w800,
                color: AppColors.primaryDark,
              )),
          const SizedBox(height: 10),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              GestureDetector(
                onTap: _pickImage,
                child: Container(
                  width: 76,
                  height: 76,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: AppColors.border),
                    image: image == null
                        ? null
                        : DecorationImage(image: image, fit: BoxFit.cover),
                  ),
                  child: image == null
                      ? const Icon(Icons.add_a_photo_rounded,
                          color: AppColors.primary, size: 22)
                      : null,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 7, vertical: 2),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(6),
                            border: Border.all(color: AppColors.border),
                          ),
                          child: Text(productCategoryLabel(_category),
                              style: const TextStyle(
                                  fontSize: 9.5,
                                  fontWeight: FontWeight.w700,
                                  color: AppColors.primaryDark)),
                        ),
                        const SizedBox(width: 6),
                        Text(_isActive ? 'Satışta' : 'Pasif',
                            style: TextStyle(
                                fontSize: 9.5,
                                fontWeight: FontWeight.w700,
                                color: _isActive
                                    ? AppColors.success
                                    : AppColors.muted)),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Text(
                        _name.text.trim().isEmpty
                            ? 'Ürün adı'
                            : _name.text.trim(),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            fontSize: 15, fontWeight: FontWeight.w800)),
                    const SizedBox(height: 2),
                    Text(
                        _barcode.text.trim().isEmpty
                            ? 'Barkod otomatik üretilecek'
                            : _barcode.text.trim(),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            fontSize: 10, color: AppColors.muted)),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Text(CalendarText.tl(sale),
              style: const TextStyle(
                  fontSize: 21,
                  fontWeight: FontWeight.w800,
                  color: AppColors.primaryDark)),
          Text('Maliyet ${CalendarText.tl(cost)} · %$margin kâr',
              style: const TextStyle(fontSize: 10.5, color: AppColors.muted)),
        ],
      ),
    );
  }

  Widget _form() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _section('TANIM'),
        TextFormField(
          controller: _name,
          textCapitalization: TextCapitalization.sentences,
          decoration: const InputDecoration(
            labelText: 'Ürün adı *',
            hintText: 'Örn. Yenileyici Gece Serumu',
          ),
          onChanged: (_) => setState(() {}),
          validator: (v) =>
              (v ?? '').trim().isEmpty ? 'Ürün adı zorunludur.' : null,
        ),
        const SizedBox(height: 12),
        TextFormField(
          controller: _barcode,
          decoration: InputDecoration(
            labelText: 'Barkod',
            helperText: 'Boş bırakılırsa otomatik üretilir.',
            suffixIcon: IconButton(
              tooltip: 'Barkod okut',
              onPressed: _scan,
              icon: const Icon(Icons.qr_code_scanner_rounded),
            ),
          ),
          onChanged: (_) => setState(() {}),
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: DropdownButtonFormField<String>(
                initialValue: _category,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Kategori'),
                items: [
                  for (final (value, label) in productCategories)
                    DropdownMenuItem(value: value, child: Text(label)),
                ],
                onChanged: (v) => setState(() => _category = v ?? _category),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: DropdownButtonFormField<String>(
                initialValue: _unit,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Birim'),
                items: [
                  for (final u in _units)
                    DropdownMenuItem(value: u, child: Text(u)),
                ],
                onChanged: (v) => setState(() => _unit = v ?? _unit),
              ),
            ),
          ],
        ),
        const SizedBox(height: 18),
        _section('DİĞER BİLGİLER'),
        Row(
          children: [
            Expanded(
              child: TextFormField(
                controller: _brand,
                decoration: const InputDecoration(
                    labelText: 'Marka', hintText: 'opsiyonel'),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: TextFormField(
                controller: _location,
                decoration: const InputDecoration(
                    labelText: 'Raf / Dolap', hintText: 'örn. A1-Raf3'),
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: TextFormField(
                controller: _lot,
                decoration: const InputDecoration(labelText: 'Lot numarası'),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: InkWell(
                onTap: _pickExpiry,
                borderRadius: BorderRadius.circular(12),
                child: InputDecorator(
                  decoration: InputDecoration(
                    labelText: 'Son kullanma',
                    suffixIcon: _expiry == null
                        ? const Icon(Icons.calendar_today_rounded, size: 18)
                        : IconButton(
                            tooltip: 'Temizle',
                            icon: const Icon(Icons.close_rounded, size: 18),
                            onPressed: () => setState(() => _expiry = null),
                          ),
                  ),
                  child: Text(
                    _expiry == null
                        ? 'Seçilmedi'
                        : DateFormat('d MMM yyyy', 'tr_TR').format(_expiry!),
                    style: TextStyle(
                        fontSize: 14,
                        color:
                            _expiry == null ? AppColors.muted : AppColors.ink),
                  ),
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 18),
        _section('FİYAT & STOK'),
        Row(
          children: [
            Expanded(child: _moneyField(_cost, 'Maliyet')),
            const SizedBox(width: 10),
            Expanded(child: _moneyField(_salePrice, 'Satış fiyatı')),
          ],
        ),
        const SizedBox(height: 12),
        TextFormField(
          controller: _minStock,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]'))],
          decoration: InputDecoration(
            labelText: 'Minimum stok',
            helperText: _isEdit
                ? null
                : 'Ürün stoğu, kaydettikten sonra "Stok girişi" hareketiyle oluşur.',
            helperMaxLines: 2,
          ),
        ),
        const SizedBox(height: 12),
        SwitchListTile.adaptive(
          value: _isActive,
          onChanged: (v) => setState(() => _isActive = v),
          contentPadding: EdgeInsets.zero,
          title: const Text('Aktif (satışta)',
              style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700)),
          subtitle: const Text(
              'Pasif ürünler satış/adisyon listesinde görünmez.',
              style: TextStyle(fontSize: 11.5, color: AppColors.muted)),
        ),
      ],
    );
  }

  Widget _moneyField(TextEditingController c, String label) => TextFormField(
        controller: c,
        keyboardType: const TextInputType.numberWithOptions(decimal: true),
        inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]'))],
        decoration: InputDecoration(labelText: label, prefixText: '₺ '),
        onChanged: (_) => setState(() {}),
      );

  Widget _section(String title) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: Row(
          children: [
            Text(title,
                style: const TextStyle(
                  fontSize: 9.5,
                  letterSpacing: 1.6,
                  fontWeight: FontWeight.w800,
                  color: AppColors.primaryDark,
                )),
            const SizedBox(width: 8),
            Expanded(
                child: Container(height: 1, color: AppColors.border)),
          ],
        ),
      );

  Widget _footer() {
    return Container(
      padding: const EdgeInsets.fromLTRB(18, 10, 18, 12),
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: AppColors.border)),
      ),
      child: Row(
        children: [
          Expanded(
            child: OutlinedButton(
              onPressed: _saving ? null : () => Navigator.pop(context),
              child: const Text('Vazgeç'),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            flex: 2,
            child: FilledButton.icon(
              onPressed: _saving ? null : _submit,
              icon: _saving
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: Colors.white))
                  : const Icon(Icons.check_rounded, size: 18),
              label: Text(_isEdit ? 'Güncelle' : 'Ürün oluştur'),
            ),
          ),
        ],
      ),
    );
  }
}
