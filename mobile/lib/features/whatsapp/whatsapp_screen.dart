import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher_string.dart';

import '../../core/network/api_client.dart';
import '../../core/platform/store_policy.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/crud/crud_screen.dart';
import '../../shared/json_helpers.dart';
import '../../shared/widgets/app_background.dart';
import '../../shared/widgets/page_header.dart';
import '../appointments/calendar_theme.dart';

/// WhatsApp ekranının açıldığı sekme — menüdeki "WhatsApp" (ayarlar) ve
/// "WhatsApp Mesajları" (gönderim kayıtları) girişleri için.
enum WhatsAppTab { settings, messages }

/// WhatsApp — bağlantı durumu + içerik/kredi tercihleri (Ayarlar), mesaj kredisi
/// cüzdanı (WhatsApp + SMS ortak) + kredi satın alma (Kredi), son gönderim kayıtları (Mesajlar).
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

  /// Ödeme maydanozasist.com'da (sağlayıcı Maydanoz): kart ya da havale / EFT orada seçilir — mobilde web'e
  /// yönlendirilir (kullanıcı kararı 18 Kas 2026). iOS'ta satın alma yüzeyi zaten yok (App Store 3.1.1).
  bool _payOnMaydanoz = false;

  Future<_WaData> _load() async {
    final results = await Future.wait([
      widget.api.get('/api/admin/whatsapp/settings').catchError((_) => <String, dynamic>{}),
      widget.api.get('/api/admin/whatsapp/wallet').catchError((_) => <String, dynamic>{}),
      widget.api.get('/api/admin/whatsapp/wallet/purchases').catchError((_) => const <dynamic>[]),
      widget.api.get('/api/admin/whatsapp/messages').catchError((_) => const <dynamic>[]),
      widget.api.get('/api/admin/sms/connection').catchError((_) => <String, dynamic>{}),
    ]);
    _payOnMaydanoz = results[1] is Map && (results[1] as Map)['payOnMaydanoz'] == true;
    return _WaData(
      settings: results[0] is Map ? (results[0] as Map).cast<String, dynamic>() : const {},
      wallet: results[1] is Map ? (results[1] as Map).cast<String, dynamic>() : const {},
      purchases: apiItems(results[2]),
      messages: apiItems(results[3]),
      sms: results[4] is Map ? (results[4] as Map).cast<String, dynamic>() : const {},
    );
  }

  void _reload() => setState(() { _future = _load(); });

  Future<void> _editSettings(Map<String, dynamic> w) async {
    final result = await showModalBottomSheet<CrudSheetResult>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => CrudFormSheet(
        title: 'WhatsApp içerik & kredi tercihleri',
        icon: Icons.chat_rounded,
        initial: w,
        fields: const [
          CrudField(key: 'reminderTemplate', label: 'Hatırlatma şablonu', type: CrudFieldType.multiline),
          CrudField(key: 'allowWalletOverage', label: 'Kota bitince mesaj kredisinden devam et (WhatsApp + SMS)', type: CrudFieldType.toggle),
          CrudField(key: 'marketingEnabled', label: 'WhatsApp kampanya mesajlarına izin ver', type: CrudFieldType.toggle),
          CrudField(key: 'monthlySpendCapCredits', label: 'Aylık kredi harcama tavanı', type: CrudFieldType.number, hint: 'Boş = paket / platform varsayılanı'),
          // Tek yönlü bildirimlerin kanalı: SMS seçilirse paket SMS kotasından / krediden düşer.
          CrudField(key: 'ratingLinkChannel', label: 'Değerlendirme linki kanalı', type: CrudFieldType.select, defaultValue: 'WhatsApp', options: _channelOptions),
          CrudField(key: 'waitlistActivatedChannel', label: 'Bekleme listesi bildirimi kanalı', type: CrudFieldType.select, defaultValue: 'WhatsApp', options: _channelOptions),
          CrudField(
            key: 'kvkkChannel',
            label: 'KVKK kanalı',
            type: CrudFieldType.select,
            defaultValue: 'WhatsApp',
            options: _channelOptions,
            hint: 'SMS: yalnız aydınlatma metni linki gider, açık rıza SMS ile alınmaz',
          ),
          // Meta onaylı şablon adları (KVKK, hatırlatma, bekleme, değerlendirme) kurumda DEĞİL:
          // Meta Business Manager platformun, şablonları BeautyAsist bağlar (web platform paneli).
        ],
      ),
    );
    if (result?.body == null) return;
    try {
      // Birim işareti: sunucu boş tavanı yalnız krediyi bilen istemciden "silindi" sayar.
      await widget.api.put('/api/admin/whatsapp/settings', {...result!.body!, 'spendCapUnit': 'Credits'});
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('WhatsApp ayarları kaydedildi.')));
      }
      _reload();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  /// KARTLA KREDİ ALMA — abonelikteki paket satın almanın birebir aynı mekanizması:
  /// ödeme sayfası HARİCİ tarayıcıda açılır (bkz. paket_screen). Kredi burada yüklenmez;
  /// sunucudaki callback ucu tahsilatı doğruladığında artar.
  Future<void> _buyCreditByCard(Map<String, dynamic> pkg) async {
    try {
      final started = await widget.api.post('/api/admin/whatsapp/wallet/checkout', {'creditPackageId': pkg['id']});
      final url = started is Map ? '${started['redirectUrl'] ?? ''}' : '';
      if (url.isEmpty || !await launchUrlString(url, mode: LaunchMode.externalApplication)) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('Ödeme sayfası açılamadı. Lütfen tekrar deneyin.')));
        }
        return;
      }
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text('Ödeme sayfası açıldı. Ödemeyi tamamladıktan sonra sayfayı aşağı çekip yenile.')));
      }
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  /// Havale yolu: bakiye platform onayından sonra eklenir (kaldırılmadı, bilinçli tercih).
  Future<void> _requestCredit(Map<String, dynamic> pkg) async {
    try {
      await widget.api.post('/api/admin/whatsapp/wallet/topup', {'creditPackageId': pkg['id']});
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Kredi talebiniz alındı. Onaylandığında bakiyenize eklenecek.')));
      }
      _reload();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  /// Paket kartına dokununca ödeme yolunu sorar — web'deki Kartla öde / Havale seçiminin karşılığı.
  Future<void> _buyCredit(Map<String, dynamic> pkg) async {
    // Ödeme Maydanoz'daysa yöntem orada seçilir (kart / havale-EFT): doğrudan ödeme sayfası tarayıcıda açılır.
    if (_payOnMaydanoz) {
      await _buyCreditByCard(pkg);
      return;
    }
    final byCard = await showModalBottomSheet<bool>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(16, 16, 16, 8),
              child: Text('Nasıl ödemek istersiniz?',
                  style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
            ),
            ListTile(
              leading: const Icon(Icons.credit_card),
              title: const Text('Kartla öde'),
              subtitle: const Text('Kredi, ödeme onaylanır onaylanmaz yüklenir.'),
              onTap: () => Navigator.pop(ctx, true),
            ),
            ListTile(
              leading: const Icon(Icons.schedule),
              title: const Text('Havale / talep oluştur'),
              subtitle: const Text('BeautyAsist onayından sonra bakiyenize eklenir.'),
              onTap: () => Navigator.pop(ctx, false),
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
    if (byCard == null) return;
    await (byCard ? _buyCreditByCard(pkg) : _requestCredit(pkg));
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
                        subtitle: 'Bağlantı durumu, mesaj kredisi ve gönderim kayıtları.',
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
                        Tab(text: 'Kredi'),
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
          children: [
            _connectionCard(d.settings),
            const SizedBox(height: 12),
            _contentCard(d.settings),
            const SizedBox(height: 12),
            // WhatsApp'ın altında: kurum sahibi kendi SMS numarasını/başlığını bağlar.
            _smsCard(d.sms),
          ],
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
                ? 'WhatsApp numaranız bağlı${phone.isNotEmpty ? ' ($phone)' : ''}. Bağlantı ve kurulum BeautyAsist tarafından yönetilir; siz yalnızca içerik ve kredi tercihlerini belirlersiniz.'
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
    final cap = valueOf(w, const ['monthlySpendCapCredits'], fallback: '');
    return _card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.tune_rounded, color: AppColors.primaryDark, size: 20),
              const SizedBox(width: 8),
              const Expanded(child: Text('İçerik & kredi tercihleri', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15))),
              TextButton.icon(onPressed: () => _editSettings(w), icon: const Icon(Icons.edit_rounded, size: 16), label: const Text('Düzenle')),
            ],
          ),
          const SizedBox(height: 4),
          _kv('Kota bitince kredi', overage ? 'Devam eder' : 'Durur (sürpriz harcama yok)'),
          _kv('WhatsApp kampanya', marketing ? 'Açık' : 'Kapalı'),
          _kv('Aylık kredi tavanı', cap.isEmpty ? 'Varsayılan' : '${_credits(cap)} kredi'),
          _kv('Değerlendirme linki', _channelLabel(w['ratingLinkChannel'])),
          _kv('Bekleme listesi bildirimi', _channelLabel(w['waitlistActivatedChannel'])),
          _kv('KVKK', _channelLabel(w['kvkkChannel'])),
          const SizedBox(height: 6),
          const Text(
            'Şablonu işlemsel tutun; "indirim/kampanya" ifadeleri Meta tarafından pahalı Pazarlama kategorisine sokabilir.',
            style: TextStyle(fontSize: 11, color: AppColors.muted, height: 1.35),
          ),
        ],
      ),
    );
  }

  // ---------- SMS GÖNDERİCİ HESABI (salt-okunur — bağlantıyı BeautyAsist kurar) ----------
  /// Kurum yalnız durumu görür: SMS'ler kendi başlığıyla mı, BeautyAsist altyapısından mı gidiyor.
  /// API parolası / IP izni / başlık onayı gibi teknik kurulum platform panelindedir (WhatsApp gibi).
  Widget _smsCard(Map<String, dynamic> s) {
    final status = '${s['status'] ?? 'NotConnected'}';
    final active = s['active'] == true;
    final settingUp = !active && status != 'NotConnected' && status != 'Disabled';
    final color = active ? const Color(0xFF1DA851) : AppColors.muted;
    return _card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(active ? Icons.verified_rounded : Icons.sms_rounded, color: active ? color : AppColors.primaryDark, size: 20),
              const SizedBox(width: 8),
              const Expanded(child: Text('SMS gönderici hesabı', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15))),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(8)),
                child: Text(active ? 'Bağlı' : 'Bağlı değil', style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w700)),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            active
                ? 'SMS\'leriniz kendi başlığınızla gidiyor: "${s['sender']}" (${s['provider']}). Paket kotanız ve mesaj krediniz düşmez; ücreti SMS sağlayıcınız keser. Bağlantı ve teknik kurulum BeautyAsist tarafından yönetilir.'
                : settingUp
                    ? 'SMS hesabınız BeautyAsist tarafından bağlanıyor. Kurulum tamamlanana kadar SMS\'ler BeautyAsist altyapısından gider (önce paket kotası, sonra mesaj kredisi).'
                    : 'SMS\'ler BeautyAsist altyapısından gider (önce paket kotası, sonra mesaj kredisi). Müşterilerinize kendi başlığınızla SMS göndermek isterseniz BeautyAsist destek ekibiyle iletişime geçin — hesabınızı biz bağlıyoruz.',
            style: const TextStyle(fontSize: 12.5, color: AppColors.muted, height: 1.4),
          ),
        ],
      ),
    );
  }

  // ---------- MESAJ KREDİSİ ----------
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
          // iOS: kredi satın alma yok (StorePolicy — App Store 3.1.1); bakiye/kullanım görünür.
          if (!StorePolicy.hidesPurchaseFlows) ...[
            const SizedBox(height: 12),
            const Padding(
              padding: EdgeInsets.only(left: 4, bottom: 6),
              child: Text('Kredi yükle', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
            ),
            for (final pkg in packages) _packageCard(pkg),
            Padding(
              padding: const EdgeInsets.all(6),
              child: Text(
                  _payOnMaydanoz
                      ? "Ödeme sayfası maydanozasist.com'da (tarayıcıda) açılır; kartla ya da havale / EFT ile ödeyebilirsiniz. "
                          'Krediniz ödeme onaylandığında yüklenir.'
                      : 'Kartla ödemede kredi anında yüklenir; havale yolunda BeautyAsist onayından sonra eklenir. '
                          'Kart bilgileriniz bizde saklanmaz.',
                  style: const TextStyle(fontSize: 11, color: AppColors.muted)),
            ),
          ],
        ],
      ),
    );
  }

  Widget _balanceCard(Map<String, dynamic> w) {
    final available = '${_credits(w['availableCredits'])} kredi';
    final est = _thousands(_int(w['estimatedUtilityMessages']));
    final estSms = _thousands(_int(w['estimatedSmsMessages']));
    final lowBalance = w['isLowBalance'] == true;
    final reserved = _num(w['reservedCredits']);
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
                  const Text('MESAJ KREDİSİ', style: TextStyle(fontSize: 10, letterSpacing: 1, color: AppColors.muted, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 2),
                  Text(available, style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800, color: Color(0xFF8C4460))),
                ],
              ),
              Flexible(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text('≈ $est WhatsApp', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Color(0xFFB14D6C))),
                    Text('ya da ≈ $estSms SMS', style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, color: Color(0xFFB14D6C))),
                    if (reserved > 0) Padding(padding: const EdgeInsets.only(top: 2), child: Text('${_credits(reserved)} kredi onay bekliyor', style: const TextStyle(fontSize: 10.5, color: AppColors.muted))),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          // Kim kaç kredi harcar — maliyetler platformdan gelir.
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              _costChip('WhatsApp hatırlatma', '${_credits(w['utilityCreditCost'])} kredi'),
              _costChip('WhatsApp kampanya', '${_credits(w['marketingCreditCost'])} kredi'),
              _costChip('SMS (70 karakter)', '${_credits(w['smsCreditsPerPart'])} kredi / parça'),
            ],
          ),
          if (lowBalance)
            Padding(
              padding: const EdgeInsets.only(top: 10),
              child: Row(children: [
                const Icon(Icons.warning_amber_rounded, size: 14, color: Color(0xFFB7791F)),
                const SizedBox(width: 6),
                Expanded(
                    child: Text(
                        StorePolicy.hidesPurchaseFlows
                            ? 'Düşük bakiye.'
                            : 'Düşük bakiye — kredi yüklemeniz önerilir.',
                        style: const TextStyle(fontSize: 11.5, color: Color(0xFFB7791F), fontWeight: FontWeight.w600))),
              ]),
            ),
          if (w['billingEnabled'] == false)
            const Padding(
              padding: EdgeInsets.only(top: 8),
              child: Text('Faturalama şu an kapalı — mesajlar krediden düşülmeden yalnız paket kotasıyla gönderiliyor.', style: TextStyle(fontSize: 10.5, color: AppColors.muted)),
            ),
        ],
      ),
    );
  }

  Widget _usageCard(Map<String, dynamic> w) {
    return _card(
      child: Column(
        children: [
          _usageBar('WhatsApp hatırlatma (pakete dahil)', _int(w['utilityUsed']), _int(w['utilityLimit']), const Color(0xFF1DA851)),
          if (_int(w['marketingLimit']) != 0) ...[
            const SizedBox(height: 10),
            _usageBar('WhatsApp kampanya (pakete dahil)', _int(w['marketingUsed']), _int(w['marketingLimit']), const Color(0xFFA5556E)),
          ],
          if (_int(w['smsLimit']) != 0 || _int(w['smsUsed']) > 0) ...[
            const SizedBox(height: 10),
            _usageBar('SMS (pakete dahil)', _int(w['smsUsed']), _int(w['smsLimit']), const Color(0xFF2F7DD1)),
          ],
          if (_num(w['monthlySpentCredits']) > 0 || w['monthlySpendCapCredits'] != null) ...[
            const SizedBox(height: 10),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Flexible(child: Text('Bu ay krediden harcanan', style: TextStyle(fontSize: 12, color: AppColors.muted))),
                Text(
                  '${_credits(w['monthlySpentCredits'])}${w['monthlySpendCapCredits'] != null ? ' / ${_credits(w['monthlySpendCapCredits'])}' : ''} kredi',
                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
                ),
              ],
            ),
          ],
          if (w['allowWalletOverage'] != true) ...[
            const SizedBox(height: 10),
            const Text(
              'Kota bitince krediden devam kapalı: aylık kota dolunca mesajlar durur, kredi harcanmaz. Ayarlar sekmesinden açabilirsiniz.',
              style: TextStyle(fontSize: 11, color: AppColors.muted, height: 1.35),
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
        Expanded(child: Text('${valueOf(p, const ['packageName'], fallback: 'Mesaj kredisi')} · ${_credits(p['grantsCredits'])} kredi', style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: Color(0xFF8A6414)))),
        const Text('Onay bekliyor', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: Color(0xFFB7791F))),
      ]),
    );
  }

  Widget _packageCard(Map<String, dynamic> pkg) {
    final price = _money(pkg['priceTry']);
    final grants = _num(pkg['grantsCredits']);
    final priceNum = _num(pkg['priceTry']);
    final description = valueOf(pkg, const ['description'], fallback: '');
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
                Text(valueOf(pkg, const ['name'], fallback: 'Mesaj kredisi'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
                const SizedBox(height: 2),
                Text('${_credits(grants)} kredi', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: Color(0xFF8C4460))),
                Text(
                  grants > 0 ? '$price · kredi başı ${_money(priceNum / grants)}' : price,
                  style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600),
                ),
                if (description.isNotEmpty) Text(description, style: const TextStyle(fontSize: 11, color: AppColors.muted)),
              ],
            ),
          ),
          FilledButton(
            // minimumSize: tema Size.fromHeight(52) ile SONSUZ genişlik ister; Row içinde
            // soldaki Expanded'i 0'a düşürüp yazıyı harf harf alt alta diziyordu.
            style: FilledButton.styleFrom(
                backgroundColor: const Color(0xFF8C4460),
                minimumSize: const Size(0, 44),
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10)),
            onPressed: () => _buyCredit(pkg),
            child: const Text('Al', style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
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
              child: Text(
                [
                  _short(valueOf(m, const ['createdAtUtc', 'sentAtUtc'], fallback: '')),
                  if ('${m['billingSource']}' == 'Quota') 'paket kotası',
                  if ('${m['billingSource']}' == 'Wallet' && _num(m['chargedCredits']) > 0) '${_credits(m['chargedCredits'])} kredi',
                ].join(' · '),
                style: const TextStyle(fontSize: 11, color: AppColors.muted),
              ),
            ),
        ],
      ),
    );
  }

  // ---------- yardımcılar ----------
  Widget _costChip(String label, String value) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.85),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: const Color(0xFFECD6DF)),
        ),
        child: Text.rich(
          TextSpan(children: [
            TextSpan(text: '$label: ', style: const TextStyle(color: AppColors.muted)),
            TextSpan(text: value, style: const TextStyle(fontWeight: FontWeight.w800, color: Color(0xFF8C4460))),
          ]),
          style: const TextStyle(fontSize: 10.5),
        ),
      );

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
  static String _money(dynamic v) => '₺${_num(v).toStringAsFixed(2).replaceAll('.', ',')}';

  /// Kredi: tam sayıysa ondalıksız ve binlik ayraçlı (1.000), kesirliyse iki hane.
  static String _credits(dynamic v) {
    final n = _num(v);
    if (n == n.roundToDouble()) return _thousands(n.round());
    return n.toStringAsFixed(2).replaceAll('.', ',');
  }

  static String _thousands(int v) {
    final s = v.abs().toString();
    final b = StringBuffer();
    for (var i = 0; i < s.length; i++) {
      if (i > 0 && (s.length - i) % 3 == 0) b.write('.');
      b.write(s[i]);
    }
    return '${v < 0 ? '-' : ''}$b';
  }

  static String _channelLabel(dynamic v) => '$v' == 'Sms' ? 'SMS' : 'WhatsApp';

  static const List<CrudOption> _channelOptions = [
    CrudOption('WhatsApp', 'WhatsApp'),
    CrudOption('Sms', 'SMS'),
  ];
}

class _WaData {
  _WaData({required this.settings, required this.wallet, required this.purchases, required this.messages, required this.sms});
  final Map<String, dynamic> settings;
  final Map<String, dynamic> wallet;
  final List<Map<String, dynamic>> purchases;
  final List<Map<String, dynamic>> messages;
  /// Kurumun kendi SMS hesabı bağlantısı (parola gelmez, kullanıcı adı maskeli).
  final Map<String, dynamic> sms;
}
