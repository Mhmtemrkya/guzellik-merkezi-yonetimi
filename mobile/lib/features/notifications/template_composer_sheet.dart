import 'package:flutter/material.dart';

import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import 'message_kit.dart';

/// ŞABLON OLUŞTURUCU — web `TemplateComposerDialog` karşılığı.
///
/// "Ne zaman, hangi kanaldan, ne yazsın" üç soruda: hazır metinden başlanır, değişkenler imlecin
/// olduğu yere eklenir, müşterinin göreceği hâl ve SMS maliyeti yazarken görünür.
/// Kaydedildi/silindiyse `true` döner (liste yenilenmeli).
Future<bool> showTemplateComposerSheet(
  BuildContext context, {
  required ApiClient api,
  Map<String, dynamic>? template,
  String? initialTrigger,
  String? initialChannel,
  String salonName = '',
  bool canDelete = true,
  Future<void> Function(Map<String, dynamic> template)? onSend,
}) async {
  final result = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _TemplateComposerSheet(
      api: api,
      template: template,
      initialTrigger: initialTrigger,
      initialChannel: initialChannel,
      salonName: salonName,
      canDelete: canDelete,
      onSend: onSend,
    ),
  );
  return result == true;
}

class _TemplateComposerSheet extends StatefulWidget {
  const _TemplateComposerSheet({
    required this.api,
    required this.template,
    required this.initialTrigger,
    required this.initialChannel,
    required this.salonName,
    required this.canDelete,
    required this.onSend,
  });

  final ApiClient api;
  final Map<String, dynamic>? template;
  final String? initialTrigger;
  final String? initialChannel;
  final String salonName;
  final bool canDelete;
  final Future<void> Function(Map<String, dynamic> template)? onSend;

  @override
  State<_TemplateComposerSheet> createState() => _TemplateComposerSheetState();
}

class _TemplateComposerSheetState extends State<_TemplateComposerSheet> {
  late String _trigger;
  late String _channel;
  late final TextEditingController _body;
  late final TextEditingController _name;
  bool _nameTouched = false;
  bool _active = true;
  bool _statusTouched = false;
  bool _busy = false;
  String? _error;
  num? _smsCreditsPerPart;

  bool get _editing => widget.template != null;

  @override
  void initState() {
    super.initState();
    final t = widget.template;
    if (t != null) {
      _trigger = '${t['trigger'] ?? 'Manual'}';
      _channel = '${t['channel'] ?? 'Sms'}';
      _body = TextEditingController(text: '${t['body'] ?? ''}');
      _name = TextEditingController(text: '${t['name'] ?? ''}');
      _nameTouched = true;
      _active = '${t['status']}' == 'Active';
    } else {
      _trigger = widget.initialTrigger ?? 'Manual';
      _channel = widget.initialChannel ?? 'Sms';
      _body = TextEditingController(text: suggestedTexts[_trigger]?.first ?? '');
      _name = TextEditingController(text: _autoName);
    }
    _body.addListener(_onChanged);
    _loadCost();
  }

  void _onChanged() => setState(() {});

  /// SMS maliyet sayacı için parça başı kredi (cüzdandan). Alınamazsa sayaç kredisiz gösterilir.
  Future<void> _loadCost() async {
    try {
      final w = await widget.api.get('/api/admin/whatsapp/wallet');
      if (!mounted || w is! Map) return;
      final v = w['smsCreditsPerPart'];
      setState(() => _smsCreditsPerPart = v is num ? v : num.tryParse('$v'));
    } catch (_) {
      // Maliyet bilgisi isteğe bağlıdır; şablon kaydı bundan etkilenmez.
    }
  }

  @override
  void dispose() {
    _body.removeListener(_onChanged);
    _body.dispose();
    _name.dispose();
    super.dispose();
  }

  String get _autoName => '${triggerTitle(_trigger)} · ${channelTitle(_channel)}';
  String get _effectiveName => _name.text;

