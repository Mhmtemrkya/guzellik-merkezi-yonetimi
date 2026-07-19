import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/theme/app_theme.dart';
import '../widgets/async_list_page.dart';

/// Schema-driven CRUD field kinds.
enum CrudFieldType {
  text,
  multiline,
  number,
  decimal,
  toggle,
  select,
  multiSelect,
  date,
}

class CrudOption {
  const CrudOption(this.value, this.label);
  final dynamic value;
  final String label;
}

/// Declarative description of a single editable field on a record.
class CrudField {
  const CrudField({
    required this.key,
    required this.label,
    this.type = CrudFieldType.text,
    this.required = false,
    this.defaultValue,
    this.options = const [],
    this.showOnCreate = true,
    this.showOnEdit = true,
    this.hint,
    this.dateOnly = true,
    this.sendNullWhenEmpty = true,
    this.optionsLoader,
    this.multiSelectAsString = false,
    this.multiSelectSeparator = ', ',
    this.digitsOnly = false,
    this.maxLength,
    this.exactLength = false,
    this.searchable = false,
  });

  final String key;
  final String label;
  final CrudFieldType type;
  final bool required;
  final Object? defaultValue;
  final List<CrudOption> options;
  final bool showOnCreate;
  final bool showOnEdit;
  final String? hint;
  final bool dateOnly;
  final bool sendNullWhenEmpty;

  /// Yalnızca rakam girilebilsin (TC, telefon). Klavye numerik olur.
  final bool digitsOnly;

  /// En fazla bu kadar karakter girilebilir (TC=11, telefon=11).
  final int? maxLength;

  /// true ise (ve required) girilen uzunluk tam olarak [maxLength] olmalı.
  final bool exactLength;

  /// For [CrudFieldType.select]: load dropdown options asynchronously
  /// (e.g. customers, staff, services).
  final Future<List<CrudOption>> Function()? optionsLoader;

  /// For [CrudFieldType.select]: binlerce seçenekli listelerde (müşteriler)
  /// dropdown yerine aramalı bir alt sayfa açılır.
  final bool searchable;

  /// For [CrudFieldType.multiSelect]. If true, selected values are joined as
  /// a string instead of being sent as an array. Useful for backend fields like
  /// `specialties` that store a comma-separated display text.
  final bool multiSelectAsString;
  final String multiSelectSeparator;
}

/// Extra contextual action shown inside the edit/detail sheet
/// (e.g. "Mark as paid", "Add stock movement").
class CrudRowAction {
  const CrudRowAction({
    required this.label,
    required this.icon,
    required this.run,
    this.color,
    this.visible,
  });

  final String label;
  final IconData icon;
  final Color? color;

  /// Returns true if the action mutated data and the list should refresh.
  final Future<bool> Function(BuildContext context, Map<String, dynamic> item)
  run;
  final bool Function(Map<String, dynamic> item)? visible;
}

typedef CrudMutation = Future<dynamic> Function(Map<String, dynamic> payload);
typedef CrudUpdate =
    Future<void> Function(Map<String, dynamic> item, Map<String, dynamic> body);
typedef CrudDelete = Future<void> Function(Map<String, dynamic> item);

/// Generic list screen with create / edit / delete + custom row actions.
class CrudListScreen extends StatefulWidget {
  const CrudListScreen({
    required this.eyebrow,
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.loader,
    required this.titleKeys,
    required this.subtitleKeys,
    this.trailingKeys = const [],
    this.statusKeys = const [],
    this.filters = const [],
    this.fields = const [],
    this.onCreate,
    this.onUpdate,
    this.onDelete,
    this.rowActions = const [],
    this.createLabel = 'Yeni kayıt',
    this.deleteLabel = 'Sil',
    this.deleteConfirm = 'Bu kaydı silmek istediğinize emin misiniz?',
    this.decorateCreate,
    this.decorateUpdate,
    this.onCreated,
    this.headerExtra,
    this.onItemTap,
    this.emptyText = 'Henüz kayıt bulunmuyor.',
    this.canCreate = true,
    this.canUpdate = true,
    this.canDelete = true,
    super.key,
  });

