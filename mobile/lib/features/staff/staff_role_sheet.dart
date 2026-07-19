import 'package:flutter/material.dart';

import '../../core/network/api_client.dart';
import '../../shared/json_helpers.dart';
import '../../shared/photo_utils.dart';

/// "Rol Düzenle / Yeni Personel" — web StaffFormDialog'un Stitch tasarımlı mobil karşılığı.
///
/// Üstte canlı personel kartı (avatar + ad/unvan + "X SAYFA · Y İŞLEM" rozetleri),
/// kompakt kimlik alanları ve iki seviyeli yetki listesi: sayfa switch'i +
/// sayfa açıkken işlem çipleri ("görsün ama yapamasın"). Kaydet → istek gövdesini
/// `Navigator.pop(context, body)` ile döndürür; API çağrısını (POST/PUT) çağıran yapar.
/// [isCreate] true ise şube seçimi + opsiyonel e-posta alanı da gösterilir.
class StaffRoleSheet extends StatefulWidget {
  const StaffRoleSheet({
    required this.api,
    this.staff = const {},
    this.isCreate = false,
    super.key,
  });

  final ApiClient api;
  final Map<String, dynamic> staff;
  final bool isCreate;

  @override
  State<StaffRoleSheet> createState() => _StaffRoleSheetState();
}

// BeautyAsist rose-gold light token'ları (Stitch tasarımıyla birebir).
const _cream = Color(0xFFF7ECF1);
const _cardBorder = Color(0xFFEFE1E7);
const _rose = Color(0xFFC85776);
const _gold = Color(0xFFB88938);
const _ink = Color(0xFF241923);
const _body = Color(0xFF4A3A44);
const _muted = Color(0xFF705A66);

const _pageIcons = <String, IconData>{
  'Customers': Icons.group_rounded,
  'Appointments': Icons.calendar_month_rounded,
  'Waitlist': Icons.hourglass_top_rounded,
  'Services': Icons.workspaces_rounded,
  'GiftCards': Icons.card_giftcard_rounded,
  'Stock': Icons.inventory_2_rounded,
  'CashRegister': Icons.account_balance_wallet_rounded,
  'CashClosing': Icons.fact_check_rounded,
  'Accounting': Icons.account_balance_rounded,
  'Reports': Icons.bar_chart_rounded,
  'Notifications': Icons.notifications_active_rounded,
  'Logs': Icons.history_rounded,
  'Settings': Icons.settings_rounded,
};

class _PermAction {
  const _PermAction(this.key, this.label);
  final String key;
  final String label;
}

class _PermPage {
  const _PermPage(this.key, this.label, this.description, this.actions);
  final String key;
  final String label;
  final String description;
  final List<_PermAction> actions;
}

class _StaffRoleSheetState extends State<StaffRoleSheet> {
  late Future<List<_PermPage>> _catalog;
  late final Set<String> _granted;
  late final TextEditingController _fullName;
  late final TextEditingController _title;
  late final TextEditingController _phone;
  late final TextEditingController _email;
  late final TextEditingController _commission;
  late bool _isActive;
  late String _photoUrl;
  List<_PermPage> _pages = const [];
  // Yeni personelde şube seçimi (düzenlemede şube bu ekrandan değişmez).
  List<Map<String, dynamic>> _branches = const [];
  String? _branchId;
  // Yapabildiği işlem kategorileri — boş küme = kısıt yok (tüm kategoriler).
  late final Set<String> _specialties;
  List<String> _categoryOptions = const [];
  bool _categoriesLoading = true;

