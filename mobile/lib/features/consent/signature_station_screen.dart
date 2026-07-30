import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/network/api_client.dart';
import '../../core/storage/session_storage.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/consent/consent_pdf.dart';
import '../../shared/consent/signature_pad.dart';
import '../../shared/widgets/app_background.dart';
import 'consent_models.dart';

/// Tablet başındaki müşteri beklemesin diye kısa yoklama.
const _pollInterval = Duration(seconds: 3);
const _stationPrefKey = 'beautyasist.consentStation';

/// TABLET İMZA İSTASYONU (mobil) — web `/imza` sayfasının karşılığı.
///
/// Tablet bir kez "istasyon adı" ile eşleşir (ör. "Kabin 1"), sonra o istasyona gönderilen
/// formu yoklar. Personel "Tablete Aktar" dediği anda form burada açılır; müşteri okur,
/// onay kutularını işaretler, parmağıyla imzalar.
class SignatureStationScreen extends StatefulWidget {
  const SignatureStationScreen({required this.api, super.key});
  final ApiClient api;

  @override
  State<SignatureStationScreen> createState() => _SignatureStationScreenState();
}

class _SignatureStationScreenState extends State<SignatureStationScreen> {
  final _stationInput = TextEditingController();
  final _signerName = TextEditingController();

  String? _station;
  ConsentForm? _form;
  final Set<String> _checked = {};
  /// Soru kimliği → (yanıt, açıklama). Yanıtlanmayan soru haritada bulunmaz.
  final Map<String, ({bool answer, String note})> _answers = {};
  String? _signature;
  bool _busy = false;
  bool _online = true;
  String? _error;
  String? _doneTitle;
  Timer? _poll;
  /// Kurum adı: eski kayıtlarda {{kurum}} çözülmemiş olabilir (yeni kayıtlarda sunucu doldurur).
  String? _institution;

  @override
  void initState() {
    super.initState();
    _restoreStation();
    _loadInstitution();
    _poll = Timer.periodic(_pollInterval, (_) => _pollPending());
  }

  Future<void> _loadInstitution() async {
    try {
      final tenant = await widget.api.get('/api/admin/tenant/');
      if (!mounted || tenant is! Map) return;
      final name = '${tenant['name'] ?? tenant['tenantName'] ?? ''}'.trim();
      if (name.isNotEmpty) setState(() => _institution = name);
    } catch (_) {
      // kurum adı çekilemezse metin sunucudan geldiği hâliyle gösterilir
    }
  }

  @override
  void dispose() {
    _poll?.cancel();
    _stationInput.dispose();
    _signerName.dispose();
    super.dispose();
  }

  Future<void> _restoreStation() async {
    final saved = await SessionStorage.readValue(_stationPrefKey);
    if (!mounted) return;
    if ((saved ?? '').trim().isNotEmpty) {
      setState(() => _station = saved!.trim());
      await _pollPending();
    }
  }

  Future<void> _pair() async {
    final value = _stationInput.text.trim();
    if (value.isEmpty) return;
    await SessionStorage.writeValue(_stationPrefKey, value);
    if (!mounted) return;
    setState(() => _station = value);
    await _pollPending();
  }

