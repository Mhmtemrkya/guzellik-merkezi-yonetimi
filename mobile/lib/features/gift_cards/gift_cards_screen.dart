import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';

import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/json_helpers.dart';
import '../../shared/widgets/barcode_scanner_sheet.dart';
import '../customers/customer_picker.dart';
import 'gift_card_share_sheet.dart';
import 'gift_card_edit_sheet.dart';
import '../../shared/widgets/app_background.dart';
import '../../shared/widgets/page_header.dart';
import '../appointments/calendar_theme.dart';
import '../../core/network/idempotency.dart';

/// Hediye Çeki & Kupon — web `hediye-cek` sayfasının mobil karşılığı.
///
/// 3 özet kartı + (katlanır) oluşturma formu + filtre sekmeleri (Tümü / Aktif /
/// Hediye çeki / Kupon) + türüne göre 3 farklı bilet/kart görseli
/// (metalik gül-altın hediye çeki, yüzde kuponu, sabit-tutar kuponu).
class GiftCardsScreen extends StatefulWidget {
  const GiftCardsScreen({required this.api, super.key});
  final ApiClient api;

  @override
  State<GiftCardsScreen> createState() => _GiftCardsScreenState();
}

class _KindMeta {
  const _KindMeta(this.value, this.label, this.icon);
  final String value;
  final String label;
  final IconData icon;
}

const _kinds = <_KindMeta>[
  _KindMeta('StoredValue', 'Hediye Çeki', Icons.account_balance_wallet_rounded),
  _KindMeta('Percentage', 'Yüzde İndirim', Icons.percent_rounded),
  _KindMeta('FixedAmount', 'Sabit İndirim', Icons.confirmation_number_rounded),
];

// Oluşturma formundaki tür seçenekleri (web ile birebir metinler).
const _kindOptions = <(String, String)>[
  ('StoredValue', 'Hediye Çeki (yüklü bakiye)'),
  ('Percentage', 'Yüzde İndirim Kuponu'),
  ('FixedAmount', 'Sabit Tutar İndirim Kuponu'),
];

enum _Scope { all, active, stored, coupon }

const _gold = Color(0xFF9A6F22);
const _goldBg = Color(0xFFFBF3E6);
const _goldBorder = Color(0xFFE7CFA6);
const _giftInk = Color(0xFF4A1F33);
const _giftAccent = Color(0xFF7A3450);

class _GiftCardsScreenState extends State<GiftCardsScreen> {
  late Future<List<Map<String, dynamic>>> _future;

  /// Kart görselinde kullanılan kurum bilgileri (logo + herkese açık adres anahtarı).
  String? _salonSlug;
  String _salonName = 'Güzellik Merkezi';
  Uint8List? _logoBytes;

  /*
   * KATALOG BAĞI. Çek serbest metne değil GERÇEK kayda bağlanır: satış ekranı müşterinin
   * çekini görünce doğru hizmeti/paketi kendiliğinden seçebilsin diye.
   */
  List<Map<String, dynamic>> _services = const [];
  List<Map<String, dynamic>> _packages = const [];
  List<Map<String, dynamic>> _products = const [];
  /*
   * YÜKLENEMEDİ ≠ TANIMLI DEĞİL. Yan yollar sessizce yutulunca ekranda "katalog boş" ve
   * "kurumun açık adresi tanımlı değil" yazıyordu; ikisi de yanlış teşhis — kullanıcı olmayan
   * bir ayarı düzeltmeye gönderiliyor, çeki kataloğa bağlamadan oluşturuyordu.
   */
  bool _catalogFailed = false;
  bool _profileFailed = false;
  /// Kullanım (redeem) anahtarlarının oturum tuzu — ekran açıkken sabit kalır.
  final String _redeemSalt = newIdempotencySalt();
  String _targetKind = 'service';
  String? _targetId;

  /// Kart→müşteri telefonu eşlemesi — paylaşım sayfasındaki numara ön-dolumu için.
  final Map<String, String> _phoneByCard = {};
  _Scope _scope = _Scope.all;

  // Oluşturma formu
  bool _createOpen = false;
  bool _busy = false;
  String? _error;
  String _kind = 'StoredValue';
  DateTime? _validUntil;
  DateTime? _validFrom;
  ({String id, String name, String phone})? _createCustomer;
  final _scopeLabel = TextEditingController();
  final _recipientName = TextEditingController();
  final _value = TextEditingController();
  final _code = TextEditingController();
  final _maxUses = TextEditingController();
  final _note = TextEditingController();

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  @override
  void dispose() {
    _value.dispose();
    _code.dispose();
    _maxUses.dispose();
    _note.dispose();
    _scopeLabel.dispose();
    _recipientName.dispose();
    super.dispose();
  }

  Future<List<Map<String, dynamic>>> _load() async {
    // Kurum profili ve katalog YAN YOLDUR: alınamazsa kart listesi yine gelir (kart görselinde
    // logo yerine ad yazılır, katalog seçici boş kalır). Ana akış bunlara bağlanmaz.
    unawaited(_loadSideData());
    final data = await widget.api.get('/api/admin/gift-cards/');
    return apiItems(data);
  }