  final String eyebrow;
  final String title;
  final String subtitle;
  final IconData icon;
  final EntityLoader loader;
  final List<String> titleKeys;
  final List<String> subtitleKeys;
  final List<String> trailingKeys;
  final List<String> statusKeys;
  final List<ListFilterOption> filters;
  final List<CrudField> fields;
  final CrudMutation? onCreate;
  final CrudUpdate? onUpdate;
  final CrudDelete? onDelete;
  final List<CrudRowAction> rowActions;
  final String createLabel;
  final String deleteLabel;
  final String deleteConfirm;
  final Widget? headerExtra;
  final String emptyText;

  /// Hooks to inject extra keys (e.g. branchId) into the outgoing payload.
  final void Function(Map<String, dynamic> payload)? decorateCreate;
  final void Function(Map<String, dynamic> payload, Map<String, dynamic> item)?
  decorateUpdate;

  /// Called after a successful create with the API result (e.g. to show
  /// one-time staff credentials).
  final void Function(BuildContext context, dynamic result)? onCreated;

  /// Verilirse satıra dokununca düzenleme sheet'i yerine bu çağrılır
  /// (ör. zengin müşteri detay ekranına push). Oluşturma FAB'ı korunur.
  final void Function(Map<String, dynamic> item)? onItemTap;

  /// Personel işlem izinleri (web Sayfa.Aksiyon paritesi): false ise ilgili
  /// yazma butonu hiç gösterilmez (backend zaten 403 ile ayrıca korur).
  final bool canCreate;
  final bool canUpdate;
  final bool canDelete;

  @override
  State<CrudListScreen> createState() => _CrudListScreenState();
}

class _CrudListScreenState extends State<CrudListScreen> {
  int refreshKey = 0;

  void _refresh() => setState(() => refreshKey++);

  bool get _canOpenSheet =>
      widget.fields.isNotEmpty || widget.rowActions.isNotEmpty;

  Future<void> _openCreate() async {
    // CrudFormSheet her zaman CrudSheetResult ile pop yapar; create akışı da onu beklemeli.
    // (Aksi halde Navigator.pop'taki tip uyuşmazlığı patlar ve form "Kaydediliyor..."da takılır.)
    final result = await showModalBottomSheet<CrudSheetResult>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => CrudFormSheet(
        title: widget.createLabel,
        fields: widget.fields.where((f) => f.showOnCreate).toList(),
        icon: widget.icon,
      ),
    );
    final body = result?.body;
    if (body == null) return;
    widget.decorateCreate?.call(body);
    await _guard(() async {
      final created = await widget.onCreate!(body);
      if (mounted) widget.onCreated?.call(context, created);
    }, 'Kayıt oluşturuldu.');
  }

  Future<void> _openEdit(Map<String, dynamic> item) async {
    final result = await showModalBottomSheet<CrudSheetResult>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => CrudFormSheet(
        title: widget.onUpdate == null || !widget.canUpdate ? 'İşlemler' : 'Düzenle',
        fields: widget.onUpdate == null || !widget.canUpdate
            ? const []
            : widget.fields.where((f) => f.showOnEdit).toList(),
        icon: widget.icon,
        initial: item,
        canDelete: widget.onDelete != null && widget.canDelete,
        deleteLabel: widget.deleteLabel,
        rowActions: widget.rowActions,
      ),
    );
    if (result == null) return;
    if (result.deleted) {
      final ok = await _confirm(widget.deleteConfirm);
      if (!ok) return;
      await _guard(() => widget.onDelete!(item), 'Kayıt silindi.');
      return;
    }
    if (result.actionRefresh) {
      _refresh();
      return;
    }
    if (result.body != null && widget.onUpdate != null && widget.canUpdate) {
      widget.decorateUpdate?.call(result.body!, item);
      await _guard(
        () => widget.onUpdate!(item, result.body!),
        'Değişiklikler kaydedildi.',
      );
    }
  }

  Future<bool> _confirm(String message) async {
    final result = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Onay'),
        content: Text(message),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Vazgeç'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Onayla'),
          ),
        ],
      ),
    );
    return result ?? false;
  }

  Future<void> _guard(Future<void> Function() task, String success) async {
    try {
      await task();
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(success)));
      _refresh();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    return AsyncListPage(
      key: ValueKey(refreshKey),
      eyebrow: widget.eyebrow,
      title: widget.title,
      subtitle: widget.subtitle,
      icon: widget.icon,
      loader: widget.loader,
      titleKeys: widget.titleKeys,
      subtitleKeys: widget.subtitleKeys,
      trailingKeys: widget.trailingKeys,
      statusKeys: widget.statusKeys,
      filters: widget.filters,
      emptyText: widget.emptyText,
      headerExtra: widget.headerExtra,
      onItemTap: widget.onItemTap ?? (_canOpenSheet ? _openEdit : null),
      floatingAction: widget.onCreate == null || !widget.canCreate
          ? null
          : FloatingActionButton.extended(
              onPressed: _openCreate,
              icon: const Icon(Icons.add_rounded),
              label: Text(widget.createLabel),
            ),
    );
  }
}

