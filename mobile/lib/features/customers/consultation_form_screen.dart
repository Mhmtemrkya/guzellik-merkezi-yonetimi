import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/json_helpers.dart';
import '../../shared/widgets/app_background.dart';
import '../../shared/widgets/page_header.dart';
import 'customer_picker.dart';

/// Müşteri Bilgi ve Onay Formu — web `ConsultationForm` bileşeninin birebir mobil karşılığı.
///
/// Tek okuma görünümü, tek editör ve tek upsert işlemi. Form oluşturma ile mevcut
/// formu düzenleme aynı editör durumunu kullanır. Bayrak/cilt tipi/serbest metin
/// listeleri, işlem uygunluğu uyarı motoru ve tüm metinler web ile aynıdır.
class ConsultationFormScreen extends StatefulWidget {
  const ConsultationFormScreen({
    required this.api,
    this.customerId,
    this.customerName,
    this.startInCreateMode = false,
    super.key,
  });

  final ApiClient api;
  final String? customerId;
  final String? customerName;
  final bool startInCreateMode;

  @override
  State<ConsultationFormScreen> createState() => _ConsultationFormScreenState();
}

// --- Web ile birebir veri tanımları (lib/consultation.ts) ---

/// İşlem uygunluğu uyarısı üreten müşteri beyan bayrakları.
const _flags = <_ConsultFlag>[
  _ConsultFlag('isPregnant', 'Gebelik'),
  _ConsultFlag('isBreastfeeding', 'Emzirme'),
  _ConsultFlag('hasPacemakerOrImplant', 'Kalp pili / metal implant'),
  _ConsultFlag('hasEpilepsy', 'Epilepsi'),
  _ConsultFlag('hasDiabetes', 'Diyabet'),
  _ConsultFlag('hasCancerHistory', 'Kanser öyküsü'),
  _ConsultFlag('usesBloodThinners', 'Kan sulandırıcı kullanımı'),
  _ConsultFlag('usedIsotretinoin', 'İzotretinoin (Roaccutane, son 6 ay)'),
  _ConsultFlag('hasKeloidTendency', 'Keloid / kötü iz eğilimi'),
  _ConsultFlag('hasActiveSkinIssue', 'Aktif cilt enfeksiyonu / uçuk'),
  _ConsultFlag('recentSunExposure', 'Son dönem güneş / bronzlaşma'),
];

const _skinTypes = <_SkinType>[
  _SkinType('Unknown', 'Belirtilmemiş'),
  _SkinType('Type1', 'Tip I — Çok açık, her zaman yanar'),
  _SkinType('Type2', 'Tip II — Açık, kolay yanar'),
  _SkinType('Type3', 'Tip III — Buğday, bazen yanar'),
  _SkinType('Type4', 'Tip IV — Zeytin, az yanar'),
  _SkinType('Type5', 'Tip V — Esmer, nadir yanar'),
  _SkinType('Type6', 'Tip VI — Koyu, yanmaz'),
];

/// Editördeki serbest metin alanları (web TEXT_FIELDS ile birebir).
const _textFields = <_TextFieldDef>[
  _TextFieldDef('complaint', 'Şikayet / talep', 'Müşterinin başvuru nedeni…'),
  _TextFieldDef('allergies', 'Alerjiler', 'Bilinen alerjiler…'),
  _TextFieldDef('medications', 'Kullanılan ilaçlar', 'Düzenli ilaçlar…'),
  _TextFieldDef(
    'chronicConditions',
    'Kronik rahatsızlıklar',
    'Tansiyon, tiroid, kalp…',
  ),
  _TextFieldDef('notes', 'Ek notlar', 'Gözlem / plan…'),
];

/// Görüntüleme (özet) bölümündeki kısa alan etiketleri (web view ile birebir).
const _viewFieldLabels = <String, String>{
  'complaint': 'Şikayet / talep',
  'allergies': 'Alerjiler',
  'medications': 'İlaçlar',
  'chronicConditions': 'Kronik',
  'notes': 'Notlar',
};