  Future<void> _loadSideData() async {
    try {
      final profile = await widget.api.get('/api/admin/tenant/public-profile');
      if (!mounted || profile is! Map) return;
      final logo = '${profile['logoData'] ?? ''}';
      final name = '${profile['name'] ?? ''}'.trim();
      setState(() {
        _profileFailed = false;
        _salonSlug = '${profile['slug'] ?? ''}'.isEmpty ? null : '${profile['slug']}';
        if (name.isNotEmpty) _salonName = name;
        _logoBytes = _decodeDataUrl(logo);
      });
    } catch (_) {
      if (mounted) setState(() => _profileFailed = true);
    }
    try {
      final results = await Future.wait<dynamic>([
        widget.api.get('/api/admin/services/', query: {'page': 1, 'pageSize': 500}),
        widget.api.get('/api/admin/packages/', query: {'page': 1, 'pageSize': 500}),
        widget.api.get('/api/admin/products/', query: {'page': 1, 'pageSize': 500}),
      ]);
      if (!mounted) return;
      setState(() {
        _catalogFailed = false;
        _services = apiItems(results[0]);
        _packages = apiItems(results[1]);
        _products = apiItems(results[2]);
      });
    } catch (_) {
      if (mounted) setState(() => _catalogFailed = true);
    }
  }

  /// `data:image/png;base64,...` biçimindeki logoyu bayta çevirir.
  static Uint8List? _decodeDataUrl(String value) {
    if (value.isEmpty) return null;
    final comma = value.indexOf(',');
    final body = comma >= 0 ? value.substring(comma + 1) : value;
    try {
      return base64Decode(body);
    } catch (_) {
      return null;
    }
  }

  /// Hedef türüne göre katalog listesi — 'service' | 'package' | 'product'.
  List<Map<String, dynamic>> _listForKind(String kind) =>
      kind == 'service' ? _services : (kind == 'package' ? _packages : _products);

  /// Seçili katalog kaydı — kapsam metnini besler.
  Map<String, dynamic>? get _selectedTarget {
    final id = _targetId;
    if (id == null || id.isEmpty) return null;
    for (final x in _listForKind(_targetKind)) {
      if ('${x['id']}' == id) return x;
    }
    return null;
  }

  Future<void> _reload() async {
    setState(() {
      _future = _load();
    });
    await _future;
  }

  List<Map<String, dynamic>> _filter(List<Map<String, dynamic>> cards) {
    switch (_scope) {
      case _Scope.active:
        return cards.where((c) => c['isValid'] == true).toList();
      case _Scope.stored:
        return cards.where((c) => '${c['kind']}' == 'StoredValue').toList();
      case _Scope.coupon:
        return cards.where((c) => '${c['kind']}' != 'StoredValue').toList();
      case _Scope.all:
        return cards;
    }
  }

  // --- Aksiyonlar ---

