import 'package:flutter/material.dart';

import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/widgets/app_background.dart';
import '../../shared/widgets/page_header.dart';

/// DESTEK TALEPLERİ — kurum kullanıcısının kendi talepleri (web `/destek` paritesi).
///
/// KAPSAM SUNUCUDA: `/api/support` yalnız oturumdaki kurumun taleplerini döner. İstemci
/// hiçbir kurum kimliği göndermez ve gönderemez — filtreyi istemciye bırakmak, başka bir
/// kurumun destek geçmişini istemeye açık kapı bırakırdı.
///
/// ZİYARETÇİ AKIŞI BURADA YOKTUR: takip kodu + jetonla oturumsuz görüntüleme web'e özeldir
/// (uygulamayı açan zaten giriş yapmıştır). Talebi açan kurum kullanıcısı onu buradan izler.
class SupportScreen extends StatefulWidget {
  const SupportScreen({required this.api, super.key});
  final ApiClient api;

  @override
  State<SupportScreen> createState() => _SupportScreenState();
}

/// Durum etiketleri — sunucudaki SupportTicketStatus ile AYNI sıra.
const _statusLabels = <String>[
  'Açık',
  'İnceleniyor',
  'Yanıtınız bekleniyor',
  'Çözüldü',
  'Kapatıldı',
];

/// Kategori etiketleri — SupportTicketCategory sırası.
const _categoryLabels = <String>[
  'Genel soru',
  'Bir şey çalışmıyor',
  'Fatura & abonelik',
  'Özellik isteği',
  'Hesap & yetki',
  'Kurulum & veri aktarımı',
];

/// Kategori seçenekleri — kullanıcının kendi dilinde (web formuyla aynı sıra ve sözcükler).
const _categoryOptions = <(int, String, IconData)>[
  (1, 'Bir şey çalışmıyor', Icons.bug_report_outlined),
  (2, 'Fatura & abonelik', Icons.credit_card_outlined),
  (4, 'Hesap & yetki', Icons.manage_accounts_outlined),
  (5, 'Kurulum & veri aktarımı', Icons.rocket_launch_outlined),
  (3, 'Özellik isteği', Icons.lightbulb_outline_rounded),
  (0, 'Genel soru', Icons.help_outline_rounded),
];

Color _statusColor(int status) => switch (status) {
      0 => AppColors.warning,
      1 => AppColors.mint,
      2 => AppColors.violet,
      3 => AppColors.success,
      _ => AppColors.muted,
    };

String _label(List<String> labels, Object? raw) {
  final i = raw is int ? raw : int.tryParse('$raw') ?? -1;
  return i >= 0 && i < labels.length ? labels[i] : '—';
}

int _asInt(Object? raw) => raw is int ? raw : int.tryParse('$raw') ?? 0;

/// Sunucudan UTC gelir; kullanıcıya YEREL saat gösterilir.
String _fmt(Object? iso) {
  final parsed = DateTime.tryParse('$iso');
  if (parsed == null) return '—';
  final d = parsed.toLocal();
  const months = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  final hh = d.hour.toString().padLeft(2, '0');
  final mm = d.minute.toString().padLeft(2, '0');
  return '${d.day} ${months[d.month - 1]} ${d.year}, $hh:$mm';
}

class _SupportScreenState extends State<SupportScreen> {
  late Future<List<Map<String, dynamic>>> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<List<Map<String, dynamic>>> _load() async {
    final data = await widget.api.get('/api/support/', query: {'pageSize': 50});
    final items = (data is Map ? data['items'] : data) as List? ?? const [];
    return items.map((e) => (e as Map).cast<String, dynamic>()).toList();
  }

  void _reload() => setState(() => _future = _load());