  @override
  void initState() {
    super.initState();
    final s = widget.staff;
    _fullName = TextEditingController(text: '${s['fullName'] ?? ''}');
    _title = TextEditingController(
        text: widget.isCreate ? 'Estetisyen' : '${s['title'] ?? ''}');
    _phone = TextEditingController(text: '${s['phone'] ?? ''}');
    _email = TextEditingController();
    _commission = TextEditingController(
        text: '${(s['commissionRate'] as num?) ?? (widget.isCreate ? 10 : 0)}');
    _isActive = s['isActive'] != false;
    final rawPhoto = '${s['photoUrl'] ?? ''}';
    _photoUrl = rawPhoto == 'null' ? '' : rawPhoto;
    final raw = s['permissions'];
    _granted = raw is Iterable
        ? raw.map((e) => '$e').where((e) => e.isNotEmpty).toSet()
        : <String>{};
    _specialties = '${s['specialties'] ?? ''}'
        .split(',')
        .map((e) => e.trim())
        .where((e) => e.isNotEmpty && e != 'null')
        .toSet();
    _catalog = _loadCatalog();
    _loadCategories();
    if (widget.isCreate) _loadBranches();
  }

  /// Kategori havuzu: özel kategoriler + hizmetlerde kullanılan kategori adları
  /// (web StaffFormDialog ile aynı kaynak).
  Future<void> _loadCategories() async {
    try {
      final results = await Future.wait([
        widget.api.get('/api/admin/service-categories/').catchError((_) => const <dynamic>[]),
        widget.api
            .get('/api/admin/services/', query: {'page': 1, 'pageSize': 300})
            .catchError((_) => const <dynamic>[]),
      ]);
      final names = <String>{};
      for (final c in apiItems(results[0])) {
        final n = '${c['name'] ?? ''}'.trim();
        if (n.isNotEmpty) names.add(n);
      }
      for (final s in apiItems(results[1])) {
        final n = '${s['category'] ?? ''}'.trim();
        if (n.isNotEmpty) names.add(n);
      }
      if (mounted) {
        setState(() {
          _categoryOptions = names.toList()..sort((a, b) => a.compareTo(b));
          _categoriesLoading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _categoriesLoading = false);
    }
  }

  Future<void> _loadBranches() async {
    try {
      final data = await widget.api.get('/api/admin/branches/');
      final branches = apiItems(data);
      if (!mounted) return;
      setState(() {
        _branches = branches;
        final def = branches.firstWhere((b) => b['isDefault'] == true,
            orElse: () => branches.isEmpty ? const {} : branches.first);
        _branchId = def['id']?.toString();
      });
    } catch (_) {
      /* şube listesi gelmezse dropdown boş kalır; kaydette uyarı verilir */
    }
  }

  Future<List<_PermPage>> _loadCatalog() async {
    final data = await widget.api.get('/api/admin/staff/permissions');
    final pages = apiItems(data).map((p) {
      final actionsRaw = p['actions'];
      final actions = actionsRaw is Iterable
          ? actionsRaw
              .whereType<Map>()
              .map((a) => _PermAction('${a['key']}', '${a['label']}'))
              .toList(growable: false)
          : const <_PermAction>[];
      return _PermPage('${p['key']}', valueOf(p, const ['label', 'key']),
          '${p['description'] ?? ''}', actions);
    }).toList(growable: false);
    _pages = pages;
    return pages;
  }

  @override
  void dispose() {
    _fullName.dispose();
    _title.dispose();
    _phone.dispose();
    _email.dispose();
    _commission.dispose();
    super.dispose();
  }

  int get _pageCount => _pages.where((p) => _granted.contains(p.key)).length;
  int get _actionCount => _granted.where((k) => k.contains('.')).length;

  String get _initials {
    final parts = _fullName.text
        .trim()
        .split(RegExp(r'\s+'))
        .where((p) => p.isNotEmpty)
        .take(2)
        .map((p) => p[0].toUpperCase());
    final joined = parts.join();
    return joined.isEmpty ? '•' : joined;
  }

  // Sayfa switch'i: açılınca sayfa + TÜM işlemleri verilir; kapanınca birlikte kalkar.
  void _togglePage(_PermPage page, bool next) {
    setState(() {
      if (next) {
        _granted.add(page.key);
        _granted.addAll(page.actions.map((a) => a.key));
      } else {
        _granted.remove(page.key);
        _granted.removeAll(page.actions.map((a) => a.key));
      }
    });
  }

  void _toggleAction(String key) {
    setState(() {
      if (!_granted.remove(key)) _granted.add(key);
    });
  }

  void _selectAll() {
    setState(() {
      for (final p in _pages) {
        _granted.add(p.key);
        _granted.addAll(p.actions.map((a) => a.key));
      }
    });
  }

  void _selectNone() => setState(_granted.clear);

  void _save() {
    if (_fullName.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Ad soyad boş olamaz.')));
      return;
    }
    if (widget.isCreate && (_branchId == null || _branchId!.isEmpty)) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Şube seçimi zorunlu.')));
      return;
    }
    Navigator.pop(context, <String, dynamic>{
      if (widget.isCreate) 'branchId': _branchId,
      if (widget.isCreate)
        'email': _email.text.trim().isEmpty ? null : _email.text.trim(),
      'fullName': _fullName.text.trim(),
      'title': _title.text.trim(),
      'phone': _phone.text.trim().isEmpty ? null : _phone.text.trim(),
      // Yapabildiği işlem kategorileri (boş = kısıt yok).
      'specialties': _specialties.isEmpty ? null : _specialties.join(', '),
      'commissionRate':
          double.tryParse(_commission.text.trim().replaceAll(',', '.')) ?? 0,
      'isActive': _isActive,
      'permissions': _granted.toList(),
      // '' → backend SetPhoto null'a çevirir (fotoğrafı kaldır).
      'photoUrl': _photoUrl,
    });
  }

  Future<void> _changePhoto() async {
    final result =
        await pickPhotoDataUrl(context, allowRemove: _photoUrl.isNotEmpty);
    if (result == null) return; // vazgeçildi
    setState(() => _photoUrl = result);
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: _cream,
        borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
      ),
      constraints:
          BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.94),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 10),
            Container(
              width: 42,
              height: 4,
              decoration: BoxDecoration(
                color: _cardBorder,
                borderRadius: BorderRadius.circular(99),
              ),
            ),
            const SizedBox(height: 12),
            Text(widget.isCreate ? 'Yeni Personel' : 'Personel Düzenle',
                style: const TextStyle(
                    fontSize: 17, fontWeight: FontWeight.w800, color: _ink)),
            const SizedBox(height: 12),
            Flexible(
              child: SingleChildScrollView(
                padding: EdgeInsets.fromLTRB(
                    16, 0, 16, MediaQuery.viewInsetsOf(context).bottom + 8),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    _personCard(),
                    const SizedBox(height: 14),
                    _identityFields(),
                    const SizedBox(height: 18),
                    _specialtySection(),
                    const SizedBox(height: 18),
                    _permissionSection(),
                  ],
                ),
              ),
            ),
            _stickyFooter(),
          ],
        ),
      ),
    );
  }

  // --- Üst: canlı personel kartı ---
  Widget _personCard() {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: _cardBorder),
      ),
      child: Row(
        children: [
          // Rose-gold halkalı avatar — dokun: kamera/galeri ile fotoğraf değiştir.
          GestureDetector(
            onTap: _changePhoto,
            child: Stack(
              clipBehavior: Clip.none,
              children: [
                Container(
                  width: 56,
                  height: 56,
                  padding: const EdgeInsets.all(2),
                  decoration: const BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: LinearGradient(
                      colors: [
                        Color(0xFFFFD3DF),
                        Color(0xFFE9A6BF),
                        Color(0xFFD9A441)
                      ],
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                    ),
                  ),
                  child: Container(
                    alignment: Alignment.center,
                    clipBehavior: Clip.antiAlias,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: Colors.white,
                      image: imageProviderOf(_photoUrl) != null
                          ? DecorationImage(
                              image: imageProviderOf(_photoUrl)!,
                              fit: BoxFit.cover)
                          : null,
                    ),
                    child: imageProviderOf(_photoUrl) == null
                        ? Text(_initials,
                            style: const TextStyle(
                                color: _rose,
                                fontWeight: FontWeight.w800,
                                fontSize: 18,
                                letterSpacing: 1))
                        : null,
                  ),
                ),
                // Kamera rozeti — fotoğraf değiştirilebileceğini gösterir.
                Positioned(
                  right: -2,
                  bottom: -2,
                  child: Container(
                    width: 22,
                    height: 22,
                    decoration: BoxDecoration(
                      color: _rose,
                      shape: BoxShape.circle,
                      border: Border.all(color: Colors.white, width: 2),
                    ),
                    child: const Icon(Icons.photo_camera_rounded,
                        size: 12, color: Colors.white),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _fullName.text.trim().isEmpty
                      ? 'Personel'
                      : _fullName.text.trim(),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                      fontSize: 15.5, fontWeight: FontWeight.w800, color: _ink),
                ),
                Text(
                  _title.text.trim().isEmpty ? 'Unvan' : _title.text.trim(),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 11.5, color: _rose),
                ),
                const SizedBox(height: 6),
                Row(
                  children: [
                    _miniBadge('$_pageCount SAYFA', _gold),
                    const SizedBox(width: 6),
                    _miniBadge('$_actionCount İŞLEM', _rose),
                  ],
                ),
              ],
            ),
          ),
          Column(
            children: [
              Switch(
                value: _isActive,
                activeThumbColor: Colors.white,
                activeTrackColor: _rose,
                onChanged: (v) => setState(() => _isActive = v),
              ),
              Text(_isActive ? 'Aktif' : 'Pasif',
                  style: TextStyle(
                      fontSize: 9.5,
                      fontWeight: FontWeight.w800,
                      color: _isActive
                          ? const Color(0xFF2F9E72)
                          : const Color(0xFFD1556F))),
            ],
          ),
        ],
      ),
    );
  }

  Widget _miniBadge(String text, Color color) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: color.withValues(alpha: .35)),
        ),
        child: Text(text,
            style: TextStyle(
                fontSize: 9,
                letterSpacing: .6,
                fontWeight: FontWeight.w800,
                color: color)),
      );

  // --- Kimlik alanları ---
  Widget _identityFields() {
    return Column(
      children: [
        _field('Ad Soyad', _fullName, onChanged: () => setState(() {})),
        const SizedBox(height: 10),
        Row(
          children: [
            Expanded(
              flex: 3,
              child:
                  _field('Unvan', _title, onChanged: () => setState(() {})),
            ),
            const SizedBox(width: 10),
            Expanded(
              flex: 2,
              child: _field('Prim %', _commission,
                  keyboardType:
                      const TextInputType.numberWithOptions(decimal: true)),
            ),
          ],
        ),
        const SizedBox(height: 10),
        _field('Telefon', _phone,
            keyboardType: TextInputType.phone, hint: '05XXXXXXXXX'),
        if (widget.isCreate) ...[
          const SizedBox(height: 10),
          // Şube — yalnız oluşturmada seçilir (düzenlemede Şube Aktar akışı kullanılır).
          DropdownButtonFormField<String>(
            initialValue: _branchId,
            isExpanded: true,
            style: const TextStyle(fontSize: 14, color: _ink),
            decoration: InputDecoration(
              isDense: true,
              labelText: 'Şube',
              filled: true,
              fillColor: Colors.white,
              labelStyle: const TextStyle(fontSize: 12.5, color: _muted),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: const BorderSide(color: _cardBorder),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: const BorderSide(color: _rose, width: 1.4),
              ),
            ),
            items: [
              for (final b in _branches)
                DropdownMenuItem(
                  value: '${b['id']}',
                  child: Text(valueOf(b, const ['name']),
                      overflow: TextOverflow.ellipsis),
                ),
            ],
            onChanged: (v) => setState(() => _branchId = v),
          ),
          const SizedBox(height: 10),
          _field('E-posta (boş bırak → otomatik üretilir)', _email,
              keyboardType: TextInputType.emailAddress),
        ],
      ],
    );
  }

  Widget _field(String label, TextEditingController controller,
      {TextInputType? keyboardType, String? hint, VoidCallback? onChanged}) {
    return TextField(
      controller: controller,
      keyboardType: keyboardType,
      onChanged: onChanged == null ? null : (_) => onChanged(),
      style: const TextStyle(fontSize: 14, color: _ink),
      decoration: InputDecoration(
        isDense: true,
        labelText: label,
        hintText: hint,
        filled: true,
        fillColor: Colors.white,
        labelStyle: const TextStyle(fontSize: 12.5, color: _muted),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: _cardBorder),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: _rose, width: 1.4),
        ),
      ),
    );
  }

  // --- Yapabildiği işlem kategorileri ---
  Widget _specialtySection() {
    // Kategori havuzunda olmayan eski seçimler de (hizmet adı saklayan kayıtlar)
    // kaldırılabilsin diye çip olarak gösterilir.
    final options = [
      ..._categoryOptions,
      ..._specialties.where((s) => !_categoryOptions.contains(s)),
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Row(
          children: [
            Icon(Icons.category_rounded, size: 16, color: _rose),
            SizedBox(width: 6),
            Text('Yapabildiği İşlem Kategorileri',
                style: TextStyle(
                    fontSize: 14, fontWeight: FontWeight.w800, color: _ink)),
          ],
        ),
        const SizedBox(height: 4),
        const Text(
          'Personel yalnızca seçili kategorilerdeki hizmetlere randevu alabilir. Hiçbiri seçilmezse tümünde çalışabilir.',
          style: TextStyle(fontSize: 10.5, color: _muted),
        ),
        const SizedBox(height: 10),
        if (_categoriesLoading)
          const Center(
              child: Padding(
            padding: EdgeInsets.symmetric(vertical: 10),
            child: CircularProgressIndicator(color: _rose),
          ))
        else if (options.isEmpty)
          const Text('Kategori bulunamadı — önce hizmetlere kategori atayın.',
              style: TextStyle(fontSize: 11.5, color: _muted))
        else
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final name in options)
                InkWell(
                  borderRadius: BorderRadius.circular(9),
                  onTap: () => setState(() {
                    if (!_specialties.remove(name)) _specialties.add(name);
                  }),
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 10, vertical: 6),
                    decoration: BoxDecoration(
                      color: _specialties.contains(name)
                          ? _rose.withValues(alpha: .10)
                          : Colors.white,
                      borderRadius: BorderRadius.circular(9),
                      border: Border.all(
                          color: _specialties.contains(name)
                              ? _rose.withValues(alpha: .45)
                              : _cardBorder),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                            _specialties.contains(name)
                                ? Icons.check_circle_rounded
                                : Icons.add_circle_outline_rounded,
                            size: 13,
                            color: _specialties.contains(name)
                                ? _rose
                                : _muted.withValues(alpha: .6)),
                        const SizedBox(width: 5),
                        Text(name,
                            style: TextStyle(
                                fontSize: 11.5,
                                fontWeight: FontWeight.w700,
                                color: _specialties.contains(name)
                                    ? _rose
                                    : _body)),
                      ],
                    ),
                  ),
                ),
            ],
          ),
      ],
    );
  }

  // --- Yetki bölümü ---
  Widget _permissionSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            const Icon(Icons.shield_rounded, size: 16, color: _rose),
            const SizedBox(width: 6),
            const Expanded(
              child: Text('Rol & Sayfa Yetkileri',
                  style: TextStyle(
                      fontSize: 14, fontWeight: FontWeight.w800, color: _ink)),
            ),
            TextButton(
              onPressed: _selectAll,
              style: TextButton.styleFrom(
                  padding: const EdgeInsets.symmetric(horizontal: 6),
                  minimumSize: const Size(0, 30)),
              child: const Text('Tümü',
                  style: TextStyle(fontSize: 12, color: _rose)),
            ),
            const Text('/', style: TextStyle(color: _cardBorder)),
            TextButton(
              onPressed: _selectNone,
              style: TextButton.styleFrom(
                  padding: const EdgeInsets.symmetric(horizontal: 6),
                  minimumSize: const Size(0, 30)),
              child: const Text('Hiçbiri',
                  style: TextStyle(fontSize: 12, color: _muted)),
            ),
          ],
        ),
        const SizedBox(height: 4),
        FutureBuilder<List<_PermPage>>(
          future: _catalog,
          builder: (context, snapshot) {
            if (snapshot.connectionState != ConnectionState.done) {
              return const Padding(
                padding: EdgeInsets.symmetric(vertical: 28),
                child: Center(
                    child: CircularProgressIndicator(color: _rose)),
              );
            }
            if (snapshot.hasError) {
              return Padding(
                padding: const EdgeInsets.symmetric(vertical: 20),
                child: Text('Yetki kataloğu yüklenemedi: ${snapshot.error}',
                    style: const TextStyle(fontSize: 12, color: _muted)),
              );
            }
            final pages = snapshot.data ?? const <_PermPage>[];
            return Column(
              children: [for (final p in pages) _pageCard(p)],
            );
          },
        ),
      ],
    );
  }

  Widget _pageCard(_PermPage page) {
    final active = _granted.contains(page.key);
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Opacity(
        opacity: active ? 1 : 0.7,
        child: Container(
          clipBehavior: Clip.antiAlias,
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
                color: active ? _rose.withValues(alpha: .35) : _cardBorder),
          ),
          child: IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // Aktif sol vurgu şeridi
                Container(width: 4, color: active ? _rose : Colors.transparent),
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(12, 10, 10, 10),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Icon(
                                _pageIcons[page.key] ??
                                    Icons.description_rounded,
                                size: 19,
                                color: active ? _rose : _muted),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(page.label,
                                  style: const TextStyle(
                                      fontSize: 13.5,
                                      fontWeight: FontWeight.w800,
                                      color: _ink)),
                            ),
                            Switch(
                              value: active,
                              activeThumbColor: Colors.white,
                              activeTrackColor: _rose,
                              onChanged: (v) => _togglePage(page, v),
                            ),
                          ],
                        ),
                        if (!active)
                          const Padding(
                            padding: EdgeInsets.only(left: 27),
                            child: Text('Erişim yok',
                                style:
                                    TextStyle(fontSize: 11, color: _muted)),
                          )
                        else if (page.actions.isNotEmpty) ...[
                          const Divider(height: 14, color: _cream),
                          Wrap(
                            spacing: 6,
                            runSpacing: 6,
                            children: [
                              for (final a in page.actions)
                                _actionChip(a, _granted.contains(a.key)),
                            ],
                          ),
                        ] else
                          Padding(
                            padding: const EdgeInsets.only(left: 27),
                            child: Text(page.description,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                    fontSize: 10.5, color: _muted)),
                          ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _actionChip(_PermAction action, bool on) {
    return InkWell(
      borderRadius: BorderRadius.circular(9),
      onTap: () => _toggleAction(action.key),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
        decoration: BoxDecoration(
          color: on ? Colors.white : _cream,
          borderRadius: BorderRadius.circular(9),
          border: Border.all(
              color: on ? _rose.withValues(alpha: .45) : _cardBorder),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(on ? Icons.check_circle_rounded : Icons.cancel_rounded,
                size: 13,
                color: on ? _rose : _muted.withValues(alpha: .5)),
            const SizedBox(width: 5),
            Text(
              action.label,
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: on ? _body : _muted.withValues(alpha: .6),
                decoration: on ? null : TextDecoration.lineThrough,
              ),
            ),
          ],
        ),
      ),
    );
  }

  // --- Sticky alt bar ---
  Widget _stickyFooter() {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 12),
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: _cardBorder)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text(
            'Sayfayı açınca tüm işlemleri açılır; istemediğini çipten kapat.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 10.5, color: _muted),
          ),
          const SizedBox(height: 8),
          SizedBox(
            width: double.infinity,
            height: 48,
            child: DecoratedBox(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(13),
                gradient: const LinearGradient(
                  colors: [Color(0xFFF47699), Color(0xFFEF6088)],
                ),
                boxShadow: [
                  BoxShadow(
                    color: _rose.withValues(alpha: .35),
                    blurRadius: 20,
                    offset: const Offset(0, 8),
                  ),
                ],
              ),
              child: TextButton.icon(
                onPressed: _save,
                icon: const Icon(Icons.save_rounded,
                    size: 18, color: Colors.white),
                label: const Text('Kaydet',
                    style: TextStyle(
                        color: Colors.white,
                        fontSize: 14.5,
                        fontWeight: FontWeight.w800)),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
