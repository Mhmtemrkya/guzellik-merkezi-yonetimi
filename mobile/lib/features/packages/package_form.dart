import 'package:flutter/material.dart';

import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/json_helpers.dart';
import '../services/service_category_field.dart';

/// Bottom-sheet form to create/edit a service package (with its line items).
class PackageForm extends StatefulWidget {
  const PackageForm({
    required this.api,
    this.item,
    this.presetCategory,
    super.key,
  });
  final ApiClient api;
  final Map<String, dynamic>? item;
  final String? presetCategory;

  @override
  State<PackageForm> createState() => _PackageFormState();
}

class _PackageItem {
  _PackageItem({this.serviceId, this.sessionCount = 1, this.unitPrice});
  String? serviceId;
  int sessionCount;
  double? unitPrice;
}

class _PackageFormState extends State<PackageForm> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _name;
  late final TextEditingController _description;
  late final TextEditingController _totalPrice;
  late final TextEditingController _deposit;
  late final TextEditingController _installments;
  String? _category;
  bool _isActive = true;
  bool _saving = false;

  late Future<void> _loading;
  List<Map<String, dynamic>> _services = [];
  final List<_PackageItem> _items = [];

  bool get _isEdit => widget.item != null;

  @override
  void initState() {
    super.initState();
    final it = widget.item;
    _name = TextEditingController(text: '${it?['name'] ?? ''}');
    _description = TextEditingController(text: '${it?['description'] ?? ''}');
    _totalPrice = TextEditingController(
      text: it?['totalPrice'] != null ? '${it!['totalPrice']}' : '',
    );
    _deposit = TextEditingController(
      text: it?['depositAmount'] != null ? '${it!['depositAmount']}' : '0',
    );
    _installments = TextEditingController(
      text: it?['installmentCount'] != null ? '${it!['installmentCount']}' : '1',
    );
    _category = (it?['category'] as String?)?.trim().isNotEmpty == true
        ? it!['category'] as String
        : widget.presetCategory;
    _isActive = it?['isActive'] != false;
    for (final raw in (it?['items'] as List? ?? const [])) {
      if (raw is Map) {
        _items.add(
          _PackageItem(
            serviceId: '${raw['serviceDefinitionId']}',
            sessionCount: (raw['sessionCount'] as num?)?.toInt() ?? 1,
            unitPrice: (raw['unitPrice'] as num?)?.toDouble(),
          ),
        );
      }
    }
    if (_items.isEmpty) _items.add(_PackageItem());
    _loading = _load();
  }

  Future<void> _load() async {
    // TÜM hizmetleri çek (tek sayfa 200 tavanına takılıp hizmetler eksik görünmesin).
    _services = apiItems(await widget.api.getAllPaged('/api/admin/services/'));
  }

  String? _serviceName(String? id) {
    if (id == null) return null;
    for (final s in _services) {
      if ('${s['id']}' == id) return valueOf(s, const ['name']);
    }
    return null;
  }

  /// Aranabilir hizmet seçici (alt sayfa) — ad/kategori ile filtreler; tüm hizmetler görünür.
  Future<void> _pickService(int index) async {
    final selectedId = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (ctx) {
        var q = '';
        return StatefulBuilder(
          builder: (ctx, setSheet) {
            final t = q.trim().toLowerCase();
            final list = t.isEmpty
                ? _services
                : _services.where((s) {
                    final name = valueOf(s, const ['name']).toLowerCase();
                    final cat = valueOf(s, const ['category', 'group']).toLowerCase();
                    return name.contains(t) || cat.contains(t);
                  }).toList();
            return Padding(
              padding: EdgeInsets.only(bottom: MediaQuery.of(ctx).viewInsets.bottom),
              child: SizedBox(
                height: MediaQuery.of(ctx).size.height * 0.7,
                child: Column(children: [
                  const SizedBox(height: 12),
                  Container(
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(color: AppColors.border, borderRadius: BorderRadius.circular(2)),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 14, 16, 8),
                    child: TextField(
                      autofocus: true,
                      decoration: const InputDecoration(
                        hintText: 'Hizmet ara: ad veya kategori…',
                        prefixIcon: Icon(Icons.search_rounded),
                        isDense: true,
                      ),
                      onChanged: (v) => setSheet(() => q = v),
                    ),
                  ),
                  Expanded(
                    child: list.isEmpty
                        ? const Center(child: Text('Hizmet bulunamadı.', style: TextStyle(color: AppColors.muted)))
                        : ListView.separated(
                            itemCount: list.length,
                            separatorBuilder: (_, _) => const Divider(height: 1),
                            itemBuilder: (_, i) {
                              final s = list[i];
                              final id = '${s['id']}';
                              final selected = id == _items[index].serviceId;
                              final cat = valueOf(s, const ['category', 'group']);
                              final price = (s['price'] as num?) ?? 0;
                              return ListTile(
                                leading: const CircleAvatar(
                                  backgroundColor: AppColors.rose,
                                  child: Icon(Icons.spa_rounded, color: AppColors.primaryDark, size: 18),
                                ),
                                title: Text(valueOf(s, const ['name']), maxLines: 1, overflow: TextOverflow.ellipsis),
                                subtitle: Text([
                                  if (cat.isNotEmpty) cat,
                                  '${price.toStringAsFixed(price == price.roundToDouble() ? 0 : 2)} ₺',
                                ].join(' · ')),
                                trailing: selected ? const Icon(Icons.check_circle_rounded, color: AppColors.primary) : null,
                                onTap: () => Navigator.pop(ctx, id),
                              );
                            },
                          ),
                  ),
                ]),
              ),
            );
          },
        );
      },
    );
    if (selectedId != null) setState(() => _items[index].serviceId = selectedId);
  }

  @override
  void dispose() {
    _name.dispose();
    _description.dispose();
    _totalPrice.dispose();
    _deposit.dispose();
    _installments.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    final items = _items
        .where((i) => i.serviceId != null)
        .map(
          (i) => {
            'serviceDefinitionId': i.serviceId,
            'sessionCount': i.sessionCount,
            'unitPrice': i.unitPrice,
          },
        )
        .toList();
    if (items.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('En az bir hizmet eklemelisiniz.')),
      );
      return;
    }
    setState(() => _saving = true);
    final body = {
      'branchId': widget.api.auth?.user?.branchId,
      'name': _name.text.trim(),
      'description': _description.text.trim().isEmpty
          ? null
          : _description.text.trim(),
      'category': _category,
      'totalPrice':
          double.tryParse(_totalPrice.text.replaceAll(',', '.')) ?? 0,
      'depositAmount':
          double.tryParse(_deposit.text.replaceAll(',', '.')) ?? 0,
      'installmentCount': int.tryParse(_installments.text) ?? 1,
      'isActive': _isActive,
      'items': items,
      'status': 'Active',
    };
    try {
      if (_isEdit) {
        await widget.api.put('/api/admin/packages/${widget.item!['id']}', body);
      } else {
        await widget.api.post('/api/admin/packages/', body);
      }
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) {
        setState(() => _saving = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }

  Future<void> _delete() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Onay'),
        content: const Text('Bu paketi silmek istediğinize emin misiniz?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Vazgeç'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Sil'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await widget.api.delete('/api/admin/packages/${widget.item!['id']}');
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(
        20,
        18,
        20,
        MediaQuery.viewInsetsOf(context).bottom + 20,
      ),
      child: FutureBuilder<void>(
        future: _loading,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const SizedBox(
              height: 280,
              child: Center(child: CircularProgressIndicator()),
            );
          }
          return SingleChildScrollView(
            child: Form(
              key: _formKey,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _isEdit ? 'Paketi düzenle' : 'Yeni paket',
                    style: Theme.of(context).textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.w800,
                        ),
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: _name,
                    decoration: const InputDecoration(labelText: 'Paket adı'),
                    validator: (v) =>
                        (v ?? '').trim().isEmpty ? 'Paket adı zorunlu.' : null,
                  ),
                  const SizedBox(height: 14),
                  ServiceCategoryField(
                    api: widget.api,
                    initialCategory: _category,
                    onChanged: (c) => _category = c,
                  ),
                  const SizedBox(height: 14),
                  TextFormField(
                    controller: _description,
                    maxLines: 2,
                    decoration: const InputDecoration(labelText: 'Açıklama'),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: TextFormField(
                          controller: _totalPrice,
                          keyboardType: const TextInputType.numberWithOptions(
                            decimal: true,
                          ),
                          decoration: const InputDecoration(
                            labelText: 'Toplam fiyat',
                          ),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: TextFormField(
                          controller: _deposit,
                          keyboardType: const TextInputType.numberWithOptions(
                            decimal: true,
                          ),
                          decoration: const InputDecoration(
                            labelText: 'Peşinat',
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _installments,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(labelText: 'Taksit sayısı'),
                  ),
                  SwitchListTile.adaptive(
                    contentPadding: EdgeInsets.zero,
                    value: _isActive,
                    onChanged: (v) => setState(() => _isActive = v),
                    title: const Text('Aktif'),
                  ),
                  const SizedBox(height: 4),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text(
                        'Paket içeriği',
                        style: TextStyle(fontWeight: FontWeight.w800),
                      ),
                      TextButton.icon(
                        onPressed: () =>
                            setState(() => _items.add(_PackageItem())),
                        icon: const Icon(Icons.add_rounded, size: 18),
                        label: const Text('Hizmet ekle'),
                      ),
                    ],
                  ),
                  for (int i = 0; i < _items.length; i++) _buildItemRow(i),
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed: _saving ? null : _save,
                    child: Text(_saving ? 'Kaydediliyor...' : 'Kaydet'),
                  ),
                  if (_isEdit) ...[
                    const SizedBox(height: 8),
                    TextButton.icon(
                      onPressed: _delete,
                      style: TextButton.styleFrom(foregroundColor: Colors.red),
                      icon: const Icon(Icons.delete_outline_rounded),
                      label: const Text('Paketi sil'),
                    ),
                  ],
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _buildItemRow(int index) {
    final item = _items[index];
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Container(
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: AppColors.surfaceSoft,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppColors.border),
        ),
        child: Column(
          children: [
            Row(
              children: [
                Expanded(
                  child: InkWell(
                    borderRadius: BorderRadius.circular(8),
                    onTap: () => _pickService(index),
                    child: InputDecorator(
                      decoration: const InputDecoration(
                        labelText: 'Hizmet',
                        isDense: true,
                        suffixIcon: Icon(Icons.search_rounded, size: 18),
                      ),
                      child: Text(
                        _serviceName(item.serviceId) ?? 'Hizmet seçin',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: item.serviceId == null ? AppColors.muted : AppColors.ink,
                        ),
                      ),
                    ),
                  ),
                ),
                if (_items.length > 1)
                  IconButton(
                    icon: const Icon(Icons.remove_circle_outline_rounded),
                    color: Colors.red,
                    onPressed: () => setState(() => _items.removeAt(index)),
                  ),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: TextFormField(
                    initialValue: '${item.sessionCount}',
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(
                      labelText: 'Seans',
                      isDense: true,
                    ),
                    onChanged: (v) =>
                        item.sessionCount = int.tryParse(v) ?? 1,
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: TextFormField(
                    initialValue: item.unitPrice != null
                        ? '${item.unitPrice}'
                        : '',
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    decoration: const InputDecoration(
                      labelText: 'Birim fiyat (ops.)',
                      isDense: true,
                    ),
                    onChanged: (v) =>
                        item.unitPrice = double.tryParse(v.replaceAll(',', '.')),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