  @override
  Widget build(BuildContext context) {
    return AppBackground(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        floatingActionButton: FloatingActionButton.extended(
          onPressed: _openCreate,
          backgroundColor: AppColors.primary,
          foregroundColor: Colors.white,
          icon: const Icon(Icons.add_rounded),
          label: const Text('Yeni talep'),
        ),
        body: SafeArea(
          child: RefreshIndicator(
            color: AppColors.primary,
            onRefresh: () async => _reload(),
            child: FutureBuilder<List<Map<String, dynamic>>>(
              future: _future,
              builder: (context, snapshot) {
                final tickets = snapshot.data ?? const <Map<String, dynamic>>[];
                return ListView(
                  padding: const EdgeInsets.fromLTRB(16, 20, 16, 110),
                  children: [
                    const PageHeader(
                      eyebrow: 'Yardım',
                      title: 'Destek',
                      subtitle: 'Talep açın, yanıtları buradan izleyin.',
                    ),
                    const SizedBox(height: 14),
                    if (snapshot.connectionState != ConnectionState.done && !snapshot.hasData)
                      const Padding(
                        padding: EdgeInsets.all(40),
                        child: Center(child: CircularProgressIndicator()),
                      )
                    else if (snapshot.hasError)
                      _empty(
                        icon: Icons.cloud_off_rounded,
                        title: 'Talepler yüklenemedi',
                        body: '${snapshot.error}',
                      )
                    else if (tickets.isEmpty)
                      _empty(
                        icon: Icons.support_agent_rounded,
                        title: 'Henüz destek talebiniz yok',
                        body: 'Bir sorunuz ya da sorununuz olduğunda “Yeni talep” ile bize yazın. '
                            'Her talebe takip kodu verilir ve yanıtı burada görürsünüz.',
                      )
                    else
                      for (final t in tickets) ...[
                        _ticketCard(t),
                        const SizedBox(height: 10),
                      ],
                  ],
                );
              },
            ),
          ),
        ),
      ),
    );
  }

  Widget _empty({required IconData icon, required String title, required String body}) => Container(
        padding: const EdgeInsets.all(28),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(22),
          border: Border.all(color: AppColors.border),
        ),
        child: Column(
          children: [
            Icon(icon, size: 40, color: AppColors.primary),
            const SizedBox(height: 12),
            Text(
              title,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: AppColors.ink),
            ),
            const SizedBox(height: 6),
            Text(
              body,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 12.5, height: 1.4, color: AppColors.muted),
            ),
          ],
        ),
      );

  Widget _ticketCard(Map<String, dynamic> t) {
    final status = _asInt(t['status']);
    final unread = t['hasUnreadForRequester'] == true;
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(20),
      child: InkWell(
        borderRadius: BorderRadius.circular(20),
        onTap: () => _openDetail('${t['id']}'),
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: AppColors.border),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Text(
                    '${t['code']}',
                    style: const TextStyle(
                      fontSize: 11.5,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 0.4,
                      color: AppColors.primaryDark,
                    ),
                  ),
                  const SizedBox(width: 8),
                  _chip(_label(_statusLabels, t['status']), _statusColor(status)),
                  const Spacer(),
                  // Okunmamış yanıt — sessiz bir nokta, rozet gürültüsü değil.
                  if (unread)
                    Container(
                      width: 8,
                      height: 8,
                      decoration: const BoxDecoration(color: AppColors.primary, shape: BoxShape.circle),
                    ),
                ],
              ),
              const SizedBox(height: 8),
              Text(
                '${t['subject']}',
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 14.5,
                  fontWeight: unread ? FontWeight.w700 : FontWeight.w600,
                  color: AppColors.ink,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                '${_label(_categoryLabels, t['category'])} · ${_fmt(t['lastMessageAtUtc'])}',
                style: const TextStyle(fontSize: 11.5, color: AppColors.muted),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _chip(String text, Color color) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.10),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: color.withValues(alpha: 0.35)),
        ),
        child: Text(
          text,
          style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: color),
        ),
      );

  Future<void> _openCreate() async {
    final created = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _CreateSheet(api: widget.api),
    );
    if (created == true) _reload();
  }

  Future<void> _openDetail(String id) async {
    final changed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _DetailSheet(api: widget.api, id: id),
    );
    // Yanıt yazıldıysa liste tazelenmeli: okunmamış rozeti ve son mesaj tarihi değişti.
    if (changed == true) _reload();
  }
}

// =============================================================================== yeni talep

class _CreateSheet extends StatefulWidget {
  const _CreateSheet({required this.api});
  final ApiClient api;

  @override
  State<_CreateSheet> createState() => _CreateSheetState();
}

class _CreateSheetState extends State<_CreateSheet> {
  final subjectController = TextEditingController();
  final messageController = TextEditingController();
  int category = 1;
  bool busy = false;
  String? error;

