import 'package:flutter/material.dart';

import '../../core/auth/permissions.dart';
import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/json_helpers.dart';

const _otherSentinel = '__OTHER__';

/// Hizmet/paket formlarının kategori bölümü — web `ServiceFormDialog` ile birebir.
///
/// Kurallar:
///  • Dropdown GERÇEK kategorileri listeler: kayıtlı kategoriler + hizmetlerde fiilen
///    kullanılan adlar. (Eskiden 6 adet sabit "standart kategori" vardı; kurumun kendi
///    kategorileri hiç görünmüyordu.)
///  • "Diğer" satırı seçilince yeni kategori ekleme kutusu açılır; eklenen kategori
///    anında seçili gelir.
///  • Alt kategori dropdown'ı kategori seçilene kadar KAPALIDIR ve yalnızca seçili
///    kategorinin alt kategorilerini gösterir ([onSubChanged] verilirse çizilir).
class ServiceCategoryField extends StatefulWidget {
  const ServiceCategoryField({
    required this.api,
    required this.initialCategory,
    required this.onChanged,
    this.initialSubCategory,
    this.onSubChanged,
    super.key,
  });

  final ApiClient api;
  final String? initialCategory;
  final ValueChanged<String?> onChanged;

  /// Alt kategori başlangıç değeri (düzenleme).
  final String? initialSubCategory;

  /// Verilirse alt kategori dropdown'ı da çizilir (paket formunda alt kategori yok).
  final ValueChanged<String?>? onSubChanged;

  @override
  State<ServiceCategoryField> createState() => _ServiceCategoryFieldState();
}

class _ServiceCategoryFieldState extends State<ServiceCategoryField> {
  String? _category;
  String? _sub;
  bool _creating = false;
  bool _busy = false;
  String _error = '';
  final _newName = TextEditingController();

  List<Map<String, dynamic>> _cats = const [];
  List<Map<String, dynamic>> _services = const [];

  bool get _canManage =>
      widget.api.auth?.user?.canAction(Perm.servicesManage) ?? true;
  bool get _canDelete =>
      widget.api.auth?.user?.canAction(Perm.servicesDelete) ?? true;

  @override
  void initState() {
    super.initState();
    _category = _clean(widget.initialCategory);
    _sub = _clean(widget.initialSubCategory);
    _load();
  }

  @override
  void dispose() {
    _newName.dispose();
    super.dispose();
  }

