import 'package:flutter/material.dart';

import '../../core/theme/app_theme.dart';

/// Web `CatalogPicker` bileşeninin mobil karşılığı: kategori + alt kategori +
/// arama ile süzülebilir katalog seçici. Satış sheet'inde (paket/hizmet) ve
/// bekleme listesinde ortak kullanılır.
///
/// - [items] her biri `id`, ad ([nameKey]), fiyat ([priceKeys] içinden ilk num),
///   [categoryKey] ve [subCategoryKey] taşıyan kayıtlar.
/// - [clearable] true ise seçili öğeye tekrar dokunmak seçimi kaldırır
///   (opsiyonel alanlarda "farketmez").
class CatalogPickerField extends StatefulWidget {
  const CatalogPickerField({
    required this.items,
    required this.selectedId,
    required this.onChanged,
    this.label,
    this.nameKey = 'name',
    this.priceKeys = const ['price', 'totalPrice'],
    this.categoryKey = 'category',
    this.subCategoryKey = 'subCategory',
    this.emptyText = 'Sonuç yok.',
    this.clearable = false,
    this.maxListHeight = 260,
    super.key,
  });

  final List<Map<String, dynamic>> items;
  final String? selectedId;
  final ValueChanged<String?> onChanged;
  final String? label;
  final String nameKey;
  final List<String> priceKeys;
  final String categoryKey;
  final String subCategoryKey;
  final String emptyText;
  final bool clearable;
  final double maxListHeight;

  @override
  State<CatalogPickerField> createState() => _CatalogPickerFieldState();
}

class _CatalogPickerFieldState extends State<CatalogPickerField> {
  final _search = TextEditingController();
  String _cat = '';
  String _sub = '';

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  String _catOf(Map<String, dynamic> p) => '${p[widget.categoryKey] ?? ''}';
  String _subOf(Map<String, dynamic> p) => '${p[widget.subCategoryKey] ?? ''}';
  String _nameOf(Map<String, dynamic> p) => '${p[widget.nameKey] ?? ''}';

  String _priceOf(Map<String, dynamic> p) {
    for (final k in widget.priceKeys) {
      final v = p[k];
      if (v is num) return v.toStringAsFixed(0);
    }
    return '0';
  }

  // Üst kategoriler (katalogda geçen).
  List<String> get _categories {
    final set = <String>{};
    for (final p in widget.items) {
      final c = _catOf(p);
      if (c.isNotEmpty) set.add(c);
    }
    return set.toList()..sort();
  }

  // Seçili üst kategorinin alt kategorileri.
  List<String> get _subCategories {
    final set = <String>{};
    for (final p in widget.items) {
      if (_cat.isNotEmpty && _catOf(p) != _cat) continue;
      final s = _subOf(p);
      if (s.isNotEmpty) set.add(s);
    }
    return set.toList()..sort();
  }

  // Kategori + alt kategori + aramayla süzülmüş katalog.
  List<Map<String, dynamic>> get _filtered {
    final term = _search.text.trim().toLowerCase();
    return widget.items.where((p) {
      if (_cat.isNotEmpty && _catOf(p) != _cat) return false;
      if (_sub.isNotEmpty && _subOf(p) != _sub) return false;
      if (term.isNotEmpty && !_nameOf(p).toLowerCase().contains(term)) {
        return false;
      }
      return true;
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    final cats = _categories;
    final subs = _subCategories;
    final filtered = _filtered;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (widget.label != null) ...[
          Text(
            widget.label!,
            style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13),
          ),
          const SizedBox(height: 8),
        ],
        TextField(
          controller: _search,
          decoration: const InputDecoration(
            isDense: true,
            prefixIcon: Icon(Icons.search_rounded, size: 18),
            hintText: 'Ada göre ara…',
          ),
          onChanged: (_) => setState(() {}),
        ),
        if (cats.isNotEmpty) ...[
          const SizedBox(height: 8),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              ChoiceChip(
                label: const Text('Tümü'),
                selected: _cat.isEmpty,
                onSelected: (_) => setState(() {
                  _cat = '';
                  _sub = '';
                }),
              ),
              for (final c in cats)
                ChoiceChip(
                  label: Text(c),
                  selected: _cat == c,
                  onSelected: (_) => setState(() {
                    _cat = _cat == c ? '' : c;
                    _sub = '';
                  }),
                ),
            ],
          ),
        ],
        if (subs.isNotEmpty) ...[
          const SizedBox(height: 6),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              ChoiceChip(
                label: const Text('Tüm alt kategoriler'),
                selected: _sub.isEmpty,
                onSelected: (_) => setState(() => _sub = ''),
              ),
              for (final s in subs)
                ChoiceChip(
                  label: Text(s),
                  selected: _sub == s,
                  onSelected: (_) => setState(() => _sub = _sub == s ? '' : s),
                ),
            ],
          ),
        ],
        const SizedBox(height: 8),
        Container(
          constraints: BoxConstraints(maxHeight: widget.maxListHeight),
          decoration: BoxDecoration(
            color: AppColors.surfaceSoft,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: AppColors.border),
          ),
          child: filtered.isEmpty
              ? Padding(
                  padding: const EdgeInsets.symmetric(vertical: 28),
                  child: Center(
                    child: Text(
                      widget.emptyText,
                      style: const TextStyle(color: AppColors.muted),
                    ),
                  ),
                )
              : ListView.separated(
                  shrinkWrap: true,
                  padding: const EdgeInsets.all(6),
                  itemCount: filtered.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 4),
                  itemBuilder: (context, i) {
                    final p = filtered[i];
                    final id = '${p['id']}';
                    final selected = widget.selectedId == id;
                    final cat = _catOf(p);
                    final sub = _subOf(p);
                    final priceNum = _priceOf(p);
                    return InkWell(
                      borderRadius: BorderRadius.circular(10),
                      onTap: () => widget.onChanged(
                        widget.clearable && selected ? null : id,
                      ),
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 10,
                          vertical: 8,
                        ),
                        decoration: BoxDecoration(
                          color: selected ? AppColors.rose : Colors.white,
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(
                            color: selected
                                ? AppColors.primary
                                : Colors.transparent,
                          ),
                        ),
                        child: Row(
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    _nameOf(p),
                                    style: const TextStyle(
                                      fontWeight: FontWeight.w600,
                                    ),
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                  const SizedBox(height: 2),
                                  Wrap(
                                    spacing: 6,
                                    children: [
                                      Text(
                                        '₺$priceNum',
                                        style: const TextStyle(
                                          fontSize: 11,
                                          color: AppColors.muted,
                                        ),
                                      ),
                                      if (cat.isNotEmpty)
                                        Text(
                                          '· $cat',
                                          style: const TextStyle(
                                            fontSize: 11,
                                            color: AppColors.muted,
                                          ),
                                        ),
                                      if (sub.isNotEmpty)
                                        Text(
                                          '· $sub',
                                          style: const TextStyle(
                                            fontSize: 11,
                                            color: AppColors.primaryDark,
                                          ),
                                        ),
                                    ],
                                  ),
                                ],
                              ),
                            ),
                            if (selected)
                              const Icon(
                                Icons.check_circle_rounded,
                                size: 18,
                                color: AppColors.primary,
                              ),
                          ],
                        ),
                      ),
                    );
                  },
                ),
        ),
      ],
    );
  }
}
