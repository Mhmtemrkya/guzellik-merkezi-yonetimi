import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/theme/app_theme.dart';
import 'assistant_api.dart';
import 'maydi_mascot.dart';

class _Message {
  _Message.user(this.text)
      : id = 'u${DateTime.now().microsecondsSinceEpoch}',
        fromUser = true,
        reply = null;
  _Message.assistant(this.id, this.text, this.reply, {this.feedback}) : fromUser = false;

  final String id;
  final String text;
  final bool fromUser;
  final Map<String, dynamic>? reply;
  int? feedback;
}

/// Maydi sohbet ekranı — web `MaydiAssistant` paneliyle aynı akış: ilk açılışta yapay zekâ onayı
/// (App Store 5.1.2(i)), rol bazlı brifing, nasıl yapılır kartı (adımlar), veri kartı (tablo), öneri
/// düğmeleri, 👍/👎, geçmiş sohbetler ve gizlilik notu. Güzellik/sağlık tavsiyesi vermez.
class AssistantScreen extends StatefulWidget {
  const AssistantScreen({required this.api, required this.auth, super.key});

  final AssistantApi api;
  final AuthController auth;

  @override
  State<AssistantScreen> createState() => _AssistantScreenState();
}

class _AssistantScreenState extends State<AssistantScreen> {
  final _input = TextEditingController();
  final _scroll = ScrollController();
  final _messages = <_Message>[];
  String? _consent; // granted | declined | null (sorulmadı)
  bool _consentLoaded = false;
  Map<String, dynamic>? _briefing;
  String? _conversationId;
  bool _busy = false;
  String _error = '';
  String? _responseId;
  MaydiMood _responseMood = MaydiMood.speaking;

  String get _scope => '${widget.api.isCustomer ? 'customer' : 'business'}.${widget.auth.user?.id ?? ''}';
  bool get _allowAi => _consent == 'granted';

  @override
  void initState() {
    super.initState();
    MaydiConsent.read(_scope).then((value) {
      if (!mounted) return;
      setState(() {
        _consent = value;
        _consentLoaded = true;
      });
      if (value != null) _loadBriefing();
    });
  }

