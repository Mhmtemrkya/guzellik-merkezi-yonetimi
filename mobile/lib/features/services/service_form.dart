import 'package:flutter/material.dart';

import '../../core/network/api_client.dart';
import 'service_category_field.dart';

const _statusOptions = [
  ['Active', 'Aktif (yayında)'],
  ['Draft', 'Taslak'],
  ['Passive', 'Pasif'],
  ['Archived', 'Arşiv'],
];

/// "Yeni hizmet tanımlama" formu — kategori bölümü web ile birebir.
class ServiceForm extends StatefulWidget {
  const ServiceForm({required this.api, this.item, super.key});
  final ApiClient api;
  final Map<String, dynamic>? item;

  @override
  State<ServiceForm> createState() => _ServiceFormState();
}

class _ServiceFormState extends State<ServiceForm> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _name;
  late final TextEditingController _duration;
  late final TextEditingController _price;
  late final TextEditingController _sessions;
  late final TextEditingController _loyalty;
  String? _category;
  String _status = 'Active';
  bool _isActive = true;
  bool _saving = false;

  bool get _isEdit => widget.item != null;

  @override
  void initState() {
    super.initState();
    final it = widget.item;
    _name = TextEditingController(text: '${it?['name'] ?? ''}');
    _duration = TextEditingController(
      text: '${it?['durationMinutes'] ?? 60}',
    );
    _price = TextEditingController(
      text: it?['price'] != null ? '${it!['price']}' : '',
    );
    _sessions = TextEditingController(
      text: '${it?['defaultSessionCount'] ?? 1}',
    );
    _loyalty = TextEditingController(
      text: it?['loyaltyPointCost'] != null ? '${it!['loyaltyPointCost']}' : '',
    );
    _category = (it?['category'] as String?)?.trim().isNotEmpty == true
        ? it!['category'] as String
        : 'Cilt Bakımı';
    final st = '${it?['status'] ?? 'Active'}';
    _status = _statusOptions.any((s) => s[0] == st) ? st : 'Active';
    _isActive = it?['isActive'] != false;
  }

  @override
  void dispose() {
    _name.dispose();
    _duration.dispose();
    _price.dispose();
    _sessions.dispose();
    _loyalty.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _saving = true);
    final body = {
      'branchId': _isEdit
          ? widget.item!['branchId'] ?? widget.api.auth?.user?.branchId
          : widget.api.auth?.user?.branchId,
      'name': _name.text.trim(),
      'category': _category,
      'durationMinutes': int.tryParse(_duration.text) ?? 60,
      'price': double.tryParse(_price.text.replaceAll(',', '.')) ?? 0,
      'defaultSessionCount': int.tryParse(_sessions.text) ?? 1,
      'loyaltyPointCost': _loyalty.text.trim().isEmpty
          ? null
          : int.tryParse(_loyalty.text),
      'isActive': _isActive,
      'status': _status,
      'iconKey': widget.item?['iconKey'],
    };
    try {
      if (_isEdit) {
        await widget.api.put('/api/admin/services/${widget.item!['id']}', body);
      } else {
        await widget.api.post('/api/admin/services/', body);
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
        content: const Text('Bu hizmeti silmek istediğinize emin misiniz?'),
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
      await widget.api.delete('/api/admin/services/${widget.item!['id']}');
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
      child: SingleChildScrollView(
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                _isEdit ? 'Hizmeti düzenle' : 'Yeni hizmet',
                style: Theme.of(context).textTheme.titleLarge?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _name,
                decoration: const InputDecoration(labelText: 'Hizmet adı'),
                validator: (v) =>
                    (v ?? '').trim().isEmpty ? 'Hizmet adı zorunlu.' : null,
              ),
              const SizedBox(height: 14),
              ServiceCategoryField(
                api: widget.api,
                initialCategory: _category,
                onChanged: (c) => _category = c,
              ),
              const SizedBox(height: 14),
              Row(
                children: [
                  Expanded(
                    child: TextFormField(
                      controller: _duration,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(labelText: 'Süre (dk)'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: TextFormField(
                      controller: _price,
                      keyboardType: const TextInputType.numberWithOptions(
                        decimal: true,
                      ),
                      decoration: const InputDecoration(labelText: 'Fiyat'),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: TextFormField(
                      controller: _sessions,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(
                        labelText: 'Seans sayısı',
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: TextFormField(
                      controller: _loyalty,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(
                        labelText: 'Sadakat puanı',
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: _status,
                decoration: const InputDecoration(labelText: 'Durum'),
                items: _statusOptions
                    .map(
                      (s) => DropdownMenuItem(value: s[0], child: Text(s[1])),
                    )
                    .toList(),
                onChanged: (v) => setState(() => _status = v ?? _status),
              ),
              SwitchListTile.adaptive(
                contentPadding: EdgeInsets.zero,
                value: _isActive,
                onChanged: (v) => setState(() => _isActive = v),
                title: const Text('Aktif'),
              ),
              const SizedBox(height: 8),
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
                  label: const Text('Hizmeti sil'),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
