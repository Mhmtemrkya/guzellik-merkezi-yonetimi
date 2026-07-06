import 'package:flutter/material.dart';

import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/crud/crud_screen.dart';
import '../../shared/json_helpers.dart';
import '../../shared/widgets/app_background.dart';
import '../../shared/widgets/page_header.dart';
import '../appointments/calendar_theme.dart';

/// WhatsApp ekranının açıldığı sekme — menüdeki "WhatsApp" (ayarlar) ve
/// "WhatsApp Mesajları" (gönderim kayıtları) girişleri için.
enum WhatsAppTab { settings, messages }

/// WhatsApp — entegrasyon ayarları (Ayarlar sekmesi) + son gönderim kayıtları
/// (Mesajlar sekmesi).
class WhatsAppScreen extends StatefulWidget {
  const WhatsAppScreen({
    required this.api,
    this.initialTab = WhatsAppTab.settings,
    super.key,
  });
  final ApiClient api;
  final WhatsAppTab initialTab;

  @override
  State<WhatsAppScreen> createState() => _WhatsAppScreenState();
}

class _WhatsAppScreenState extends State<WhatsAppScreen> {
  late Future<_WaData> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<_WaData> _load() async {
    final results = await Future.wait([
      widget.api
          .get('/api/admin/whatsapp/settings')
          .catchError((_) => <String, dynamic>{}),
      widget.api
          .get('/api/admin/whatsapp/messages')
          .catchError((_) => const <dynamic>[]),
    ]);
    return _WaData(
      settings: results[0] is Map
          ? (results[0] as Map).cast<String, dynamic>()
          : const {},
      messages: apiItems(results[1]),
    );
  }

  void _reload() => setState(() { _future = _load(); });

  Future<void> _edit(Map<String, dynamic> w) async {
    final result = await showModalBottomSheet<CrudSheetResult>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => CrudFormSheet(
        title: 'WhatsApp ayarları',
        icon: Icons.chat_rounded,
        initial: w,
        fields: const [
          CrudField(key: 'enabled', label: 'Aktif', type: CrudFieldType.toggle),
          CrudField(key: 'phoneNumberId', label: 'Phone Number ID'),
          CrudField(
              key: 'accessToken',
              label: 'Access Token (değişmezse boş bırakın)'),
          CrudField(key: 'businessAccountId', label: 'Business Account ID'),
          CrudField(key: 'verifyToken', label: 'Verify Token'),
          CrudField(
              key: 'reminderTemplate',
              label: 'Hatırlatma şablonu',
              type: CrudFieldType.multiline),
        ],
      ),
    );
    if (result?.body == null) return;
    try {
      await widget.api.put('/api/admin/whatsapp/settings', result!.body!);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('WhatsApp ayarları kaydedildi.')));
      }
      _reload();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppBackground(
      child: DefaultTabController(
        length: 2,
        initialIndex: widget.initialTab.index,
        child: Scaffold(
          backgroundColor: Colors.transparent,
          body: SafeArea(
            child: FutureBuilder<_WaData>(
              future: _future,
              builder: (context, snapshot) {
                final d = snapshot.data;
                final loading =
                    snapshot.connectionState != ConnectionState.done;
                return Column(
                  children: [
                    const Padding(
                      padding: EdgeInsets.fromLTRB(18, 20, 18, 8),
                      child: PageHeader(
                        eyebrow: 'İletişim',
                        title: 'WhatsApp',
                        subtitle: 'Entegrasyon ayarları ve gönderim kayıtları.',
                      ),
                    ),
                    const TabBar(
                      labelColor: AppColors.primaryDark,
                      unselectedLabelColor: AppColors.muted,
                      indicatorColor: AppColors.primary,
                      indicatorWeight: 2.5,
                      labelStyle:
                          TextStyle(fontSize: 14, fontWeight: FontWeight.w800),
                      unselectedLabelStyle:
                          TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
                      tabs: [
                        Tab(text: 'Ayarlar'),
                        Tab(text: 'Mesajlar'),
                      ],
                    ),
                    Expanded(
                      child: loading || d == null
                          ? const Center(child: CircularProgressIndicator())
                          : TabBarView(
                              children: [
                                _settingsTab(d),
                                _messagesTab(d),
                              ],
                            ),
                    ),
                  ],
                );
              },
            ),
          ),
        ),
      ),
    );
  }

  Widget _settingsTab(_WaData d) => RefreshIndicator(
        color: AppColors.primary,
        onRefresh: () async => _reload(),
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 110),
          children: [_settingsCard(d.settings)],
        ),
      );

  Widget _messagesTab(_WaData d) => RefreshIndicator(
        color: AppColors.primary,
        onRefresh: () async => _reload(),
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 110),
          children: [
            if (d.messages.isEmpty)
              const Padding(
                padding: EdgeInsets.all(40),
                child: Center(
                    child: Text('Gönderim kaydı yok.',
                        style: TextStyle(color: AppColors.muted))),
              )
            else
              for (final m in d.messages.take(50)) _messageRow(m),
          ],
        ),
      );

  Widget _settingsCard(Map<String, dynamic> w) {
    final rows = [
      ['Durum', w['enabled'] == true ? 'Aktif' : 'Pasif'],
      ['Phone Number ID', valueOf(w, const ['phoneNumberId'])],
      ['Business Account', valueOf(w, const ['businessAccountId'])],
      ['Sağlayıcı', valueOf(w, const ['provider'])],
      [
        'Kurulu',
        (w['configured'] == true || w['hasCredentials'] == true || w['hasAccessToken'] == true)
            ? 'Evet'
            : 'Hayır'
      ],
    ];
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.chat_rounded, color: AppColors.primaryDark),
              const SizedBox(width: 8),
              const Expanded(
                child: Text('Entegrasyon Ayarları',
                    style: TextStyle(
                        fontWeight: FontWeight.w800, fontSize: 15)),
              ),
              TextButton.icon(
                onPressed: () => _edit(w),
                icon: const Icon(Icons.edit_rounded, size: 16),
                label: const Text('Düzenle'),
              ),
            ],
          ),
          const SizedBox(height: 6),
          for (final r in rows)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Row(
                children: [
                  SizedBox(
                    width: 140,
                    child: Text(r[0],
                        style: const TextStyle(
                            fontSize: 13, color: AppColors.muted)),
                  ),
                  Expanded(
                    child: Text(r[1],
                        style: const TextStyle(
                            fontSize: 13, fontWeight: FontWeight.w600)),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _messageRow(Map<String, dynamic> m) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(13),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Text(
                  valueOf(m, const ['customerName', 'phone'], fallback: 'Mesaj'),
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
              ),
              Text(valueOf(m, const ['status'], fallback: ''),
                  style: const TextStyle(
                      fontSize: 11, color: AppColors.muted)),
            ],
          ),
          const SizedBox(height: 2),
          Text(valueOf(m, const ['message'], fallback: ''),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 12, color: AppColors.muted)),
          if (valueOf(m, const ['sentAtUtc'], fallback: '').isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Text(_short('${m['sentAtUtc']}'),
                  style: const TextStyle(fontSize: 11, color: AppColors.muted)),
            ),
        ],
      ),
    );
  }

  String _short(String iso) {
    final d = DateTime.tryParse(iso)?.toLocal();
    return d == null
        ? ''
        : '${d.day}.${d.month}.${d.year} ${CalendarText.hm(d)}';
  }
}

class _WaData {
  _WaData({required this.settings, required this.messages});
  final Map<String, dynamic> settings;
  final List<Map<String, dynamic>> messages;
}
