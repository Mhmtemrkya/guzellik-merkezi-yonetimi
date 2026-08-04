import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/json_helpers.dart';
import '../../shared/widgets/catalog_picker_field.dart';
import '../appointments/calendar_theme.dart';
import '../stock/product_form_sheet.dart' show productCategoryLabel;
import 'adisyon_receipt_sheet.dart';

/// Adisyon kalem türleri — web `AdisyonPanel` TYPE_LABELS ile birebir.
const adisyonItemTypes = <String>[
  'Service',
  'Product',
  'PackageUse',
  'Extra',
  'Payment',
  'Discount',
  'PackageSale',
];

/// Tahsilat kaleminin ödeme yöntemi (web PAYMENT_METHODS + methodMap).
const _methods = <(String, String)>[
  ('cash', 'Nakit'),
  ('card', 'Kart'),
  ('transfer', 'Havale/EFT'),
];

/// Adisyona kalem ekleme sayfası — web `AdisyonPanel`'in "Kalem ekle" bölümünün paritesi.
///
/// Katalogdan seçim ŞART: eskiden mobilde açıklama/fiyat elle yazılıyor ve `refId: null`
/// gönderiliyordu; bu yüzden ürün satışında stok düşmüyor, paket satışında seans açılmıyordu.
/// Burada hizmet/ürün/paket gerçek kayıttan seçilir, fiyat katalogdan dolar.
Future<Map<String, dynamic>?> showAdisyonItemSheet(
  BuildContext context, {
  required ApiClient api,
  required List<Map<String, dynamic>> services,
  required List<Map<String, dynamic>> products,
  required List<Map<String, dynamic>> packages,
  required List<Map<String, dynamic>> staff,
  String? defaultStaffMemberId,
}) {
  return showModalBottomSheet<Map<String, dynamic>>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _AdisyonItemSheet(
      services: services,
      products: products,
      packages: packages,
      staff: staff,
      defaultStaffMemberId: defaultStaffMemberId,
    ),
  );
}

class _AdisyonItemSheet extends StatefulWidget {
  const _AdisyonItemSheet({
    required this.services,
    required this.products,
    required this.packages,
    required this.staff,
    this.defaultStaffMemberId,
  });

  final List<Map<String, dynamic>> services;
  final List<Map<String, dynamic>> products;
  final List<Map<String, dynamic>> packages;
  final List<Map<String, dynamic>> staff;
  final String? defaultStaffMemberId;

  @override
  State<_AdisyonItemSheet> createState() => _AdisyonItemSheetState();
}

class _AdisyonItemSheetState extends State<_AdisyonItemSheet> {
  String _type = 'Service';
  String? _refId;
  String _method = 'cash';
  String? _staffId;
  final _description = TextEditingController();
  final _quantity = TextEditingController(text: '1');
  final _unitPrice = TextEditingController();
  String? _error;

  bool get _isPayment => _type == 'Payment';
  bool get _isDiscount => _type == 'Discount';
  bool get _isPackageUse => _type == 'PackageUse';
  bool get _needsCatalog =>
      _type == 'Service' ||
      _type == 'Product' ||
      _type == 'PackageUse' ||
      _type == 'PackageSale';

  @override
  void initState() {
    super.initState();
    _staffId = widget.defaultStaffMemberId;
  }

  @override
  void dispose() {
    _description.dispose();
    _quantity.dispose();
    _unitPrice.dispose();
    super.dispose();
  }

  List<Map<String, dynamic>> get _catalog => switch (_type) {
        // Üründe kategori backend enum'u ('SkinCare'…); seçicideki kategori çipinde
        // ham anahtar yerine Türkçe etiket görünsün diye kopya üzerinde çevrilir.
        'Product' => [
            for (final p in widget.products)
              {...p, 'category': productCategoryLabel('${p['category']}')},
          ],
        'PackageSale' => widget.packages,
        _ => widget.services,
      };

  Map<String, dynamic>? get _selected {
    if (_refId == null) return null;
    for (final item in _catalog) {
      if ('${item['id']}' == _refId) return item;
    }
    return null;
  }

  /// Katalogdan gelen birim fiyat (web selectedRefPrice).
  double get _catalogPrice {
    final item = _selected;
    if (item == null) return 0;
    return switch (_type) {
      'Product' => numberOf(item, const ['salePrice']),
      'PackageSale' => numberOf(item, const ['totalPrice', 'price']),
      _ => numberOf(item, const ['price']),
    };
  }

  double get _typedPrice =>
      double.tryParse(_unitPrice.text.trim().replaceAll(',', '.')) ?? 0;

  double get _effectiveUnit =>
      _isPackageUse ? 0 : (_typedPrice > 0 ? _typedPrice : _catalogPrice);