  @override
  void dispose() {
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _decide(String value) async {
    await MaydiConsent.write(_scope, value);
    if (!mounted) return;
    setState(() => _consent = value);
    _loadBriefing();
  }

  Future<void> _loadBriefing() async {
    try {
      final briefing = await widget.api.briefing(allowAi: _allowAi);
      if (mounted) setState(() => _briefing = briefing);
    } catch (_) {
      if (mounted) setState(() => _briefing = {'greeting': 'Merhaba, ben Maydi.', 'lines': const [], 'suggestions': const []});
    }
  }

  void _scrollDown() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) _scroll.animateTo(_scroll.position.maxScrollExtent, duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
    });
  }

  Future<void> _send(String raw) async {
    final message = raw.trim();
    if (message.isEmpty || _busy) return;
    setState(() {
      _error = '';
      _input.clear();
      _messages.add(_Message.user(message));
      _busy = true;
    });
    _scrollDown();
    try {
      final reply = await widget.api.send(
        message,
        conversationId: _conversationId,
        allowAi: _allowAi,
        clientMessageId: '${DateTime.now().microsecondsSinceEpoch}-${math.Random().nextInt(1 << 30)}',
      );
      if (!mounted) return;
      setState(() {
        _conversationId = '${reply['conversationId'] ?? ''}';
        _messages.add(_Message.assistant('${reply['messageId']}', '${reply['text'] ?? ''}', reply));
        _responseMood = _moodOf(reply, message);
        _responseId = '${reply['messageId']}';
      });
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _busy = false);
      _scrollDown();
    }
  }

  MaydiMood _moodOf(Map<String, dynamic> reply, String question) {
    final outcome = '${reply['outcome'] ?? ''}';
    if (outcome == 'denied' || outcome == 'error') return MaydiMood.speaking;
    if (isMaydiAppreciation(question)) return MaydiMood.love;
    final kind = '${reply['kind'] ?? ''}';
    final actions = (reply['actions'] as List?) ?? const [];
    if (kind == 'how_to' || actions.any((action) => action is Map && action['type'] == 'navigate')) return MaydiMood.guiding;
    if (kind == 'data') return MaydiMood.happy;
    return MaydiMood.speaking;
  }

  Future<void> _rate(_Message message, bool helpful) async {
    setState(() => message.feedback = helpful ? 1 : -1);
    try {
      await widget.api.feedback(message.id, helpful);
    } catch (_) {}
  }

  void _navigate(String? webRoute) {
    final route = mobileRouteFor(webRoute, customer: widget.api.isCustomer);
    if (route == null) return;
    Navigator.of(context).pop();
    GoRouter.of(context).go(route);
  }

  void _newChat() => setState(() {
        _messages.clear();
        _conversationId = null;
        _error = '';
      });

  Future<void> _openHistory() async {
    List<Map<String, dynamic>> items;
    try {
      items = await widget.api.conversations();
    } catch (_) {
      items = const [];
    }
    if (!mounted) return;
    final picked = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) => _HistorySheet(
        items: items,
        onDelete: (id) async {
          await widget.api.deleteConversation(id);
          if (id == _conversationId) _newChat();
        },
      ),
    );
    if (picked == null) return;
    try {
      final stored = await widget.api.messages(picked);
      if (!mounted) return;
      setState(() {
        _messages
          ..clear()
          ..addAll(stored.map((item) => item['sender'] == 'user'
              ? _Message.user('${item['text'] ?? ''}')
              : _Message.assistant('${item['id']}', '${item['text'] ?? ''}', _storedReply(item),
                  feedback: (item['feedback'] as num?)?.toInt())));
        _conversationId = picked;
      });
      _scrollDown();
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    }
  }

  /// Kayıtlı mesajın kart verisini canlı cevap biçimine çevirir (web storedToReply ile aynı).
  Map<String, dynamic> _storedReply(Map<String, dynamic> item) {
    Map<String, dynamic> payload = const {};
    try {
      final decoded = jsonDecode('${item['payloadJson'] ?? '{}'}');
      if (decoded is Map) payload = Map<String, dynamic>.from(decoded);
    } catch (_) {}
    return {
      'kind': item['kind'],
      'outcome': item['outcome'],
      'text': item['text'],
      'data': payload['data'],
      'actions': payload['actions'] ?? const [],
      'suggestions': payload['suggestions'] ?? const [],
    };
  }

  @override
  Widget build(BuildContext context) {
    final sizes = MaydiSizes.of(context);
    return Scaffold(
      backgroundColor: AppColors.surface,
      appBar: AppBar(
        backgroundColor: const Color(0xFFFFF5F8),
        titleSpacing: 0,
        title: Row(
          children: [
            MaydiMascot(size: sizes.header, thinking: _busy, responseId: _responseId, responseMood: _responseMood),
            const SizedBox(width: 8),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Maydi', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16, color: AppColors.ink)),
                Text(_consent == 'declined' ? 'Yapay zekâ kapalı' : 'BeautyAsist asistanı',
                    style: const TextStyle(fontSize: 11, color: AppColors.muted)),
              ],
            ),
          ],
        ),
        actions: [
          if (_consent != null) ...[
            IconButton(tooltip: 'Geçmiş sohbetler', onPressed: _openHistory, icon: const Icon(Icons.history_rounded)),
            IconButton(tooltip: 'Yeni sohbet', onPressed: _newChat, icon: const Icon(Icons.refresh_rounded)),
          ],
        ],
      ),
      body: !_consentLoaded
          ? const Center(child: CircularProgressIndicator())
          : _consent == null
              ? _ConsentView(onDecide: _decide, heroSize: sizes.hero)
              : SafeArea(top: false, child: _chat()),
    );
  }

  Widget _chat() {
    final lastReply = _messages.reversed.firstWhere((item) => item.reply != null, orElse: () => _Message.user('')).reply;
    final Map<String, dynamic>? source = _messages.isEmpty ? _briefing : lastReply;
    final Object? rawSuggestions = source == null ? null : source['suggestions'];
    final suggestions = rawSuggestions is List ? rawSuggestions.whereType<String>().toList() : const <String>[];
    return Column(
      children: [
        Expanded(
          child: ListView(
            controller: _scroll,
            padding: const EdgeInsets.fromLTRB(12, 12, 12, 12),
            children: [
              if (_messages.isEmpty) _BriefingCard(briefing: _briefing),
              for (final message in _messages)
                message.fromUser
                    ? _UserBubble(text: message.text)
                    : _AssistantBubble(message: message, onNavigate: _navigate, onRate: _rate, customer: widget.api.isCustomer),
              if (_busy)
                const Padding(
                  padding: EdgeInsets.only(top: 8),
                  child: Row(children: [
                    SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2)),
                    SizedBox(width: 8),
                    Text('Maydi düşünüyor…', style: TextStyle(color: AppColors.muted, fontSize: 12.5)),
                  ]),
                ),
              if (_error.isNotEmpty)
                Container(
                  margin: const EdgeInsets.only(top: 8),
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(color: const Color(0xFFFFF1F2), borderRadius: BorderRadius.circular(12)),
                  child: Text(_error, style: const TextStyle(color: AppColors.danger, fontSize: 12)),
                ),
            ],
          ),
        ),
        if (suggestions.isNotEmpty && !_busy)
          SizedBox(
            height: 42,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
              itemCount: suggestions.length,
              separatorBuilder: (_, _) => const SizedBox(width: 6),
              itemBuilder: (_, index) => ActionChip(
                label: Text(suggestions[index], style: const TextStyle(fontSize: 12, color: AppColors.primaryDark)),
                backgroundColor: AppColors.surface,
                side: const BorderSide(color: AppColors.border),
                onPressed: () => _send(suggestions[index]),
              ),
            ),
          ),
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 6, 12, 4),
          child: Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _input,
                  maxLength: 1000,
                  minLines: 1,
                  maxLines: 4,
                  textInputAction: TextInputAction.send,
                  onSubmitted: _send,
                  decoration: const InputDecoration(hintText: "Maydi'ye sorun…", counterText: '', isDense: true),
                ),
              ),
              const SizedBox(width: 8),
              IconButton.filled(
                tooltip: 'Gönder',
                onPressed: _busy ? null : () => _send(_input.text),
                icon: const Icon(Icons.send_rounded),
              ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 0, 14, 8),
          child: Text(
            _allowAi
                ? 'Yardım için yalnız sorunuz, ad/telefon/TC/e-posta gizlenerek yapay zekâya gider; sağlık bilgisi asla gönderilmez. Sohbetler 90 gün saklanır. Güzellik/sağlık tavsiyesi vermez.'
                : 'Yapay zekâ kapalı: sorularınız dışarı gönderilmez. Sohbetler 90 gün saklanır. Güzellik/sağlık tavsiyesi vermez.',
            style: const TextStyle(fontSize: 10, color: AppColors.muted, height: 1.3),
          ),
        ),
      ],
    );
  }
}

