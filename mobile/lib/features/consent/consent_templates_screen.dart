import 'package:flutter/material.dart';

import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/responsive.dart';
import '../../shared/consent/consent_pdf.dart';
import '../../shared/json_helpers.dart';
import '../../shared/widgets/app_background.dart';
import '../../shared/widgets/page_header.dart';
import 'consent_models.dart';

/// Onam formu ŞABLON yönetimi (web `ConsentTemplatesCard` paritesi).
///
/// Şablon = kurumun yazdığı metin + müşterinin işaretleyeceği onay maddeleri +
/// **Evet/Hayır soruları** + hangi hizmetlerde zorunlu olduğu. Randevu "Tamamlandı"
/// yapılırken bu bağa bakılır; müşteri formu tabletten okuyup imzalar.
///
/// KAYIT NOTU: `packageIds` GÖNDERİLMEZ — bu ekran paket bağını yönetmiyor, sunucu
/// alanı taşımayan istekte mevcut bağı korur (bkz. UpsertConsentTemplateRequest).

const String _starterBody = '''Sayın {{musteri}},

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

const List<String> _starterItems = [
  'Bilgilendirme metnini okudum ve anladım.',
  'Sorularımı sordum, tatmin edici yanıt aldım.',
  'Beyanlarımın doğru olduğunu kabul ediyorum.',
  'İşlemin uygulanmasına onay veriyorum.',
];


class ConsentTemplatesScreen extends StatefulWidget {
  const ConsentTemplatesScreen({required this.api, super.key});
  final ApiClient api;

  @override
  State<ConsentTemplatesScreen> createState() => _ConsentTemplatesScreenState();
}

class _ConsentTemplatesScreenState extends State<ConsentTemplatesScreen> {
  List<Map<String, dynamic>> _templates = const [];
  List<Map<String, dynamic>> _services = const [];
  String _institution = 'Kurum';
  String? _logo;
  bool _loading = true;
  bool _busy = false;
  String? _error;

  /// null → liste görünümü; dolu → düzenleyici.
  _Draft? _draft;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final res = await Future.wait<dynamic>([
        widget.api.get('/api/admin/consent-templates/'),
        widget.api
            .get('/api/admin/services/', query: {'page': 1, 'pageSize': 300})
            .catchError((_) => const <dynamic>[]),
        // PDF önizlemesi için kurum adı + logo (imzalı belgeyle aynı başlık).
        widget.api.get('/api/admin/tenant/').catchError((_) => null),
        widget.api.get('/api/admin/tenant/public-profile').catchError((_) => null),
      ]);
      if (!mounted) return;
      setState(() {
        _templates = apiItems(res[0]);
        _services = apiItems(res[1]);
        final tenant = res[2];
        if (tenant is Map) {
          final name = '${tenant['name'] ?? tenant['tenantName'] ?? ''}'.trim();
          if (name.isNotEmpty) _institution = name;
        }
        final profile = res[3];
        final logo = profile is Map ? '${profile['logoData'] ?? ''}'.trim() : '';
        _logo = logo.isEmpty ? null : logo;
        _loading = false;
      });
    } catch (e) {
      if (mounted) {
        setState(() {
          _loading = false;
          // Paket kapısı kapalıysa uçlar 409 döner — ekran bunu düz metinle söyler.
          _error = '$e';
        });
      }
    }
  }

  Future<void> _save() async {
    final draft = _draft;
    if (draft == null) return;
    if (draft.title.text.trim().isEmpty) {
      setState(() => _error = 'Form başlığı zorunlu.');
      return;
    }
    if (draft.body.text.trim().isEmpty) {
      setState(() => _error = 'Form metni zorunlu.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final payload = {
        'title': draft.title.text.trim(),
        'body': draft.body.text.trim(),
        'checkItems': draft.items,
        // Boş dizi = "soruları temizle"; alanı hiç göndermemek "dokunma" demek olurdu.
        'questions': [
          for (final q in draft.questions)
            if (q.text.trim().isNotEmpty) q.toJson(),
        ],
        'requiresSignature': draft.requiresSignature,
        'isActive': draft.isActive,
        'serviceIds': draft.serviceIds.toList(),
      };
      if (draft.id == null) {
        await widget.api.post('/api/admin/consent-templates/', payload);
      } else {
        await widget.api.put('/api/admin/consent-templates/${draft.id}', payload);
      }
      if (!mounted) return;
      draft.dispose();
      setState(() => _draft = null);
      await _load();
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Onam formu kaydedildi.')));
      }
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _delete(Map<String, dynamic> t) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Formu sil'),
        content: Text(
            '“${t['title'] ?? 'Onam formu'}” silinsin mi? İmzalanmış belgeler silinmez, yalnız şablon ve hizmet bağları kalkar.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Vazgeç')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Sil')),
        ],
      ),
    );
    if (ok != true) return;
    setState(() => _busy = true);
    try {
      await widget.api.delete('/api/admin/consent-templates/${t['id']}');
      await _load();
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _preview(Map<String, dynamic> t) async {
    try {
      await ConsentPdf.share(
        institutionName: _institution,
        title: '${t['title'] ?? 'Onam Formu'}',
        body: ConsentPdf.fillPlaceholders('${t['body'] ?? ''}'),
        logoBase64: _logo,
        checkItems: [for (final i in (t['checkItems'] as List? ?? const [])) '$i'],
        questions: [
          for (final q in (t['questions'] as List? ?? const []))
            if (q is Map) q.cast<String, dynamic>(),
        ],
      );
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }

  void _startNew() => setState(() {
        _error = null;
        _draft = _Draft(
          id: null,
          title: TextEditingController(),
          body: TextEditingController(text: _starterBody),
          items: [..._starterItems],
          questions: starterQuestions(),
          requiresSignature: true,
          isActive: true,
          serviceIds: <String>{},
        );
      });

  void _startEdit(Map<String, dynamic> t) => setState(() {
        _error = null;
        _draft = _Draft(
          id: '${t['id']}',
          title: TextEditingController(text: '${t['title'] ?? ''}'),
          body: TextEditingController(text: '${t['body'] ?? ''}'),
          items: [for (final i in (t['checkItems'] as List? ?? const [])) '$i'],
          questions: [
            for (final q in (t['questions'] as List? ?? const []))
              if (q is Map) QuestionDraft.fromJson(q.cast<String, dynamic>()),
          ],
          requiresSignature: t['requiresSignature'] != false,
          isActive: t['isActive'] != false,
          serviceIds: {for (final s in (t['serviceIds'] as List? ?? const [])) '$s'},
        );
      });

  @override
  void dispose() {
    _draft?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AppBackground(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        body: SafeArea(
          child: ResponsiveCenter(
            maxWidth: 900,
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : RefreshIndicator(
                    color: AppColors.primary,
                    onRefresh: _load,
                    child: _draft == null ? _list() : _editor(_draft!),
                  ),
          ),
        ),
        floatingActionButton: _draft == null && !_loading
            ? FloatingActionButton.extended(
                onPressed: _startNew,
                icon: const Icon(Icons.add_rounded),
                label: const Text('Yeni form'),
              )
            : null,
      ),
    );
  }

  // ------------------------------------------------------------------ liste ---

  Widget _list() {
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(16, 20, 16, 110),
      children: [
        const PageHeader(
          eyebrow: 'Ayarlar',
          title: 'Onam Formları',
          subtitle:
              'Hizmetlere bağladığınız formlar, randevu “Tamamlandı” yapılırken imzalı mı diye '
              'kontrol edilir. Müşteri formu tabletten okur, soruları yanıtlar ve imzalar.',
        ),
        const SizedBox(height: 14),
        if (_error != null) _errorBox(_error!),
        if (_templates.isEmpty)
          Container(
            padding: const EdgeInsets.symmetric(vertical: 34, horizontal: 16),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: AppColors.border),
            ),
            child: const Column(
              children: [
                Icon(Icons.assignment_rounded, size: 38, color: AppColors.primary),
                SizedBox(height: 10),
                Text('Henüz onam formu yok',
                    style: TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                SizedBox(height: 6),
                Text(
                  '“Yeni form” ile hazır iskeletten başlayın; metni düzenleyip Evet/Hayır '
                  'sorularını ve hangi hizmetlerde zorunlu olacağını seçin.',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 12.5, color: AppColors.muted, height: 1.4),
                ),
              ],
            ),
          )
        else
          for (final t in _templates) _templateCard(t),
      ],
    );
  }

  Widget _templateCard(Map<String, dynamic> t) {
    final items = (t['checkItems'] as List? ?? const []).length;
    final questions = (t['questions'] as List? ?? const []).length;
    final names = [for (final n in (t['serviceNames'] as List? ?? const [])) '$n'];
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text('${t['title'] ?? 'Onam formu'}',
                    style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14.5)),
              ),
              if (t['isActive'] == false) _badge('Pasif', AppColors.muted),
              if (t['requiresSignature'] == false) ...[
                const SizedBox(width: 6),
                _badge('İmzasız', AppColors.primaryDark),
              ],
            ],
          ),
          const SizedBox(height: 6),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              _metaChip(Icons.checklist_rounded, '$items onay maddesi'),
              _metaChip(Icons.help_outline_rounded, '$questions soru'),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            names.isEmpty ? 'Hiçbir hizmete bağlı değil' : 'Hizmetler: ${names.join(', ')}',
            style: const TextStyle(fontSize: 11.5, color: AppColors.muted, height: 1.35),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () => _preview(t),
                  icon: const Icon(Icons.picture_as_pdf_rounded, size: 16),
                  label: const Text('Önizle'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: FilledButton.icon(
                  onPressed: () => _startEdit(t),
                  icon: const Icon(Icons.edit_rounded, size: 16),
                  label: const Text('Düzenle'),
                ),
              ),
              const SizedBox(width: 4),
              IconButton(
                tooltip: 'Sil',
                onPressed: _busy ? null : () => _delete(t),
                icon: const Icon(Icons.delete_outline_rounded),
                color: AppColors.danger,
              ),
            ],
          ),
        ],
      ),
    );
  }

  // -------------------------------------------------------------- düzenleyici ---

  Widget _editor(_Draft d) {
    final grouped = <String, List<Map<String, dynamic>>>{};
    for (final s in _services) {
      final g = '${s['category'] ?? ''}'.trim().isEmpty ? 'Kategorisiz' : '${s['category']}';
      grouped.putIfAbsent(g, () => []).add(s);
    }
    final groups = grouped.keys.toList()..sort((a, b) => a.compareTo(b));

    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(16, 20, 16, 40),
      children: [
        PageHeader(
          eyebrow: 'Onam Formu',
          title: d.id == null ? 'Yeni form' : 'Formu düzenle',
          subtitle: 'Metinde {{musteri}} {{hizmet}} {{tarih}} {{kurum}} {{personel}} '
              'yer tutucuları form açılırken gerçek değerlerle dolar.',
        ),
        const SizedBox(height: 14),
        if (_error != null) _errorBox(_error!),

        _card([
          TextField(
            controller: d.title,
            decoration: const InputDecoration(
              labelText: 'Form başlığı *',
              hintText: 'Güzellik Uygulaması Onay Formu',
            ),
          ),
          const SizedBox(height: 6),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            dense: true,
            value: d.requiresSignature,
            onChanged: (v) => setState(() => d.requiresSignature = v),
            title: const Text('İmza zorunlu', style: TextStyle(fontSize: 13.5)),
            subtitle: const Text('Kapalıysa form yalnız okunur/bilgilendirir.',
                style: TextStyle(fontSize: 11.5, color: AppColors.muted)),
          ),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            dense: true,
            value: d.isActive,
            onChanged: (v) => setState(() => d.isActive = v),
            title: const Text('Aktif', style: TextStyle(fontSize: 13.5)),
          ),
        ]),

        _card([
          const _SectionLabel('Form metni'),
          const SizedBox(height: 8),
          TextField(
            controller: d.body,
            maxLines: 12,
            style: const TextStyle(fontSize: 12.5, height: 1.45),
            decoration: const InputDecoration(isDense: true),
          ),
        ]),

        _card([
          const _SectionLabel('Onay maddeleri'),
          const Text('Müşteri tablette tek tek işaretler.',
              style: TextStyle(fontSize: 11.5, color: AppColors.muted)),
          const SizedBox(height: 8),
          for (var i = 0; i < d.items.length; i++)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(
                children: [
                  const Icon(Icons.check_box_outline_blank_rounded,
                      size: 16, color: AppColors.muted),
                  const SizedBox(width: 8),
                  Expanded(child: Text(d.items[i], style: const TextStyle(fontSize: 12.5))),
                  InkWell(
                    onTap: () => setState(() => d.items = [...d.items]..removeAt(i)),
                    child: const Icon(Icons.close_rounded, size: 16, color: AppColors.muted),
                  ),
                ],
              ),
            ),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: d.itemDraft,
                  decoration: const InputDecoration(isDense: true, hintText: 'Yeni onay maddesi…'),
                  onSubmitted: (_) => _addItem(d),
                ),
              ),
              const SizedBox(width: 8),
              TextButton(onPressed: () => _addItem(d), child: const Text('Ekle')),
            ],
          ),
        ]),

        // EVET / HAYIR SORULARI
        _card([
          const _SectionLabel('Evet / Hayır soruları'),
          const Text('Müşteri tablette her soruyu Evet ya da Hayır olarak yanıtlar.',
              style: TextStyle(fontSize: 11.5, color: AppColors.muted)),
          const SizedBox(height: 10),
          for (var i = 0; i < d.questions.length; i++) _questionEditor(d, i),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: d.questionDraft,
                  decoration: const InputDecoration(
                      isDense: true, hintText: 'Yeni soru… (ör. Hamile misiniz?)'),
                  onSubmitted: (_) => _addQuestion(d),
                ),
              ),
              const SizedBox(width: 8),
              TextButton(onPressed: () => _addQuestion(d), child: const Text('Soru ekle')),
            ],
          ),
          if (d.questions.isEmpty)
            const Padding(
              padding: EdgeInsets.only(top: 4),
              child: Text('Soru eklemezseniz formda yalnız onay maddeleri görünür.',
                  style: TextStyle(fontSize: 11.5, color: AppColors.muted)),
            ),
        ]),

        _card([
          _SectionLabel('Bu form hangi hizmetlerde zorunlu? (${d.serviceIds.length} seçili)'),
          const SizedBox(height: 8),
          if (groups.isEmpty)
            const Text('Hizmet kaydı yok.',
                style: TextStyle(fontSize: 12.5, color: AppColors.muted))
          else
            for (final g in groups) ...[
              Padding(
                padding: const EdgeInsets.only(top: 4, bottom: 4),
                child: Text(g.toUpperCase(),
                    style: const TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 1.4,
                        color: AppColors.primaryDark)),
              ),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  for (final s in grouped[g]!)
                    FilterChip(
                      label: Text('${s['name'] ?? ''}'),
                      labelStyle: const TextStyle(fontSize: 12),
                      selected: d.serviceIds.contains('${s['id']}'),
                      onSelected: (on) => setState(() {
                        if (on) {
                          d.serviceIds.add('${s['id']}');
                        } else {
                          d.serviceIds.remove('${s['id']}');
                        }
                      }),
                    ),
                ],
              ),
            ],
        ]),

        Row(
          children: [
            Expanded(
              child: OutlinedButton(
                onPressed: _busy
                    ? null
                    : () {
                        d.dispose();
                        setState(() {
                          _draft = null;
                          _error = null;
                        });
                      },
                style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(46)),
                child: const Text('Vazgeç'),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              flex: 2,
              child: FilledButton.icon(
                onPressed: _busy ? null : _save,
                style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(46)),
                icon: _busy
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : const Icon(Icons.check_rounded, size: 18),
                label: const Text('Kaydet'),
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _questionEditor(_Draft d, int index) {
    final q = d.questions[index];
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(11),
      decoration: BoxDecoration(
        color: AppColors.surfaceSoft.withValues(alpha: .4),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 22,
                height: 22,
                margin: const EdgeInsets.only(top: 10),
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: AppColors.surfaceSoft,
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text('${index + 1}',
                    style: const TextStyle(
                        fontSize: 11, fontWeight: FontWeight.w800, color: AppColors.primaryDark)),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: TextFormField(
                  initialValue: q.text,
                  onChanged: (v) => q.text = v,
                  decoration: const InputDecoration(isDense: true, hintText: 'Soru metni…'),
                  style: const TextStyle(fontSize: 13),
                ),
              ),
              IconButton(
                visualDensity: VisualDensity.compact,
                onPressed: () => setState(() => d.questions.removeAt(index)),
                icon: const Icon(Icons.close_rounded, size: 18),
                color: AppColors.muted,
              ),
            ],
          ),
          const SizedBox(height: 4),
          // Önizleme: müşteri tablette bu iki düğmeyi görecek.
          Row(
            children: [
              _previewPill('Evet', AppColors.success),
              const SizedBox(width: 6),
              _previewPill('Hayır', AppColors.muted),
            ],
          ),
          const SizedBox(height: 4),
          Wrap(
            spacing: 4,
            children: [
              FilterChip(
                label: const Text('Zorunlu'),
                labelStyle: const TextStyle(fontSize: 11.5),
                visualDensity: VisualDensity.compact,
                selected: q.required,
                onSelected: (v) => setState(() => q.required = v),
              ),
              FilterChip(
                label: const Text('Açıklama alanı'),
                labelStyle: const TextStyle(fontSize: 11.5),
                visualDensity: VisualDensity.compact,
                selected: q.note,
                onSelected: (v) => setState(() => q.note = v),
              ),
            ],
          ),
        ],
      ),
    );
  }

  void _addItem(_Draft d) {
    final v = d.itemDraft.text.trim();
    if (v.isEmpty) return;
    setState(() {
      d.items = [...d.items, v];
      d.itemDraft.clear();
    });
  }

  void _addQuestion(_Draft d) {
    final v = d.questionDraft.text.trim();
    if (v.isEmpty) return;
    setState(() {
      d.questions.add(QuestionDraft(id: newQuestionId(), text: v));
      d.questionDraft.clear();
    });
  }

  // ------------------------------------------------------------------ parçalar ---

  Widget _card(List<Widget> children) => Container(
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: AppColors.border),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: children),
      );

  Widget _errorBox(String text) => Container(
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: AppColors.danger.withValues(alpha: .08),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppColors.danger.withValues(alpha: .3)),
        ),
        child: Text(text, style: const TextStyle(fontSize: 12.5, color: AppColors.danger)),
      );

  Widget _badge(String text, Color color) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: color.withValues(alpha: .10),
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: color.withValues(alpha: .35)),
        ),
        child: Text(text,
            style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w800, color: color)),
      );

  Widget _metaChip(IconData icon, String text) => Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 13, color: AppColors.primaryDark),
          const SizedBox(width: 4),
          Text(text, style: const TextStyle(fontSize: 11.5, color: AppColors.muted)),
        ],
      );

  Widget _previewPill(String text, Color color) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
        decoration: BoxDecoration(
          color: color.withValues(alpha: .10),
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: color.withValues(alpha: .3)),
        ),
        child: Text(text,
            style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: color)),
      );
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Text(text,
      style: const TextStyle(
          fontSize: 10.5,
          fontWeight: FontWeight.w800,
          letterSpacing: 1.4,
          color: AppColors.primaryDark));
}

/// Düzenleyicinin tuttuğu taslak (yeni ya da mevcut şablon).
class _Draft {
  _Draft({
    required this.id,
    required this.title,
    required this.body,
    required this.items,
    required this.questions,
    required this.requiresSignature,
    required this.isActive,
    required this.serviceIds,
  });

  final String? id;
  final TextEditingController title;
  final TextEditingController body;
  final TextEditingController itemDraft = TextEditingController();
  final TextEditingController questionDraft = TextEditingController();
  List<String> items;
  final List<QuestionDraft> questions;
  bool requiresSignature;
  bool isActive;
  final Set<String> serviceIds;

  void dispose() {
    title.dispose();
    body.dispose();
    itemDraft.dispose();
    questionDraft.dispose();
  }
}