  static String? _clean(String? v) {
    final t = (v ?? '').trim();
    return t.isEmpty ? null : t;
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait<dynamic>([
        widget.api.get('/api/admin/service-categories/'),
        widget.api
            .get('/api/admin/services/', query: {'page': 1, 'pageSize': 300})
            .catchError((_) => const <dynamic>[]),
      ]);
      if (!mounted) return;
      setState(() {
        _cats = apiItems(results[0]);
        _services = apiItems(results[1]);
      });
    } catch (_) {
      // Kategoriler çekilemezse alan boş listeyle çalışır; form kilitlenmez.
    }
  }

  /// Kayıtlı üst kategoriler (liste SortOrder'a göre gelir).
  List<String> get _registered => _cats
      .where((c) => c['parentId'] == null && c['isActive'] != false)
      .map((c) => '${c['name'] ?? ''}'.trim())
      .where((n) => n.isNotEmpty)
      .toList();

  /// Kaydı olmayan ama hizmetlerde kullanılan adlar — listeden düşmesinler.
  List<String> get _used {
    final registered = _registered.toSet();
    final out = <String>{};
    for (final s in _services) {
      final c = '${s['category'] ?? ''}'.trim();
      if (c.isNotEmpty && !registered.contains(c)) out.add(c);
    }
    // Düzenlenen kaydın kategorisi hiçbir listede yoksa yine de seçili kalabilmeli.
    if (_category != null && !registered.contains(_category)) out.add(_category!);
    final list = out.toList()..sort();
    return list;
  }

  String? get _parentId {
    for (final c in _cats) {
      if (c['parentId'] == null && '${c['name'] ?? ''}'.trim() == _category) {
        return '${c['id']}';
      }
    }
    return null;
  }

  /// Seçili kategorinin alt kategorileri: kayıtlı olanlar + o kategoride kullanılanlar.
  List<String> get _subs {
    if (_category == null) return const [];
    final out = <String>[];
    final pid = _parentId;
    if (pid != null) {
      for (final c in _cats) {
        if ('${c['parentId'] ?? ''}' != pid || c['isActive'] == false) continue;
        final n = '${c['name'] ?? ''}'.trim();
        if (n.isNotEmpty && !out.contains(n)) out.add(n);
      }
    }
    for (final s in _services) {
      if ('${s['category'] ?? ''}'.trim() != _category) continue;
      final n = '${s['subCategory'] ?? ''}'.trim();
      if (n.isNotEmpty && !out.contains(n)) out.add(n);
    }
    if (_sub != null && !out.contains(_sub)) out.add(_sub!);
    return out;
  }

  void _setCategory(String? value) {
    setState(() {
      _category = _clean(value);
      _sub = null; // kategori değişti → önceki alt kategori geçersiz
    });
    widget.onChanged(_category);
    widget.onSubChanged?.call(null);
  }

  void _setSub(String? value) {
    setState(() => _sub = _clean(value));
    widget.onSubChanged?.call(_sub);
  }

  Future<void> _create() async {
    final name = _newName.text.trim();
    if (name.isEmpty) return;
    setState(() {
      _busy = true;
      _error = '';
    });
    try {
      await widget.api.post('/api/admin/service-categories/', {
        'name': name,
        'isActive': true,
      });
      await _load();
      if (!mounted) return;
      setState(() {
        _creating = false;
        _newName.clear();
      });
      _setCategory(name);
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _delete() async {
    final pid = _parentId;
    if (pid == null) return;
    try {
      await widget.api.delete('/api/admin/service-categories/$pid');
      await _load();
      if (mounted) _setCategory(null);
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    }
  }

  @override
  Widget build(BuildContext context) {
    final registered = _registered;
    final used = _used;
    final subs = _subs;
    final canDeleteSelected = _canDelete && _parentId != null && !_creating;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Row(
          children: [
            Icon(Icons.sell_rounded, size: 15, color: AppColors.primaryDark),
            SizedBox(width: 6),
            Text('Kategori', style: TextStyle(fontWeight: FontWeight.w700)),
          ],
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              // FormField.initialValue rebuild'de eşitlenmez; kategori PROGRAMLA
              // değişince (yeni kategori eklenince) görünen değerin güncellenmesi için
              // alan key ile yeniden kurulur.
              child: DropdownButtonFormField<String>(
                key: ValueKey('cat-${_creating ? _otherSentinel : (_category ?? '')}'),
                initialValue: _creating ? _otherSentinel : _category,
                isExpanded: true,
                decoration: const InputDecoration(
                  hintText: '— Kategori seçilmedi —',
                ),
                items: [
                  for (final c in registered)
                    DropdownMenuItem(value: c, child: Text(c)),
                  for (final c in used)
                    DropdownMenuItem(
                      value: c,
                      child: Text('$c  ·  kullanımda'),
                    ),
                  if (_canManage)
                    const DropdownMenuItem(
                      value: _otherSentinel,
                      child: Text('＋ Diğer — yeni kategori ekle…'),
                    ),
                ],
                onChanged: (v) {
                  if (v == _otherSentinel) {
                    setState(() {
                      _creating = true;
                      _error = '';
                    });
                    return;
                  }
                  setState(() => _creating = false);
                  _setCategory(v);
                },
              ),
            ),
            if (canDeleteSelected) ...[
              const SizedBox(width: 8),
              IconButton(
                tooltip: 'Seçili kategoriyi sil',
                onPressed: _busy ? null : _delete,
                icon: const Icon(
                  Icons.delete_outline_rounded,
                  color: AppColors.danger,
                ),
              ),
            ],
          ],
        ),

        // "Diğer" → yeni kategori ekleme kutusu
        if (_creating) ...[
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
                const Text(
                  'Yeni kategori ekle',
                  style: TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: _newName,
                  autofocus: true,
                  textInputAction: TextInputAction.done,
                  decoration: const InputDecoration(
                    isDense: true,
                    hintText: 'Örn. Medikal Estetik',
                  ),
                  onSubmitted: (_) => _create(),
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: FilledButton(
                        style: FilledButton.styleFrom(
                          minimumSize: const Size.fromHeight(42),
                        ),
                        onPressed: _busy ? null : _create,
                        child: Text(_busy ? 'Ekleniyor...' : 'Ekle'),
                      ),
                    ),
                    const SizedBox(width: 8),
                    TextButton(
                      onPressed: _busy
                          ? null
                          : () => setState(() {
                              _creating = false;
                              _newName.clear();
                              _error = '';
                            }),
                      child: const Text('Vazgeç'),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                const Text(
                  'Eklenen kategori tüm hizmet/paket formlarında ve Kategoriler ekranında görünür.',
                  style: TextStyle(fontSize: 11, color: AppColors.muted),
                ),
                if (_error.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Text(
                      _error,
                      style: const TextStyle(color: AppColors.danger, fontSize: 11),
                    ),
                  ),
              ],
            ),
          ),
        ],
        if (!_creating && _error.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(
              _error,
              style: const TextStyle(color: AppColors.danger, fontSize: 11),
            ),
          ),

        // Alt kategori — kategori seçilene kadar kapalı, sonra O kategorinin altları
        if (widget.onSubChanged != null) ...[
          const SizedBox(height: 14),
          const Row(
            children: [
              Icon(
                Icons.account_tree_rounded,
                size: 15,
                color: AppColors.primaryDark,
              ),
              SizedBox(width: 6),
              Text(
                'Alt kategori (opsiyonel)',
                style: TextStyle(fontWeight: FontWeight.w700),
              ),
            ],
          ),
          const SizedBox(height: 8),
          DropdownButtonFormField<String>(
            key: ValueKey('sub-${_category ?? ''}-${_sub ?? ''}'),
            initialValue: _sub,
            isExpanded: true,
            decoration: const InputDecoration(
              hintText: '— Alt kategorisiz —',
            ),
            items: [
              for (final n in subs) DropdownMenuItem(value: n, child: Text(n)),
            ],
            // Kategori yoksa ya da alt kategorisi yoksa alan kapalıdır.
            onChanged: (_category == null || subs.isEmpty) ? null : _setSub,
          ),
          const SizedBox(height: 6),
          Text(
            _category == null
                ? 'Önce kategori seçin; alt kategoriler seçtiğiniz kategoriye göre listelenir.'
                : subs.isEmpty
                    ? '“$_category” kategorisinin alt kategorisi yok. Kategoriler ekranından ekleyebilirsiniz.'
                    : '“$_category” kategorisinin alt kategorileri.',
            style: const TextStyle(fontSize: 11, color: AppColors.muted),
          ),
          if (_sub != null)
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                onPressed: () => _setSub(null),
                icon: const Icon(Icons.close_rounded, size: 15),
                label: const Text('Alt kategoriyi kaldır'),
              ),
            ),
        ],
      ],
    );
  }
}