  /// Kullanıcı adı kendisi yazmadıysa ad, tetikleyici/kanal seçimini izler.
  void _syncAutoName() {
    if (!_nameTouched) _name.text = _autoName;
  }

  void _pickTrigger(String next) {
    final current = _body.text;
    final untouched = current.trim().isEmpty || suggestedTexts.values.any((l) => l.contains(current));
    setState(() {
      _trigger = next;
      if (untouched) _body.text = suggestedTexts[next]?.first ?? current;
      _syncAutoName();
    });
  }

  void _pickChannel(String next) => setState(() {
        _channel = next;
        _syncAutoName();
      });

  /// Değişkeni İMLECİN olduğu yere ekler (sona değil) ve imleci arkasına taşır.
  void _insertVariable(String key) {
    final token = '{{$key}}';
    final text = _body.text;
    final sel = _body.selection;
    final start = sel.isValid ? sel.start : text.length;
    final end = sel.isValid ? sel.end : text.length;
    final next = text.replaceRange(start, end, token);
    _body.value = TextEditingValue(
      text: next,
      selection: TextSelection.collapsed(offset: start + token.length),
    );
  }

  Future<void> _save() async {
    final name = _effectiveName.trim();
    final body = _body.text.trim();
    if (name.isEmpty) {
      setState(() => _error = 'Şablona bir ad verin.');
      return;
    }
    if (body.isEmpty) {
      setState(() => _error = 'Mesaj metni boş olamaz.');
      return;
    }
    setState(() { _busy = true; _error = null; });
    try {
      final t = widget.template;
      // Meta onayındaki şablonun durumu kullanıcı anahtara dokunmadıkça korunur.
      final status = _editing && !_statusTouched && '${t!['status']}' == 'PendingApproval'
          ? 'PendingApproval'
          : (_active ? 'Active' : 'Draft');
      final payload = <String, dynamic>{
        'name': name,
        'channel': _channel,
        'trigger': _trigger,
        'body': body,
        'status': status,
        'branchId': t != null ? t['branchId'] : widget.api.auth?.user?.branchId,
      };
      final res = t != null
          ? await widget.api.put('/api/admin/notification-templates/${t['id']}', payload)
          : await widget.api.post('/api/admin/notification-templates/', payload);
      if (!mounted) return;
      final pending = res is Map && res['pendingApproval'] == true;
      final messenger = ScaffoldMessenger.of(context);
      Navigator.pop(context, true);
      messenger.showSnackBar(SnackBar(
        content: Text(pending
            ? 'Şablon değişikliği onaya gönderildi.'
            : _editing
                ? 'Şablon güncellendi.'
                : (_active && isAutomatic(_trigger)
                    ? '"$name" oluşturuldu ve aktif — otomatik gönderim devrede.'
                    : '"$name" oluşturuldu.')),
      ));
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _delete() async {
    final t = widget.template;
    if (t == null) return;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Şablonu sil'),
        content: Text('"${t['name']}" şablonu silinsin mi?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Vazgeç')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.danger, minimumSize: const Size(0, 44)),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Sil'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    setState(() { _busy = true; _error = null; });
    try {
      await widget.api.delete('/api/admin/notification-templates/${t['id']}');
      if (!mounted) return;
      final messenger = ScaffoldMessenger.of(context);
      Navigator.pop(context, true);
      messenger.showSnackBar(const SnackBar(content: Text('Şablon silindi.')));
    } catch (e) {
      if (mounted) setState(() { _error = '$e'; _busy = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final preview = renderSample(_body.text, widget.salonName);
    final parts = smsParts(preview);
    final reminderFlow = usesWhatsAppReminderFlow(_channel, _trigger);
    final trigger = triggerOptions.firstWhere((t) => t.key == _trigger, orElse: () => triggerOptions.first);
    final channel = channelOptions.firstWhere((c) => c.key == _channel, orElse: () => channelOptions.first);
    final canSendNow = _editing && '${widget.template!['status']}' == 'Active' && widget.onSend != null;

    return DraggableScrollableSheet(
      initialChildSize: .95,
      minChildSize: .5,
      maxChildSize: .97,
      expand: false,
      builder: (context, scroll) => Container(
        decoration: const BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 14, 8, 6),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(_editing ? 'ŞABLONU DÜZENLE' : 'YENİ MESAJ ŞABLONU',
                            style: const TextStyle(fontSize: 10.5, letterSpacing: 1.2, fontWeight: FontWeight.w800, color: AppColors.primary)),
                        const SizedBox(height: 2),
                        Text(_effectiveName.isEmpty ? 'Mesaj şablonu' : _effectiveName,
                            maxLines: 1, overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: AppColors.ink)),
                      ],
                    ),
                  ),
                  IconButton(onPressed: _busy ? null : () => Navigator.pop(context, false), icon: const Icon(Icons.close_rounded)),
                ],
              ),
            ),
            const Divider(height: 1),
            Expanded(
              child: ListView(
                controller: scroll,
                padding: const EdgeInsets.fromLTRB(18, 14, 18, 24),
                children: [
                  const _StepTitle(n: 1, title: 'Ne zaman gönderilsin?'),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final t in triggerOptions)
                        ChoiceChip(
                          label: Text(t.title),
                          selected: _trigger == t.key,
                          onSelected: (_) => _pickTrigger(t.key),
                        ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(trigger.desc, style: const TextStyle(fontSize: 11.5, color: AppColors.muted)),
                  const SizedBox(height: 16),

                  const _StepTitle(n: 2, title: 'Hangi kanaldan?'),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final c in channelOptions)
                        ChoiceChip(
                          avatar: Icon(
                            c.key == 'Sms' ? Icons.sms_rounded : c.key == 'WhatsApp' ? Icons.chat_rounded : Icons.mail_rounded,
                            size: 16,
                          ),
                          label: Text(c.title),
                          selected: _channel == c.key,
                          onSelected: (_) => _pickChannel(c.key),
                        ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(channel.note, style: const TextStyle(fontSize: 11.5, color: AppColors.muted, height: 1.35)),
                  const SizedBox(height: 16),

                  const _StepTitle(n: 3, title: 'Ne yazsın?'),
                  if (reminderFlow)
                    const _Note(
                      color: Color(0xFFE8F3FB),
                      border: Color(0xFFBFDCF0),
                      text: 'WhatsApp randevu hatırlatması iki yönlü onay (Evet / Hayır / Ertele) akışıyla gider ve metnini '
                          'WhatsApp ayarlarındaki "Hatırlatma şablonu"ndan alır. Bu şablonu açmanız hatırlatmayı başlatır; buradaki metin kullanılmaz.',
                    ),
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      const Text('Hazır metin:', style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: AppColors.muted)),
                      for (var i = 0; i < (suggestedTexts[_trigger] ?? const <String>[]).length; i++)
                        ActionChip(
                          label: Text('Öneri ${i + 1}'),
                          onPressed: () => _body.text = suggestedTexts[_trigger]![i],
                        ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: _body,
                    minLines: 4,
                    maxLines: 8,
                    decoration: const InputDecoration(hintText: 'Merhaba {{ad}}, …', alignLabelWithHint: true),
                  ),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: [
                      for (final v in variablesFor(_trigger))
                        ActionChip(
                          avatar: const Icon(Icons.add_rounded, size: 16),
                          label: Text(v.label),
                          tooltip: v.hint,
                          onPressed: () => _insertVariable(v.key),
                        ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  const Text('Değişkene dokun, imlecin olduğu yere eklensin. Gönderimde her müşterinin kendi bilgisiyle dolar.',
                      style: TextStyle(fontSize: 11, color: AppColors.muted)),
                  const SizedBox(height: 16),

                  const Text('MÜŞTERİNİN GÖRECEĞİ',
                      style: TextStyle(fontSize: 10.5, letterSpacing: 1.2, fontWeight: FontWeight.w800, color: AppColors.primary)),
                  const SizedBox(height: 8),
                  MessageBubble(channel: _channel, text: reminderFlow ? '' : preview, salonName: widget.salonName),
                  if (_channel == 'Sms' && !reminderFlow) ...[
                    const SizedBox(height: 10),
                    Row(
                      children: [
                        Expanded(child: _Metric(label: 'Karakter', value: '${preview.length}')),
                        const SizedBox(width: 8),
                        Expanded(child: _Metric(label: 'SMS parçası', value: '$parts', warn: parts > 2)),
                        const SizedBox(width: 8),
                        Expanded(
                          child: _Metric(
                            label: 'Kredi / kişi',
                            value: _smsCreditsPerPart == null ? '—' : formatCredits(parts * _smsCreditsPerPart!),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    const Text(
                      "70 karaktere kadar 1 SMS; daha uzunu 67'şer karakterlik parçalara bölünür. Önce paket SMS kotası kullanılır, kredi yalnız kota bitince düşer.",
                      style: TextStyle(fontSize: 11, color: AppColors.muted, height: 1.35),
                    ),
                    if (hasEmoji(_body.text))
                      const _Note(
                        color: Color(0xFFFEF6E7),
                        border: Color(0xFFF3D9A0),
                        text: "Metinde emoji var: SMS'te 2 karakter sayılır ve bazı telefonlarda kutucuk olarak görünebilir.",
                      ),
                    if (parts > 2)
                      _Note(
                        color: const Color(0xFFFEF6E7),
                        border: const Color(0xFFF3D9A0),
                        text: 'Mesaj $parts parça tutuyor; kısaltırsanız kişi başı maliyet düşer.',
                      ),
                  ],
                  if (_channel == 'WhatsApp' && !reminderFlow) ...[
                    const SizedBox(height: 10),
                    _Note(
                      color: AppColors.surfaceSoft,
                      border: AppColors.border,
                      text: _trigger == 'PaymentDue'
                          ? 'Bilgilendirme mesajı: kota bitince mesaj başına hatırlatma kredisi düşer.'
                          : 'Kampanya sınıfında ücretlendirilir (Meta kuralı) ve WhatsApp ayarlarından kampanya izni gerekir. '
                              'Serbest metin yalnız son 24 saatte size yazmış müşteriye iletilir.',
                    ),
                  ],
                  const SizedBox(height: 16),

                  TextField(
                    controller: _name,
                    onChanged: (_) => setState(() => _nameTouched = true),
                    decoration: const InputDecoration(labelText: 'Şablon adı', isDense: true),
                  ),
                  const SizedBox(height: 4),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    value: _active,
                    onChanged: (v) => setState(() { _active = v; _statusTouched = true; }),
                    title: Text(_active ? 'Aktif' : 'Taslak', style: const TextStyle(fontWeight: FontWeight.w700)),
                    subtitle: Text(
                      trigger.automatic
                          ? (_active ? 'Otomatik gönderim çalışır' : 'Otomatik gönderim durur')
                          : (_active ? 'Gönderime hazır' : 'Gönderilemez'),
                      style: const TextStyle(fontSize: 11.5),
                    ),
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 6),
                    Text(_error!, style: const TextStyle(color: AppColors.danger, fontWeight: FontWeight.w600)),
                  ],
                ],
              ),
            ),
            const Divider(height: 1),
            SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
                child: Row(
                  children: [
                    if (_editing && widget.canDelete)
                      IconButton(
                        tooltip: 'Sil',
                        onPressed: _busy ? null : _delete,
                        icon: const Icon(Icons.delete_outline_rounded, color: AppColors.danger),
                      ),
                    if (canSendNow)
                      TextButton.icon(
                        style: TextButton.styleFrom(minimumSize: const Size(0, 44)),
                        onPressed: _busy
                            ? null
                            : () async {
                                final t = widget.template!;
                                Navigator.pop(context, false);
                                await widget.onSend!(t);
                              },
                        icon: const Icon(Icons.send_rounded, size: 18),
                        label: const Text('Gönder'),
                      ),
                    const Spacer(),
                    FilledButton.icon(
                      style: FilledButton.styleFrom(
                        backgroundColor: AppColors.primaryDark,
                        minimumSize: const Size(0, 46),
                        padding: const EdgeInsets.symmetric(horizontal: 18),
                      ),
                      onPressed: _busy ? null : _save,
                      icon: _busy
                          ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                          : const Icon(Icons.check_rounded, size: 18),
                      label: Text(_editing ? 'Kaydet' : 'Şablonu oluştur'),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Telefonda nasıl görüneceği — kanala göre balon rengi (web `PhonePreview` karşılığı).
class MessageBubble extends StatelessWidget {
  const MessageBubble({required this.channel, required this.text, required this.salonName, super.key});
  final String channel;
  final String text;
  final String salonName;

  @override
  Widget build(BuildContext context) {
    final (bg, fg) = switch (channel) {
      'WhatsApp' => (const Color(0xFFDCF8C6), const Color(0xFF1F2C1A)),
      'Email' => (Colors.white, AppColors.ink),
      _ => (const Color(0xFFE9E9EB), const Color(0xFF1C1C1E)),
    };
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFFF4F1F2),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Center(
            child: Text('${channelTitle(channel)} · ${salonName.isEmpty ? 'Salonunuz' : salonName}',
                style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: AppColors.muted)),
          ),
          const SizedBox(height: 8),
          if (text.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 18),
              child: Center(child: Text('Mesaj metni burada görünecek', style: TextStyle(fontSize: 11.5, color: AppColors.muted))),
            )
          else
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
              decoration: BoxDecoration(
                color: bg,
                borderRadius: const BorderRadius.only(
                  topLeft: Radius.circular(4),
                  topRight: Radius.circular(16),
                  bottomLeft: Radius.circular(16),
                  bottomRight: Radius.circular(16),
                ),
                border: channel == 'Email' ? Border.all(color: AppColors.border) : null,
              ),
              child: Text(text, style: TextStyle(fontSize: 13, height: 1.4, color: fg)),
            ),
        ],
      ),
    );
  }
}

