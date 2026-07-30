import 'package:flutter/material.dart';

import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/json_helpers.dart';
import 'consent_models.dart';

const _starterBody = '''Sayın {{musteri}},

{{kurum}} bünyesinde tarafınıza uygulanacak {{hizmet}} işlemi hakkında aşağıdaki bilgilendirme yapılmıştır.

1. İŞLEMİN TANIMI
İşlemin nasıl uygulanacağı, süresi ve beklenen sonuçları tarafıma anlatılmıştır.

2. OLASI YAN ETKİLER
İşlem sonrası geçici kızarıklık, hassasiyet ve ödem görülebileceği bilgisi tarafıma verilmiştir.

3. UYGULAMA ÖNCESİ BEYANIM
Kullandığım ilaçlar, alerjilerim ve kronik rahatsızlıklarım hakkında doğru bilgi verdiğimi beyan ederim.

4. UYGULAMA SONRASI BAKIM
İşlem sonrası uyulması gereken bakım önerileri tarafıma anlatılmıştır.

Tarih: {{tarih}}''';

const _starterItems = <String>[
  'Bilgilendirme metnini okudum ve anladım.',
  'Sorularımı sordum, tatmin edici yanıt aldım.',
  'Beyanlarımın doğru olduğunu kabul ediyorum.',
  'İşlemin uygulanmasına onay veriyorum.',
];

/// Hizmet/paket formlarında onam formu seçimi (web `ConsentPicker` paritesi).
///
/// "Onam formu istensin mi?" anahtarı açılınca kayıtlı formlar çip olarak listelenir;
/// aynı yerden **yeni form da oluşturulabilir** (Ayarlar'a gitmeye gerek yok).
///
/// Seçim burada KAYDEDİLMEZ: sahibi form (hizmet/paket) kaydedilirken
/// [syncConsentLinks] ile şablonların hizmet/paket bağı güncellenir.
class ConsentPickerField extends StatefulWidget {
  const ConsentPickerField({
    required this.api,
    required this.selected,
    required this.onChanged,
    required this.label,
    this.hint,
    super.key,
  });

  final ApiClient api;
  final Set<String> selected;
  final ValueChanged<Set<String>> onChanged;
  final String label;
  final String? hint;

  @override
  State<ConsentPickerField> createState() => _ConsentPickerFieldState();
}

class _ConsentPickerFieldState extends State<ConsentPickerField> {
  bool _enabled = false;
  bool _loading = false;
  bool _busy = false;
  bool _creating = false;
  String? _error;
  List<Map<String, dynamic>> _templates = const [];

  final _title = TextEditingController();
  final _body = TextEditingController(text: _starterBody);
  final _itemDraft = TextEditingController();
  final _questionDraft = TextEditingController();
  List<String> _items = [..._starterItems];
  /// Evet/Hayır soruları — tam düzenleme Ayarlar › Onam Formları'nda.
  List<QuestionDraft> _questions = starterQuestions();

  @override
  void initState() {
    super.initState();
    _enabled = widget.selected.isNotEmpty;
    if (_enabled) _load();
  }

  @override
  void didUpdateWidget(ConsentPickerField old) {
    super.didUpdateWidget(old);
    // Düzenleme modunda kayıt sonradan yüklenirse anahtarı aç.
    if (!_enabled && widget.selected.isNotEmpty) {
      _enabled = true;
      _load();
    }
  }

