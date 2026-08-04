import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';

import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/json_helpers.dart';
import '../appointments/calendar_theme.dart';

/// Gider kategorileri — web `ExpenseFormDialog.visiblePredefined` ile birebir.
/// Salary (maaş) burada YOK: maaş ödemesi kendi sayfasında alınır.
const _categories = <(String, String, IconData)>[
  ('Rent', 'Kira', Icons.home_work_rounded),
  ('Utilities', 'Faturalar', Icons.bolt_rounded),
  ('Supplies', 'Sarf Malzeme', Icons.inventory_2_rounded),
  ('Inventory', 'Stok/Ürün', Icons.widgets_rounded),
  ('Marketing', 'Pazarlama', Icons.campaign_rounded),
  ('Maintenance', 'Bakım', Icons.build_rounded),
  ('Professional', 'Danışmanlık', Icons.work_rounded),
  ('Equipment', 'Ekipman', Icons.handyman_rounded),
  ('Office', 'Ofis', Icons.description_rounded),
  ('Tax', 'Vergi / SGK', Icons.receipt_long_rounded),
  ('Other', 'Diğer', Icons.more_horiz_rounded),
];

const _methods = <(String, String)>[
  ('Cash', 'Nakit'),
  ('Card', 'Kart'),
  ('BankTransfer', 'Havale/EFT'),
  ('Check', 'Çek'),
];

/// Gider kaydı formu — web `ExpenseFormDialog` paritesi.
///
/// "Diğer" seçilince kurumun ÖZEL gider kategorileri (`/api/admin/expense-categories`)
/// listelenir, yerinde yeni kategori eklenebilir; seçilen ad açıklamaya `[Ad]` ön eki
/// olarak yazılır (web handleCreateExpense ile aynı sözleşme).
Future<Map<String, dynamic>?> showExpenseFormSheet(
  BuildContext context, {
  required ApiClient api,
}) {
  return showModalBottomSheet<Map<String, dynamic>>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _ExpenseFormSheet(api: api),
  );
}

class _ExpenseFormSheet extends StatefulWidget {
  const _ExpenseFormSheet({required this.api});
  final ApiClient api;

  @override
  State<_ExpenseFormSheet> createState() => _ExpenseFormSheetState();
}