class _ConsentView extends StatelessWidget {
  const _ConsentView({required this.onDecide, required this.heroSize});
  final void Function(String) onDecide;
  final double heroSize;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
      children: [
        Center(child: MaydiMascot(size: heroSize, mood: MaydiMood.guiding)),
        const SizedBox(height: 12),
        const Text('Merhaba, ben Maydi!', textAlign: TextAlign.center, style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: AppColors.ink)),
        const SizedBox(height: 10),
        const Text(
          'Uygulamanın nasıl kullanıldığını anlatır, randevu, kasa ve stok gibi sorularınızı doğrudan kendi kayıtlarınızdan cevaplarım.',
          style: TextStyle(fontSize: 14, color: AppColors.ink, height: 1.4),
        ),
        const SizedBox(height: 12),
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(color: const Color(0xFFFFF8FB), borderRadius: BorderRadius.circular(14), border: Border.all(color: AppColors.border)),
          child: const Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Yapay zekâ kullanımı', style: TextStyle(fontWeight: FontWeight.w700, color: AppColors.primaryDark)),
              SizedBox(height: 4),
              Text(
                '"Nasıl yapılır" sorularınızı daha iyi anlamak için yalnız soru metniniz, üçüncü taraf bir yapay zekâ hizmetine '
                '(OpenRouter üzerinden) gönderilir. Göndermeden önce müşteri/personel adları, telefon, TC ve e-posta gizlenir; '
                'konsültasyon ve sağlık bilgileri hiçbir zaman gönderilmez, sağlayıcı veriyi saklamaz ya da eğitimde kullanmaz.',
                style: TextStyle(fontSize: 12.5, color: AppColors.ink, height: 1.4),
              ),
            ],
          ),
        ),
        const SizedBox(height: 10),
        const Text(
          'Kayıt: Maydi sohbetleri güvenlik amacıyla 90 gün saklanır ve bu sürede yetkili BeautyAsist personeli '
          'tarafından görüntülenebilir. Ayrıntılar Gizlilik Politikası\'nda.',
          style: TextStyle(fontSize: 12, color: AppColors.muted, height: 1.35),
        ),
        const SizedBox(height: 16),
        FilledButton(onPressed: () => onDecide('granted'), child: const Text('Kabul ediyorum')),
        const SizedBox(height: 8),
        OutlinedButton(onPressed: () => onDecide('declined'), child: const Text('Yapay zekâsız kullan')),
      ],
    );
  }
}