/// Müşteri beyanlarından işlem uygunluğu uyarılarını üretir.
/// Web `deriveConsultationWarnings` ile birebir aynı motor → tek doğruluk kaynağı.
List<_ConsultWarning> _warnings(Map<String, dynamic> f) {
  final w = <_ConsultWarning>[];
  void add(String severity, String title, String detail) =>
      w.add(_ConsultWarning(severity, title, detail));

  if (f['isPregnant'] == true) {
    add(
      'high',
      'Gebelik',
      'Lazer/IPL epilasyon, kimyasal peeling, RF ve iğneli (mezoterapi) işlemler önerilmez.',
    );
  }
  if (f['isBreastfeeding'] == true) {
    add(
      'medium',
      'Emzirme',
      'Kimyasal peeling ve bazı aktif içerikler/mezoterapi önerilmez; hekime danışın.',
    );
  }
  if (f['hasPacemakerOrImplant'] == true) {
    add(
      'high',
      'Kalp pili / metal implant',
      'RF, elektroterapi ve bazı cihazlar uygulanmamalı.',
    );
  }
  if (f['hasEpilepsy'] == true) {
    add(
      'medium',
      'Epilepsi',
      'Yoğun ışık (IPL/lazer) nöbet tetikleyebilir; dikkatli olun.',
    );
  }
  if (f['hasDiabetes'] == true) {
    add(
      'medium',
      'Diyabet',
      'Yara iyileşmesi yavaş; iğneli/ablatif işlemlerde enfeksiyon riski.',
    );
  }
  if (f['hasCancerHistory'] == true) {
    add(
      'high',
      'Onkoloji öyküsü',
      'Hekim onayı olmadan ışık/RF/iğneli işlem yapılmamalı.',
    );
  }
  if (f['usesBloodThinners'] == true) {
    add('medium', 'Kan sulandırıcı', 'İğneli işlemlerde morarma/kanama riski.');
  }
  if (f['usedIsotretinoin'] == true) {
    add(
      'high',
      'İzotretinoin (Roaccutane)',
      'Lazer, peeling ve ağda kontrendike; son kullanımdan en az 6 ay sonra.',
    );
  }
  if (f['hasKeloidTendency'] == true) {
    add('medium', 'Keloid eğilimi', 'İğneli/ablatif işlemlerde skar/keloid riski.');
  }
  if (f['hasActiveSkinIssue'] == true) {
    add(
      'high',
      'Aktif cilt enfeksiyonu / uçuk',
      'İyileşene dek bölgesel işlemler ertelenmeli.',
    );
  }
  if (f['recentSunExposure'] == true) {
    add(
      'medium',
      'Son dönem güneş / bronzlaşma',
      'Lazer/IPL’de yanık ve leke riski; 2–4 hafta bekleyin.',
    );
  }
  return w;
}

class _ConsultationFormScreenState extends State<ConsultationFormScreen> {
  final _newOption = TextEditingController();
  final _textCtrls = <String, TextEditingController>{};

  String? _customerId;
  String? _customerName;
  Future<_ConsultData>? _future;

  bool _editing = false;
  bool _creatingNew = false;
  bool _busy = false;
  String? _error;
  String? _pendingMessage;

  final Map<String, dynamic> _draft = {};