  @override
  void dispose() {
    subjectController.dispose();
    messageController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final subject = subjectController.text.trim();
    final message = messageController.text.trim();
    if (subject.length < 3) {
      setState(() => error = 'Lütfen kısa bir konu başlığı yazın.');
      return;
    }
    if (message.length < 10) {
      setState(() => error = 'Sorununuzu biraz daha ayrıntılı anlatır mısınız? (En az 10 karakter)');
      return;
    }
    setState(() {
      busy = true;
      error = null;
    });
    try {
      // Ad/e-posta/kurum SUNUCUDAN gelir (oturum) — istemci göndermez ve gönderse de yok sayılır.
      await widget.api.post('/api/public/support/', {
        'subject': subject,
        'message': message,
        'category': category,
      });
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (mounted) setState(() => error = e.message);
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return _sheetShell(
      context,
      title: 'Yeni destek talebi',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Konu hangisi?',
            style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppColors.muted),
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final (value, label, icon) in _categoryOptions)
                _categoryChip(value: value, label: label, icon: icon),
            ],
          ),
          const SizedBox(height: 16),
          TextField(
            controller: subjectController,
            maxLength: 180,
            decoration: const InputDecoration(
              labelText: 'Konu başlığı',
              counterText: '',
              hintText: 'Örn. Randevu tamamlanınca seans düşmüyor',
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: messageController,
            maxLines: 6,
            maxLength: 4000,
            decoration: const InputDecoration(
              labelText: 'Ne oldu?',
              alignLabelWithHint: true,
              hintText: 'Adım adım ne yaptığınızı ve ne beklediğinizi yazarsanız çok daha hızlı çözeriz.',
            ),
          ),
          if (error != null) ...[
            const SizedBox(height: 6),
            Text(error!, style: const TextStyle(color: AppColors.danger, fontSize: 12.5, height: 1.35)),
          ],
          const SizedBox(height: 14),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: busy ? null : _submit,
              icon: busy
                  ? const SizedBox.square(
                      dimension: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : const Icon(Icons.send_rounded, size: 18),
              label: const Text('Talebi gönder'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _categoryChip({required int value, required String label, required IconData icon}) {
    final active = category == value;
    return InkWell(
      borderRadius: BorderRadius.circular(20),
      onTap: () => setState(() => category = value),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
        decoration: BoxDecoration(
          color: active ? AppColors.primary.withValues(alpha: 0.10) : Colors.white,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: active ? AppColors.primary : AppColors.border),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 15, color: active ? AppColors.primaryDark : AppColors.muted),
            const SizedBox(width: 6),
            Text(
              label,
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: active ? AppColors.primaryDark : AppColors.ink,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// =============================================================================== talep ayrıntısı

class _DetailSheet extends StatefulWidget {
  const _DetailSheet({required this.api, required this.id});
  final ApiClient api;
  final String id;

  @override
  State<_DetailSheet> createState() => _DetailSheetState();
}

class _DetailSheetState extends State<_DetailSheet> {
  final replyController = TextEditingController();
  Map<String, dynamic>? ticket;
  bool loading = true;
  bool busy = false;

  /// Yanıt yazıldı mı? Kapanışta listeye bildirilir (okunmamış rozeti + son mesaj değişti).
  bool changed = false;
  String? error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    replyController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final data = await widget.api.get('/api/support/${widget.id}');
      if (mounted) {
        setState(() => ticket = (data as Map).cast<String, dynamic>());
        // Sunucu okunmamış rozetini düşürdü — liste tazelenmeli.
        changed = true;
      }
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> _reply() async {
    final message = replyController.text.trim();
    if (message.length < 2) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final data = await widget.api.post('/api/support/${widget.id}/reply', {'message': message});
      if (mounted) {
        setState(() {
          ticket = (data as Map).cast<String, dynamic>();
          changed = true;
        });
        replyController.clear();
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => error = e.message);
    } catch (e) {
      if (mounted) setState(() => error = '$e');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = ticket;
    final status = t == null ? 0 : _asInt(t['status']);
    final closed = status == 4;
    final messages = (t?['messages'] as List? ?? const [])
        .map((e) => (e as Map).cast<String, dynamic>())
        .toList();

    return PopScope(
      canPop: true,
      onPopInvokedWithResult: (_, _) {},
      child: _sheetShell(
        context,
        title: t == null ? 'Destek talebi' : '${t['code']}',
        onClose: () => Navigator.of(context).pop(changed),
        child: loading
            ? const Padding(padding: EdgeInsets.all(40), child: Center(child: CircularProgressIndicator()))
            : t == null
                ? Text(error ?? 'Talep bulunamadı.', style: const TextStyle(color: AppColors.danger))
                : Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                            decoration: BoxDecoration(
                              color: _statusColor(status).withValues(alpha: 0.10),
                              borderRadius: BorderRadius.circular(20),
                              border: Border.all(color: _statusColor(status).withValues(alpha: 0.35)),
                            ),
                            child: Text(
                              _label(_statusLabels, t['status']),
                              style: TextStyle(
                                fontSize: 10.5,
                                fontWeight: FontWeight.w700,
                                color: _statusColor(status),
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              _label(_categoryLabels, t['category']),
                              style: const TextStyle(fontSize: 11.5, color: AppColors.muted),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 10),
                      Text(
                        '${t['subject']}',
                        style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: AppColors.ink),
                      ),
                      const SizedBox(height: 16),
                      for (final m in messages) ...[
                        _message(m),
                        const SizedBox(height: 10),
                      ],
                      const SizedBox(height: 6),
                      if (closed)
                        Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: AppColors.surfaceSoft,
                            borderRadius: BorderRadius.circular(14),
                            border: Border.all(color: AppColors.border),
                          ),
                          child: const Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Icon(Icons.lock_outline_rounded, size: 18, color: AppColors.muted),
                              SizedBox(width: 10),
                              Expanded(
                                child: Text(
                                  'Bu talep kapatıldı. Yeni bir sorunuz için yeni talep oluşturun.',
                                  style: TextStyle(fontSize: 12, height: 1.35, color: AppColors.muted),
                                ),
                              ),
                            ],
                          ),
                        )
                      else ...[
                        TextField(
                          controller: replyController,
                          maxLines: 4,
                          maxLength: 4000,
                          decoration: const InputDecoration(
                            labelText: 'Yanıt yazın',
                            alignLabelWithHint: true,
                            counterText: '',
                          ),
                        ),
                        if (status == 3)
                          const Padding(
                            padding: EdgeInsets.only(top: 4),
                            child: Text(
                              'Bu talep çözüldü olarak işaretlendi. Sorun devam ediyorsa yazmanız yeterli — '
                              'talep yeniden açılır.',
                              style: TextStyle(fontSize: 11.5, height: 1.35, color: AppColors.muted),
                            ),
                          ),
                        if (error != null) ...[
                          const SizedBox(height: 6),
                          Text(error!, style: const TextStyle(color: AppColors.danger, fontSize: 12.5)),
                        ],
                        const SizedBox(height: 10),
                        SizedBox(
                          width: double.infinity,
                          child: FilledButton.icon(
                            onPressed: busy ? null : _reply,
                            icon: busy
                                ? const SizedBox.square(
                                    dimension: 16,
                                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                                : const Icon(Icons.send_rounded, size: 18),
                            label: const Text('Gönder'),
                          ),
                        ),
                      ],
                    ],
                  ),
      ),
    );
  }

  /// Mesaj balonu. TARAF, ROLDEN DEĞİL sunucunun gönderdiği `side` alanından okunur
  /// (0 talep sahibi · 1 platform · 2 sistem notu).
  Widget _message(Map<String, dynamic> m) {
    final side = _asInt(m['side']);
    if (side == 2) {
      // Sistem notu balon DEĞİLDİR: kimsenin yazmadığı bir cümleyi birinin söylediği
      // izlenimi vermemeli.
      return Row(
        children: [
          const Expanded(child: Divider(color: AppColors.border)),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8),
            child: Text(
              '${m['body']}',
              style: const TextStyle(fontSize: 11, color: AppColors.muted),
            ),
          ),
          const Expanded(child: Divider(color: AppColors.border)),
        ],
      );
    }

    final fromPlatform = side == 1;
    return Align(
      alignment: fromPlatform ? Alignment.centerLeft : Alignment.centerRight,
      child: Container(
        constraints: const BoxConstraints(maxWidth: 520),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: fromPlatform ? AppColors.background : Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: fromPlatform ? AppColors.rose : AppColors.border),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '${fromPlatform ? (m['authorName'] ?? 'BeautyAsist Destek') : (m['authorName'] ?? 'Siz')}'
              ' · ${_fmt(m['sentAtUtc'])}',
              style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: AppColors.muted),
            ),
            const SizedBox(height: 5),
            Text(
              '${m['body']}',
              style: const TextStyle(fontSize: 13, height: 1.4, color: AppColors.ink),
            ),
          ],
        ),
      ),
    );
  }
}

// =============================================================================== ortak kabuk

/// Alt sayfa kabuğu.
///
/// KLAVYE TUZAĞI: `viewInsets.bottom` dolgusu ŞART — klavye açılınca metin alanı klavyenin
/// altında kalır ve kullanıcı yazdığını göremez. Yükseklik ekranın %92'siyle sınırlıdır ve
/// gövde kaydırılabilir; uzun yazışma alt çubuğu taşırmaz.
Widget _sheetShell(
  BuildContext context, {
  required String title,
  required Widget child,
  VoidCallback? onClose,
}) {
  return Padding(
    padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
    child: Container(
      constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.92),
      decoration: const BoxDecoration(
        color: AppColors.background,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 14, 12, 8),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    title,
                    style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: AppColors.ink),
                  ),
                ),
                IconButton(
                  onPressed: onClose ?? () => Navigator.of(context).pop(),
                  icon: const Icon(Icons.close_rounded),
                  color: AppColors.muted,
                ),
              ],
            ),
          ),
          const Divider(height: 1, color: AppColors.border),
          Flexible(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
              child: child,
            ),
          ),
        ],
      ),
    ),
  );
}