class _ExpenseFormSheetState extends State<_ExpenseFormSheet> {
  String _category = 'Rent';
  String? _customCategory;
  String _method = 'Cash';
  DateTime _date = DateTime.now();
  late DateTime _period = DateTime.now();
  final _amount = TextEditingController();
  final _description = TextEditingController();
  final _reference = TextEditingController();
  final _newCategory = TextEditingController();
  List<Map<String, dynamic>> _customCategories = const [];
  bool _creatingCategory = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadCategories();
  }

  @override
  void dispose() {
    _amount.dispose();
    _description.dispose();
    _reference.dispose();
    _newCategory.dispose();
    super.dispose();
  }

  Future<void> _loadCategories() async {
    try {
      final data = await widget.api.get('/api/admin/expense-categories/');
      if (!mounted) return;
      setState(() => _customCategories = apiItems(data)
          .where((c) => c['isActive'] != false)
          .toList()
        ..sort((a, b) => valueOf(a, const ['name'])
            .toLowerCase()
            .compareTo(valueOf(b, const ['name']).toLowerCase())));
    } catch (_) {
      // Özel kategori ucu kapalıysa bölüm boş görünür.
    }
  }

  Future<void> _createCategory() async {
    final name = _newCategory.text.trim();
    if (name.isEmpty) return;
    setState(() {
      _creatingCategory = true;
      _error = null;
    });
    try {
      await widget.api
          .post('/api/admin/expense-categories/', {'name': name, 'isActive': true});
      _newCategory.clear();
      await _loadCategories();
      if (mounted) setState(() => _customCategory = name);
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _creatingCategory = false);
    }
  }

  Future<void> _deleteCategory(Map<String, dynamic> category) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Kategoriyi sil'),
        content: Text(
            '"${valueOf(category, const ['name'])}" özel gider kategorisi silinsin mi?'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Vazgeç')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Sil'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await widget.api
          .delete('/api/admin/expense-categories/${category['id']}');
      if (valueOf(category, const ['name']) == _customCategory) {
        _customCategory = null;
      }
      await _loadCategories();
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    }
  }

  double get _amountValue =>
      double.tryParse(_amount.text.trim().replaceAll(',', '.')) ?? 0;

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _date,
      firstDate: DateTime(now.year - 3),
      lastDate: DateTime(now.year + 1, 12, 31),
    );
    if (picked != null) {
      setState(() {
        _date = picked;
        _period = DateTime(picked.year, picked.month);
      });
    }
  }

  Future<void> _pickPeriod() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _period,
      firstDate: DateTime(now.year - 3),
      lastDate: DateTime(now.year + 1, 12, 31),
      initialDatePickerMode: DatePickerMode.year,
      helpText: 'Giderin ait olduğu ay',
    );
    if (picked != null) {
      setState(() => _period = DateTime(picked.year, picked.month));
    }
  }

  void _submit() {
    if (_amountValue <= 0) {
      setState(() => _error = 'Tutar pozitif olmalı.');
      return;
    }
    if (_category == 'Other' && (_customCategory == null || _customCategory!.isEmpty)) {
      setState(() => _error =
          '"Diğer" seçildiğinde özel kategori seçmen veya yeni kategori eklemen gerekli.');
      return;
    }
    final typed = _description.text.trim();
    // Web ile aynı sözleşme: özel kategori adı açıklamanın başına [köşeli] yazılır.
    final description = _category == 'Other' && _customCategory != null
        ? (typed.isEmpty ? _customCategory : '[$_customCategory] $typed')
        : (typed.isEmpty ? null : typed);
    Navigator.pop(context, <String, dynamic>{
      'category': _category,
      'amount': _amountValue,
      'paymentMethod': _method,
      // Gün ortası damgası: yerel gece yarısı UTC'de önceki güne kayıyordu.
      'occurredAtUtc':
          DateTime(_date.year, _date.month, _date.day, 12).toUtc().toIso8601String(),
      'staffMemberId': null,
      'periodLabel': DateFormat('yyyy-MM').format(_period),
      'description': description,
      'reference':
          _reference.text.trim().isEmpty ? null : _reference.text.trim(),
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
              padding: const EdgeInsets.fromLTRB(18, 14, 8, 4),
              child: Row(
                children: [
                  Container(
                    width: 40,
                    height: 40,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: AppColors.surfaceSoft,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: AppColors.border),
                    ),
                    child: const Icon(Icons.trending_down_rounded,
                        color: AppColors.primaryDark, size: 20),
                  ),
                  const SizedBox(width: 11),
                  const Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Gider kaydı oluştur',
                            style: TextStyle(
                                fontSize: 16.5, fontWeight: FontWeight.w800)),
                        Text(
                            'Kira, fatura, sarf gibi para çıkışları. Personel maaşı için "Maaşlar" sekmesini kullan.',
                            style: TextStyle(
                                fontSize: 11, color: AppColors.muted)),
                      ],
                    ),
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
                    18, 8, 18, MediaQuery.viewInsetsOf(context).bottom + 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _label('Kategori'),
                    _categoryGrid(),
                    if (_category == 'Other') ...[
                      const SizedBox(height: 10),
                      _customCategoryBox(),
                    ],
                    const SizedBox(height: 14),
                    Row(
                      children: [
                        Expanded(
                          child: TextField(
                            controller: _amount,
                            keyboardType: const TextInputType.numberWithOptions(
                                decimal: true),
                            inputFormatters: [
                              FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]'))
                            ],
                            onChanged: (_) => setState(() {}),
                            decoration: const InputDecoration(
                                labelText: 'Tutar', prefixText: '₺ '),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: DropdownButtonFormField<String>(
                            initialValue: _method,
                            isExpanded: true,
                            decoration: const InputDecoration(
                                labelText: 'Ödeme yöntemi'),
                            items: [
                              for (final (value, label) in _methods)
                                DropdownMenuItem(
                                    value: value, child: Text(label)),
                            ],
                            onChanged: (v) =>
                                setState(() => _method = v ?? _method),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Expanded(
                          child: InkWell(
                            onTap: _pickDate,
                            borderRadius: BorderRadius.circular(12),
                            child: InputDecorator(
                              decoration: const InputDecoration(
                                labelText: 'Tarih',
                                suffixIcon:
                                    Icon(Icons.calendar_today_rounded, size: 16),
                              ),
                              child: Text(
                                  DateFormat('d MMM yyyy', 'tr_TR').format(_date),
                                  style: const TextStyle(fontSize: 14)),
                            ),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: InkWell(
                            onTap: _pickPeriod,
                            borderRadius: BorderRadius.circular(12),
                            child: InputDecorator(
                              decoration: const InputDecoration(
                                labelText: 'Dönem',
                                helperText: 'Faturanın ait olduğu ay',
                                suffixIcon: Icon(Icons.event_repeat_rounded,
                                    size: 16),
                              ),
                              child: Text(
                                  DateFormat('MMMM yyyy', 'tr_TR')
                                      .format(_period),
                                  style: const TextStyle(fontSize: 14)),
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _description,
                      decoration: const InputDecoration(
                        labelText: 'Açıklama',
                        hintText: 'Hangi tedarikçi, ne için…',
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _reference,
                      decoration: const InputDecoration(
                        labelText: 'Fiş / fatura no',
                        hintText: 'Opsiyonel',
                      ),
                    ),
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
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                        '${_category == 'Other' ? (_customCategory ?? 'Özel kategori') : _categories.firstWhere((c) => c.$1 == _category).$2}'
                        '${_amountValue > 0 ? ' · ${CalendarText.tl(_amountValue)}' : ''}',
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            fontSize: 11.5,
                            fontWeight: FontWeight.w700,
                            color: AppColors.muted)),
                  ),
                  const SizedBox(width: 10),
                  FilledButton.icon(
                    style: AppButtons.inline(),
                    onPressed: _submit,
                    icon: const Icon(Icons.check_rounded, size: 18),
                    label: const Text('Gideri kaydet'),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _label(String text) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Text(text,
            style: const TextStyle(
                fontSize: 11.5,
                fontWeight: FontWeight.w700,
                color: AppColors.primaryDark)),
      );

  Widget _categoryGrid() {
    return Wrap(
      spacing: 7,
      runSpacing: 7,
      children: [
        for (final (value, label, icon) in _categories)
          GestureDetector(
            onTap: () => setState(() {
              _category = value;
              if (value != 'Other') _customCategory = null;
              _error = null;
            }),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 140),
              padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 8),
              decoration: BoxDecoration(
                color: _category == value ? AppColors.surfaceSoft : Colors.white,
                borderRadius: BorderRadius.circular(13),
                border: Border.all(
                    color: _category == value
                        ? AppColors.primary
                        : AppColors.border),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(icon,
                      size: 15,
                      color: _category == value
                          ? AppColors.primaryDark
                          : AppColors.muted),
                  const SizedBox(width: 6),
                  Text(label,
                      style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                          color: _category == value
                              ? AppColors.primaryDark
                              : AppColors.muted)),
                ],
              ),
            ),
          ),
      ],
    );
  }

  Widget _customCategoryBox() {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surfaceSoft.withValues(alpha: .5),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('ÖZEL KATEGORİ',
              style: TextStyle(
                  fontSize: 9.5,
                  letterSpacing: 1.4,
                  fontWeight: FontWeight.w800,
                  color: AppColors.primaryDark)),
          const SizedBox(height: 8),
          if (_customCategories.isEmpty)
            const Text('Tanımlı özel kategori yok — aşağıdan ekleyebilirsin.',
                style: TextStyle(fontSize: 11.5, color: AppColors.muted))
          else
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final c in _customCategories)
                  Builder(builder: (_) {
                    final name = valueOf(c, const ['name']);
                    final on = _customCategory == name;
                    return GestureDetector(
                      onTap: () => setState(() {
                        _customCategory = name;
                        _error = null;
                      }),
                      onLongPress: () => _deleteCategory(c),
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 10, vertical: 6),
                        decoration: BoxDecoration(
                          color: on ? AppColors.primary : Colors.white,
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(
                              color: on ? AppColors.primary : AppColors.border),
                        ),
                        child: Text(name,
                            style: TextStyle(
                                fontSize: 11.5,
                                fontWeight: FontWeight.w700,
                                color: on ? Colors.white : AppColors.ink)),
                      ),
                    );
                  }),
              ],
            ),
          const SizedBox(height: 6),
          const Text('Kategoriyi silmek için üzerine basılı tut.',
              style: TextStyle(fontSize: 10, color: AppColors.muted)),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _newCategory,
                  decoration: const InputDecoration(
                    isDense: true,
                    hintText: 'Yeni kategori adı (ör. Danışmanlık)',
                  ),
                ),
              ),
              const SizedBox(width: 8),
              FilledButton(
                style: AppButtons.inline(height: 40),
                onPressed: _creatingCategory ? null : _createCategory,
                child: _creatingCategory
                    ? const SizedBox(
                        width: 14,
                        height: 14,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.white))
                    : const Text('Ekle'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