  @override
  void initState() {
    super.initState();
    _customerId = _normalizeId(widget.customerId);
    _customerName = widget.customerName;
    if (_customerId == null) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _ensureCustomer());
    } else {
      if (widget.startInCreateMode) {
        _prepareDraft(null);
        _editing = true;
        _creatingNew = true;
      }
      _future = _load();
    }
  }

  @override
  void dispose() {
    _newOption.dispose();
    for (final controller in _textCtrls.values) {
      controller.dispose();
    }
    super.dispose();
  }

  // --- Yardımcılar ---

  String? _normalizeId(String? value) {
    final id = value?.trim();
    if (id == null || id.isEmpty || id.toLowerCase() == 'null') return null;
    return id;
  }

  bool _hasForm(Map<String, dynamic>? form) => form?['id'] != null;

  String _validSkinType(dynamic value) {
    final raw = '${value ?? 'Unknown'}';
    return _skinTypes.any((skin) => skin.value == raw) ? raw : 'Unknown';
  }

  List<String> _stringList(dynamic value) {
    if (value is Iterable) {
      return value
          .map((item) => '$item'.trim())
          .where((item) => item.isNotEmpty)
          .toList();
    }
    final raw = '${value ?? ''}'.trim();
    return raw.isEmpty ? <String>[] : <String>[raw];
  }

  /// Büyük/küçük harf duyarsız tekilleştirme (web uniqueLabels).
  List<String> _uniqueLabels(Iterable<String> labels) {
    final seen = <String>{};
    final out = <String>[];
    for (final raw in labels) {
      final label = raw.trim();
      if (label.isEmpty) continue;
      final key = label.toLowerCase();
      if (seen.add(key)) out.add(label);
    }
    return out;
  }

  // --- Veri yükleme ---

  Future<void> _ensureCustomer() async {
    final picked = await pickCustomer(context, widget.api);
    if (!mounted) return;
    if (picked == null) {
      if (Navigator.canPop(context)) Navigator.pop(context);
      return;
    }

    final id = _normalizeId(picked.id);
    if (id == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Müşteri kaydı henüz hazır değil. Listeyi yenileyip tekrar deneyin.',
          ),
        ),
      );
      return;
    }

    setState(() {
      _customerId = id;
      _customerName = picked.name;
      _editing = false;
      _creatingNew = false;
      _error = null;
      _pendingMessage = null;
      _future = _load();
    });
  }

  Future<_ConsultData> _load() async {
    final branchId = _normalizeId(widget.api.auth?.user?.branchId);
    final result = await Future.wait<dynamic>([
      widget.api
          .get('/api/admin/customers/$_customerId/consultation')
          .catchError((_) => null),
      widget.api
          .get(
            '/api/admin/consultation-options',
            query: {'branchId': ?branchId},
          )
          .catchError((_) => const <dynamic>[]),
    ]);

    final rawForm = result[0];
    final form = rawForm is Map ? rawForm.cast<String, dynamic>() : null;

    final options = <_ConsultOption>[];
    if (result[1] is List) {
      for (final item in result[1] as List) {
        if (item is! Map) continue;
        final map = item.cast<String, dynamic>();
        final label = valueOf(map, const ['label'], fallback: '').trim();
        if (label.isEmpty) continue;
        options.add(_ConsultOption('${map['id'] ?? ''}', label));
      }
    }

    return _ConsultData(form: form, options: options);
  }

  Future<void> _reload() async {
    setState(() { _future = _load(); });
    await _future;
  }

  // --- Editör durumu ---

  Map<String, dynamic> _emptyDraft() => {
    for (final flag in _flags) flag.key: false,
    'skinType': 'Unknown',
    for (final field in _textFields) field.key: '',
    'consentGiven': false,
    'customSelections': <String>[],
  };

  void _prepareDraft(Map<String, dynamic>? form) {
    final next = <String, dynamic>{..._emptyDraft(), ...?form};

    for (final flag in _flags) {
      next[flag.key] = next[flag.key] == true;
    }
    next['skinType'] = _validSkinType(next['skinType']);
    next['consentGiven'] = next['consentGiven'] == true;
    next['customSelections'] = _stringList(next['customSelections']);
    for (final field in _textFields) {
      next[field.key] = '${next[field.key] ?? ''}';
    }

    _draft
      ..clear()
      ..addAll(next);

    for (final field in _textFields) {
      _textCtrls.putIfAbsent(field.key, TextEditingController.new).text =
          '${_draft[field.key] ?? ''}';
    }
    _newOption.clear();
  }

  void _startCreate() {
    if (_normalizeId(_customerId) == null) return;
    _startEdit(null, creatingNew: true);
  }

  void _startEdit(Map<String, dynamic>? form, {bool creatingNew = false}) {
    _prepareDraft(form);
    setState(() {
      _editing = true;
      _creatingNew = creatingNew;
      _error = null;
      _pendingMessage = null;
    });
  }

  void _cancelEdit() {
    setState(() {
      _editing = false;
      _creatingNew = false;
      _error = null;
    });
  }

  // --- "Özel" bölümü ---

  List<String> get _selectedCustom => _stringList(_draft['customSelections']);

  bool _customSelected(String label) =>
      _selectedCustom.any((item) => item.toLowerCase() == label.toLowerCase());

  void _toggleCustom(String label) {
    final selected = _selectedCustom;
    setState(() {
      _draft['customSelections'] = _customSelected(label)
          ? selected
                .where((item) => item.toLowerCase() != label.toLowerCase())
                .toList()
          : [...selected, label];
    });
  }

  void _addCustom() {
    final label = _newOption.text.trim();
    if (label.isEmpty) return;
    if (!_customSelected(label)) {
      setState(() => _draft['customSelections'] = [..._selectedCustom, label]);
    }
    _newOption.clear();
  }

  /// Seçeneği formdan kaldırır; kütüphane seçeneğiyse kütüphaneden de siler (kalıcı).
  Future<void> _removeCustom(String label, _ConsultData data) async {
    setState(() {
      _draft['customSelections'] = _selectedCustom
          .where((item) => item.toLowerCase() != label.toLowerCase())
          .toList();
    });

    final option = data.optionByLabel(label);
    if (option != null && option.id.isNotEmpty) {
      try {
        await widget.api.delete('/api/admin/consultation-options/${option.id}');
        await _reload();
      } catch (_) {
        // Web paritesi: kütüphane seçeneğini silmek "best effort"; başarısız olsa
        // bile editör akışkan kalsın.
      }
    }
  }

  // --- Kaydetme ---

  Future<void> _save() async {
    final customerId = _normalizeId(_customerId);
    if (customerId == null) {
      setState(() {
        _error =
            'Müşteri kaydı henüz hazır değil. Listeyi yenileyip tekrar deneyin.';
      });
      return;
    }

    setState(() {
      _busy = true;
      _error = null;
      _pendingMessage = null;
    });

    try {
      for (final field in _textFields) {
        _draft[field.key] = _textCtrls[field.key]?.text.trim() ?? '';
      }

      // Web paritesi: düzenlemede mevcut formdaki "dolduran" adı korunur,
      // yoksa güncel kullanıcıya düşülür.
      final user = widget.api.auth?.user;
      final existingFiller = '${_draft['filledByName'] ?? ''}'.trim();
      final response = await widget.api
          .put('/api/admin/customers/$customerId/consultation', {
            for (final flag in _flags) flag.key: _draft[flag.key] == true,
            'skinType': _draft['skinType'] ?? 'Unknown',
            for (final field in _textFields) field.key: _draft[field.key],
            'consentGiven': _draft['consentGiven'] == true,
            'filledByName': existingFiller.isNotEmpty
                ? existingFiller
                : (user?.fullName ?? user?.email),
            'customSelections': _selectedCustom,
          });

      if (!mounted) return;
      if (response is Map && response['pendingApproval'] == true) {
        setState(() {
          _editing = false;
          _creatingNew = false;
          _pendingMessage =
              '${response['message'] ?? 'Müşteri bilgi formu onaya gönderildi. Kurum yöneticisi onaylayınca kaydedilecek.'}';
        });
      } else {
        setState(() {
          _editing = false;
          _creatingNew = false;
        });
        await _reload();
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Müşteri bilgi formu kaydedildi.')),
        );
      }
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  // --- Görünüm ---

  @override
  Widget build(BuildContext context) {
    return AppBackground(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        body: SafeArea(
          child: _customerId == null
              ? _pickPrompt()
              : RefreshIndicator(
                  color: AppColors.primary,
                  onRefresh: _reload,
                  child: FutureBuilder<_ConsultData>(
                    future: _future,
                    builder: (context, snapshot) {
                      if (snapshot.connectionState != ConnectionState.done &&
                          !snapshot.hasData) {
                        return ListView(
                          physics: const AlwaysScrollableScrollPhysics(),
                          padding: const EdgeInsets.fromLTRB(16, 20, 16, 110),
                          children: [
                            _header(),
                            const SizedBox(height: 60),
                            const Center(child: CircularProgressIndicator()),
                          ],
                        );
                      }

                      final data = snapshot.data ?? _ConsultData.empty();
                      final current = _editing ? _draft : data.form ?? {};
                      final warnings = _warnings(current);
                      final actualHasForm = _hasForm(data.form);
                      final inEditor = _editing || _creatingNew;
                      // Web: uyarı/durum şeridi yalnızca form varken, editördeyken
                      // veya uyarı oluştuğunda görünür (boş durumda gizli).
                      final showStatus =
                          actualHasForm || inEditor || warnings.isNotEmpty;

                      return ListView(
                        physics: const AlwaysScrollableScrollPhysics(),
                        padding: const EdgeInsets.fromLTRB(16, 20, 16, 110),
                        children: [
                          _header(),
                          const SizedBox(height: 14),
                          if (_pendingMessage != null) ...[
                            _pendingBanner(_pendingMessage!),
                            const SizedBox(height: 10),
                          ],
                          _warningBanner(warnings, showStatus),
                          if (showStatus) const SizedBox(height: 12),
                          if (inEditor)
                            ..._editorChildren(data)
                          else if (actualHasForm)
                            _summary(data.form!)
                          else
                            _emptyState(),
                        ],
                      );
                    },
                  ),
                ),
        ),
      ),
    );
  }

  Widget _header() => PageHeader(
    eyebrow: _customerName ?? 'Müşteri',
    title: 'Müşteri Bilgi ve Onay Formu',
    subtitle: 'Müşteri beyanları, işlem uygunluğu ve onam.',
    action: IconButton(
      tooltip: 'Müşteri değiştir',
      onPressed: _ensureCustomer,
      color: AppColors.primaryDark,
      icon: const Icon(Icons.swap_horiz_rounded),
    ),
  );

  Widget _pickPrompt() => Center(
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Icon(
          Icons.person_search_rounded,
          size: 44,
          color: AppColors.primary,
        ),
        const SizedBox(height: 12),
        const Text(
          'Müşteri bilgi formu için müşteri seçin',
          textAlign: TextAlign.center,
          style: TextStyle(fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 12),
        FilledButton.icon(
          onPressed: _ensureCustomer,
          icon: const Icon(Icons.person_add_alt_1_rounded),
          label: const Text('Müşteri Seç'),
        ),
      ],
    ),
  );

  Widget _emptyState() => Semantics(
    button: true,
    label: 'Form oluştur',
    child: GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: _startCreate,
      child: _card(
        child: Column(
          children: [
            const Icon(
              Icons.assignment_outlined,
              size: 40,
              color: AppColors.primary,
            ),
            const SizedBox(height: 10),
            const Text(
              'Henüz müşteri bilgi formu yok.',
              textAlign: TextAlign.center,
              style: TextStyle(fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 6),
            const Text(
              'İşlem öncesi müşteri beyanları ve onay için “Form oluştur”a dokunun.',
              textAlign: TextAlign.center,
              style: TextStyle(color: AppColors.muted, fontSize: 13, height: 1.4),
            ),
            const SizedBox(height: 14),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(vertical: 14),
              decoration: BoxDecoration(
                color: AppColors.primary,
                borderRadius: BorderRadius.circular(14),
              ),
              child: const Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.add_rounded, color: Colors.white),
                  SizedBox(width: 8),
                  Text(
                    'Form oluştur',
                    style: TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    ),
  );

  Widget _summary(Map<String, dynamic> form) {
    final markedFlags = _flags.where((flag) => form[flag.key] == true).toList();
    final customSelections = _stringList(form['customSelections']);
    final skin = _skinLabel('${form['skinType'] ?? 'Unknown'}');
    final rows = <(String, String)>[
      if (skin != null) ('Cilt tipi', skin),
      for (final field in _textFields)
        if ('${form[field.key] ?? ''}'.trim().isNotEmpty)
          (_viewFieldLabels[field.key] ?? field.label, '${form[field.key]}'),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Align(
          alignment: Alignment.centerRight,
          child: OutlinedButton.icon(
            onPressed: () => _startEdit(form),
            icon: const Icon(Icons.edit_rounded, size: 17),
            label: const Text('Düzenle'),
          ),
        ),
        const SizedBox(height: 8),
        if (markedFlags.isNotEmpty)
          _card(
            title: 'Beyan edilen durumlar',
            child: Wrap(
              spacing: 6,
              runSpacing: 6,
              children: markedFlags
                  .map((flag) => _chip(flag.label, AppColors.primaryDark))
                  .toList(),
            ),
          ),
        if (customSelections.isNotEmpty)
          _card(
            title: 'Özel',
            child: Wrap(
              spacing: 6,
              runSpacing: 6,
              children: customSelections
                  .map((label) => _chip(label, AppColors.primary))
                  .toList(),
            ),
          ),
        if (rows.isNotEmpty)
          _card(
            title: 'Bilgiler',
            child: Column(
              children: [
                for (final row in rows)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: _infoRow(row.$1, row.$2),
                  ),
              ],
            ),
          ),
        _consentLine(form),
      ],
    );
  }

  List<Widget> _editorChildren(_ConsultData data) {
    return [
      // İşlem uygunluğu beyanları (bayraklar)
      _card(
        title: 'İşlem uygunluğu beyanları',
        child: Column(
          children: [
            for (final flag in _flags)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: _checkTile(
                  label: flag.label,
                  value: _draft[flag.key] == true,
                  onChanged: () => setState(
                    () => _draft[flag.key] = !(_draft[flag.key] == true),
                  ),
                ),
              ),
          ],
        ),
      ),

      // Özel — kuruma/şubeye özel işaretlenebilir seçenekler
      _card(
        title: 'Özel',
        subtitle: 'kuruma/şubeye özel seçenekler',
        child: _customEditor(data),
      ),

      // Cilt tipi (Fitzpatrick)
      _card(
        title: 'Cilt tipi (Fitzpatrick)',
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12),
          decoration: BoxDecoration(
            color: AppColors.surfaceSoft.withValues(alpha: .5),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppColors.border),
          ),
          child: DropdownButtonHideUnderline(
            child: DropdownButton<String>(
              value: _validSkinType(_draft['skinType']),
              isExpanded: true,
              items: [
                for (final skin in _skinTypes)
                  DropdownMenuItem(
                    value: skin.value,
                    child: Text(skin.label, overflow: TextOverflow.ellipsis),
                  ),
              ],
              onChanged: (value) =>
                  setState(() => _draft['skinType'] = value ?? 'Unknown'),
            ),
          ),
        ),
      ),

      // Serbest metin beyanları
      _card(
        title: 'Beyanlar',
        child: Column(
          children: [
            for (final field in _textFields)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: TextField(
                  controller: _textCtrls[field.key],
                  minLines: 2,
                  maxLines: 4,
                  textInputAction: TextInputAction.newline,
                  decoration: InputDecoration(
                    labelText: field.label,
                    hintText: field.placeholder,
                    isDense: true,
                  ),
                ),
              ),
          ],
        ),
      ),

      // Onam
      _consentEditor(),

      if (_error != null) ...[
        const SizedBox(height: 10),
        Text(
          _error!,
          style: const TextStyle(color: AppColors.danger, fontSize: 12.5),
        ),
      ],
      const SizedBox(height: 14),
      Row(
        children: [
          Expanded(
            child: OutlinedButton(
              onPressed: _busy ? null : _cancelEdit,
              child: const Text('İptal'),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: FilledButton.icon(
              onPressed: _busy ? null : _save,
              icon: _busy
                  ? const SizedBox.square(
                      dimension: 16,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Icon(Icons.check_rounded, size: 18),
              label: const Text('Kaydet'),
            ),
          ),
        ],
      ),
    ];
  }

  Widget _customEditor(_ConsultData data) {
    // Gösterilecek seçenekler: kütüphane + bu formda işaretli ama kütüphanede
    // olmayanlar (silinmiş olabilir).
    final labels = _uniqueLabels([
      ...data.options.map((option) => option.label),
      ..._selectedCustom,
    ]);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (labels.isNotEmpty)
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final label in labels)
                _customChip(
                  label: label,
                  selected: _customSelected(label),
                  onToggle: () => _toggleCustom(label),
                  onRemove: () => _removeCustom(label, data),
                ),
            ],
          )
        else
          const Text(
            'Henüz özel seçenek yok.',
            style: TextStyle(color: AppColors.muted, fontSize: 12),
          ),
        const SizedBox(height: 10),
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: _newOption,
                onSubmitted: (_) => _addCustom(),
                decoration: const InputDecoration(
                  isDense: true,
                  hintText: 'Özel seçenek ekle (ör. Botoks geçmişi)…',
                ),
              ),
            ),
            const SizedBox(width: 8),
            FilledButton.icon(
              onPressed: _addCustom,
              icon: const Icon(Icons.add_rounded, size: 18),
              label: const Text('Ekle'),
              style: FilledButton.styleFrom(
                minimumSize: const Size(0, 48),
                padding: const EdgeInsets.symmetric(horizontal: 14),
              ),
            ),
          ],
        ),
        const SizedBox(height: 6),
        const Text(
          'Eklenen seçenek bu kuruma/şubeye kaydedilir; sonraki müşterilerde hazır checkbox olarak çıkar.',
          style: TextStyle(color: AppColors.muted, fontSize: 10.5, height: 1.4),
        ),
      ],
    );
  }

  // --- Parça widget'lar ---

  Widget _warningBanner(List<_ConsultWarning> warnings, bool showOk) {
    if (warnings.isEmpty) {
      if (!showOk) return const SizedBox.shrink();
      return _statusBox(
        color: AppColors.success,
        icon: Icons.verified_user_rounded,
        child: const Text(
          'Belirgin işlem uygunluğu uyarısı yok.',
          style: TextStyle(
            color: AppColors.success,
            fontWeight: FontWeight.w700,
            fontSize: 12.5,
          ),
        ),
      );
    }

    final highCount = warnings.where((w) => w.severity == 'high').length;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const Icon(Icons.shield_outlined, size: 17, color: AppColors.danger),
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                'İşlem uygunluğu uyarıları (${warnings.length}${highCount > 0 ? ' · $highCount yüksek' : ''})',
                style: const TextStyle(
                  color: AppColors.danger,
                  fontWeight: FontWeight.w800,
                  fontSize: 12.5,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        for (final warning in warnings)
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: _statusBox(
              color: warning.severity == 'high'
                  ? AppColors.danger
                  : AppColors.warning,
              icon: Icons.warning_amber_rounded,
              child: RichText(
                text: TextSpan(
                  style: const TextStyle(
                    color: AppColors.ink,
                    fontSize: 12,
                    height: 1.3,
                  ),
                  children: [
                    TextSpan(
                      text: '${warning.title}: ',
                      style: const TextStyle(fontWeight: FontWeight.w800),
                    ),
                    TextSpan(text: warning.detail),
                  ],
                ),
              ),
            ),
          ),
      ],
    );
  }

  Widget _pendingBanner(String message) => _statusBox(
    color: AppColors.warning,
    icon: Icons.schedule_rounded,
    child: Text(
      message,
      style: const TextStyle(
        color: AppColors.warning,
        fontWeight: FontWeight.w700,
        fontSize: 12,
      ),
    ),
  );

  Widget _statusBox({
    required Color color,
    required IconData icon,
    required Widget child,
  }) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: color.withValues(alpha: .09),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: color.withValues(alpha: .28)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18, color: color),
          const SizedBox(width: 8),
          Expanded(child: child),
        ],
      ),
    );
  }

  Widget _checkTile({
    required String label,
    required bool value,
    required VoidCallback onChanged,
  }) {
    final color = value ? AppColors.primary : AppColors.border;
    return Semantics(
      button: true,
      checked: value,
      label: label,
      onTap: onChanged,
      child: Listener(
        behavior: HitTestBehavior.opaque,
        onPointerUp: (_) => onChanged(),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 140),
          curve: Curves.easeOut,
          constraints: const BoxConstraints(minHeight: 44),
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
          decoration: BoxDecoration(
            color: value
                ? AppColors.primary.withValues(alpha: .1)
                : AppColors.surfaceSoft.withValues(alpha: .45),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: color.withValues(alpha: .75)),
          ),
          child: Row(
            children: [
              AnimatedContainer(
                duration: const Duration(milliseconds: 140),
                width: 22,
                height: 22,
                decoration: BoxDecoration(
                  color: value ? AppColors.primary : Colors.transparent,
                  borderRadius: BorderRadius.circular(7),
                  border: Border.all(
                    color: (value ? AppColors.primary : AppColors.border)
                        .withValues(alpha: .95),
                    width: 1.5,
                  ),
                ),
                child: value
                    ? const Icon(
                        Icons.check_rounded,
                        color: Colors.white,
                        size: 16,
                      )
                    : null,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  label,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 13,
                    height: 1.2,
                    color: value ? AppColors.primaryDark : AppColors.ink,
                    fontWeight: value ? FontWeight.w800 : FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// "Özel" bölümünde işaretlenebilir + kaldırılabilir seçenek çipi.
  Widget _customChip({
    required String label,
    required bool selected,
    required VoidCallback onToggle,
    required VoidCallback onRemove,
  }) {
    final color = selected ? AppColors.primary : AppColors.border;
    return Container(
      decoration: BoxDecoration(
        color: selected
            ? AppColors.primary.withValues(alpha: .12)
            : AppColors.surfaceSoft,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: color.withValues(alpha: .85)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          InkWell(
            borderRadius: BorderRadius.circular(10),
            onTap: onToggle,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(10, 7, 6, 7),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    selected
                        ? Icons.check_circle_rounded
                        : Icons.radio_button_unchecked_rounded,
                    size: 15,
                    color: selected ? AppColors.primaryDark : AppColors.muted,
                  ),
                  const SizedBox(width: 6),
                  Text(
                    label,
                    style: TextStyle(
                      color: selected ? AppColors.primaryDark : AppColors.muted,
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            ),
          ),
          InkWell(
            borderRadius: BorderRadius.circular(10),
            onTap: onRemove,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(2, 7, 8, 7),
              child: Icon(
                Icons.close_rounded,
                size: 15,
                color: AppColors.muted.withValues(alpha: .8),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _consentEditor() {
    final selected = _draft['consentGiven'] == true;
    return InkWell(
      borderRadius: BorderRadius.circular(16),
      onTap: () => setState(() => _draft['consentGiven'] = !selected),
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: selected
              ? AppColors.success.withValues(alpha: .09)
              : AppColors.surface,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: selected
                ? AppColors.success.withValues(alpha: .35)
                : AppColors.border,
          ),
        ),
        child: Row(
          children: [
            Checkbox(
              value: selected,
              onChanged: (_) =>
                  setState(() => _draft['consentGiven'] = !selected),
              activeColor: AppColors.success,
            ),
            const Expanded(
              child: Text(
                'Müşteri bilgilendirildi ve onam/rıza alındı (KVKK + işlem onamı).',
                style: TextStyle(fontSize: 13, color: AppColors.ink),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _consentLine(Map<String, dynamic> form) {
    final ok = form['consentGiven'] == true;
    final by = '${form['filledByName'] ?? ''}'.trim();
    final date = parseUtcToLocal(form['updatedAtUtc'] ?? form['takenAtUtc']);
    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Wrap(
        crossAxisAlignment: WrapCrossAlignment.center,
        spacing: 8,
        runSpacing: 6,
        children: [
          _chip(
            ok ? 'Onam alındı' : 'Onam yok',
            ok ? AppColors.success : AppColors.warning,
            icon: ok
                ? Icons.verified_user_rounded
                : Icons.warning_amber_rounded,
          ),
          if (by.isNotEmpty)
            Text(
              by,
              style: const TextStyle(color: AppColors.muted, fontSize: 11.5),
            ),
          if (date != null)
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(
                  Icons.event_rounded,
                  size: 13,
                  color: AppColors.muted,
                ),
                const SizedBox(width: 4),
                Text(
                  DateFormat('d MMM yyyy', 'tr_TR').format(date),
                  style: const TextStyle(color: AppColors.muted, fontSize: 11.5),
                ),
              ],
            ),
        ],
      ),
    );
  }

  Widget _infoRow(String label, String value) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: AppColors.surfaceSoft.withValues(alpha: .45),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border.withValues(alpha: .7)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: const TextStyle(
              color: AppColors.primaryDark,
              fontSize: 10.5,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 3),
          Text(value, style: const TextStyle(color: AppColors.ink, fontSize: 13)),
        ],
      ),
    );
  }

  Widget _chip(String label, Color color, {IconData? icon}) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: color.withValues(alpha: .09),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: color.withValues(alpha: .28)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 13, color: color),
            const SizedBox(width: 4),
          ],
          Text(
            label,
            style: TextStyle(
              color: color,
              fontSize: 11.5,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }

  Widget _card({String? title, String? subtitle, required Widget child}) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryDark.withValues(alpha: .04),
            blurRadius: 24,
            offset: const Offset(0, 12),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (title != null) ...[
            Row(
              crossAxisAlignment: CrossAxisAlignment.baseline,
              textBaseline: TextBaseline.alphabetic,
              children: [
                Flexible(
                  child: Text(
                    title,
                    style: const TextStyle(
                      fontSize: 11,
                      color: AppColors.primaryDark,
                      fontWeight: FontWeight.w800,
                      letterSpacing: .3,
                    ),
                  ),
                ),
                if (subtitle != null) ...[
                  const SizedBox(width: 6),
                  Flexible(
                    child: Text(
                      '· $subtitle',
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 10.5,
                        color: AppColors.muted,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ),
                ],
              ],
            ),
            const SizedBox(height: 10),
          ],
          child,
        ],
      ),
    );
  }

  String? _skinLabel(String value) {
    final match = _skinTypes.firstWhere(
      (skin) => skin.value == value,
      orElse: () => const _SkinType('', ''),
    );
    if (match.value.isEmpty || match.value == 'Unknown') return null;
    return match.label;
  }
}

// --- Modeller ---

class _ConsultData {
  const _ConsultData({required this.form, required this.options});

  factory _ConsultData.empty() =>
      const _ConsultData(form: null, options: <_ConsultOption>[]);

  final Map<String, dynamic>? form;
  final List<_ConsultOption> options;

  _ConsultOption? optionByLabel(String label) {
    for (final option in options) {
      if (option.label.toLowerCase() == label.toLowerCase()) return option;
    }
    return null;
  }
}

class _ConsultOption {
  const _ConsultOption(this.id, this.label);
  final String id;
  final String label;
}

class _ConsultFlag {
  const _ConsultFlag(this.key, this.label);
  final String key;
  final String label;
}

class _SkinType {
  const _SkinType(this.value, this.label);
  final String value;
  final String label;
}

class _TextFieldDef {
  const _TextFieldDef(this.key, this.label, this.placeholder);
  final String key;
  final String label;
  final String placeholder;
}

class _ConsultWarning {
  const _ConsultWarning(this.severity, this.title, this.detail);
  final String severity;
  final String title;
  final String detail;
}