  /// Tablet adını sıfırlar (eşleştirme ekranına döner).
  ///
  /// Ekranda imzalanmayı bekleyen bir form varken yanlışlıkla basılması müşterinin
  /// yarım kalan imzasını götürür — bu yüzden form varsa önce onay sorulur.
  Future<void> _unpair() async {
    if (_form != null) {
      final ok = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Tablet adı değiştirilsin mi?'),
          content: const Text(
            'Ekranda imza bekleyen bir form var. Adı değiştirirseniz form bu tabletten '
            'kaldırılır; personelin formu yeniden göndermesi gerekir.',
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Vazgeç')),
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Değiştir'),
            ),
          ],
        ),
      );
      if (ok != true) return;
    }
    await SessionStorage.deleteValue(_stationPrefKey);
    if (!mounted) return;
    setState(() {
      // Mevcut ad kutuya ön-doldurulur: çoğunlukla "Kabin 1" → "Kabin 2" gibi küçük bir düzeltme yapılır.
      _stationInput.text = _station ?? '';
      _station = null;
      _form = null;
      _checked.clear();
      _answers.clear();
      _signature = null;
      _error = null;
      _doneTitle = null;
    });
  }

  Future<void> _pollPending() async {
    final station = _station;
    if (station == null || !mounted) return;
    try {
      final res = await widget.api.get('/api/consent/station/pending', query: {'station': station});
      if (!mounted) return;
      setState(() => _online = true);
      final data = res is Map ? res.cast<String, dynamic>() : null;
      final incoming = data == null ? null : ConsentForm(data);
      // Aynı form tekrar gelirse ekranı sıfırlamayız (müşteri imza atıyor olabilir).
      if (incoming != null && incoming.id != _form?.id) {
        setState(() {
          _form = incoming;
          _checked.clear();
          _answers.clear();
          _signature = null;
          _signerName.text = incoming.customerName ?? '';
          _error = null;
          _doneTitle = null;
        });
      } else if (incoming == null && _form == null) {
        setState(() => _form = null);
      }
    } catch (_) {
      if (mounted) setState(() => _online = false);
    }
  }

  Future<void> _submit() async {
    final form = _form;
    if (form == null) return;
    final token = form.sessionToken;
    if (token == null || token.isEmpty) {
      setState(() => _error = 'İmza oturumu bulunamadı. Personelden formu yeniden göndermesini isteyin.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.api.post('/api/consent/session/$token/sign', {
        'checkedItems': _checked.toList(),
        'answers': [
          for (final q in form.questions)
            if (_answers[q.id] != null)
              {
                'id': q.id,
                'text': q.text,
                'answer': _answers[q.id]!.answer,
                'note': _answers[q.id]!.note.trim().isEmpty ? null : _answers[q.id]!.note.trim(),
              },
        ],
        'signatureImage': _signature,
        'signerName': _signerName.text.trim().isEmpty ? form.customerName : _signerName.text.trim(),
      });
      if (!mounted) return;
      setState(() {
        _doneTitle = form.title;
        _form = null;
        _checked.clear();
        _answers.clear();
        _signature = null;
      });
      Timer(const Duration(seconds: 6), () {
        if (mounted) setState(() => _doneTitle = null);
      });
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  bool get _allChecked {
    final items = _form?.checkItems ?? const <String>[];
    return items.every(_checked.contains);
  }

  /// Zorunlu soruların tamamı yanıtlandı mı? (Sunucu da ayrıca doğrular.)
  bool get _allAnswered {
    final questions = _form?.questions ?? const <ConsentQuestion>[];
    return questions.every((q) => !q.required || _answers.containsKey(q.id));
  }

  bool get _canSubmit {
    final form = _form;
    if (form == null || _busy) return false;
    if (!_allChecked) return false;
    if (!_allAnswered) return false;
    if (form.requiresSignature && (_signature == null || _signature!.isEmpty)) return false;
    return true;
  }

  @override
  Widget build(BuildContext context) {
    return AppBackground(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        appBar: AppBar(
          title: Text(_station == null ? 'İmza Tableti' : _station!),
          actions: [
            if (_station != null)
              Padding(
                padding: const EdgeInsets.only(right: 6),
                child: Center(
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                    decoration: BoxDecoration(
                      color: (_online ? AppColors.success : AppColors.warning).withValues(alpha: .12),
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text(
                      _online ? 'Bağlı' : 'Bekleniyor',
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w800,
                        color: _online ? AppColors.success : AppColors.warning,
                      ),
                    ),
                  ),
                ),
              ),
            if (_station != null)
              IconButton(
                tooltip: 'Tablet adını değiştir',
                onPressed: _unpair,
                icon: const Icon(Icons.drive_file_rename_outline_rounded),
              ),
          ],
        ),
        body: SafeArea(child: _station == null ? _pairView() : _stationView()),
      ),
    );
  }

  Widget _pairView() {
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 24, 20, 40),
      children: [
        Container(
          width: 56,
          height: 56,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: AppColors.surfaceSoft,
            borderRadius: BorderRadius.circular(18),
          ),
          child: const Icon(Icons.tablet_mac_rounded, size: 28, color: AppColors.primaryDark),
        ),
        const SizedBox(height: 16),
        const Text('İmza tabletini tanımlayın',
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
        const SizedBox(height: 8),
        const Text(
          'Bu cihaza bir ad verin (ör. Kabin 1). Personel bilgisayardan formu bu ada gönderdiğinde '
          'form burada otomatik açılır.',
          style: TextStyle(color: AppColors.muted, fontSize: 13, height: 1.45),
        ),
        const SizedBox(height: 20),
        TextField(
          controller: _stationInput,
          autofocus: true,
          textInputAction: TextInputAction.done,
          decoration: const InputDecoration(hintText: 'Kabin 1'),
          onSubmitted: (_) => _pair(),
        ),
        const SizedBox(height: 12),
        FilledButton(onPressed: _pair, child: const Text('Bu tableti hazırla')),
      ],
    );
  }

  Widget _stationView() {
    if (_doneTitle != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 84,
                height: 84,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: AppColors.success.withValues(alpha: .12),
                  shape: BoxShape.circle,
                ),
                child: const Icon(Icons.check_circle_rounded, size: 44, color: AppColors.success),
              ),
              const SizedBox(height: 16),
              const Text('Formunuz imzalandı',
                  style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
              const SizedBox(height: 6),
              Text('$_doneTitle · Teşekkür ederiz.',
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: AppColors.muted, fontSize: 13)),
            ],
          ),
        ),
      );
    }

    final form = _form;
    if (form == null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 84,
                height: 84,
                alignment: Alignment.center,
                decoration: const BoxDecoration(color: AppColors.surfaceSoft, shape: BoxShape.circle),
                child: const Icon(Icons.draw_rounded, size: 40, color: AppColors.primaryDark),
              ),
              const SizedBox(height: 16),
              const Text('Form bekleniyor', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
              const SizedBox(height: 8),
              const Text(
                'Personel “Tablete Aktar” dediğinde form burada otomatik açılır. '
                'Bu ekranı açık bırakabilirsiniz.',
                textAlign: TextAlign.center,
                style: TextStyle(color: AppColors.muted, fontSize: 13, height: 1.45),
              ),
              const SizedBox(height: 22),
              // Tablet adı burada da GÖRÜNÜR olmalı: personelin bilgisayarda yazacağı ad birebir
              // budur; ayrıca sıfırlama yalnız AppBar ikonunda kalırsa kullanıcı bulamıyor.
              Container(
                padding: const EdgeInsets.fromLTRB(14, 12, 10, 12),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: AppColors.border),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.tablet_mac_rounded, size: 18, color: AppColors.primaryDark),
                    const SizedBox(width: 10),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('Bu tabletin adı',
                            style: TextStyle(fontSize: 11, color: AppColors.muted, fontWeight: FontWeight.w600)),
                        Text(_station ?? '—',
                            style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800)),
                      ],
                    ),
                    const SizedBox(width: 14),
                    TextButton.icon(
                      onPressed: _unpair,
                      icon: const Icon(Icons.drive_file_rename_outline_rounded, size: 16),
                      label: const Text('Değiştir'),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      );
    }

    final items = form.checkItems;
    final questions = form.questions;
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 40),
      children: [
        // Belge
        Container(
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: AppColors.border),
          ),
          clipBehavior: Clip.antiAlias,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: double.infinity,
                color: AppColors.surfaceSoft.withValues(alpha: .6),
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('ONAM FORMU',
                        style: TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.w800,
                          letterSpacing: 2,
                          color: AppColors.primaryDark,
                        )),
                    const SizedBox(height: 5),
                    Text(form.title, style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w800)),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      children: [
                        if (form.customerName != null) _chip('Müşteri: ${form.customerName}'),
                        if (form.serviceName != null) _chip('İşlem: ${form.serviceName}'),
                        if (form.staffName != null) _chip('Uygulayan: ${form.staffName}'),
                      ],
                    ),
                  ],
                ),
              ),
              Container(
                constraints: const BoxConstraints(maxHeight: 260),
                padding: const EdgeInsets.all(16),
                child: SingleChildScrollView(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        ConsentPdf.fillPlaceholders(
                          form.body,
                          customerName: form.customerName,
                          serviceName: form.serviceName,
                          institutionName: _institution,
                          staffName: form.staffName,
                        ),
                        style: const TextStyle(fontSize: 14, height: 1.55),
                      ),
                      if (form.staffNotes != null) ...[
                        const SizedBox(height: 14),
                        Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: AppColors.surfaceSoft.withValues(alpha: .7),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text('UYGULAMA NOTU',
                                  style: TextStyle(
                                    fontSize: 10,
                                    fontWeight: FontWeight.w800,
                                    letterSpacing: 1.6,
                                    color: AppColors.primaryDark,
                                  )),
                              const SizedBox(height: 4),
                              Text(form.staffNotes!, style: const TextStyle(fontSize: 13, height: 1.4)),
                            ],
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),

        // Evet / Hayır soruları — beyan; "Hayır" da geçerli bir yanıttır.
        if (questions.isNotEmpty) ...[
          const SizedBox(height: 14),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: AppColors.border),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Expanded(
                      child: Text('SORULAR',
                          style: TextStyle(
                            fontSize: 10,
                            fontWeight: FontWeight.w800,
                            letterSpacing: 1.8,
                            color: AppColors.primaryDark,
                          )),
                    ),
                    Text('${_answers.length}/${questions.length} yanıtlandı',
                        style: const TextStyle(fontSize: 11.5, color: AppColors.muted)),
                  ],
                ),
                const SizedBox(height: 10),
                for (var i = 0; i < questions.length; i++) _questionRow(questions[i], i),
              ],
            ),
          ),
        ],

        // Onay maddeleri
        if (items.isNotEmpty) ...[
          const SizedBox(height: 14),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: AppColors.border),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('ONAY MADDELERİ',
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 1.8,
                      color: AppColors.primaryDark,
                    )),
                const SizedBox(height: 10),
                for (final item in items)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: InkWell(
                      borderRadius: BorderRadius.circular(14),
                      onTap: () => setState(() {
                        if (!_checked.remove(item)) _checked.add(item);
                      }),
                      child: Container(
                        padding: const EdgeInsets.all(13),
                        decoration: BoxDecoration(
                          color: _checked.contains(item) ? AppColors.surfaceSoft : Colors.white,
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(
                            color: _checked.contains(item) ? AppColors.primary : AppColors.border,
                            width: _checked.contains(item) ? 1.6 : 1,
                          ),
                        ),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Icon(
                              _checked.contains(item)
                                  ? Icons.check_circle_rounded
                                  : Icons.radio_button_unchecked_rounded,
                              size: 22,
                              color: _checked.contains(item) ? AppColors.primaryDark : AppColors.muted,
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(item, style: const TextStyle(fontSize: 14, height: 1.4)),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ],

        // İmza
        if (form.requiresSignature) ...[
          const SizedBox(height: 14),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: AppColors.border),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('İMZA',
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 1.8,
                      color: AppColors.primaryDark,
                    )),
                const SizedBox(height: 10),
                TextField(
                  controller: _signerName,
                  decoration: const InputDecoration(labelText: 'İmzalayan ad soyad', isDense: true),
                ),
                const SizedBox(height: 12),
                SignaturePad(
                  height: 200,
                  enabled: !_busy,
                  onChanged: (value) => setState(() => _signature = value),
                ),
              ],
            ),
          ),
        ],

        if (_error != null) ...[
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: AppColors.danger.withValues(alpha: .10),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppColors.danger.withValues(alpha: .35)),
            ),
            child: Text(_error!, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700)),
          ),
        ],

        const SizedBox(height: 16),
        FilledButton.icon(
          style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(56)),
          onPressed: _canSubmit ? _submit : null,
          icon: _busy
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                )
              : const Icon(Icons.verified_user_rounded),
          label: Text(_busy ? 'Kaydediliyor...' : 'Onaylıyorum ve İmzalıyorum'),
        ),
        const SizedBox(height: 8),
        if (!_allChecked)
          const Text('Devam etmek için tüm onay maddelerini işaretleyin.',
              textAlign: TextAlign.center, style: TextStyle(fontSize: 12, color: AppColors.muted))
        else if (form.requiresSignature && _signature == null)
          const Text('Son adım: imza alanına imzanızı atın.',
              textAlign: TextAlign.center, style: TextStyle(fontSize: 12, color: AppColors.muted)),
      ],
    );
  }

  /// Tek soru satırı: metin + iri Evet/Hayır düğmeleri + (istenmişse) açıklama alanı.
  Widget _questionRow(ConsentQuestion q, int index) {
    final picked = _answers[q.id];
    final missing = q.required && picked == null;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Container(
        padding: const EdgeInsets.all(13),
        decoration: BoxDecoration(
          color: missing ? AppColors.surfaceSoft.withValues(alpha: .45) : Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: missing ? AppColors.rose : AppColors.border),
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
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: AppColors.surfaceSoft,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text('${index + 1}',
                      style: const TextStyle(
                          fontSize: 11, fontWeight: FontWeight.w800, color: AppColors.primaryDark)),
                ),
                const SizedBox(width: 9),
                Expanded(
                  child: Text.rich(
                    TextSpan(children: [
                      TextSpan(text: q.text),
                      if (q.required)
                        const TextSpan(
                            text: ' *', style: TextStyle(color: AppColors.primaryDark)),
                    ]),
                    style: const TextStyle(fontSize: 14, height: 1.4),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(child: _answerButton(q, true, 'Evet', picked?.answer == true)),
                const SizedBox(width: 8),
                Expanded(child: _answerButton(q, false, 'Hayır', picked?.answer == false)),
              ],
            ),
            // Açıklama alanı: şablonda istendiyse ve yanıt verildiyse çıkar.
            if (q.note && picked != null) ...[
              const SizedBox(height: 8),
              TextFormField(
                initialValue: picked.note,
                onChanged: (v) => setState(() => _answers[q.id] = (answer: picked.answer, note: v)),
                decoration: const InputDecoration(
                  hintText: 'Açıklama (isteğe bağlı)',
                  isDense: true,
                ),
                style: const TextStyle(fontSize: 13.5),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _answerButton(ConsentQuestion q, bool value, String label, bool selected) {
    final color = value ? AppColors.success : AppColors.primaryDark;
    return InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: () => setState(() {
        _answers[q.id] = (answer: value, note: _answers[q.id]?.note ?? '');
      }),
      child: Container(
        height: 46,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: selected ? color : Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: selected ? color : AppColors.border, width: selected ? 1.6 : 1),
        ),
        child: Text(label,
            style: TextStyle(
                fontSize: 14.5,
                fontWeight: FontWeight.w800,
                color: selected ? Colors.white : AppColors.ink)),
      ),
    );
  }

  Widget _chip(String text) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: AppColors.border),
        ),
        child: Text(text, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
      );
}