class CrudSheetResult {
  const CrudSheetResult({
    this.body,
    this.deleted = false,
    this.actionRefresh = false,
  });
  final Map<String, dynamic>? body;
  final bool deleted;
  final bool actionRefresh;
}

/// Bottom-sheet form generated from a list of [CrudField]s.
class CrudFormSheet extends StatefulWidget {
  const CrudFormSheet({
    required this.title,
    required this.fields,
    required this.icon,
    this.initial,
    this.canDelete = false,
    this.deleteLabel = 'Sil',
    this.rowActions = const [],
    super.key,
  });

  final String title;
  final List<CrudField> fields;
  final IconData icon;
  final Map<String, dynamic>? initial;
  final bool canDelete;
  final String deleteLabel;
  final List<CrudRowAction> rowActions;

  @override
  State<CrudFormSheet> createState() => _CrudFormSheetState();
}

class _CrudFormSheetState extends State<CrudFormSheet> {
  final _formKey = GlobalKey<FormState>();
  final Map<String, TextEditingController> _controllers = {};
  final Map<String, dynamic> _values = {};
  final Map<String, List<CrudOption>> _asyncOptions = {};
  bool _saving = false;
  bool _loadingOptions = false;

  List<CrudOption> _optionsFor(CrudField field) =>
      _asyncOptions[field.key] ?? field.options;

  @override
  void initState() {
    super.initState();
    _loadAsyncOptions();
    for (final field in widget.fields) {
      final existing = widget.initial?[field.key];
      switch (field.type) {
        case CrudFieldType.toggle:
          _values[field.key] = existing is bool
              ? existing
              : (field.defaultValue as bool? ?? false);
          break;
        case CrudFieldType.select:
          // Aramalı seçimde ilk kaydı otomatik seçme — kullanıcı arayıp seçer.
          _values[field.key] =
              existing ??
              field.defaultValue ??
              (field.searchable || field.options.isEmpty
                  ? null
                  : field.options.first.value);
          break;
        case CrudFieldType.multiSelect:
          _values[field.key] = _parseMultiValue(existing);
          break;
        case CrudFieldType.date:
          final date =
              _parseDate(existing) ??
              (field.defaultValue == 'today' ? DateTime.now() : null);
          _values[field.key] = date;
          _controllers[field.key] = TextEditingController(
            text: date == null ? '' : _formatDate(date),
          );
          break;
        case CrudFieldType.text:
        case CrudFieldType.multiline:
        case CrudFieldType.number:
        case CrudFieldType.decimal:
          final initialText = existing != null
              ? '$existing'
              : (field.defaultValue != null ? '${field.defaultValue}' : '');
          _controllers[field.key] = TextEditingController(text: initialText);
          break;
      }
    }
  }