  @override
  void dispose() {
    _title.dispose();
    _body.dispose();
    _itemDraft.dispose();
    _questionDraft.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final data = await widget.api.get('/api/admin/consent-templates/');
      if (!mounted) return;
      setState(() => _templates = apiItems(data).where((t) => t['isActive'] != false).toList());
    } catch (_) {
      if (mounted) setState(() => _templates = const []);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _create() async {
    final title = _title.text.trim();
    if (title.isEmpty) {
      setState(() => _error = 'Form başlığı zorunlu.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final created = await widget.api.post('/api/admin/consent-templates/', {
        'title': title,
        'body': _body.text.trim().isEmpty ? _starterBody : _body.text.trim(),
        'checkItems': _items,
        'questions': [
          for (final q in _questions)
            if (q.text.trim().isNotEmpty) q.toJson(),
        ],
        'requiresSignature': true,
        'isActive': true,
        'serviceIds': const <String>[],
        'packageIds': const <String>[],
      });
      await _load();
      if (!mounted) return;
      final id = created is Map ? '${created['id'] ?? ''}' : '';
      if (id.isNotEmpty) widget.onChanged({...widget.selected, id});
      setState(() {
        _creating = false;
        _title.clear();
        _body.text = _starterBody;
        _items = [..._starterItems];
        _questions = starterQuestions();
      });
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        CheckboxListTile(
          contentPadding: EdgeInsets.zero,
          controlAffinity: ListTileControlAffinity.leading,
          value: _enabled,
          onChanged: (v) {
            setState(() => _enabled = v ?? false);
            if (_enabled) {
              _load();
            } else {
              widget.onChanged(<String>{});
              setState(() => _creating = false);
            }
          },
          title: Row(
            children: [
              const Icon(Icons.assignment_turned_in_rounded, size: 16, color: AppColors.primaryDark),
              const SizedBox(width: 6),
              Expanded(
                child: Text(widget.label,
                    style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
              ),
            ],
          ),
          subtitle: Text(
            widget.hint ??
                'Seçilen formlar, bu kalemi alan müşteride imzalanana kadar uyarı olarak görünür.',
            style: const TextStyle(fontSize: 11.5, color: AppColors.muted, height: 1.35),
          ),
        ),
        if (_enabled)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: AppColors.surfaceSoft.withValues(alpha: .55),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: AppColors.primary.withValues(alpha: .35)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (_loading)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 10),
                    child: Row(children: [
                      SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)),
                      SizedBox(width: 10),
                      Text('Formlar yükleniyor…', style: TextStyle(fontSize: 12.5, color: AppColors.muted)),
                    ]),
                  )
                else if (_templates.isEmpty)
                  const Text('Kayıtlı onam formu yok. Aşağıdan hemen oluşturabilirsiniz.',
                      style: TextStyle(fontSize: 12.5, color: AppColors.muted))
                else
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final t in _templates)
                        FilterChip(
                          label: Text('${t['title'] ?? 'Onam formu'}'),
                          selected: widget.selected.contains('${t['id']}'),
                          onSelected: (on) {
                            final next = {...widget.selected};
                            if (on) {
                              next.add('${t['id']}');
                            } else {
                              next.remove('${t['id']}');
                            }
                            widget.onChanged(next);
                          },
                        ),
                    ],
                  ),
                const SizedBox(height: 10),
                if (!_creating)
                  OutlinedButton.icon(
                    onPressed: () => setState(() {
                      _creating = true;
                      _error = null;
                    }),
                    icon: const Icon(Icons.add_rounded, size: 16),
                    label: const Text('Yeni onam formu oluştur'),
                  )
                else
                  _createBox(),
              ],
            ),
          ),
      ],
    );
  }

  Widget _createBox() {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Expanded(
                child: Text('Yeni onam formu',
                    style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13)),
              ),
              IconButton(
                visualDensity: VisualDensity.compact,
                onPressed: () => setState(() => _creating = false),
                icon: const Icon(Icons.close_rounded, size: 18),
              ),
            ],
          ),
          TextField(
            controller: _title,
            autofocus: true,
            decoration: const InputDecoration(
              isDense: true,
              labelText: 'Form başlığı',
              hintText: 'Örn. Lazer Epilasyon Onay Formu',
            ),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _body,
            maxLines: 7,
            style: const TextStyle(fontSize: 12, height: 1.4),
            decoration: const InputDecoration(isDense: true, labelText: 'Form metni'),
          ),
          const SizedBox(height: 10),
          const Text('Onay maddeleri',
              style: TextStyle(fontWeight: FontWeight.w700, fontSize: 12)),
          const SizedBox(height: 6),
          for (var i = 0; i < _items.length; i++)
            Padding(
              padding: const EdgeInsets.only(bottom: 5),
              child: Row(
                children: [
                  const Icon(Icons.check_box_outline_blank_rounded, size: 15, color: AppColors.muted),
                  const SizedBox(width: 6),
                  Expanded(child: Text(_items[i], style: const TextStyle(fontSize: 12))),
                  InkWell(
                    onTap: () => setState(() => _items = [..._items]..removeAt(i)),
                    child: const Icon(Icons.close_rounded, size: 15, color: AppColors.muted),
                  ),
                ],
              ),
            ),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _itemDraft,
                  decoration: const InputDecoration(isDense: true, hintText: 'Yeni onay maddesi…'),
                  onSubmitted: (_) => _addItem(),
                ),
              ),
              const SizedBox(width: 8),
              TextButton(onPressed: _addItem, child: const Text('Ekle')),
            ],
          ),
          const SizedBox(height: 10),
          const Text('Evet / Hayır soruları',
              style: TextStyle(fontWeight: FontWeight.w700, fontSize: 12)),
          const SizedBox(height: 6),
          for (var i = 0; i < _questions.length; i++)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(
                children: [
                  const Icon(Icons.help_outline_rounded, size: 15, color: AppColors.muted),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(_questions[i].text,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 12)),
                  ),
                  // Zorunluluk hızlı anahtar; ayrıntılı ayar (açıklama alanı) Ayarlar'da.
                  InkWell(
                    onTap: () => setState(() => _questions[i].required = !_questions[i].required),
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                      margin: const EdgeInsets.only(right: 6),
                      decoration: BoxDecoration(
                        color: _questions[i].required
                            ? AppColors.primary.withValues(alpha: .12)
                            : Colors.transparent,
                        borderRadius: BorderRadius.circular(999),
                        border: Border.all(
                            color: _questions[i].required ? AppColors.primary : AppColors.border),
                      ),
                      child: Text(_questions[i].required ? 'Zorunlu' : 'İsteğe bağlı',
                          style: TextStyle(
                              fontSize: 10,
                              fontWeight: FontWeight.w700,
                              color: _questions[i].required
                                  ? AppColors.primaryDark
                                  : AppColors.muted)),
                    ),
                  ),
                  InkWell(
                    onTap: () => setState(() => _questions = [..._questions]..removeAt(i)),
                    child: const Icon(Icons.close_rounded, size: 15, color: AppColors.muted),
                  ),
                ],
              ),
            ),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _questionDraft,
                  decoration: const InputDecoration(
                      isDense: true, hintText: 'Yeni soru… (ör. Hamile misiniz?)'),
                  onSubmitted: (_) => _addQuestion(),
                ),
              ),
              const SizedBox(width: 8),
              TextButton(onPressed: _addQuestion, child: const Text('Ekle')),
            ],
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(_error!, style: const TextStyle(color: AppColors.danger, fontSize: 11.5)),
            ),
          const SizedBox(height: 10),
          FilledButton.icon(
            style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(44)),
            onPressed: _busy ? null : _create,
            icon: const Icon(Icons.add_rounded, size: 17),
            label: Text(_busy ? 'Oluşturuluyor…' : 'Oluştur ve seç'),
          ),
          const SizedBox(height: 6),
          const Text(
            'Metinde {{musteri}} {{hizmet}} {{tarih}} {{kurum}} {{personel}} yer tutucuları gerçek '
            'değerlerle dolar. Ayrıntılı düzenleme için Ayarlar › Onam Formları.',
            style: TextStyle(fontSize: 11, color: AppColors.muted, height: 1.35),
          ),
        ],
      ),
    );
  }

  void _addItem() {
    final v = _itemDraft.text.trim();
    if (v.isEmpty) return;
    setState(() {
      _items = [..._items, v];
      _itemDraft.clear();
    });
  }

  void _addQuestion() {
    final v = _questionDraft.text.trim();
    if (v.isEmpty) return;
    setState(() {
      _questions = [..._questions, QuestionDraft(id: newQuestionId(), text: v)];
      _questionDraft.clear();
    });
  }
}