  int get _previewQty {
    if (_isPayment || _isDiscount) return 1;
    return (int.tryParse(_quantity.text.trim()) ?? 1).clamp(1, 9999);
  }

  double get _previewTotal => _effectiveUnit * _previewQty;

  void _selectType(String type) {
    setState(() {
      _type = type;
      _refId = null;
      _error = null;
      _description.clear();
      _unitPrice.clear();
      _quantity.text = '1';
    });
  }

  void _submit() {
    var description = _description.text.trim();
    var unitPrice = _effectiveUnit;
    String? refId = _refId;
    final item = _selected;

    // Web addItem() kuralları: katalogdan seçilince açıklama/fiyat otomatik dolar.
    switch (_type) {
      case 'Service':
        if (item != null && description.isEmpty) {
          description = valueOf(item, const ['name'], fallback: 'Hizmet');
        }
      case 'Product':
        if (item != null && description.isEmpty) {
          description = valueOf(item, const ['name'], fallback: 'Ürün');
        }
      case 'PackageUse':
        if (item != null && description.isEmpty) {
          description = '${valueOf(item, const ['name'], fallback: 'Hizmet')} (paketten)';
        }
        unitPrice = 0;
      case 'PackageSale':
        if (item != null && description.isEmpty) {
          description = 'Paket satışı: ${valueOf(item, const ['name'], fallback: 'Paket')}';
        }
      case 'Payment':
        refId = null;
        if (description.isEmpty) {
          final label = _methods.firstWhere((m) => m.$1 == _method).$2;
          description = 'Tahsilat · $label';
        }
      case 'Discount':
        refId = null;
        if (description.isEmpty) description = 'İndirim';
    }

    if (description.isEmpty) {
      setState(() => _error = 'Açıklama gerekli');
      return;
    }
    if (_type == 'PackageSale' && (refId == null || refId.isEmpty)) {
      setState(() => _error = 'Paket seçimi gerekli');
      return;
    }
    if ((_isPayment || _isDiscount || _type == 'Extra') && unitPrice <= 0) {
      setState(() => _error = 'Tutar pozitif olmalı');
      return;
    }

    Navigator.pop(context, <String, dynamic>{
      'type': _type,
      'refId': refId,
      'description': description,
      'quantity': _isPayment || _isDiscount ? 1 : _previewQty,
      'unitPrice': unitPrice,
      'staffMemberId': _staffId,
      'coveredByPackage': _isPackageUse,
      'method': _isPayment ? _method : null,
    });
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
      ),
      constraints:
          BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.92),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 14, 8, 6),
              child: Row(
                children: [
                  const Expanded(
                    child: Text('Kalem ekle',
                        style: TextStyle(
                            fontSize: 17, fontWeight: FontWeight.w800)),
                  ),
                  IconButton(
                    onPressed: () => Navigator.pop(context),
                    icon: const Icon(Icons.close_rounded),
                  ),
                ],
              ),
            ),
            Flexible(
              child: SingleChildScrollView(
                padding: EdgeInsets.fromLTRB(
                    18, 0, 18, MediaQuery.viewInsetsOf(context).bottom + 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _typeChips(),
                    const SizedBox(height: 14),
                    if (_needsCatalog) _catalogField(),
                    if (_type == 'Extra' || _isDiscount || _isPayment)
                      TextField(
                        controller: _description,
                        decoration: InputDecoration(
                          labelText: 'Açıklama',
                          hintText: _isPayment
                              ? 'Tahsilat açıklaması (opsiyonel)'
                              : 'Açıklama',
                        ),
                      ),
                    if (_isPayment) ...[
                      const SizedBox(height: 12),
                      DropdownButtonFormField<String>(
                        initialValue: _method,
                        decoration:
                            const InputDecoration(labelText: 'Ödeme yöntemi'),
                        items: [
                          for (final (value, label) in _methods)
                            DropdownMenuItem(value: value, child: Text(label)),
                        ],
                        onChanged: (v) => setState(() => _method = v ?? _method),
                      ),
                    ],
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        if (!_isPackageUse)
                          Expanded(
                            child: TextField(
                              controller: _unitPrice,
                              keyboardType: const TextInputType.numberWithOptions(
                                  decimal: true),
                              inputFormatters: [
                                FilteringTextInputFormatter.allow(
                                    RegExp(r'[0-9.,]'))
                              ],
                              onChanged: (_) => setState(() {}),
                              decoration: InputDecoration(
                                labelText: _isPayment || _isDiscount
                                    ? 'Tutar'
                                    : 'Birim fiyat',
                                prefixText: '₺ ',
                                hintText: _catalogPrice > 0
                                    ? 'Katalog: ${CalendarText.tl(_catalogPrice)}'
                                    : '0',
                              ),
                            ),
                          ),
                        if (!_isPackageUse && !_isPayment && !_isDiscount)
                          const SizedBox(width: 10),
                        if (!_isPayment && !_isDiscount)
                          Expanded(
                            child: TextField(
                              controller: _quantity,
                              keyboardType: TextInputType.number,
                              inputFormatters: [
                                FilteringTextInputFormatter.digitsOnly
                              ],
                              onChanged: (_) => setState(() {}),
                              decoration: const InputDecoration(labelText: 'Adet'),
                            ),
                          ),
                      ],
                    ),
                    if (!_isPayment && !_isDiscount) ...[
                      const SizedBox(height: 12),
                      DropdownButtonFormField<String>(
                        initialValue: _staffId,
                        isExpanded: true,
                        decoration: InputDecoration(
                          // Ürün/paket satışında SATAN, hizmet/paket kullanımında UYGULAYAN kişi.
                          labelText: _type == 'Product' || _type == 'PackageSale'
                              ? 'Satış yapan'
                              : 'İşlem yapan',
                          helperText: _staffId == null
                              ? 'Boş bırakılırsa prim hesaplanmaz, kayıt Kurum Yöneticisi adına geçer.'
                              : null,
                          helperMaxLines: 2,
                        ),
                        items: [
                          const DropdownMenuItem<String>(
                              value: null, child: Text('Seçilmedi')),
                          for (final s in widget.staff)
                            DropdownMenuItem(
                              value: '${s['id']}',
                              child: Text(
                                  valueOf(s, const ['fullName', 'name'],
                                      fallback: 'Personel'),
                                  overflow: TextOverflow.ellipsis),
                            ),
                        ],
                        onChanged: (v) => setState(() => _staffId = v),
                      ),
                    ],
                    if (_error != null) ...[
                      const SizedBox(height: 12),
                      Text(_error!,
                          style: const TextStyle(
                              color: AppColors.danger,
                              fontSize: 12,
                              fontWeight: FontWeight.w700)),
                    ],
                  ],
                ),
              ),
            ),
            Container(
              padding: const EdgeInsets.fromLTRB(18, 10, 18, 12),
              decoration: const BoxDecoration(
                border: Border(top: BorderSide(color: AppColors.border)),
              ),
              child: FilledButton.icon(
                style: FilledButton.styleFrom(
                    minimumSize: const Size.fromHeight(48)),
                onPressed: _submit,
                icon: const Icon(Icons.add_rounded, size: 18),
                label: Text(_previewTotal > 0 && !_isPackageUse
                    ? 'Kalem ekle · ${_previewQty > 1 ? '$_previewQty × ${CalendarText.tl(_effectiveUnit)} = ' : ''}${CalendarText.tl(_previewTotal)}'
                    : 'Kalem ekle'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _typeChips() {
    return Wrap(
      spacing: 7,
      runSpacing: 7,
      children: [
        for (final type in adisyonItemTypes)
          Builder(builder: (_) {
            final v = adisyonItemVisual(type);
            final on = _type == type;
            return GestureDetector(
              onTap: () => _selectType(type),
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 140),
                padding:
                    const EdgeInsets.symmetric(horizontal: 11, vertical: 7),
                decoration: BoxDecoration(
                  color: on ? v.bg : Colors.white,
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: on ? v.ink : AppColors.border),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(v.icon, size: 14, color: on ? v.ink : AppColors.muted),
                    const SizedBox(width: 5),
                    Text(
                        type == 'PackageUse'
                            ? 'Paketten kullan'
                            : type == 'PackageSale'
                                ? 'Paket satışı'
                                : v.label,
                        style: TextStyle(
                            fontSize: 11.5,
                            fontWeight: FontWeight.w700,
                            color: on ? v.ink : AppColors.muted)),
                  ],
                ),
              ),
            );
          }),
      ],
    );
  }

  Widget _catalogField() {
    final label = switch (_type) {
      'Product' => 'Ürün',
      'PackageSale' => 'Paket',
      'PackageUse' => 'Paketten kullanılacak hizmet',
      _ => 'Hizmet',
    };
    if (_catalog.isEmpty) {
      return Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: Text('$label kaydı bulunamadı.',
            style: const TextStyle(fontSize: 12, color: AppColors.muted)),
      );
    }
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: CatalogPickerField(
        label: label,
        items: _catalog,
        selectedId: _refId,
        priceKeys: _type == 'Product'
            ? const ['salePrice']
            : const ['price', 'totalPrice'],
        clearable: true,
        onChanged: (id) => setState(() {
          _refId = id;
          _error = null;
        }),
      ),
    );
  }
}