  Future<void> _run(Future<void> Function() task) async {
    setState(() => _busy = true);
    try {
      await task();
      await _reload();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('$e')));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _create() async {
    final numeric = double.tryParse(_value.text.trim().replaceAll(',', '.'));
    if (numeric == null || numeric <= 0) {
      setState(() => _error = 'Geçerli bir değer girin.');
      return;
    }
    if (_kind == 'Percentage' && numeric > 100) {
      setState(() => _error = 'Yüzde indirim 100’ü aşamaz.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.api.post('/api/admin/gift-cards/', {
        'code': _code.text.trim().isEmpty ? null : _code.text.trim(),
        'kind': _kind,
        'value': numeric,
        'validUntilUtc': _validUntil == null
            ? null
            : DateTime(
                _validUntil!.year,
                _validUntil!.month,
                _validUntil!.day,
                23,
                59,
                59,
              ).toUtc().toIso8601String(),
        'maxUses': _maxUses.text.trim().isEmpty
            ? 0
            : int.tryParse(_maxUses.text.trim()) ?? 0,
        'note': _note.text.trim().isEmpty ? null : _note.text.trim(),
        // Başlangıç günün BAŞI, bitiş günün SONU: iki tarih de dahildir (kartta öyle yazar).
        'validFromUtc': _validFrom == null
            ? null
            : DateTime(_validFrom!.year, _validFrom!.month, _validFrom!.day).toUtc().toIso8601String(),
        // Kapsam metni yazılmadıysa seçilen katalog kaydının adı karta basılır.
        'scopeLabel': _scopeLabel.text.trim().isEmpty
            ? (_selectedTarget == null ? null : '${_selectedTarget!['name']}')
            : _scopeLabel.text.trim(),
        'recipientName': _recipientName.text.trim().isEmpty
            ? (_createCustomer?.name)
            : _recipientName.text.trim(),
        'serviceDefinitionId': _targetKind == 'service' ? _targetId : null,
        'servicePackageId': _targetKind == 'package' ? _targetId : null,
        'productId': _targetKind == 'product' ? _targetId : null,
        'customerId': _createCustomer?.id,
        'branchId': widget.api.auth?.user?.branchId,
      });
      _value.clear();
      _code.clear();
      _maxUses.clear();
      _note.clear();
      _scopeLabel.clear();
      _recipientName.clear();
      setState(() {
        _validUntil = null;
        _validFrom = null;
        _createOpen = false;
        _targetId = null;
        _createCustomer = null;
      });
      await _reload();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Hediye çeki / kupon oluşturuldu.')),
        );
      }
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /*
   * QR İLE MÜŞTERİ EŞLEŞTİRME. Kart müşterisiz basılıp elden verilir; sonra QR okutulup
   * "bu kart şu müşterinin" denir. SIRA ÖNEMLİ: önce müşteri seçilir, sonra okutulur —
   * tersi olsaydı okunan kart bir yere iliştirilene kadar havada kalırdı.
   */
  Future<void> _assignFlow() async {
    final customer = await pickCustomer(context, widget.api);
    if (customer == null || !mounted) return;

    final scanned = await showBarcodeScannerSheet(context);
    if (scanned == null || !mounted) return;

    final code = _extractCode(scanned);
    if (code.isEmpty) {
      _toast('Okunan kod hediye kartına ait değil.');
      return;
    }
    await _assign(code, customer.id, customer.name, allowReassign: false);
    if (customer.phone.isNotEmpty) _phoneByCard[code] = customer.phone;
  }

  Future<void> _assign(String code, String customerId, String customerName,
      {required bool allowReassign}) async {
    setState(() => _busy = true);
    try {
      final result = await widget.api.post('/api/admin/gift-cards/assign-customer', {
        'code': code,
        'customerId': customerId,
        'allowReassign': allowReassign,
      });
      await _reload();
      // ONAYA DÜŞTÜYSE TAMAMLANMIŞ DEME: personel yazmaları taslağa düşer ve istek yine 200
      // döner. "Tanımlandı" demek, gerçekleşmemiş bir işlemin ardından kullanıcıyı bırakır;
      // tekrar denenip mükerrer onay talebi açılır.
      final pending = result is Map && result['pendingApproval'] == true;
      _toast(pending
          ? '$code kartının $customerName adlı müşteriye tanımlanması onaya gönderildi.'
          : '$code kartı $customerName adlı müşteriye tanımlandı.');
    } catch (e) {
      final message = '$e';
      // Kart BAŞKA müşteriye tanımlıysa sunucu 409 döner; devir kullanıcı onayıyla yapılır.
      if (!allowReassign && message.contains('başka bir müşteriye')) {
        if (!mounted) return;
        final ok = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text('Kart başka müşteride'),
            content: Text('$message\n\nBu kartı $customerName adlı müşteriye devretmek istiyor musunuz?'),
            actions: [
              TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Vazgeç')),
              FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Devret')),
            ],
          ),
        );
        if (ok == true) {
          await _assign(code, customerId, customerName, allowReassign: true);
        }
        return;
      }
      _toast(message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Okunan QR'dan kart kodunu çıkarır (web'deki `extractCode` ile aynı kurallar):
  /// tam adres, göreli yol ya da çıplak kod kabul edilir.
  static String _extractCode(String raw) {
    final text = raw.trim();
    if (text.isEmpty) return '';
    final match = RegExp(r'hediye-kart/[^/]+/([^/?#\s]+)', caseSensitive: false).firstMatch(text);
    if (match != null) {
      // BOZUK KAÇIŞ ÇÖKERTMEZ: "%" gibi yarım diziler decodeComponent'i fırlatır; ham değere düşülür.
      final raw = match.group(1)!;
      try {
        return Uri.decodeComponent(raw).toUpperCase();
      } catch (_) {
        return raw.toUpperCase();
      }
    }
    if (RegExp(r'^[A-Za-z0-9-]{4,40}$').hasMatch(text)) return text.toUpperCase();
    return '';
  }

  void _toast(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  /// Kartın müşteriye gidecek hâli — önizleme, PDF, WhatsApp.
  Future<void> _showCard(Map<String, dynamic> card) async {
    await showGiftCardShareSheet(
      context,
      api: widget.api,
      card: card,
      salonName: _salonName,
      salonSlug: _salonSlug,
      salonProfileFailed: _profileFailed,
      logoBytes: _logoBytes,
      defaultPhone: _phoneByCard['${card['code']}'] ?? '',
    );
  }

  Future<void> _redeem(Map<String, dynamic> card) async {
    final controller = TextEditingController();
    final amount = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Kullan / Bakiye düş'),
        content: TextField(
          controller: controller,
          autofocus: true,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: const InputDecoration(labelText: 'Kullanılacak tutar'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Vazgeç'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, controller.text.trim()),
            child: const Text('Kullan'),
          ),
        ],
      ),
    );
    final value = double.tryParse((amount ?? '').replaceAll(',', '.'));
    if (value == null || value <= 0) return;
    await _run(() async {
      /*
       * PARA YAZAR → ANAHTARLI GİDER. Anahtarsız istek ağ hatasında tekrar denendiğinde çekten
       * İKİNCİ KEZ bakiye düşerdi; müşteri parasını sessizce kaybederdi. Anahtar İÇERİKTEN
       * türetilir: aynı kart + aynı tutar aynı anahtarı üretir (çift dokunuş tek kayıt), tutar
       * düzeltilirse anahtar da değişir ve meşru ikinci kullanım yazılır.
       */
      final key = idempotencyKey(_redeemSalt, ['gift-redeem', '${card['id']}', value]);
      await widget.api.post('/api/admin/gift-cards/${card['id']}/redeem', {
        'amount': value,
      }, key);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Hediye çeki kullanıldı.')),
        );
      }
    });
  }

  /*
   * KART DÜZELTME — kod/tür/değer HARİÇ (web'deki GiftCardEditModal'in eşi).
   *
   * Kart basılıp müşterinin eline geçer ve üstündeki QR kodu kalıcı olarak kodlar; kodu
   * değiştirmek dolaşımdaki kartı tek hamlede öldürür. Yanlış basılmış kartın doğru yolu
   * pasifleştirip yenisini basmaktır — bu yüzden düzeltme yalnız geçerlilik, kapsam, alıcı,
   * kullanım hakkı, iç not ve katalog bağını kapsar.
   */
  Future<void> _edit(Map<String, dynamic> card) async {
    final saved = await showGiftCardEditSheet(
      context,
      api: widget.api,
      card: card,
      services: _services,
      packages: _packages,
      products: _products,
    );
    if (saved == true) await _reload();
  }

  Future<void> _delete(Map<String, dynamic> card) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Sil'),
        content: Text(
          '${card['code'] ?? 'Kod'} silinsin mi? Bu işlem geri alınamaz.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Vazgeç'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Sil'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    await _run(() => widget.api.delete('/api/admin/gift-cards/${card['id']}'));
  }

  Future<void> _toggleActive(Map<String, dynamic> card) async {
    final next = card['isActive'] != true;
    await _run(
      () => widget.api.post('/api/admin/gift-cards/${card['id']}/active', {
        'active': next,
      }),
    );
  }

  // --- Görünüm ---

  @override
  Widget build(BuildContext context) {
    return AppBackground(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        body: SafeArea(
          child: RefreshIndicator(
            color: AppColors.primary,
            onRefresh: _reload,
            child: FutureBuilder<List<Map<String, dynamic>>>(
              future: _future,
              builder: (context, snapshot) {
                final cards = snapshot.data ?? const [];
                final loading =
                    snapshot.connectionState != ConnectionState.done &&
                    !snapshot.hasData;
                final filtered = _filter(cards);
                return ListView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.fromLTRB(16, 20, 16, 110),
                  children: [
                    const PageHeader(
                      eyebrow: 'Pazarlama',
                      title: 'Hediye Çeki & Kupon',
                      subtitle:
                          'Hediye çeki, kupon, bakiye ve kullanım durumu.',
                    ),
                    const SizedBox(height: 16),
                    _statsRow(cards),
                    const SizedBox(height: 14),
                    _createCard(),
                    const SizedBox(height: 14),
                    _assignCard(),
                    const SizedBox(height: 14),
                    _tabs(),
                    const SizedBox(height: 14),
                    if (loading)
                      const Padding(
                        padding: EdgeInsets.all(40),
                        child: Center(child: CircularProgressIndicator()),
                      )
                    else if (filtered.isEmpty)
                      _empty()
                    else
                      for (final c in filtered) ...[
                        _giftTile(c),
                        const SizedBox(height: 14),
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

  // 3 özet kartı
  Widget _statsRow(List<Map<String, dynamic>> cards) {
    final total = cards.length;
    final active = cards.where((c) => c['isValid'] == true).length;
    final storedBalance = cards
        .where((c) => '${c['kind']}' == 'StoredValue')
        .fold<double>(
          0,
          (s, c) => s + ((c['balance'] as num?)?.toDouble() ?? 0),
        );
    return Row(
      children: [
        _statCard(
          'Toplam kod',
          '$total',
          Icons.card_giftcard_rounded,
          AppColors.primary,
        ),
        const SizedBox(width: 10),
        _statCard(
          'Geçerli',
          '$active',
          Icons.check_circle_rounded,
          AppColors.success,
        ),
        const SizedBox(width: 10),
        _statCard(
          'Çek bakiyesi',
          CalendarText.tl(storedBalance),
          Icons.account_balance_wallet_rounded,
          _gold,
        ),
      ],
    );
  }

  Widget _statCard(String label, String value, IconData icon, Color color) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: AppColors.border),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 34,
              height: 34,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: color.withValues(alpha: .12),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(icon, size: 18, color: color),
            ),
            const SizedBox(height: 8),
            Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontSize: 10,
                color: AppColors.muted,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              value,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.w800,
                color: AppColors.ink,
              ),
            ),
          ],
        ),
      ),
    );
  }

  // Katlanır oluşturma formu
  /// QR ile müşteri eşleştirme kartı — basılı kartı müşteriye bağlama.
  Widget _assignCard() {
    return Container(
      padding: const EdgeInsets.all(16),
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
              Container(
                width: 34,
                height: 34,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: AppColors.primary,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Icon(Icons.qr_code_scanner_rounded, color: Colors.white, size: 18),
              ),
              const SizedBox(width: 10),
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Kartı müşteriye tanımla',
                        style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800)),
                    SizedBox(height: 2),
                    Text('Önce müşteriyi seçin, sonra kartın QR kodunu okutun.',
                        style: TextStyle(fontSize: 11.5, color: AppColors.muted)),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: _busy ? null : _assignFlow,
              style: FilledButton.styleFrom(minimumSize: const Size(0, 46)),
              icon: const Icon(Icons.qr_code_scanner_rounded, size: 18),
              label: const Text('Müşteri seç ve QR okut'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _createCard() {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        children: [
          InkWell(
            borderRadius: BorderRadius.circular(20),
            onTap: () => setState(() => _createOpen = !_createOpen),
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Row(
                children: [
                  Container(
                    width: 32,
                    height: 32,
                    alignment: Alignment.center,
                    decoration: const BoxDecoration(
                      gradient: LinearGradient(
                        colors: [Color(0xFFF47699), Color(0xFFEF6088)],
                      ),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(
                      Icons.add_rounded,
                      color: Colors.white,
                      size: 19,
                    ),
                  ),
                  const SizedBox(width: 10),
                  const Expanded(
                    child: Text(
                      'Yeni hediye çeki / kupon oluştur',
                      style: TextStyle(
                        fontWeight: FontWeight.w800,
                        fontSize: 14,
                      ),
                    ),
                  ),
                  Icon(
                    _createOpen
                        ? Icons.keyboard_arrow_up_rounded
                        : Icons.keyboard_arrow_down_rounded,
                    color: AppColors.muted,
                  ),
                ],
              ),
            ),
          ),
          AnimatedCrossFade(
            duration: const Duration(milliseconds: 200),
            crossFadeState: _createOpen
                ? CrossFadeState.showSecond
                : CrossFadeState.showFirst,
            firstChild: const SizedBox(width: double.infinity),
            secondChild: _createForm(),
          ),
        ],
      ),
    );
  }

  Widget _createForm() {
    final isPercent = _kind == 'Percentage';
    final valueLabel = isPercent
        ? 'Yüzde (%)'
        : _kind == 'StoredValue'
        ? 'Yüklenecek bakiye'
        : 'İndirim tutarı';
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 0, 14, 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Divider(height: 1, color: AppColors.border),
          const SizedBox(height: 14),
          DropdownButtonFormField<String>(
            initialValue: _kind,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'Tür', isDense: true),
            items: [
              for (final (v, l) in _kindOptions)
                DropdownMenuItem(value: v, child: Text(l)),
            ],
            onChanged: (v) => setState(() => _kind = v ?? _kind),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _value,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            inputFormatters: [
              FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]')),
            ],
            decoration: InputDecoration(
              labelText: valueLabel,
              isDense: true,
              prefixText: isPercent ? '%  ' : '₺  ',
              hintText: isPercent ? 'örn. 15' : 'örn. 500',
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _code,
            textCapitalization: TextCapitalization.characters,
            inputFormatters: [UpperCaseTextFormatter()],
            decoration: const InputDecoration(
              labelText: 'Kod (boş = otomatik)',
              isDense: true,
              hintText: 'örn. YILBASI25',
            ),
          ),
          const SizedBox(height: 12),
          InkWell(
            borderRadius: BorderRadius.circular(12),
            onTap: () => _pickDate(from: true),
            child: InputDecorator(
              decoration: const InputDecoration(
                labelText: 'Geçerlilik başlangıcı (ops.)',
                isDense: true,
                suffixIcon: Icon(Icons.calendar_today_rounded, size: 18),
              ),
              child: Text(
                _validFrom == null
                    ? 'Seçilmedi'
                    : DateFormat('d MMM yyyy', 'tr_TR').format(_validFrom!),
                style: TextStyle(color: _validFrom == null ? AppColors.muted : AppColors.ink),
              ),
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: InkWell(
                  borderRadius: BorderRadius.circular(12),
                  onTap: _pickDate,
                  child: InputDecorator(
                    decoration: const InputDecoration(
                      labelText: 'Son geçerlilik (ops.)',
                      isDense: true,
                      suffixIcon: Icon(Icons.calendar_today_rounded, size: 18),
                    ),
                    child: Text(
                      _validUntil == null
                          ? 'Seçilmedi'
                          : DateFormat(
                              'd MMM yyyy',
                              'tr_TR',
                            ).format(_validUntil!),
                      style: TextStyle(
                        color: _validUntil == null
                            ? AppColors.muted
                            : AppColors.ink,
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: TextField(
                  controller: _maxUses,
                  keyboardType: TextInputType.number,
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  decoration: const InputDecoration(
                    labelText: 'Maks. kullanım',
                    isDense: true,
                    hintText: '0 = sınırsız',
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _note,
            decoration: const InputDecoration(
              labelText: 'Açıklama (ops.)',
              isDense: true,
              hintText: 'örn. Yılbaşı kampanyası',
              helperText: 'Sadece iç kayıt notu — kartın üzerine basılmaz.',
            ),
          ),
          const SizedBox(height: 14),
          _targetPicker(),
          const SizedBox(height: 12),
          // AŞAĞIDAKİ İKİ ALAN KARTIN ÜZERİNE BASILIR (iç not değil).
          TextField(
            controller: _scopeLabel,
            decoration: InputDecoration(
              labelText: 'Kartta yazacak kapsam (ops.)',
              isDense: true,
              hintText: _selectedTarget == null ? 'örn. El ve Ayak Bakım' : '${_selectedTarget!['name']}',
              helperText: 'Boşsa seçilen kalemin adı, o da yoksa “tüm hizmetlerde” yazar.',
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _recipientName,
            decoration: const InputDecoration(
              labelText: 'Kartta yazacak alıcı (ops.)',
              isDense: true,
              hintText: 'örn. Ayşe Yılmaz',
              helperText: 'Boşsa kartta noktalı boşluk kalır, elle yazılır.',
            ),
          ),
          const SizedBox(height: 12),
          // Müşteriye bağlanırsa alıcı adı ve WhatsApp numarası kendiliğinden gelir.
          InkWell(
            borderRadius: BorderRadius.circular(12),
            onTap: () async {
              final picked = await pickCustomer(context, widget.api);
              if (picked != null && mounted) setState(() => _createCustomer = picked);
            },
            child: InputDecorator(
              decoration: InputDecoration(
                labelText: 'Müşteriye bağla (ops.)',
                isDense: true,
                suffixIcon: _createCustomer == null
                    ? const Icon(Icons.person_search_rounded, size: 18)
                    : IconButton(
                        icon: const Icon(Icons.close_rounded, size: 18),
                        onPressed: () => setState(() => _createCustomer = null),
                      ),
                helperText: 'Bağlarsanız kartın alıcı adı ve WhatsApp numarası kendiliğinden gelir.',
              ),
              child: Text(
                _createCustomer?.name ?? 'Seçilmedi',
                style: TextStyle(color: _createCustomer == null ? AppColors.muted : AppColors.ink),
              ),
            ),
          ),
          if (_error != null) ...[
            const SizedBox(height: 10),
            Text(
              _error!,
              style: const TextStyle(color: AppColors.danger, fontSize: 12.5),
            ),
          ],
          const SizedBox(height: 14),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: _busy ? null : _create,
              icon: _busy
                  ? const SizedBox.square(
                      dimension: 16,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Icon(Icons.add_rounded),
              label: const Text('Oluştur'),
            ),
          ),
        ],
      ),
    );
  }

  /// Katalog seçici — çekin hangi hizmet/paket için geçerli olduğu.
  Widget _targetPicker() {
    final list = _listForKind(_targetKind);
    final selected = _selectedTarget;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const Expanded(
              child: Text('Hangi hizmet / paket / ürün için? (ops.)',
                  style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: AppColors.muted)),
            ),
            SegmentedButton<String>(
              style: const ButtonStyle(visualDensity: VisualDensity.compact),
              // ÜÇÜNDEN EN FAZLA BİRİ: kısıt sunucuda da uygulanır (GiftCard.SetCatalogTarget).
              segments: const [
                ButtonSegment(value: 'service', label: Text('Hizmet')),
                ButtonSegment(value: 'package', label: Text('Paket')),
                ButtonSegment(value: 'product', label: Text('Ürün')),
              ],
              selected: {_targetKind},
              onSelectionChanged: (v) => setState(() {
                _targetKind = v.first;
                _targetId = null;
              }),
            ),
          ],
        ),
        const SizedBox(height: 8),
        DropdownButtonFormField<String>(
          initialValue: _targetId,
          isExpanded: true,
          decoration: InputDecoration(
            labelText: _targetKind == 'service'
                ? 'Hizmet'
                : (_targetKind == 'package' ? 'Paket' : 'Ürün'),
            isDense: true,
            hintText: _catalogFailed
                ? 'Katalog yüklenemedi'
                : (list.isEmpty ? 'Tanımlı kayıt yok' : 'Seçilmedi'),
          ),
          items: [
            const DropdownMenuItem<String>(value: null, child: Text('Seçilmedi')),
            for (final x in list)
              DropdownMenuItem(value: '${x['id']}', child: Text('${x['name'] ?? '—'}', overflow: TextOverflow.ellipsis)),
          ],
          onChanged: (v) => setState(() => _targetId = v),
        ),
        if (_catalogFailed) ...[
          const SizedBox(height: 6),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
            decoration: BoxDecoration(
              color: const Color(0xFFFDF3E2),
              borderRadius: BorderRadius.circular(9),
              border: Border.all(color: const Color(0xFFEFC98B)),
            ),
            child: const Text(
              'Hizmet/paket listesi alınamadı. Çeki şimdi kataloğa bağlamadan oluşturabilir, '
              'liste geldiğinde bağı sonradan kurabilirsiniz.',
              style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w600, color: Color(0xFF8A5A11)),
            ),
          ),
        ],
        const SizedBox(height: 4),
        Text(
          selected == null
              ? 'Bağlarsanız satış ekranı, çeki olan müşteride bu kalemi kendiliğinden seçer.'
              : 'Kartta “…geçerli ${selected['name']} çekidir.” yazacak.',
          style: const TextStyle(fontSize: 10.5, color: AppColors.muted),
        ),
      ],
    );
  }

  Future<void> _pickDate({bool from = false}) async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: from
          ? (_validFrom ?? now)
          : (_validUntil ?? now.add(const Duration(days: 30))),
      // Başlangıç GEÇMİŞE de konabilir (kart daha önce verilmiş olabilir); bitiş bugünden geri gitmez.
      firstDate: from ? DateTime(now.year - 1) : now,
      lastDate: DateTime(now.year + 5),
    );
    if (picked != null) setState(() { if (from) { _validFrom = picked; } else { _validUntil = picked; } });
  }

  // Filtre sekmeleri
  Widget _tabs() {
    const items = <(_Scope, String)>[
      (_Scope.all, 'Tümü'),
      (_Scope.active, 'Aktif'),
      (_Scope.stored, 'Hediye çeki'),
      (_Scope.coupon, 'Kupon'),
    ];
    return SizedBox(
      height: 38,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: items.length,
        separatorBuilder: (_, _) => const SizedBox(width: 8),
        itemBuilder: (_, i) {
          final (scope, label) = items[i];
          final selected = _scope == scope;
          return GestureDetector(
            onTap: () => setState(() => _scope = scope),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 150),
              alignment: Alignment.center,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              decoration: BoxDecoration(
                color: selected ? AppColors.primary : AppColors.surface,
                borderRadius: BorderRadius.circular(20),
                border: Border.all(
                  color: selected ? AppColors.primary : AppColors.border,
                ),
              ),
              child: Text(
                label,
                style: TextStyle(
                  color: selected ? Colors.white : AppColors.muted,
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _empty() => Padding(
    padding: const EdgeInsets.symmetric(vertical: 40),
    child: Center(
      child: Column(
        children: [
          Icon(
            Icons.card_giftcard_rounded,
            size: 44,
            color: AppColors.primary.withValues(alpha: .5),
          ),
          const SizedBox(height: 12),
          const Text(
            'Bu filtrede kayıt yok.\nYukarıdan yeni bir hediye çeki / kupon oluşturabilirsin.',
            textAlign: TextAlign.center,
            style: TextStyle(color: AppColors.muted, fontSize: 13),
          ),
        ],
      ),
    ),
  );

  // --- Bilet/kart görseli ---

  Widget _giftTile(Map<String, dynamic> card) {
    final kind = '${card['kind']}';
    final isValid = card['isValid'] == true;
    final body = switch (kind) {
      'StoredValue' => _storedVisual(card),
      'Percentage' => _percentVisual(card),
      _ => _fixedVisual(card),
    };
    return Opacity(
      opacity: isValid ? 1 : .72,
      child: Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(22),
          boxShadow: [
            BoxShadow(
              color: AppColors.primaryDark.withValues(alpha: .12),
              blurRadius: 28,
              offset: const Offset(0, 14),
            ),
          ],
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(22),
          child: Column(children: [body, _actionBar(card)]),
        ),
      ),
    );
  }

  (String, Color, IconData) _statusInfo(Map<String, dynamic> card) {
    if (card['isValid'] == true) {
      return ('Geçerli', AppColors.success, Icons.check_circle_rounded);
    }
    if (card['isActive'] == true) {
      return ('Süresi/hakkı doldu', AppColors.danger, Icons.cancel_rounded);
    }
    return ('Pasif', AppColors.muted, Icons.cancel_rounded);
  }

  Widget _kindBadge(String kind, Color fg, Color bg) {
    final meta = _kinds.firstWhere(
      (k) => k.value == kind,
      orElse: () => _kinds.last,
    );
    return _badge(meta.label, fg, bg, icon: meta.icon);
  }

  Widget _statusBadge(Map<String, dynamic> card, Color bg) {
    final (label, color, icon) = _statusInfo(card);
    return _badge(label, color, bg, icon: icon);
  }

  Widget _badge(String label, Color fg, Color bg, {IconData? icon}) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: fg.withValues(alpha: .3)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 11, color: fg),
            const SizedBox(width: 4),
          ],
          Text(
            label,
            style: TextStyle(
              color: fg,
              fontSize: 9.5,
              fontWeight: FontWeight.w800,
              letterSpacing: .3,
            ),
          ),
        ],
      ),
    );
  }

  Widget _footer(
    Map<String, dynamic> card,
    Color labelColor,
    Color valueColor, {
    Color? codeBg,
  }) {
    final used = (card['usedCount'] as num?)?.toInt() ?? 0;
    final max = (card['maxUses'] as num?)?.toInt() ?? 0;
    final until = parseUtcToLocal(card['validUntilUtc']);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'KOD',
                style: TextStyle(
                  fontSize: 8.5,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 1.4,
                  color: labelColor,
                ),
              ),
              const SizedBox(height: 2),
              Container(
                padding: codeBg == null
                    ? null
                    : const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                decoration: codeBg == null
                    ? null
                    : BoxDecoration(
                        color: codeBg,
                        borderRadius: BorderRadius.circular(6),
                      ),
                child: Text(
                  '${card['code'] ?? '—'}',
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w900,
                    letterSpacing: 1,
                    color: valueColor,
                  ),
                ),
              ),
            ],
          ),
        ),
        Column(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(
              'Kullanım: $used${max > 0 ? ' / $max' : ' / ∞'}',
              style: TextStyle(
                fontSize: 10,
                fontWeight: FontWeight.w700,
                color: labelColor,
              ),
            ),
            if (until != null) ...[
              const SizedBox(height: 2),
              Text(
                'SKT: ${DateFormat('d.MM.yyyy').format(until)}',
                style: TextStyle(
                  fontSize: 10,
                  fontWeight: FontWeight.w700,
                  color: labelColor,
                ),
              ),
            ],
          ],
        ),
      ],
    );
  }

  // Metalik gül-altın hediye çeki
  Widget _storedVisual(Map<String, dynamic> card) {
    final balance = (card['balance'] as num?)?.toDouble() ?? 0;
    final value = (card['value'] as num?)?.toDouble() ?? 0;
    return Container(
      padding: const EdgeInsets.all(18),
      constraints: const BoxConstraints(minHeight: 196),
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFFF7DCCB), Color(0xFFEDB9C8), Color(0xFFDFA6B6)],
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              _kindBadge('StoredValue', _giftAccent, Colors.white70),
              _statusBadge(card, Colors.white70),
            ],
          ),
          const SizedBox(height: 18),
          Text(
            'BAKİYE',
            style: TextStyle(
              fontSize: 9.5,
              fontWeight: FontWeight.w800,
              letterSpacing: 1.6,
              color: _giftAccent.withValues(alpha: .8),
            ),
          ),
          const SizedBox(height: 4),
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text(
                CalendarText.tl(balance),
                style: const TextStyle(
                  fontSize: 30,
                  fontWeight: FontWeight.w900,
                  color: _giftInk,
                ),
              ),
              const SizedBox(width: 6),
              Text(
                '/ ${CalendarText.tl(value)}',
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                  color: _giftAccent.withValues(alpha: .6),
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          Divider(color: _giftAccent.withValues(alpha: .2), height: 1),
          const SizedBox(height: 10),
          _footer(card, _giftAccent.withValues(alpha: .75), _giftInk),
        ],
      ),
    );
  }

  // Yüzde indirim kuponu — beyaz bilet
  Widget _percentVisual(Map<String, dynamic> card) {
    final value = (card['value'] as num?)?.toDouble() ?? 0;
    final note = '${card['note'] ?? ''}'.trim();
    return Container(
      padding: const EdgeInsets.all(18),
      constraints: const BoxConstraints(minHeight: 196),
      color: Colors.white,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              _kindBadge(
                'Percentage',
                AppColors.primary,
                AppColors.primary.withValues(alpha: .1),
              ),
              _statusBadge(card, AppColors.surface),
            ],
          ),
          const SizedBox(height: 6),
          Center(
            child: Column(
              children: [
                Text(
                  '%${_trimNum(value)}',
                  style: const TextStyle(
                    fontSize: 46,
                    height: 1.1,
                    fontWeight: FontWeight.w900,
                    color: AppColors.primary,
                  ),
                ),
                if (note.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(
                      note,
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: AppColors.muted,
                      ),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          const Divider(color: AppColors.border, height: 1),
          const SizedBox(height: 10),
          _footer(card, AppColors.muted, AppColors.ink),
        ],
      ),
    );
  }

  // Sabit tutar kuponu — krem/altın bilet
  Widget _fixedVisual(Map<String, dynamic> card) {
    final value = (card['value'] as num?)?.toDouble() ?? 0;
    final note = '${card['note'] ?? ''}'.trim();
    return Container(
      padding: const EdgeInsets.all(18),
      constraints: const BoxConstraints(minHeight: 196),
      decoration: const BoxDecoration(color: _goldBg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              _kindBadge('FixedAmount', _gold, Colors.white),
              _statusBadge(card, Colors.white),
            ],
          ),
          const SizedBox(height: 6),
          Center(
            child: Column(
              children: [
                Text(
                  CalendarText.tl(value),
                  style: const TextStyle(
                    fontSize: 38,
                    height: 1.1,
                    fontWeight: FontWeight.w900,
                    color: _gold,
                  ),
                ),
                if (note.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(
                      note,
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: AppColors.muted,
                      ),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          Divider(color: _goldBorder, height: 1),
          const SizedBox(height: 10),
          _footer(
            card,
            _gold.withValues(alpha: .8),
            AppColors.ink,
            codeBg: Colors.white,
          ),
        ],
      ),
    );
  }

  Widget _actionBar(Map<String, dynamic> card) {
    final isStored = '${card['kind']}' == 'StoredValue';
    final isActive = card['isActive'] == true;
    return Container(
      color: Colors.white,
      padding: const EdgeInsets.all(10),
      child: Column(
        children: [
          // Asıl eylem: kartın müşteriye gidecek hâlini aç (önizleme / PDF / WhatsApp).
          SizedBox(
            width: double.infinity,
            child: _barButton(
              icon: Icons.image_rounded,
              label: 'Kartı göster',
              color: Colors.white,
              bg: AppColors.primary,
              onTap: _busy ? null : () => _showCard(card),
            ),
          ),
          const SizedBox(height: 8),
          Row(
        children: [
          if (isStored) ...[
            Expanded(
              child: _barButton(
                icon: Icons.redeem_rounded,
                label: 'Kullan',
                color: AppColors.primaryDark,
                bg: AppColors.surfaceSoft,
                onTap: _busy ? null : () => _redeem(card),
              ),
            ),
            const SizedBox(width: 8),
          ],
          Expanded(
            child: _barButton(
              icon: Icons.power_settings_new_rounded,
              label: isActive ? 'Pasifleştir' : 'Aktifleştir',
              color: const Color(0xFF5D4A56),
              bg: AppColors.surfaceSoft,
              onTap: _busy ? null : () => _toggleActive(card),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: _barButton(
              icon: Icons.edit_outlined,
              label: 'Düzelt',
              color: const Color(0xFF5D4A56),
              bg: AppColors.surfaceSoft,
              onTap: _busy ? null : () => _edit(card),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: _barButton(
              icon: Icons.delete_outline_rounded,
              label: 'Sil',
              color: AppColors.danger,
              bg: AppColors.danger.withValues(alpha: .1),
              onTap: _busy ? null : () => _delete(card),
            ),
          ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _barButton({
    required IconData icon,
    required String label,
    required Color color,
    required Color bg,
    required VoidCallback? onTap,
  }) {
    return Material(
      color: bg,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 9),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 15, color: color),
              const SizedBox(width: 5),
              Flexible(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w700,
                    color: color,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _trimNum(double v) => v == v.roundToDouble() ? '${v.toInt()}' : '$v';
}

/// Giriş anında metni büyük harfe çeviren formatter (kod alanı).
class UpperCaseTextFormatter extends TextInputFormatter {
  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) {
    return TextEditingValue(
      text: newValue.text.toUpperCase(),
      selection: newValue.selection,
    );
  }
}