/// Şablonların hizmet/paket bağını istenen seçimle eşitler.
///
/// Bağ, hizmet/paket kaydında değil ŞABLON kaydında durduğu için güncelleme şablon ucundan
/// yapılır; yalnız DEĞİŞEN şablonlar güncellenir.
Future<void> syncConsentLinks(
  ApiClient api, {
  String? serviceId,
  String? packageId,
  required Set<String> selected,
}) async {
  assert((serviceId == null) != (packageId == null), 'Ya hizmet ya paket verilmeli.');
  List<Map<String, dynamic>> templates;
  try {
    templates = apiItems(await api.get('/api/admin/consent-templates/'));
  } catch (_) {
    return; // onam özelliği kapalı → sessizce geç
  }
  final key = serviceId != null ? 'serviceIds' : 'packageIds';
  final targetId = serviceId ?? packageId!;

  for (final t in templates) {
    final id = '${t['id']}';
    final current = (t[key] as List?)?.map((e) => '$e').toList() ?? <String>[];
    final linked = current.contains(targetId);
    final wanted = selected.contains(id);
    if (linked == wanted) continue;
    final next = wanted ? [...current, targetId] : current.where((x) => x != targetId).toList();
    final other = key == 'serviceIds' ? 'packageIds' : 'serviceIds';
    await api.put('/api/admin/consent-templates/$id', {
      'title': t['title'],
      'body': t['body'],
      'checkItems': (t['checkItems'] as List?)?.map((e) => '$e').toList() ?? const <String>[],
      'requiresSignature': t['requiresSignature'] != false,
      'isActive': t['isActive'] != false,
      key: next,
      other: (t[other] as List?)?.map((e) => '$e').toList() ?? const <String>[],
    });
  }
}

/// Bir hizmet/paket için hâlihazırda bağlı şablon kimlikleri.
Future<Set<String>> loadConsentLinks(
  ApiClient api, {
  String? serviceId,
  String? packageId,
}) async {
  final targetId = serviceId ?? packageId;
  if (targetId == null || targetId.isEmpty) return <String>{};
  final key = serviceId != null ? 'serviceIds' : 'packageIds';
  try {
    final templates = apiItems(await api.get('/api/admin/consent-templates/'));
    return templates
        .where((t) => ((t[key] as List?)?.map((e) => '$e') ?? const <String>[]).contains(targetId))
        .map((t) => '${t['id']}')
        .toSet();
  } catch (_) {
    return <String>{};
  }
}