class _BriefingCard extends StatelessWidget {
  const _BriefingCard({required this.briefing});
  final Map<String, dynamic>? briefing;

  @override
  Widget build(BuildContext context) {
    final lines = (briefing?['lines'] as List?)?.whereType<String>().toList() ?? const <String>[];
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: const Color(0xFFFFF5F8), borderRadius: BorderRadius.circular(16)),
      child: briefing == null
          ? const Row(children: [
              SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2)),
              SizedBox(width: 8),
              Text('Hazırlanıyor…', style: TextStyle(color: AppColors.muted)),
            ])
          : Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('${briefing!['greeting'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w700, color: AppColors.ink, height: 1.35)),
                for (final line in lines)
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      const Padding(padding: EdgeInsets.only(top: 6), child: CircleAvatar(radius: 3, backgroundColor: AppColors.primary)),
                      const SizedBox(width: 8),
                      Expanded(child: Text(line, style: const TextStyle(color: AppColors.ink, height: 1.35))),
                    ]),
                  ),
              ],
            ),
    );
  }
}

class _UserBubble extends StatelessWidget {
  const _UserBubble({required this.text});
  final String text;

  @override
  Widget build(BuildContext context) => Align(
        alignment: Alignment.centerRight,
        child: Container(
          margin: const EdgeInsets.only(top: 10, left: 48),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
          decoration: const BoxDecoration(
            color: Color(0xFF8E3F5B),
            borderRadius: BorderRadius.only(topLeft: Radius.circular(16), topRight: Radius.circular(16), bottomLeft: Radius.circular(16), bottomRight: Radius.circular(4)),
          ),
          child: Text(text, style: const TextStyle(color: Colors.white, height: 1.35)),
        ),
      );
}

const _fieldLabels = <String, String>{
  'time': 'Saat', 'customer': 'Müşteri', 'service': 'Hizmet', 'status': 'Durum', 'left': 'Kalan', 'total': 'Toplam',
  'staff': 'Personel', 'free': 'Boş aralık', 'count': 'Adet', 'day': 'Gün', 'title': 'İşlem', 'by': 'İsteyen', 'at': 'Tarih',
  'product': 'Ürün', 'stock': 'Stok', 'min': 'Kritik', 'unit': 'Birim', 'date': 'Tarih', 'amount': 'Tutar',
  'oldest': 'En eski vade', 'completed': 'Tamamlanan', 'revenue': 'Ciro', 'last': 'Son', 'when': 'Zaman',
  'method': 'Yöntem', 'income': 'Tahsilat', 'average': 'Ortalama',
};
const _moneyFields = {'amount', 'revenue', 'income'};

String _cell(String key, dynamic value) {
  if (value is List) return value.join(', ');
  if (value is num && _moneyFields.contains(key)) return '${value.toStringAsFixed(2).replaceAll('.', ',')} ₺';
  return value == null ? '—' : '$value';
}

class _AssistantBubble extends StatelessWidget {
  const _AssistantBubble({required this.message, required this.onNavigate, required this.onRate, required this.customer});
  final _Message message;
  final void Function(String?) onNavigate;
  final void Function(_Message, bool) onRate;
  final bool customer;