  DateTime? _parseDate(dynamic value) {
    if (value == null) return null;
    final raw = '$value'.trim();
    if (raw.isEmpty) return null;
    final iso = DateTime.tryParse(raw);
    if (iso != null) return iso.toLocal();

    final compact = RegExp(r'^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$');
    final compactMatch = compact.firstMatch(raw);
    if (compactMatch != null) {
      final day = int.tryParse(compactMatch.group(1)!);
      final month = int.tryParse(compactMatch.group(2)!);
      final year = int.tryParse(compactMatch.group(3)!);
      return _safeDate(year, month, day);
    }

    final reverse = RegExp(r'^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$');
    final reverseMatch = reverse.firstMatch(raw);
    if (reverseMatch != null) {
      final year = int.tryParse(reverseMatch.group(1)!);
      final month = int.tryParse(reverseMatch.group(2)!);
      final day = int.tryParse(reverseMatch.group(3)!);
      return _safeDate(year, month, day);
    }
    return null;
  }

  DateTime? _safeDate(int? year, int? month, int? day) {
    if (year == null || month == null || day == null) return null;
    if (year < 1900 || year > DateTime.now().year + 10) return null;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    final date = DateTime(year, month, day);
    if (date.year != year || date.month != month || date.day != day) {
      return null;
    }
    return date;
  }

  String _formatDate(DateTime date) =>
      '${date.day.toString().padLeft(2, '0')}.${date.month.toString().padLeft(2, '0')}.${date.year}';

  List<dynamic> _parseMultiValue(dynamic existing) {
    if (existing is List) {
      return existing.where((e) => '$e'.trim().isNotEmpty).toList();
    }
    if (existing == null) return <dynamic>[];
    return '$existing'
        .split(RegExp(r'[,;]'))
        .map((e) => e.trim())
        .where((e) => e.isNotEmpty)
        .toList();
  }

