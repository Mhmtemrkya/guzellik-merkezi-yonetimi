import 'package:flutter/material.dart';

import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/json_helpers.dart';

/// Standart kategoriler — web "yeni hizmet tanımlama" modülüyle birebir.
const kPredefinedCategories = [
  'Lazer Epilasyon',
  'Cilt Bakımı',
  'Bölgesel İncelme',
  'Kaş & Kalıcı Makyaj',
  'Masaj',
  'Tırnak Bakımı',
];

const _otherSentinel = '__OTHER__';

/// Web'deki ServiceFormDialog kategori bölümünün birebir karşılığı:
/// tek "Kategori" dropdown'u (standart kategoriler + "Diğer"), "Diğer"
/// seçilince kuruma özel kategori seç / sil / ekle paneli.
class ServiceCategoryField extends StatefulWidget {
  const ServiceCategoryField({
    required this.api,
    required this.initialCategory,
    required this.onChanged,
    super.key,
  });

  final ApiClient api;
  final String? initialCategory;
  final ValueChanged<String?> onChanged;

  @override
  State<ServiceCategoryField> createState() => _ServiceCategoryFieldState();
}

class _ServiceCategoryFieldState extends State<ServiceCategoryField> {
  String? _category;
  bool _showCustomList = false;
  List<Map<String, dynamic>> _customCategories = [];
  String _error = '';

  @override
  void initState() {
    super.initState();
    _category = widget.initialCategory;
    _showCustomList = _category != null &&
        _category!.isNotEmpty &&
        !kPredefinedCategories.contains(_category);
    _loadCustom();
  }


  Future<void> _loadCustom() async {
    try {
      final data = await widget.api.get('/api/admin/service-categories/');
      if (mounted) {
        setState(() => _customCategories = apiItems(data));
      }
    } catch (_) {}
  }

  void _setCategory(String? value) {
    setState(() => _category = value);
    widget.onChanged(value);
  }

  Future<void> _delete(Map<String, dynamic> target) async {
    try {
      await widget.api.delete('/api/admin/service-categories/${target['id']}');
      await _loadCustom();
      _setCategory(null);
    } catch (e) {
      setState(() => _error = '$e');
    }
  }

  @override
  Widget build(BuildContext context) {
    final customNames = _customCategories
        .map((c) => valueOf(c, const ['name']))
        .where((n) => n != '—')
        .toList();
    final selectedCustom = _category != null && customNames.contains(_category);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: const [
            Icon(Icons.sell_rounded, size: 15, color: AppColors.primaryDark),
            SizedBox(width: 6),
            Text('Kategori', style: TextStyle(fontWeight: FontWeight.w700)),
          ],
        ),
        const SizedBox(height: 8),
        DropdownButtonFormField<String>(
          initialValue: _showCustomList ? _otherSentinel : _category,
          isExpanded: true,
          decoration: const InputDecoration(),
          items: [
            for (final c in kPredefinedCategories)
              DropdownMenuItem(value: c, child: Text(c)),
            const DropdownMenuItem(
              value: _otherSentinel,
              child: Text('── Diğer (özel kategori)'),
            ),
          ],
          onChanged: (v) {
            if (v == _otherSentinel) {
              setState(() => _showCustomList = true);
              if (_category != null && kPredefinedCategories.contains(_category)) {
                _setCategory(null);
              }
            } else {
              setState(() => _showCustomList = false);
              _setCategory(v);
            }
          },
        ),
        if (_showCustomList) ...[
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: AppColors.surfaceSoft,
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: AppColors.border),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Flexible(
                      child: Text(
                        'Kuruma özel hizmet kategorileri',
                        style: TextStyle(
                          fontWeight: FontWeight.w700,
                          fontSize: 12,
                        ),
                      ),
                    ),
                    Text(
                      '${customNames.length} adet',
                      style: const TextStyle(
                        color: AppColors.muted,
                        fontSize: 11,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: DropdownButtonFormField<String>(
                        initialValue: selectedCustom ? _category : null,
                        isExpanded: true,
                        decoration: const InputDecoration(
                          isDense: true,
                          hintText: '— Özel kategori seç —',
                        ),
                        items: [
                          for (final n in customNames)
                            DropdownMenuItem(value: n, child: Text(n)),
                        ],
                        onChanged: (v) => _setCategory(v),
                      ),
                    ),
                    if (selectedCustom) ...[
                      const SizedBox(width: 8),
                      IconButton(
                        tooltip: 'Seçili kategoriyi sil',
                        onPressed: () {
                          final target = _customCategories.firstWhere(
                            (c) => valueOf(c, const ['name']) == _category,
                            orElse: () => const {},
                          );
                          if (target.isNotEmpty) _delete(target);
                        },
                        icon: const Icon(
                          Icons.delete_outline_rounded,
                          color: Colors.red,
                        ),
                      ),
                    ],
                  ],
                ),
                const SizedBox(height: 8),
                // Kategori EKLEME buradan yapılmaz — tek kaynak Kategoriler ekranıdır (web paritesi).
                const Text(
                  'Yeni kategori eklemek için Paket & Hizmet › Kategoriler ekranını kullanın.',
                  style: TextStyle(fontSize: 11, color: AppColors.muted),
                ),
                if (_error.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Text(
                      _error,
                      style: const TextStyle(color: Colors.red, fontSize: 11),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ],
    );
  }
}