class _StepTitle extends StatelessWidget {
  const _StepTitle({required this.n, required this.title});
  final int n;
  final String title;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Row(
          children: [
            Container(
              width: 20,
              height: 20,
              alignment: Alignment.center,
              decoration: const BoxDecoration(color: AppColors.primaryDark, shape: BoxShape.circle),
              child: Text('$n', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: Colors.white)),
            ),
            const SizedBox(width: 8),
            Text(title, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: AppColors.ink)),
          ],
        ),
      );
}

class _Metric extends StatelessWidget {
  const _Metric({required this.label, required this.value, this.warn = false});
  final String label;
  final String value;
  final bool warn;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 6),
        decoration: BoxDecoration(
          color: warn ? const Color(0xFFFEF6E7) : Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: warn ? const Color(0xFFF3D9A0) : AppColors.border),
        ),
        child: Column(
          children: [
            Text(value,
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: warn ? const Color(0xFFB7791F) : AppColors.primaryDark)),
            Text(label, style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: AppColors.muted)),
          ],
        ),
      );
}

class _Note extends StatelessWidget {
  const _Note({required this.color, required this.border, required this.text});
  final Color color;
  final Color border;
  final String text;

  @override
  Widget build(BuildContext context) => Container(
        margin: const EdgeInsets.only(top: 6, bottom: 4),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(12), border: Border.all(color: border)),
        child: Text(text, style: const TextStyle(fontSize: 11.5, height: 1.35, color: AppColors.ink)),
      );
}