  @override
  Widget build(BuildContext context) {
    final reply = message.reply ?? const {};
    final data = reply['data'];
    final kind = '${reply['kind'] ?? ''}';
    final steps = kind == 'how_to' && data is Map ? (data['steps'] as List?)?.whereType<String>().toList() ?? const <String>[] : const <String>[];
    final items = kind == 'data' && data is Map ? (data['items'] as List?)?.whereType<Map>().toList() ?? const <Map>[] : const <Map>[];
    final actions = ((reply['actions'] as List?) ?? const []).whereType<Map>()
        .where((action) => action['type'] == 'navigate' && mobileRouteFor('${action['route']}', customer: customer) != null)
        .toList();
    return Align(
      alignment: Alignment.centerLeft,
      child: Padding(
        padding: const EdgeInsets.only(top: 10, right: 24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
              decoration: const BoxDecoration(
                color: AppColors.surfaceSoft,
                borderRadius: BorderRadius.only(topLeft: Radius.circular(16), topRight: Radius.circular(16), bottomRight: Radius.circular(16), bottomLeft: Radius.circular(4)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(message.text, style: const TextStyle(color: AppColors.ink, height: 1.4)),
                  for (var i = 0; i < steps.length; i++)
                    Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        CircleAvatar(radius: 10, backgroundColor: const Color(0xFF8E3F5B),
                            child: Text('${i + 1}', style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.w700))),
                        const SizedBox(width: 8),
                        Expanded(child: Text(steps[i], style: const TextStyle(color: AppColors.ink, height: 1.35))),
                      ]),
                    ),
                  for (final item in items.take(15))
                    Container(
                      margin: const EdgeInsets.only(top: 6),
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(10), border: Border.all(color: AppColors.border)),
                      child: Wrap(
                        spacing: 10,
                        runSpacing: 2,
                        children: [
                          for (final entry in item.entries.where((entry) => entry.value != null))
                            Text('${_fieldLabels['${entry.key}'] ?? entry.key}: ${_cell('${entry.key}', entry.value)}',
                                style: const TextStyle(fontSize: 12, color: AppColors.ink)),
                        ],
                      ),
                    ),
                  for (final action in actions)
                    Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: OutlinedButton.icon(
                        onPressed: () => onNavigate('${action['route']}'),
                        icon: const Icon(Icons.arrow_forward_rounded, size: 16),
                        label: Text('${action['label'] ?? 'Sayfayı aç'}'),
                      ),
                    ),
                ],
              ),
            ),
            if (reply.isNotEmpty && reply['outcome'] != 'small_talk')
              Row(mainAxisSize: MainAxisSize.min, children: [
                IconButton(
                  tooltip: 'Faydalı',
                  visualDensity: VisualDensity.compact,
                  onPressed: () => onRate(message, true),
                  icon: Icon(Icons.thumb_up_alt_outlined, size: 16, color: message.feedback == 1 ? AppColors.success : AppColors.muted),
                ),
                IconButton(
                  tooltip: 'Faydalı değil',
                  visualDensity: VisualDensity.compact,
                  onPressed: () => onRate(message, false),
                  icon: Icon(Icons.thumb_down_alt_outlined, size: 16, color: message.feedback == -1 ? AppColors.danger : AppColors.muted),
                ),
              ]),
          ],
        ),
      ),
    );
  }
}

class _HistorySheet extends StatefulWidget {
  const _HistorySheet({required this.items, required this.onDelete});
  final List<Map<String, dynamic>> items;
  final Future<void> Function(String) onDelete;

  @override
  State<_HistorySheet> createState() => _HistorySheetState();
}

class _HistorySheetState extends State<_HistorySheet> {
  late final List<Map<String, dynamic>> _items = [...widget.items];

  @override
  Widget build(BuildContext context) {
    if (_items.isEmpty) {
      return const Padding(padding: EdgeInsets.all(32), child: Text('Henüz kayıtlı sohbet yok.', textAlign: TextAlign.center));
    }
    return ListView(
      shrinkWrap: true,
      children: [
        for (final item in _items)
          ListTile(
            title: Text('${item['title'] ?? ''}', maxLines: 1, overflow: TextOverflow.ellipsis),
            subtitle: Text(_when('${item['lastMessageAtUtc'] ?? ''}')),
            onTap: () => Navigator.of(context).pop('${item['id']}'),
            trailing: IconButton(
              tooltip: 'Sohbeti sil',
              icon: const Icon(Icons.delete_outline_rounded),
              onPressed: () async {
                final id = '${item['id']}';
                try {
                  await widget.onDelete(id);
                  setState(() => _items.removeWhere((row) => '${row['id']}' == id));
                } catch (_) {}
              },
            ),
          ),
      ],
    );
  }

  static String _when(String utc) {
    // Sunucu UTC damgasını 'Z' olmadan gönderir (MySQL Kind=Unspecified); eklenmezse yerel saat sanılır.
    final hasZone = RegExp(r'([zZ]|[+-]\d\d:?\d\d)$').hasMatch(utc);
    final parsed = DateTime.tryParse(hasZone ? utc : '${utc}Z')?.toLocal();
    if (parsed == null) return '';
    String two(int value) => value.toString().padLeft(2, '0');
    return '${two(parsed.day)}.${two(parsed.month)}.${parsed.year} ${two(parsed.hour)}:${two(parsed.minute)}';
  }
}