  /// Aramalı select — seçenekleri filtrelenebilir bir alt sayfada listeler.
  Future<CrudOption?> _pickSearchableOption(
    CrudField field,
    List<CrudOption> options,
  ) {
    return showModalBottomSheet<CrudOption>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) {
        var q = '';
        return StatefulBuilder(
          builder: (ctx, setSheet) {
            final list = q.isEmpty
                ? options
                : options
                    .where((o) => o.label.toLowerCase().contains(q))
                    .toList();
            return Padding(
              padding:
                  EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(ctx).bottom),
              child: SizedBox(
                height: MediaQuery.sizeOf(ctx).height * 0.75,
                child: Column(
                  children: [
                    const SizedBox(height: 14),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 20),
                      child: Align(
                        alignment: Alignment.centerLeft,
                        child: Text(
                          field.label,
                          style: const TextStyle(
                              fontSize: 18, fontWeight: FontWeight.w800),
                        ),
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 10, 16, 6),
                      child: TextField(
                        autofocus: true,
                        onChanged: (v) =>
                            setSheet(() => q = v.trim().toLowerCase()),
                        decoration: InputDecoration(
                          isDense: true,
                          hintText: 'Ara…',
                          prefixIcon: const Icon(Icons.search_rounded, size: 18),
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                        ),
                      ),
                    ),
                    Expanded(
                      child: list.isEmpty
                          ? const Center(
                              child: Text('Sonuç bulunamadı.',
                                  style: TextStyle(color: Colors.black54)))
                          : ListView.builder(
                              padding:
                                  const EdgeInsets.fromLTRB(8, 4, 8, 16),
                              itemCount: list.length,
                              itemBuilder: (_, i) => ListTile(
                                title: Text(list[i].label),
                                onTap: () => Navigator.pop(ctx, list[i]),
                              ),
                            ),
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }

  Future<void> _loadAsyncOptions() async {
    final loaders = widget.fields
        .where((f) => f.optionsLoader != null)
        .toList();
    if (loaders.isEmpty) return;
    setState(() => _loadingOptions = true);
    for (final field in loaders) {
      try {
        _asyncOptions[field.key] = await field.optionsLoader!();
      } catch (_) {
        _asyncOptions[field.key] = const [];
      }
    }
    if (mounted) setState(() => _loadingOptions = false);
  }

  @override
  void dispose() {
    for (final c in _controllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  Map<String, dynamic> _buildBody() {
    final body = <String, dynamic>{};
    for (final field in widget.fields) {
      switch (field.type) {
        case CrudFieldType.toggle:
          body[field.key] = _values[field.key] == true;
          break;
        case CrudFieldType.select:
          body[field.key] = _values[field.key];
          break;
        case CrudFieldType.multiSelect:
          final selected = ((_values[field.key] as List?) ?? const [])
              .where((e) => '$e'.trim().isNotEmpty)
              .toList();
          body[field.key] = field.multiSelectAsString
              ? selected.join(field.multiSelectSeparator)
              : selected;
          if (selected.isEmpty && field.sendNullWhenEmpty) {
            body[field.key] = null;
          }
          break;
        case CrudFieldType.date:
          final typed = _controllers[field.key]?.text.trim() ?? '';
          final date = typed.isEmpty
              ? (_values[field.key] as DateTime?)
              : _parseDate(typed);
          if (date == null) {
            body[field.key] = null;
          } else if (field.dateOnly) {
            body[field.key] =
                '${date.year.toString().padLeft(4, '0')}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';
          } else {
            body[field.key] = date.toUtc().toIso8601String();
          }
          break;
        case CrudFieldType.number:
          final text = _controllers[field.key]!.text.trim();
          body[field.key] = text.isEmpty ? null : int.tryParse(text);
          break;
        case CrudFieldType.decimal:
          final text = _controllers[field.key]!.text.trim().replaceAll(
            ',',
            '.',
          );
          body[field.key] = text.isEmpty ? null : double.tryParse(text);
          break;
        case CrudFieldType.text:
        case CrudFieldType.multiline:
          final text = _controllers[field.key]!.text.trim();
          body[field.key] = text.isEmpty
              ? (field.sendNullWhenEmpty ? null : '')
              : text;
          break;
      }
    }
    return body;
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _saving = true);
    Navigator.pop(context, CrudSheetResult(body: _buildBody()));
  }

  Future<void> _pickDate(CrudField field) async {
    final now = DateTime.now();
    final current = _values[field.key] as DateTime?;
    final picked = await showDatePicker(
      context: context,
      initialDate: current ?? now,
      firstDate: DateTime(1900),
      lastDate: DateTime(now.year + 10),
    );
    if (picked != null) {
      setState(() {
        _values[field.key] = picked;
        _controllers[field.key]?.text = _formatDate(picked);
      });
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
              Row(
                children: [
                  Icon(widget.icon, color: AppColors.primaryDark),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      widget.title,
                      style: Theme.of(context).textTheme.titleLarge?.copyWith(
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              for (final field in widget.fields) ...[
                _buildField(field),
                const SizedBox(height: 12),
              ],
              for (final action in widget.rowActions)
                if (action.visible?.call(widget.initial ?? {}) ?? true) ...[
                  OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(
                      foregroundColor: action.color,
                      minimumSize: const Size.fromHeight(46),
                    ),
                    onPressed: _saving
                        ? null
                        : () async {
                            final changed = await action.run(
                              context,
                              widget.initial ?? {},
                            );
                            if (changed && context.mounted) {
                              Navigator.pop(
                                context,
                                const CrudSheetResult(actionRefresh: true),
                              );
                            }
                          },
                    icon: Icon(action.icon),
                    label: Text(action.label),
                  ),
                  const SizedBox(height: 10),
                ],
              const SizedBox(height: 4),
              if (widget.fields.isNotEmpty)
                FilledButton(
                  onPressed: _saving ? null : _submit,
                  child: Text(_saving ? 'Kaydediliyor...' : 'Kaydet'),
                ),
              if (widget.canDelete) ...[
                const SizedBox(height: 8),
                TextButton.icon(
                  onPressed: () => Navigator.pop(
                    context,
                    const CrudSheetResult(deleted: true),
                  ),
                  style: TextButton.styleFrom(foregroundColor: Colors.red),
                  icon: const Icon(Icons.delete_outline_rounded),
                  label: Text(widget.deleteLabel),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildField(CrudField field) {
    switch (field.type) {
      case CrudFieldType.toggle:
        return SwitchListTile.adaptive(
          contentPadding: EdgeInsets.zero,
          value: _values[field.key] == true,
          onChanged: (v) => setState(() => _values[field.key] = v),
          title: Text(field.label),
        );
      case CrudFieldType.select:
        final options = _optionsFor(field);
        if (field.optionsLoader != null && _loadingOptions) {
          return InputDecorator(
            decoration: InputDecoration(labelText: field.label),
            child: const Row(
              children: [
                SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
                SizedBox(width: 10),
                Text('Yükleniyor...'),
              ],
            ),
          );
        }
        final current = options.any((o) => o.value == _values[field.key])
            ? _values[field.key]
            : null;
        if (field.searchable) {
          final selected =
              options.where((o) => o.value == current).firstOrNull;
          return FormField<dynamic>(
            validator: (_) => field.required && current == null
                ? '${field.label} zorunlu.'
                : null,
            builder: (state) => InkWell(
              borderRadius: BorderRadius.circular(12),
              onTap: () async {
                final picked = await _pickSearchableOption(field, options);
                if (picked != null) {
                  setState(() => _values[field.key] = picked.value);
                }
              },
              child: InputDecorator(
                decoration: InputDecoration(
                  labelText: field.label,
                  suffixIcon: const Icon(Icons.search_rounded, size: 20),
                  errorText: state.errorText,
                ),
                isEmpty: selected == null,
                child: selected == null
                    ? const Text('Ara ve seç…',
                        style: TextStyle(color: Colors.black38))
                    : Text(selected.label,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontWeight: FontWeight.w600)),
              ),
            ),
          );
        }
        return DropdownButtonFormField<dynamic>(
          initialValue: current,
          isExpanded: true,
          decoration: InputDecoration(labelText: field.label),
          items: options
              .map(
                (o) => DropdownMenuItem(
                  value: o.value,
                  child: Text(o.label, overflow: TextOverflow.ellipsis),
                ),
              )
              .toList(),
          onChanged: (v) => setState(() => _values[field.key] = v),
          validator: (v) =>
              field.required && v == null ? '${field.label} zorunlu.' : null,
        );
      case CrudFieldType.multiSelect:
        final options = _optionsFor(field);
        if (field.optionsLoader != null && _loadingOptions) {
          return InputDecorator(
            decoration: InputDecoration(labelText: field.label),
            child: const Row(
              children: [
                SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
                SizedBox(width: 10),
                Text('Yükleniyor...'),
              ],
            ),
          );
        }
        final selected = ((_values[field.key] as List?) ?? <dynamic>[]);
        return FormField<List<dynamic>>(
          initialValue: selected,
          validator: (v) => field.required && (v == null || v.isEmpty)
              ? '${field.label} zorunlu.'
              : null,
          builder: (state) => InputDecorator(
            decoration: InputDecoration(
              labelText: field.label,
              errorText: state.errorText,
              helperText: options.isEmpty
                  ? 'Önce hizmet ekleyin; canlı hizmet listesi burada görünür.'
                  : field.hint,
            ),
            child: options.isEmpty
                ? const Text(
                    'Seçilebilir hizmet bulunamadı.',
                    style: TextStyle(color: AppColors.muted),
                  )
                : Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final option in options)
                        FilterChip(
                          label: Text(option.label),
                          selected: selected.contains(option.value),
                          onSelected: (checked) {
                            final next = List<dynamic>.from(selected);
                            if (checked) {
                              next.add(option.value);
                            } else {
                              next.remove(option.value);
                            }
                            setState(() => _values[field.key] = next);
                            state.didChange(next);
                          },
                        ),
                    ],
                  ),
          ),
        );
      case CrudFieldType.date:
        final date = _values[field.key] as DateTime?;
        return TextFormField(
          controller: _controllers[field.key],
          keyboardType: TextInputType.datetime,
          decoration: InputDecoration(
            labelText: field.label,
            hintText: field.hint ?? 'gg.aa.yyyy',
            suffixIcon: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (date != null ||
                    (_controllers[field.key]?.text.isNotEmpty ?? false))
                  IconButton(
                    tooltip: 'Temizle',
                    icon: const Icon(Icons.clear_rounded, size: 18),
                    onPressed: () => setState(() {
                      _values[field.key] = null;
                      _controllers[field.key]?.clear();
                    }),
                  ),
                IconButton(
                  tooltip: 'Takvimden seç',
                  icon: const Icon(Icons.calendar_today_rounded, size: 18),
                  onPressed: () => _pickDate(field),
                ),
              ],
            ),
          ),
          onChanged: (value) {
            final parsed = _parseDate(value);
            if (parsed != null) setState(() => _values[field.key] = parsed);
          },
          validator: (v) {
            final value = (v ?? '').trim();
            if (field.required && value.isEmpty) {
              return '${field.label} zorunlu.';
            }
            if (value.isNotEmpty && _parseDate(value) == null) {
              return 'Tarih gg.aa.yyyy veya yyyy-aa-gg formatında olmalı.';
            }
            return null;
          },
        );
      case CrudFieldType.number:
      case CrudFieldType.decimal:
        return TextFormField(
          controller: _controllers[field.key],
          keyboardType: TextInputType.numberWithOptions(
            decimal: field.type == CrudFieldType.decimal,
          ),
          inputFormatters: field.type == CrudFieldType.number
              ? [FilteringTextInputFormatter.digitsOnly]
              : [FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]'))],
          decoration: InputDecoration(
            labelText: field.label,
            hintText: field.hint,
          ),
          validator: (v) => field.required && (v ?? '').trim().isEmpty
              ? '${field.label} zorunlu.'
              : null,
        );
      case CrudFieldType.text:
      case CrudFieldType.multiline:
        final formatters = <TextInputFormatter>[
          if (field.digitsOnly) FilteringTextInputFormatter.digitsOnly,
          if (field.maxLength != null)
            LengthLimitingTextInputFormatter(field.maxLength),
        ];
        return TextFormField(
          controller: _controllers[field.key],
          maxLines: field.type == CrudFieldType.multiline ? 3 : 1,
          keyboardType: field.digitsOnly
              ? TextInputType.phone
              : (field.type == CrudFieldType.multiline
                    ? TextInputType.multiline
                    : TextInputType.text),
          inputFormatters: formatters.isEmpty ? null : formatters,
          maxLength: field.maxLength,
          decoration: InputDecoration(
            labelText: field.label,
            hintText: field.hint,
            // maxLength sayaç balonunu gizle (alan zaten sınırlı).
            counterText: '',
          ),
          validator: (v) {
            final value = (v ?? '').trim();
            if (field.required && value.isEmpty) {
              return '${field.label} zorunlu.';
            }
            if (value.isNotEmpty &&
                field.exactLength &&
                field.maxLength != null &&
                value.length != field.maxLength) {
              return '${field.label} ${field.maxLength} haneli olmalı.';
            }
            return null;
          },
        );
    }
  }
}
