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

/// WhatsApp — bağlantı durumu + içerik/kontör tercihleri (Ayarlar), kontör
/// cüzdanı + ek kontör satın alma (Kontör), son gönderim kayıtları (Mesajlar).
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
      widget.api.get('/api/admin/whatsapp/settings').catchError((_) => <String, dynamic>{}),
      widget.api.get('/api/admin/whatsapp/wallet').catchError((_) => <String, dynamic>{}),
      widget.api.get('/api/admin/whatsapp/wallet/purchases').catchError((_) => const <dynamic>[]),
      widget.api.get('/api/admin/whatsapp/messages').catchError((_) => const <dynamic>[]),
    ]);
    return _WaData(
      settings: results[0] is Map ? (results[0] as Map).cast<String, dynamic>() : const {},
      wallet: results[1] is Map ? (results[1] as Map).cast<String, dynamic>() : const {},
      purchases: apiItems(results[2]),
      messages: apiItems(results[3]),
    );
  }

  void _reload() => setState(() { _future = _load(); });

  Future<void> _editSettings(Map<String, dynamic> w) async {
    final result = await showModalBottomSheet<CrudSheetResult>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => CrudFormSheet(
        title: 'WhatsApp içerik & kontör tercihleri',
        icon: Icons.chat_rounded,
        initial: w,
        fields: const [
          CrudField(key: 'reminderTemplate', label: 'Hatırlatma şablonu', type: CrudFieldType.multiline),
          CrudField(key: 'allowWalletOverage', label: 'Kota bitince kontörden devam et', type: CrudFieldType.toggle),
          CrudField(key: 'marketingEnabled', label: 'Pazarlama (kampanya) mesajlarına izin ver', type: CrudFieldType.toggle),
          CrudField(key: 'monthlySpendCapTry', label: 'Aylık kontör harcama tavanı (₺)', type: CrudFieldType.decimal),
        ],
      ),
    );
    if (result?.body == null) return;
    try {
      await widget.api.put('/api/admin/whatsapp/settings', result!.body!);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('WhatsApp ayarları kaydedildi.')));
      }
      _reload();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  Future<void> _buyCredit(Map<String, dynamic> pkg) async {
    try {
      await widget.api.post('/api/admin/whatsapp/wallet/topup', {'creditPackageId': pkg['id']});
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Kontör talebiniz alındı. Onaylandığında bakiyenize eklenecek.')));
      }
      _reload();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppBackground(
      child: DefaultTabController(
        length: 3,
        initialIndex: widget.initialTab == WhatsAppTab.messages ? 2 : 0,
        child: Scaffold(
          backgroundColor: Colors.transparent,
          body: SafeArea(
            child: FutureBuilder<_WaData>(
              future: _future,
              builder: (context, snapshot) {
                final d = snapshot.data;
                final loading = snapshot.connectionState != ConnectionState.done;
                return Column(
                  children: [
                    const Padding(
                      padding: EdgeInsets.fromLTRB(18, 20, 18, 8),
                      child: PageHeader(
                        eyebrow: 'İletişim',
                        title: 'WhatsApp',
                        subtitle: 'Bağlantı durumu, kontör ve gönderim kayıtları.',
                      ),
                    ),
                    const TabBar(
                      labelColor: AppColors.primaryDark,
                      unselectedLabelColor: AppColors.muted,
                      indicatorColor: AppColors.primary,
                      indicatorWeight: 2.5,
                      labelStyle: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w800),
                      unselectedLabelStyle: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600),
                      tabs: [
                        Tab(text: 'Ayarlar'),
                        Tab(text: 'Kontör'),
                        Tab(text: 'Mesajlar'),
                      ],
                    ),
                    Expanded(
                      child: loading || d == null
                          ? const Center(child: CircularProgressIndicator())
                          : TabBarView(
                              children: [
                                _settingsTab(d),
                                _walletTab(d),
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

  // ---------- AYARLAR ----------
  Widget _settingsTab(_WaData d) => RefreshIndicator(
        color: AppColors.primary,
        onRefresh: () async => _reload(),
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 110),
          children: [_connectionCard(d.settings), const SizedBox(height: 12), _contentCard(d.settings)],
        ),
      );

  Widget _connectionCard(Map<String, dynamic> w) {
    final status = '${w['connectionStatus'] ?? 'NotConnected'}';
    final connected = w['isConnected'] == true;
    final phone = valueOf(w, const ['displayPhoneNumber'], fallback: '');
    final (label, color) = switch (status) {
      'Connected' => ('Bağlı', const Color(0xFF1DA851)),
      'Pending' => ('Doğrulama bekliyor', const Color(0xFFB7791F)),
      'Disabled' => ('Devre dışı', const Color(0xFFC0392B)),
      _ => ('Bağlı değil', AppColors.muted),
    };
    return _card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(connected ? Icons.verified_rounded : Icons.phone_in_talk_rounded, color: color, size: 20),
              const SizedBox(width: 8),
              const Expanded(child: Text('Bağlantı durumu', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15))),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(8)),
                child: Text(label, style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w700)),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            connected
                ? 'WhatsApp numaranız bağlı${phone.isNotEmpty ? ' ($phone)' : ''}. Bağlantı ve kurulum BeautyAsist tarafından yönetilir; siz yalnızca içerik ve kontör tercihlerini belirlersiniz.'
                : 'WhatsApp bağlantınız henüz kurulmadı. Numaranızın bağlanması için BeautyAsist destek ekibiyle iletişime geçin. O zamana dek mesajlar simülasyon olur.',
            style: const TextStyle(fontSize: 12.5, color: AppColors.muted, height: 1.4),
          ),
        ],
      ),
    );
  }

  Widget _contentCard(Map<String, dynamic> w) {
    final marketing = w['marketingEnabled'] == true;
    final overage = w['allowWalletOverage'] == true;
    final cap = valueOf(w, const ['monthlySpendCapTry'], fallback: '');
    return _card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.tune_rounded, color: AppColors.primaryDark, size: 20),
              const SizedBox(width: 8),
              const Expanded(child: Text('İçerik & kontör tercihleri', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15))),
              TextButton.icon(onPressed: () => _editSettings(w), icon: const Icon(Icons.edit_rounded, size: 16), label: const Text('Düzenle')),
            ],
          ),
          const SizedBox(height: 4),
          _kv('Kota bitince kontör', overage ? 'Devam eder' : 'Durur (sürpriz fatura yok)'),
          _kv('Pazarlama mesajları', marketing ? 'Açık' : 'Kapalı'),
          _kv('Aylık harcama tavanı', cap.isEmpty ? 'Varsayılan' : '₺$cap'),
          const SizedBox(height: 6),
          const Text(
            'Şablonu işlemsel tutun; "indirim/kampanya" ifadeleri Meta tarafından pahalı Pazarlama kategorisine sokabilir.',
            style: TextStyle(fontSize: 11, color: AppColors.muted, height: 1.35),
          ),
        ],
      ),
    );
  }

  // ---------- KONTÖR ----------
  Widget _walletTab(_WaData d) {
    final w = d.wallet;
    final packages = apiItems(w['creditPackages']);
    final pending = d.purchases.where((p) => '${p['status']}' == 'Pending').toList();
    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: () async => _reload(),
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 110),
        children: [
          _balanceCard(w),
          const SizedBox(height: 12),
          _usageCard(w),
          if (pending.isNotEmpty) ...[
            const SizedBox(height: 12),
            for (final p in pending) _pendingRow(p),
          ],
          const SizedBox(height: 12),
          const Padding(
            padding: EdgeInsets.only(left: 4, bottom: 6),
            child: Text('Ek kontör al', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
          ),
          for (final pkg in packages) _packageCard(pkg),
          const Padding(
            padding: EdgeInsets.all(6),
            child: Text('Kontör talepleriniz BeautyAsist onayından sonra bakiyenize eklenir.',
                style: TextStyle(fontSize: 11, color: AppColors.muted)),
          ),
        ],
      ),
    );
  }

  Widget _balanceCard(Map<String, dynamic> w) {
    final available = _money(w['availableTry']);
    final est = _int(w['estimatedUtilityMessages']);
    final lowBalance = w['isLowBalance'] == true;
    final reserved = _num(w['reservedTry']);
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        gradient: const LinearGradient(colors: [Color(0xFFFFF5F8), Color(0xFFFDEEF3)]),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFFF0DBE3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('KULLANILABİLİR BAKİYE', style: TextStyle(fontSize: 10, letterSpacing: 1, color: AppColors.muted, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 2),
                  Text(available, style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800, color: Color(0xFF8E3F5B))),
                ],
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text('≈ $est mesaj', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Color(0xFFB14D6C))),
                  if (reserved > 0) Padding(padding: const EdgeInsets.only(top: 2), child: Text('${_money(reserved)} rezerve', style: const TextStyle(fontSize: 10.5, color: AppColors.muted))),
                ],
              ),
            ],
          ),
          if (lowBalance)
            Padding(
              padding: const EdgeInsets.only(top: 10),
              child: Row(children: const [
                Icon(Icons.warning_amber_rounded, size: 14, color: Color(0xFFB7791F)),
                SizedBox(width: 6),
                Expanded(child: Text('Düşük bakiye — kontör yüklemeniz önerilir.', style: TextStyle(fontSize: 11.5, color: Color(0xFFB7791F), fontWeight: FontWeight.w600))),
              ]),
            ),
          if (w['billingEnabled'] == false)
            const Padding(
              padding: EdgeInsets.only(top: 8),
              child: Text('Faturalama şu an kapalı — mesajlar kontör düşülmeden gönderiliyor.', style: TextStyle(fontSize: 10.5, color: AppColors.muted)),
            ),
        ],
      ),
    );
  }

  Widget _usageCard(Map<String, dynamic> w) {
    return _card(
      child: Column(
        children: [
          _usageBar('Hatırlatma (Utility)', _int(w['utilityUsed']), _int(w['utilityLimit']), const Color(0xFF1DA851)),
          if (_int(w['marketingLimit']) > 0) ...[
            const SizedBox(height: 10),
            _usageBar('Pazarlama (Marketing)', _int(w['marketingUsed']), _int(w['marketingLimit']), const Color(0xFFC85776)),
          ],
          if (_num(w['monthlyWalletSpentTry']) > 0 || w['monthlySpendCapTry'] != null) ...[
            const SizedBox(height: 10),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Bu ay kontör harcaması', style: TextStyle(fontSize: 12, color: AppColors.muted)),
                Text(
                  '${_money(w['monthlyWalletSpentTry'])}${w['monthlySpendCapTry'] != null ? ' / ${_money(w['monthlySpendCapTry'])}' : ''}',
                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _usageBar(String label, int used, int limit, Color color) {
    final unlimited = limit < 0;
    final pct = (limit > 0) ? (used / limit).clamp(0.0, 1.0) : 0.08;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(label, style: const TextStyle(fontSize: 12, color: AppColors.muted)),
            Text('$used${unlimited ? '' : ' / $limit'}', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
          ],
        ),
        const SizedBox(height: 5),
        ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: LinearProgressIndicator(value: pct, minHeight: 6, backgroundColor: const Color(0xFFF0E2E8), color: color),
        ),
      ],
    );
  }

  Widget _pendingRow(Map<String, dynamic> p) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: const Color(0xFFFEF6E7), borderRadius: BorderRadius.circular(12), border: Border.all(color: const Color(0xFFF3D9A0))),
      child: Row(children: [
        const Icon(Icons.schedule_rounded, size: 16, color: Color(0xFFB7791F)),
        const SizedBox(width: 8),
        Expanded(child: Text('${valueOf(p, const ['packageName'], fallback: 'Kontör')} · ${_money(p['grantsTry'])}', style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: Color(0xFF8A6414)))),
        const Text('Onay bekliyor', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: Color(0xFFB7791F))),
      ]),
    );
  }

  Widget _packageCard(Map<String, dynamic> pkg) {
    final price = _money(pkg['priceTry']);
    final grants = _num(pkg['grantsTry']);
    final priceNum = _num(pkg['priceTry']);
    final est = _int(pkg['estimatedUtilityMessages']);
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14), border: Border.all(color: AppColors.border)),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(valueOf(pkg, const ['name'], fallback: 'Kontör'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
                const SizedBox(height: 2),
                Row(children: [
                  Text(price, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: Color(0xFF8E3F5B))),
                  if (grants > priceNum) Padding(padding: const EdgeInsets.only(left: 6), child: Text('+${_money(grants - priceNum)} bonus', style: const TextStyle(fontSize: 11, color: Color(0xFF1DA851), fontWeight: FontWeight.w600))),
                ]),
                Text('≈ $est mesaj', style: const TextStyle(fontSize: 11, color: AppColors.muted)),
              ],
            ),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: const Color(0xFF8E3F5B), padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10)),
            onPressed: () => _buyCredit(pkg),
            child: const Text('Talep et', style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
          ),
        ],
      ),
    );
  }

  // ---------- MESAJLAR ----------
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
                child: Center(child: Text('Gönderim kaydı yok.', style: TextStyle(color: AppColors.muted))),
              )
            else
              for (final m in d.messages.take(50)) _messageRow(m),
          ],
        ),
      );

  Widget _messageRow(Map<String, dynamic> m) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(13),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14), border: Border.all(color: AppColors.border)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(child: Text(valueOf(m, const ['customerName', 'phone'], fallback: 'Mesaj'), style: const TextStyle(fontWeight: FontWeight.w700))),
              Text(valueOf(m, const ['status'], fallback: ''), style: const TextStyle(fontSize: 11, color: AppColors.muted)),
            ],
          ),
          const SizedBox(height: 2),
          Text(valueOf(m, const ['body', 'message'], fallback: ''), maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: AppColors.muted)),
          if (valueOf(m, const ['createdAtUtc', 'sentAtUtc'], fallback: '').isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Text(_short(valueOf(m, const ['createdAtUtc', 'sentAtUtc'], fallback: '')), style: const TextStyle(fontSize: 11, color: AppColors.muted)),
            ),
        ],
      ),
    );
  }

  // ---------- yardımcılar ----------
  Widget _card({required Widget child}) => Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20), border: Border.all(color: AppColors.border)),
        child: child,
      );

  Widget _kv(String k, String v) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(
          children: [
            SizedBox(width: 150, child: Text(k, style: const TextStyle(fontSize: 12.5, color: AppColors.muted))),
            Expanded(child: Text(v, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600))),
          ],
        ),
      );

  String _short(String iso) {
    final d = DateTime.tryParse(iso)?.toLocal();
    return d == null ? '' : '${d.day}.${d.month}.${d.year} ${CalendarText.hm(d)}';
  }

  static num _num(dynamic v) => v is num ? v : num.tryParse('$v') ?? 0;
  static int _int(dynamic v) => v is num ? v.toInt() : int.tryParse('$v') ?? 0;
  static String _money(dynamic v) => '₺${_num(v).toStringAsFixed(2)}';
}

class _WaData {
  _WaData({required this.settings, required this.wallet, required this.purchases, required this.messages});
  final Map<String, dynamic> settings;
  final Map<String, dynamic> wallet;
  final List<Map<String, dynamic>> purchases;
  final List<Map<String, dynamic>> messages;
}
