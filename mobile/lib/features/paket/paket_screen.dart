import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher_string.dart';

import '../../core/network/api_client.dart';
import '../../core/network/idempotency.dart';
import '../../core/platform/store_policy.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/json_helpers.dart';
import '../../shared/widgets/app_background.dart';
import '../../shared/widgets/page_header.dart';
import '../appointments/calendar_theme.dart';

/// Paketim — web `/admin/paket` sayfasının mobil paritesi: mevcut abonelik,
/// bu ayki kullanım ve yükseltme yolu. Menüde "Kullanım & Limitler" yerine
/// gelir, Ayarlar > "Paket detayı & yükselt" buraya bağlanır.
class PaketScreen extends StatefulWidget {
  const PaketScreen({required this.api, super.key});
  final ApiClient api;

  @override
  State<PaketScreen> createState() => _PaketScreenState();
}

String _tl(num? v) => CalendarText.tl(v?.toDouble() ?? 0);

const _metricLabels = <String, String>{
  'branches': 'Şube',
  'staff': 'Personel',
  'customers': 'Müşteri',
  'appointments': 'Aylık Randevu',
  'sms': 'Aylık SMS',
  'whatsapp': 'Aylık WhatsApp',
  'email': 'Aylık E-posta',
};

const _metricIcons = <String, IconData>{
  'branches': Icons.store_rounded,
  'staff': Icons.badge_rounded,
  'customers': Icons.people_rounded,
  'appointments': Icons.event_rounded,
  'sms': Icons.sms_rounded,
  'whatsapp': Icons.chat_rounded,
  'email': Icons.mail_rounded,
};

// Pakete göre vitrin etiketleri (web ile birebir).
const _planHighlights = <String, List<String>>{
  'Starter': ['Randevu Yönetimi', 'Müşteri Kayıt', 'Raporlama'],
  'Pro': [
    'Randevu Yönetimi',
    'Hatırlatma SMS',
    'Stok & Ürün',
    'Gelişmiş Raporlar',
    'Personel Yönetimi'
  ],
  'Premium': [
    'Randevu Yönetimi',
    'Otomatik Hatırlatma',
    'Paket & Seans',
    'Stok & Ürün',
    'Gelişmiş Raporlar',
    'Personel Yönetimi',
    'SMS Entegrasyonu',
    'Kasa & Tahsilat',
    'Ön Muhasebe'
  ],
  'AIKlinik': [
    'AI Asistanı',
    'Akıllı Hatırlatma',
    'Tahmin Analitiği',
    'Otomatik Kampanya',
    'Gelişmiş Raporlar',
    'Çoklu Şube Yönetimi',
    'API & Entegrasyon',
    'Ön Muhasebe'
  ],
  'Enterprise': [
    'Özel Geliştirme',
    'Özel Entegrasyon',
    '7/24 Destek',
    'SLA & Güvence',
    'Dedicated Hesap Yöneticisi'
  ],
};

List<String> _highlightsOf(Map<String, dynamic> plan) {
  final key = '${plan['planKey'] ?? ''}';
  if (_planHighlights.containsKey(key)) return _planHighlights[key]!;
  final raw = '${plan['features'] ?? ''}';
  final out = <String>[];
  for (final f in raw.split(',').map((e) => e.trim()).where((e) => e.isNotEmpty)) {
    if (!out.contains(f)) out.add(f);
    if (out.length >= 6) break;
  }
  return out;
}

Set<String> _featureSet(Map<String, dynamic> plan) => '${plan['features'] ?? ''}'
    .split(',')
    .map((e) => e.trim())
    .where((e) => e.isNotEmpty)
    .toSet();

double _limitOf(Map<String, dynamic> plan, String key) {
  final v = numberOf(plan, [key]).toDouble();
  return v < 0 ? double.infinity : v;
}

const _limitKeys = ['maxBranches', 'maxStaff', 'maxCustomers', 'maxMonthlyAppointments'];

/// Web `isUpgradeOf` ile birebir: aday, mevcut paketin TÜM özelliklerini kapsıyor ve fazlasını
/// (özellik ya da limit; -1 = sınırsız) veriyorsa "üst paket"tir. Vitrin sırası / liste fiyatı
/// ölçüt değil — şube başı tek paket sırada başta durur ve birim fiyatı düşük görünür.
bool _isUpgradeOf(Map<String, dynamic> candidate, Map<String, dynamic> current) {
  final cf = _featureSet(candidate);
  final kf = _featureSet(current);
  if (!kf.every(cf.contains)) return false;
  if (_limitKeys.any((k) => _limitOf(candidate, k) < _limitOf(current, k))) return false;
  return cf.length > kf.length ||
      _limitKeys.any((k) => _limitOf(candidate, k) > _limitOf(current, k));
}

class _PaketScreenState extends State<PaketScreen> {
  late Future<_PaketData> _future;
  String _period = 'Yearly'; // Monthly | Yearly
  String? _busyPlanId;
  String? _payingInvoiceId;
  String? _actionMsg;
  bool _actionErr = false;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<_PaketData> _load() async {
    final r = await Future.wait<dynamic>([
      widget.api
          .get('/api/admin/subscription-plans')
          .catchError((_) => const <dynamic>[]),
      widget.api.get('/api/admin/usage').catchError((_) => <String, dynamic>{}),
      widget.api
          .get('/api/admin/tenant/')
          .catchError((_) => <String, dynamic>{}),
      // Ödeme altyapısı kapalıysa ya da kullanıcı yetkili değilse bu uç hata döner;
      // sayfanın kalanı bundan etkilenmemeli.
      widget.api
          .get('/api/admin/billing/')
          .catchError((_) => <String, dynamic>{}),
      // Dijital onam hakkı (web paritesi) — yetkisizse boş; sayfanın kalanı etkilenmez.
      widget.api
          .get('/api/admin/billing/consent-allowance')
          .catchError((_) => <String, dynamic>{}),
      // Kayıtlı müşteri hakkı (web paritesi) — aynı kural: ödenmiş kademe yoksa yeni müşteri eklenemez.
      widget.api
          .get('/api/admin/billing/customer-allowance')
          .catchError((_) => <String, dynamic>{}),
    ]);
    final plans = apiItems(r[0])
        .where((p) => p['isActive'] != false)
        .toList()
      ..sort((a, b) {
        final d = numberOf(a, const ['displayOrder'])
            .compareTo(numberOf(b, const ['displayOrder']));
        if (d != 0) return d;
        return numberOf(a, const ['monthlyPriceTRY'])
            .compareTo(numberOf(b, const ['monthlyPriceTRY']));
      });
    return _PaketData(
      plans: plans,
      usage: r[1] is Map ? (r[1] as Map).cast<String, dynamic>() : const {},
      tenant: r[2] is Map ? (r[2] as Map).cast<String, dynamic>() : const {},
      billing: r[3] is Map ? (r[3] as Map).cast<String, dynamic>() : const {},
      consent: r[4] is Map ? (r[4] as Map).cast<String, dynamic>() : const {},
      customers: r[5] is Map ? (r[5] as Map).cast<String, dynamic>() : const {},
    );
  }

  // KADEME YÜKSELTME (müşteri / onam) — para yazar: anahtar içerikten (tuz + boyut + kademe + tutar). Sonucu
  // bilinmeyen deneme aynı anahtarla tekrarlanır; kesin yanıtta (2xx/4xx) tuz döner (web paritesi).
  final Map<String, String> _tierSalt = {
    'customers': newIdempotencySalt(),
    'consent': newIdempotencySalt(),
  };
  String? _tierBusy;

  Future<void> _upgradeTier(String kind, Map<String, dynamic> allowance) async {
    final text = _tierTexts[kind]!;
    final quote = allowance['quote'] is Map ? (allowance['quote'] as Map).cast<String, dynamic>() : null;
    final tierAbove = allowance['nextTierAbove'];
    if (quote == null || tierAbove == null) return;
    final total = numberOf(quote, const ['total']);
    final byCard = '${allowance['chargeMethod'] ?? ''}' == 'Card';
    final tierText = '${numberOf(allowance, const ['nextTierAbove']).toInt()} üzeri ${text.unit}';
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(text.name),
        content: Text(byCard
            ? '${text.name} ($tierText) açılacak. Bugün ${_tl(total)} (KDV dahil, dönem sonuna kadar orantılı) kayıtlı kartınızdan çekilecek. Onaylıyor musunuz?'
            : '${text.name} ($tierText) için ${_tl(total)} (KDV dahil) tutarında fatura kesilecek. Kademe, ödeme alındığında açılır. Onaylıyor musunuz?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Vazgeç')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: Text(byCard ? '${_tl(total)} öde' : 'Onayla (${_tl(total)})'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    final key = idempotencyKey(_tierSalt[kind]!, ['$kind-upgrade', tierAbove, total]);
    final path = kind == 'customers' ? '/api/admin/billing/customer-upgrade' : '/api/admin/billing/consent-upgrade';
    setState(() => _tierBusy = kind);
    try {
      final r = await widget.api.post(path, {'confirmedChargeTRY': total}, key);
      _tierSalt[kind] = newIdempotencySalt();
      if (!mounted) return;
      setState(() {
        _actionMsg = r is Map ? '${r['message'] ?? 'İşlem tamamlandı.'}' : 'İşlem tamamlandı.';
        _actionErr = false;
        _future = _load();
      });
    } on ApiException catch (e) {
      final status = e.statusCode;
      if (status != null && status > 0 && status < 500) _tierSalt[kind] = newIdempotencySalt();
      if (!mounted) return;
      setState(() {
        _actionMsg = e.message;
        _actionErr = true;
        _future = _load();
      });
    } finally {
      if (mounted) setState(() => _tierBusy = null);
    }
  }

  /// Kademe kartı (kayıtlı müşteri / dijital onam) — sayaç / ödenmiş kapasite, kilit durumu, sonraki kademe.
  /// iOS'ta (App Store 3.1.1) fiyat ve satın alma gösterilmez; yalnız durum, nötr dille.
  Widget _tierCard(String kind, Map<String, dynamic> allowance, bool storeSafe) {
    final text = _tierTexts[kind]!;
    final count = numberOf(allowance, const ['count']).toInt();
    final capRaw = allowance['capacity'];
    final capacity = capRaw == null ? null : numberOf(allowance, const ['capacity']).toInt();
    final locked = allowance['allowed'] == false;
    final ratio = capacity == null || capacity == 0 ? 0.06 : (count / capacity).clamp(0.0, 1.0);
    final near = !locked && capacity != null && ratio >= 0.9;
    final quote = allowance['quote'] is Map ? (allowance['quote'] as Map).cast<String, dynamic>() : null;
    final total = quote == null ? 0 : numberOf(quote, const ['total']);
    final canBuy = !storeSafe && allowance['canPurchase'] == true && total > 0 && allowance['nextTierAbove'] != null;
    final openInvoice = '${allowance['openInvoiceNumber'] ?? ''}';
    final reason = '${allowance['reason'] ?? ''}';
    final color = locked ? AppColors.danger : near ? const Color(0xFFB7791F) : AppColors.primary;

    return Container(
      margin: const EdgeInsets.only(bottom: 4),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: locked ? AppColors.danger.withValues(alpha: .35) : AppColors.primary.withValues(alpha: .18)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(text.icon, size: 18, color: color),
              const SizedBox(width: 8),
              Expanded(child: Text(text.title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14))),
              if (locked)
                const Icon(Icons.lock_rounded, size: 16, color: AppColors.danger),
            ],
          ),
          const SizedBox(height: 10),
          Text('$count / ${capacity?.toString() ?? '∞'} ${text.countLabel}',
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          ClipRRect(
            borderRadius: BorderRadius.circular(6),
            child: LinearProgressIndicator(
              value: ratio.toDouble(),
              minHeight: 6,
              color: color,
              backgroundColor: const Color(0xFFF7E9EE),
            ),
          ),
          const SizedBox(height: 8),
          if (locked)
            Text(
              storeSafe ? text.lockedTextNeutral : text.lockedText,
              style: const TextStyle(fontSize: 12, color: AppColors.danger, fontWeight: FontWeight.w600),
            ),
          const SizedBox(height: 2),
          Text(text.footnote, style: const TextStyle(fontSize: 11.5, color: Color(0xFF74616A))),
          if (!storeSafe && allowance['nextTierAbove'] != null) ...[
            const SizedBox(height: 4),
            Text(
              'Sonraki kademe: ${numberOf(allowance, const ['nextTierAbove']).toInt()} üzeri ${text.unit}'
              '${allowance['nextTierMonthlyFee'] != null ? ' · ${_tl(numberOf(allowance, const ['nextTierMonthlyFee']))} / ay + KDV' : ''}',
              style: const TextStyle(fontSize: 12, color: Color(0xFF4A3A44)),
            ),
          ],
          // iOS (App Store 3.1.1): fatura / ödeme bilgisi bu uygulamada gösterilmez (Paketim fatura kartı da gizli).
          if (!storeSafe && openInvoice.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text('$openInvoice numaralı fatura ödeme bekliyor; ödeme alındığında kademe açılır.',
                style: const TextStyle(fontSize: 12, color: Color(0xFFB7791F))),
          ] else if (!storeSafe && allowance['canPurchase'] != true && reason.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(reason, style: const TextStyle(fontSize: 12, color: Color(0xFF74616A))),
          ],
          if (canBuy) ...[
            const SizedBox(height: 10),
            FilledButton(
              onPressed: _tierBusy != null ? null : () => _upgradeTier(kind, allowance),
              child: Text(allowance['chargeMethod'] == 'Card' ? '${_tl(total)} öde ve kademeyi aç' : '${_tl(total)} faturayı onayla'),
            ),
          ],
        ],
      ),
    );
  }

  /// Müşteri metriğinin sınırı paket alanından (çoğu pakette sınırsız) değil ÖDENMİŞ müşteri kademesinden
  /// gelir — "∞" yazan hücre yanında "yeni müşteri eklenemiyor" kartı çelişirdi (web `withTierCapacity`).
  Map<String, dynamic> _withTierCapacity(Map<String, dynamic> metric, Map<String, dynamic> allowance) {
    if (allowance.isEmpty || allowance['capacity'] == null) return metric;
    final capacity = numberOf(allowance, const ['capacity']).toInt();
    final count = numberOf(allowance, const ['count']).toInt();
    final percent = capacity > 0 ? ((count / capacity) * 100).round().clamp(0, 100) : 100;
    final allowed = allowance['allowed'] != false;
    return {
      ...metric,
      'used': count,
      'limit': capacity,
      'percent': percent,
      'isUnlimited': false,
      'isOver': !allowed,
      'isWarning': allowed && percent >= 90,
    };
  }

  Future<void> _reload() async {
    setState(() {
      _future = _load();
    });
    await _future;
  }

  int? _daysLeft(dynamic iso) {
    final d = parseUtcToLocal(iso);
    if (d == null) return null;
    return (d.difference(DateTime.now()).inMinutes / 1440).ceil();
  }

  /// Mevcut paketin ödeme düğmesi (web ile aynı kural): deneme / askı / dönemli abonelik.
  /// Elle faturalanan (dönemsiz) kurum ödemeyi faturalardan yapar; iOS'ta ödeme yüzeyi yok.
  String? _currentPayLabel(Map<String, dynamic> billing) {
    if (StorePolicy.hidesPurchaseFlows || billing['paymentsEnabled'] != true) return null;
    final status = '${billing['status'] ?? ''}';
    if (status == 'Trial') return 'Aboneliği başlat';
    if (status == 'Suspended') return 'Ödeyip yeniden aç';
    final period = '${billing['billingPeriod'] ?? ''}';
    return period.isNotEmpty ? 'Dönemi şimdi öde' : null;
  }

  /// Açık faturayı öde: ödeme Maydanoz'da alınır, fatura ödenince kapanır (şube / kademe o an açılır).
  Future<void> _payInvoice(Map<String, dynamic> inv) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Faturayı öde'),
        content: Text(
            '${inv['number'] ?? ''} numaralı faturayı ödüyorsun.\n\nTutar: ${_tl(numberOf(inv, const ['amountTRY']))} (KDV dahil)\n\nGüvenli ödeme sayfası tarayıcıda açılacak. Ödeme tamamlanınca bu sayfayı aşağı çekip yenile.\n\nDevam edilsin mi?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Vazgeç')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Ödemeye git')),
        ],
      ),
    );
    if (ok != true) return;
    setState(() {
      _payingInvoiceId = '${inv['id']}';
      _actionMsg = null;
    });
    try {
      final started = await widget.api.post('/api/admin/billing/invoices/${inv['id']}/pay', const {});
      final url = started is Map ? '${started['redirectUrl'] ?? ''}' : '';
      if (url.isEmpty || !await launchUrlString(url, mode: LaunchMode.externalApplication)) {
        if (mounted) {
          setState(() {
            _actionMsg = 'Ödeme sayfası açılamadı. Lütfen tekrar dene.';
            _actionErr = true;
          });
        }
        return;
      }
      if (mounted) {
        setState(() {
          _actionMsg = 'Ödeme sayfası açıldı. Ödemeyi tamamladıktan sonra sayfayı aşağı çekip yenile.';
          _actionErr = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _actionMsg = '$e';
          _actionErr = true;
        });
      }
    } finally {
      if (mounted) setState(() => _payingInvoiceId = null);
    }
  }

  Future<void> _choose(Map<String, dynamic> plan, {bool renewing = false}) async {
    final yearly = _period == 'Yearly';
    final price = numberOf(
        plan, [yearly ? 'yearlyPriceTRY' : 'monthlyPriceTRY']);
    final periodText = yearly ? 'yıllık' : 'aylık';
    final isPaid = price > 0;
    // TUTAR SUNUCUDAN: şube sayısı, müşteri / onam kademeleri ve KDV dahil — ödeme sayfası aynı
    // tutarı çeker. Teklif alınamazsa birim fiyat "+ KDV" olarak söylenir (paket fiyatları KDV hariç).
    var amountText = '${_tl(price)} + KDV';
    if (isPaid) {
      try {
        final raw = await widget.api.get('/api/admin/billing/quote', query: {'planId': plan['id'], 'period': _period});
        if (raw is Map && raw['total'] != null) {
          final q = raw.cast<String, dynamic>();
          final branches = numberOf(q, const ['branches']).toInt();
          amountText = '${_tl(numberOf(q, const ['total']))} (KDV dahil${branches > 1 ? ' · $branches şube' : ''})';
        }
      } catch (_) {
        // Birim fiyatla devam edilir; tahsil edilecek tutarı ödeme sayfası gösterir.
      }
    }
    if (!mounted) return;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(renewing ? '${plan['name']} ödemesi' : '${plan['name']} paketine geç'),
        content: Text(isPaid
            ? renewing
                ? '"${plan['name']}" aboneliğin için $periodText ödeme.\n\nTutar: $amountText\n\nDönem bitmeden ödersen yeni dönem mevcut bitişten devam eder. Güvenli ödeme sayfası tarayıcıda açılacak. Ödeme tamamlanınca bu sayfayı aşağı çekip yenile.\n\nDevam edilsin mi?'
                : '"${plan['name']}" paketine $periodText dönemle geçiyorsun.\n\nTutar: $amountText\n\nGüvenli ödeme sayfası tarayıcıda açılacak. Ödeme tamamlanınca bu sayfayı aşağı çekip yenile.\n\nDevam edilsin mi?'
            : '"${plan['name']}" paketine $periodText dönemle geçeceksin.\n\nBu paket için ödeme alınmıyor.\n\nDevam edilsin mi?'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Vazgeç')),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: Text(isPaid ? 'Ödemeye git' : 'Pakete geç')),
        ],
      ),
    );
    if (ok != true) return;
    setState(() {
      _busyPlanId = '${plan['id']}';
      _actionMsg = null;
    });
    try {
      if (isPaid) {
        // ÜCRETLİ PAKET ÖDEMEDEN AÇILMAZ: abonelik, sağlayıcı ödemeyi onayladıktan sonra
        // sunucudaki callback ucunda başlatılır. Burada yalnızca ödeme sayfası açılır.
        final started = await widget.api.post('/api/admin/billing/checkout', {
          'subscriptionPlanId': plan['id'],
          'billingPeriod': _period,
        });
        final url = started is Map ? '${started['redirectUrl'] ?? ''}' : '';
        if (url.isEmpty || !await launchUrlString(url, mode: LaunchMode.externalApplication)) {
          if (mounted) {
            setState(() {
              _actionMsg = 'Ödeme sayfası açılamadı. Lütfen tekrar dene.';
              _actionErr = true;
            });
          }
          return;
        }
        if (mounted) {
          setState(() {
            _actionMsg =
                'Ödeme sayfası açıldı. Ödemeyi tamamladıktan sonra sayfayı aşağı çekip yenile.';
            _actionErr = false;
          });
        }
        return;
      }

      await widget.api.post('/api/admin/tenant/upgrade', {
        'subscriptionPlanId': plan['id'],
        'billingPeriod': _period,
      });
      if (mounted) {
        setState(() {
          _actionMsg =
              'Paket başarıyla "${plan['name']}" ($periodText) olarak değiştirildi.';
          _actionErr = false;
        });
      }
      await _reload();
    } catch (e) {
      if (mounted) {
        setState(() {
          _actionMsg = 'Paket değiştirilemedi: $e';
          _actionErr = true;
        });
      }
    } finally {
      if (mounted) setState(() => _busyPlanId = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppBackground(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        body: SafeArea(
          child: RefreshIndicator(
            color: AppColors.primary,
            onRefresh: _reload,
            child: FutureBuilder<_PaketData>(
              future: _future,
              builder: (context, snapshot) {
                if (snapshot.connectionState != ConnectionState.done &&
                    !snapshot.hasData) {
                  return ListView(
                    children: const [
                      SizedBox(height: 200),
                      Center(child: CircularProgressIndicator()),
                    ],
                  );
                }
                final d = snapshot.data ?? _PaketData();
                return ListView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.fromLTRB(16, 20, 16, 110),
                  children: _body(d),
                );
              },
            ),
          ),
        ),
      ),
    );
  }

  List<Widget> _body(_PaketData d) {
    final usage = d.usage;
    final tenant = d.tenant;
    // Müşteri metriği ödenmiş kademe kapasitesiyle (bkz. _withTierCapacity) — özet kart, rozet ve liste AYNI diziden.
    final metrics = (usage['metrics'] as List? ?? const [])
        .whereType<Map>()
        .map((e) => e.cast<String, dynamic>())
        .map((m) => '${m['key']}' == 'customers' ? _withTierCapacity(m, d.customers) : m)
        .toList();
    final planName = valueOf(usage, const ['planName'], fallback: 'Atanmamış');
    final monthlyPrice = numberOf(usage, const ['planMonthlyPriceTRY']);
    final currentPlanId = '${usage['subscriptionPlanId'] ?? ''}';
    final maxPercent = metrics.fold<int>(
        numberOf(usage, const ['maxPercent']).round(),
        (best, m) => numberOf(m, const ['percent']).round() > best ? numberOf(m, const ['percent']).round() : best);
    final hasOverflow = usage['hasOverflow'] == true ||
        usage['hasAnyOverflow'] == true ||
        metrics.any((m) => m['isOver'] == true);
    final hasWarning = usage['hasWarning'] == true ||
        metrics.any((m) => m['isWarning'] == true);

    final currentIndex =
        d.plans.indexWhere((p) => '${p['id']}' == currentPlanId);
    final currentPlan = currentIndex >= 0 ? d.plans[currentIndex] : null;
    final upgradePath = currentPlan == null
        ? d.plans
        : (d.plans
            .where((p) => '${p['id']}' != currentPlanId && _isUpgradeOf(p, currentPlan))
            .toList()
          ..sort((a, b) => numberOf(a, const ['monthlyPriceTRY'])
              .compareTo(numberOf(b, const ['monthlyPriceTRY']))));
    Map<String, dynamic>? recommended;
    if (currentPlan != null) {
      // Üst paketlerin en uygun ücretlisi.
      for (final p in upgradePath) {
        if (numberOf(p, const ['monthlyPriceTRY']) > 0) {
          recommended = p;
          break;
        }
      }
    } else {
      // Paket atanmamış: en kapsamlı ücretli paket.
      final paid = d.plans
          .where((p) => numberOf(p, const ['monthlyPriceTRY']) > 0)
          .toList()
        ..sort((a, b) {
          final byFeat = _featureSet(b).length.compareTo(_featureSet(a).length);
          return byFeat != 0
              ? byFeat
              : numberOf(a, const ['monthlyPriceTRY'])
                  .compareTo(numberOf(b, const ['monthlyPriceTRY']));
        });
      if (paid.isNotEmpty) recommended = paid.first;
    }
    final perBranch = currentPlan?['chargePerBranch'] == true;
    final quoteMap = d.billing['nextRenewalQuote'] is Map
        ? (d.billing['nextRenewalQuote'] as Map).cast<String, dynamic>()
        : null;
    final branchMetric = metrics.where((m) => '${m['key']}' == 'branches');
    final branchesBilled = quoteMap != null
        ? numberOf(quoteMap, const ['branches']).toInt()
        : (branchMetric.isEmpty ? 0 : numberOf(branchMetric.first, const ['used']).toInt());
    final billedBranches = branchesBilled < 1 ? 1 : branchesBilled;
    // Web paritesi: aylık toplam SUNUCU TEKLİFİNDEN (şube × birim + müşteri / onam kademeleri);
    // teklif yoksa (ödeme kapalı / yıllık dönem) yalnız şube ücreti olduğu açıkça yazılır.
    final monthlyQuote = quoteMap != null && '${quoteMap['period']}' == 'Monthly' ? quoteMap : null;
    final quoteHasTiers = monthlyQuote != null &&
        (monthlyQuote['lines'] as List? ?? const [])
            .whereType<Map>()
            .any((l) => l['code'] == 'customers' || l['code'] == 'consent');
    final priceSub = monthlyPrice == 0
        ? 'Teklifle fiyatlanır'
        : monthlyQuote != null
            ? 'Aylık toplam ${_tl(numberOf(monthlyQuote, const ['subtotal']))} + KDV · '
                '${numberOf(monthlyQuote, const ['branches']).toInt()} şube${quoteHasTiers ? ' + kademe' : ''}'
            : perBranch
                ? 'Şube ücreti: $billedBranches şube · ${_tl(monthlyPrice * billedBranches)} + KDV / ay'
                : 'KDV hariç · aylık';

    Map<String, dynamic>? topMetric;
    for (final m in metrics) {
      if (topMetric == null ||
          numberOf(m, const ['percent']) >
              numberOf(topMetric, const ['percent'])) {
        topMetric = m;
      }
    }

    final status = '${tenant['status'] ?? ''}'.toLowerCase();
    final isTrial = status == 'trial';
    final trialDays = _daysLeft(tenant['trialEndsAt']);
    final showTrial = isTrial && trialDays != null && trialDays <= 7;
    final subEnds = tenant['subscriptionEndsAt'];
    final subDays = _daysLeft(subEnds);
    final suspended = status == 'suspended' ||
        status == 'paused' ||
        status == 'cancelled';
    final showSub = !isTrial &&
        subEnds != null &&
        ((status == 'active' && subDays != null && subDays <= 30) ||
            (suspended && subDays != null));
    final subPeriodLabel =
        '${tenant['subscriptionPeriod'] ?? ''}' == 'Yearly'
            ? 'Yıllık'
            : '${tenant['subscriptionPeriod'] ?? ''}' == 'Monthly'
                ? 'Aylık'
                : 'Abonelik';

    // iOS: fiyat, yükseltme ve ödeme yüzeyleri yok (StorePolicy — App Store 3.1.1).
    final storeSafe = StorePolicy.hidesPurchaseFlows;

    return [
      PageHeader(
        eyebrow: 'Aboneliğim',
        title: 'Paketim',
        subtitle: storeSafe
            ? 'Mevcut abonelik ve bu ayki kullanım.'
            : 'Mevcut abonelik, kullanım ve yükseltme yolu.',
      ),
      const SizedBox(height: 16),
      if (storeSafe && (showTrial || showSub))
        _banner(
          warning: true,
          title: showTrial
              ? (trialDays <= 0
                  ? 'Deneme süren doldu.'
                  : 'Deneme süren $trialDays gün içinde dolacak.')
              : (subDays! <= 0
                  ? '$subPeriodLabel aboneliğin doldu.'
                  : '$subPeriodLabel aboneliğin $subDays gün içinde bitiyor.'),
          sub: 'Abonelik işlemleri bu uygulamadan yapılmaz.',
        )
      else ...[
        if (showTrial)
          _banner(
            warning: trialDays > 0,
            title: trialDays <= 0
                ? 'Deneme sürenin doldu — abonelik gerek.'
                : 'Deneme süren $trialDays gün içinde dolacak.',
            sub: trialDays <= 0
                ? 'Hesabın yakında pasifleştirilecek; bir paket seçerek aktivasyonu sürdür.'
                : 'Şimdi bir paket seçerek geçişi sorunsuz yap.',
          ),
        if (showSub)
          _banner(
            warning: subDays > 0,
            title: subDays <= 0
                ? '$subPeriodLabel aboneliğin doldu — lütfen paket satın al.'
                : '$subPeriodLabel aboneliğin $subDays gün içinde bitiyor.',
            sub: subDays <= 0
                ? 'Kurum pasife alındı; aşağıdan bir paket seçip dönem yenileyerek erişimi sürdür.'
                : 'Şimdi yenileyerek kesintisiz devam et.',
          ),
      ],
      if (_actionMsg != null) ...[
        _resultBanner(_actionMsg!, _actionErr),
        const SizedBox(height: 12),
      ],
      // STAT KARTLARI
      Row(
        children: [
          _statCard(
            Icons.workspace_premium_rounded,
            'Mevcut paket',
            planName,
            badge: isTrial ? 'Deneme' : 'Aktif',
            badgeColor: isTrial ? const Color(0xFFB7791F) : AppColors.success,
            big: true,
          ),
          if (!storeSafe) ...[
            const SizedBox(width: 10),
            _statCard(
              Icons.credit_card_rounded,
              perBranch ? 'Aylık fiyat · şube başına' : 'Aylık fiyat',
              monthlyPrice == 0 ? 'Özel' : _tl(monthlyPrice),
              sub: priceSub,
            ),
          ],
        ],
      ),
      const SizedBox(height: 10),
      Row(
        children: [
          _statCard(
            Icons.trending_up_rounded,
            'En yüksek metrik',
            '%$maxPercent',
            sub: topMetric != null
                ? (_metricLabels['${topMetric['key']}'] ??
                    valueOf(topMetric, const ['label'], fallback: 'kullanım'))
                : 'kullanım',
            badge: hasOverflow
                ? 'limit aşıldı'
                : hasWarning
                    ? 'sınıra yakın'
                    : '%$maxPercent kullanıldı',
            badgeColor: hasOverflow
                ? AppColors.danger
                : hasWarning
                    ? const Color(0xFFB7791F)
                    : AppColors.success,
          ),
          if (!storeSafe) ...[
            const SizedBox(width: 10),
            _statCard(
              Icons.auto_awesome_rounded,
              'Üst paketler',
              '${upgradePath.length}',
              badge: recommended != null ? '${recommended['name']} (Önerilen)' : null,
              badgeColor: AppColors.primary,
              sub: recommended == null ? 'en kapsamlı paketi kullanıyorsun' : null,
            ),
          ],
        ],
      ),
      const SizedBox(height: 16),
      // ÖDEME: kayıtlı kart + son faturalar. Ödeme altyapısı kapalıyken kart kısmı gizlenir ama kesilmiş
      // faturalar (ör. kartsız şube eklemenin AÇIK faturası) yine görünür — web paritesi.
      if (!storeSafe &&
          (d.billing['paymentsEnabled'] == true ||
              (d.billing['recentInvoices'] as List? ?? const []).isNotEmpty)) ...[
        const SizedBox(height: 12),
        _billingCard(d.billing),
      ],
      // BU AYKİ KULLANIM
      _sectionTitle(Icons.insights_rounded, 'Bu Ayki Kullanım'),
      const SizedBox(height: 10),
      if (metrics.isEmpty)
        _emptyBox('Kullanım verisi alınamadı.')
      else
        ...metrics.map(_usageCell),
      // MÜŞTERİ + DİJİTAL ONAM — kapasite yalnız ödenmiş kademeden; sınır yoksa kart gösterilmez.
      for (final entry in [('customers', d.customers), ('consent', d.consent)])
        if (entry.$2.isNotEmpty && (entry.$2['capacity'] != null || entry.$2['allowed'] == false)) ...[
          const SizedBox(height: 12),
          _tierCard(entry.$1, entry.$2, storeSafe),
        ],
      if (!storeSafe) ...[
        const SizedBox(height: 16),
        // YÜKSELTME YOLU
        Row(
          children: [
            Expanded(
              child: _sectionTitle(Icons.auto_awesome_rounded, 'Yükseltme Yolu'),
            ),
            _periodToggle(),
          ],
        ),
        const SizedBox(height: 12),
        if (d.plans.isEmpty)
          _emptyBox('Plan kataloğu henüz yüklenmedi.')
        else
          ...d.plans.map((p) => _planCard(
                p,
                isCurrent: '${p['id']}' == currentPlanId,
                payLabel: '${p['id']}' == currentPlanId ? _currentPayLabel(d.billing) : null,
                isRecommended:
                    recommended != null && '${p['id']}' == '${recommended['id']}' &&
                        '${p['id']}' != currentPlanId,
              )),
      ],
    ];
  }

  // ----------------------------- parçalar -----------------------------

  /// Ödeme kartı: kayıtlı kart durumu + son faturalar (web `/admin/paket` paritesi).
  Widget _billingCard(Map<String, dynamic> billing) {
    final card = billing['card'] is Map
        ? (billing['card'] as Map).cast<String, dynamic>()
        : null;
    final invoices = (billing['recentInvoices'] as List? ?? const [])
        .whereType<Map>()
        .map((e) => e.cast<String, dynamic>())
        .take(4)
        .toList();
    final failures = card == null
        ? 0
        : numberOf(card, const ['consecutiveFailureCount']).round();
    final nextCharge = parseUtcToLocal(billing['subscriptionEndsAtUtc']);
    final nextQuote = billing['nextRenewalQuote'] is Map
        ? (billing['nextRenewalQuote'] as Map).cast<String, dynamic>()
        : null;
    final paymentsOn = billing['paymentsEnabled'] == true;
    final hasOpen = invoices.any((i) => i['status'] == 'Sent' || i['status'] == 'Overdue');

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.primary.withValues(alpha: .18)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.credit_card_rounded,
                  size: 18, color: AppColors.primary),
              const SizedBox(width: 8),
              Text(paymentsOn ? 'Ödeme ve Faturalar' : 'Faturalar',
                  style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
            ],
          ),
          const SizedBox(height: 10),
          if (!paymentsOn) ...[
            if (hasOpen)
              const Text(
                'Ödeme bekleyen faturaların için ekibimiz seninle iletişime geçer; ödeme alındığında durum "Ödendi" olur.',
                style: TextStyle(fontSize: 12, height: 1.45, color: Color(0xFF74616A)),
              ),
          ] else if (card != null) ...[
            Text('${card['maskedNumber'] ?? 'Kayıtlı kart'}',
                style: const TextStyle(
                    fontSize: 14.5, fontWeight: FontWeight.w600)),
            const SizedBox(height: 2),
            Text(
              [card['association'], card['family'], card['bankName']]
                  .where((e) => e != null && '$e'.isNotEmpty)
                  .join(' · '),
              style: const TextStyle(fontSize: 12, color: Color(0xFF74616A)),
            ),
            if (nextCharge != null) ...[
              const SizedBox(height: 6),
              Text(
                'Sonraki tahsilat: ${nextCharge.day.toString().padLeft(2, '0')}.${nextCharge.month.toString().padLeft(2, '0')}.${nextCharge.year}'
                '${nextQuote != null ? ' · ${_tl(numberOf(nextQuote, const ['total']))} (KDV dahil)' : ''}',
                style: const TextStyle(fontSize: 12, color: Color(0xFF4A3A44)),
              ),
            ],
            // Sonraki yenilemenin kalem dökümü (şube × birim, müşteri / onam kademesi) — sunucu hesabı.
            if (nextQuote != null) ...[
              const SizedBox(height: 6),
              for (final line in (nextQuote['lines'] as List? ?? const []).whereType<Map>())
                Padding(
                  padding: const EdgeInsets.only(top: 2),
                  child: Row(
                    children: [
                      Expanded(child: Text('${line['label']}', style: const TextStyle(fontSize: 11.5, color: Color(0xFF5A4B53)))),
                      Text(_tl(numberOf(line.cast<String, dynamic>(), const ['net'])), style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600)),
                    ],
                  ),
                ),
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Row(
                  children: [
                    const Expanded(child: Text('KDV', style: TextStyle(fontSize: 11.5, color: Color(0xFF74616A)))),
                    Text(_tl(numberOf(nextQuote, const ['vat'])), style: const TextStyle(fontSize: 11.5, color: Color(0xFF74616A))),
                  ],
                ),
              ),
            ],
            if (failures > 0) ...[
              const SizedBox(height: 8),
              Text(
                'Son $failures tahsilat denemesi başarısız. Kartını güncelle.',
                style: const TextStyle(
                    fontSize: 12, color: Color(0xFFB7791F)),
              ),
            ],
          ] else
            Text(
              // Maydanoz: ödeme maydanozasist.com'da alınır, kart saklanmaz (web ile aynı metin).
              billing['paymentProvider'] == 'Maydanoz'
                  ? "Ödeme maydanozasist.com'da. Ücretli bir paket seçtiğinde Maydanoz "
                      "Yazılım'ın güvenli ödeme sayfasına (iyzico) yönlendirilirsin; ödeme "
                      'tamamlanınca uygulamaya dönebilirsin. Kart bilgilerin bizde saklanmaz. '
                      'Dönem sonunda yenilemek için buradan yeniden ödeme yaparsın.'
                  : 'Kayıtlı kart yok. Ücretli bir paket seçtiğinde güvenli ödeme sayfasına '
                      'yönlendirilirsin; kartını kaydedersen abonelik otomatik yenilenir. '
                      'Kart bilgilerin bizde saklanmaz.',
              style: const TextStyle(
                  fontSize: 12, height: 1.45, color: Color(0xFF74616A)),
            ),
          if (invoices.isNotEmpty) ...[
            const SizedBox(height: 12),
            const Divider(height: 1),
            const SizedBox(height: 10),
            ...invoices.map((inv) {
              final paid = '${inv['status'] ?? ''}' == 'Paid';
              // Neye ait olduğu (dönem / ek şube / kademe) — "ödenince açılacak" şube talebi burada görünür.
              final notes = '${inv['notes'] ?? ''}'.trim();
              return Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('${inv['number'] ?? ''}',
                              style: const TextStyle(
                                  fontSize: 12, color: Color(0xFF4A3A44))),
                          if (notes.isNotEmpty)
                            Text(notes,
                                style: const TextStyle(
                                    fontSize: 11, height: 1.3, color: Color(0xFF74616A))),
                        ],
                      ),
                    ),
                    Text(_tl(numberOf(inv, const ['amountTRY'])),
                        style: const TextStyle(
                            fontSize: 12.5, fontWeight: FontWeight.w600)),
                    const SizedBox(width: 8),
                    Icon(
                      paid
                          ? Icons.check_circle_rounded
                          : Icons.schedule_rounded,
                      size: 14,
                      color: paid ? AppColors.success : const Color(0xFFB7791F),
                    ),
                    // Ödeme Maydanoz'daysa açık fatura buradan ödenir (iOS'ta ödeme yüzeyi yok).
                    if (!StorePolicy.hidesPurchaseFlows &&
                        paymentsOn &&
                        billing['paymentProvider'] == 'Maydanoz' &&
                        (inv['status'] == 'Sent' || inv['status'] == 'Overdue')) ...[
                      const SizedBox(width: 6),
                      TextButton(
                        onPressed: _payingInvoiceId != null ? null : () => _payInvoice(inv.cast<String, dynamic>()),
                        style: TextButton.styleFrom(
                          minimumSize: Size.zero,
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                        ),
                        child: Text(_payingInvoiceId == '${inv['id']}' ? '…' : 'Öde',
                            style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800)),
                      ),
                    ],
                  ],
                ),
              );
            }),
          ],
        ],
      ),
    );
  }

  Widget _banner({
    required bool warning,
    required String title,
    required String sub,
  }) {
    final color = warning ? const Color(0xFFB7791F) : AppColors.danger;
    final bg = warning ? const Color(0xFFFFF7E6) : const Color(0xFFFDECEC);
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(13),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: color.withValues(alpha: .4)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.warning_amber_rounded, size: 18, color: color),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title,
                    style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w800,
                        color: color)),
                const SizedBox(height: 2),
                Text(sub,
                    style: TextStyle(
                        fontSize: 11, color: color.withValues(alpha: .85))),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _resultBanner(String msg, bool err) {
    final color = err ? AppColors.danger : AppColors.success;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: color.withValues(alpha: .1),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: .35)),
      ),
      child: Row(
        children: [
          Icon(err ? Icons.error_outline_rounded : Icons.check_circle_rounded,
              size: 16, color: color),
          const SizedBox(width: 8),
          Expanded(
            child: Text(msg,
                style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: color)),
          ),
        ],
      ),
    );
  }

  Widget _statCard(
    IconData icon,
    String label,
    String value, {
    String? sub,
    String? badge,
    Color? badgeColor,
    bool big = false,
  }) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.all(13),
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
                Container(
                  width: 32,
                  height: 32,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: const Color(0xFFF6DFE6),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(icon, size: 17, color: AppColors.primary),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(label,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          fontSize: 9.5,
                          letterSpacing: .3,
                          color: AppColors.muted)),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Text(value,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                    fontSize: big ? 19 : 20,
                    fontWeight: FontWeight.w900,
                    height: 1)),
            if (sub != null) ...[
              const SizedBox(height: 3),
              Text(sub,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 10, color: AppColors.muted)),
            ],
            if (badge != null) ...[
              const SizedBox(height: 7),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
                decoration: BoxDecoration(
                  color: (badgeColor ?? AppColors.primary)
                      .withValues(alpha: .12),
                  borderRadius: BorderRadius.circular(7),
                ),
                child: Text(badge,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                        fontSize: 9,
                        fontWeight: FontWeight.w800,
                        color: badgeColor ?? AppColors.primary)),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _sectionTitle(IconData icon, String title) {
    return Row(
      children: [
        Icon(icon, size: 16, color: AppColors.primary),
        const SizedBox(width: 6),
        Text(title,
            style: const TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w800,
                letterSpacing: .3,
                color: AppColors.primaryDark)),
      ],
    );
  }

  Widget _periodToggle() {
    Widget seg(String key, String label) {
      final on = _period == key;
      return GestureDetector(
        onTap: () => setState(() => _period = key),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          decoration: BoxDecoration(
            color: on ? const Color(0xFFF6DFE6) : Colors.white,
            borderRadius: BorderRadius.circular(8),
          ),
          child: Text(label,
              style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  color: on ? AppColors.primary : AppColors.muted)),
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(11),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [seg('Monthly', 'Aylık'), seg('Yearly', 'Yıllık')],
      ),
    );
  }

  Widget _usageCell(Map<String, dynamic> m) {
    final key = '${m['key'] ?? ''}';
    final label =
        _metricLabels[key] ?? valueOf(m, const ['label', 'key']);
    final used = numberOf(m, const ['used']);
    final limit = numberOf(m, const ['limit']);
    final unlimited = m['isUnlimited'] == true || limit < 0;
    final percent = numberOf(m, const ['percent']).clamp(0, 100);
    final over = m['isOver'] == true;
    final warn = m['isWarning'] == true;
    final color = over
        ? AppColors.danger
        : warn
            ? const Color(0xFFB7791F)
            : AppColors.primary;
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(13),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(_metricIcons[key] ?? Icons.donut_large_rounded,
                  size: 15, color: AppColors.primary),
              const SizedBox(width: 7),
              Expanded(
                child: Text(label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 12.5)),
              ),
              Text(
                  unlimited
                      ? '${used.toInt()} / ∞'
                      : '${used.toInt()} / ${limit.toInt()}',
                  style: TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w800,
                      color: color)),
            ],
          ),
          const SizedBox(height: 8),
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(
              value: unlimited ? 0.06 : percent / 100,
              minHeight: 6,
              backgroundColor: AppColors.surfaceSoft,
              color: color,
            ),
          ),
          const SizedBox(height: 4),
          Align(
            alignment: Alignment.centerRight,
            child: Text(unlimited ? 'sınırsız' : '%${percent.round()}',
                style: const TextStyle(fontSize: 9.5, color: AppColors.muted)),
          ),
        ],
      ),
    );
  }

  Widget _planCard(
    Map<String, dynamic> p, {
    required bool isCurrent,
    required bool isRecommended,
    String? payLabel,
  }) {
    final monthly = numberOf(p, const ['monthlyPriceTRY']);
    final yearly = numberOf(p, const ['yearlyPriceTRY']);
    final isCustom = monthly == 0;
    final busy = _busyPlanId == '${p['id']}';
    final highlights = _highlightsOf(p);
    final metrics = <(IconData, String, double)>[
      (Icons.store_rounded, 'Şube', numberOf(p, const ['maxBranches'])),
      (Icons.badge_rounded, 'Personel', numberOf(p, const ['maxStaff'])),
      (Icons.people_rounded, 'Müşteri', numberOf(p, const ['maxCustomers'])),
      (
        Icons.event_rounded,
        'Aylık Randevu',
        numberOf(p, const ['maxMonthlyAppointments'])
      ),
      (
        Icons.sms_rounded,
        'Aylık SMS',
        numberOf(p, const ['maxMonthlySmsCount'])
      ),
    ];
    String fmt(double v) => v < 0 ? '∞' : v.toInt().toString();

    final fg = isCurrent ? Colors.white : AppColors.ink;
    final mutedFg = isCurrent ? Colors.white70 : AppColors.muted;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: isCurrent
            ? const LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [Color(0xFF5C2138), Color(0xFF7A2F4D), Color(0xFF3A1426)],
              )
            : null,
        color: isCurrent ? null : AppColors.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: isCurrent
              ? const Color(0xFF7A2F4D)
              : isRecommended
                  ? const Color(0xFFE0617F)
                  : AppColors.border,
          width: isRecommended && !isCurrent ? 1.4 : 1,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: isCurrent
                      ? Colors.white.withValues(alpha: .15)
                      : const Color(0xFFF6DFE6),
                  borderRadius: BorderRadius.circular(7),
                ),
                child: Text(
                    isCurrent
                        ? 'AKTİF PAKET'
                        : '${p['planKey'] ?? ''}'.toUpperCase(),
                    style: TextStyle(
                        fontSize: 9,
                        letterSpacing: .6,
                        fontWeight: FontWeight.w800,
                        color: isCurrent ? Colors.white : AppColors.primary)),
              ),
              const Spacer(),
              if (isRecommended)
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: const Color(0xFFE0617F),
                    borderRadius: BorderRadius.circular(7),
                  ),
                  child: const Text('ÖNERİLEN',
                      style: TextStyle(
                          fontSize: 9,
                          letterSpacing: .6,
                          fontWeight: FontWeight.w800,
                          color: Colors.white)),
                ),
              if (isCurrent)
                const Icon(Icons.check_circle_rounded,
                    size: 18, color: Color(0xFF6EE7B7)),
            ],
          ),
          const SizedBox(height: 10),
          Text('${p['name'] ?? 'Paket'}',
              style: TextStyle(
                  fontSize: 21, fontWeight: FontWeight.w900, color: fg)),
          if ('${p['description'] ?? ''}'.trim().isNotEmpty) ...[
            const SizedBox(height: 2),
            Text('${p['description']}',
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 11.5, color: mutedFg)),
          ],
          const SizedBox(height: 12),
          if (isCustom)
            Text('Özel Fiyat',
                style: TextStyle(
                    fontSize: 24,
                    fontWeight: FontWeight.w900,
                    color: isCurrent ? Colors.white : AppColors.primary))
          else
            Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(_tl(monthly),
                    style: TextStyle(
                        fontSize: 28,
                        fontWeight: FontWeight.w900,
                        color: isCurrent ? Colors.white : AppColors.primary)),
                const SizedBox(width: 3),
                Padding(
                  padding: const EdgeInsets.only(bottom: 4),
                  // Paket fiyatları KDV HARİÇ; şube başına paket birim fiyattır.
                  child: Text('/ay${p['chargePerBranch'] == true ? ' · şube' : ''} +KDV',
                      style: TextStyle(fontSize: 12, color: mutedFg)),
                ),
                if (_period == 'Yearly' && yearly > 0) ...[
                  const Spacer(),
                  Padding(
                    padding: const EdgeInsets.only(bottom: 3),
                    child: Text('Yıllık ${_tl(yearly)}',
                        style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                            color: mutedFg)),
                  ),
                ],
              ],
            ),
          const SizedBox(height: 14),
          for (final m in metrics)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(
                children: [
                  Icon(m.$1,
                      size: 14,
                      color: isCurrent
                          ? const Color(0xFFF3A3BF)
                          : AppColors.primary),
                  const SizedBox(width: 7),
                  Expanded(
                    child: Text(m.$2,
                        style: TextStyle(fontSize: 12, color: mutedFg)),
                  ),
                  Text(fmt(m.$3),
                      style: TextStyle(
                          fontSize: 12.5,
                          fontWeight: FontWeight.w800,
                          color: fg)),
                ],
              ),
            ),
          if (highlights.isNotEmpty) ...[
            const SizedBox(height: 8),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final h in highlights)
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: isCurrent
                          ? Colors.white.withValues(alpha: .1)
                          : AppColors.surfaceSoft,
                      borderRadius: BorderRadius.circular(7),
                      border: Border.all(
                          color: isCurrent
                              ? Colors.white.withValues(alpha: .2)
                              : AppColors.border),
                    ),
                    child: Text(h,
                        style: TextStyle(
                            fontSize: 9.5,
                            color: isCurrent ? Colors.white70 : AppColors.ink)),
                  ),
              ],
            ),
          ],
          const SizedBox(height: 14),
          SizedBox(
            width: double.infinity,
            child: _planAction(p, isCurrent, isCustom, isRecommended, busy, payLabel),
          ),
        ],
      ),
    );
  }

  Widget _planAction(Map<String, dynamic> p, bool isCurrent, bool isCustom,
      bool isRecommended, bool busy, String? payLabel) {
    if (isCurrent && payLabel != null && !isCustom) {
      return FilledButton.icon(
        onPressed: busy ? null : () => _choose(p, renewing: true),
        style: FilledButton.styleFrom(
          backgroundColor: Colors.white,
          foregroundColor: AppColors.primary,
          padding: const EdgeInsets.symmetric(vertical: 12),
        ),
        icon: busy
            ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
            : const Icon(Icons.credit_card_rounded, size: 16),
        label: Text(payLabel, style: const TextStyle(fontWeight: FontWeight.w800)),
      );
    }
    if (isCurrent) {
      return Container(
        padding: const EdgeInsets.symmetric(vertical: 11),
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: .12),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: Colors.white.withValues(alpha: .25)),
        ),
        child: const Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.check_circle_rounded, size: 16, color: Colors.white),
            SizedBox(width: 6),
            Text('Mevcut paketiniz',
                style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: Colors.white)),
          ],
        ),
      );
    }
    if (isCustom) {
      return OutlinedButton.icon(
        onPressed: () {},
        icon: const Icon(Icons.mail_outline_rounded, size: 16),
        label: const Text('İletişime geç'),
      );
    }
    return FilledButton(
      onPressed: busy ? null : () => _choose(p),
      style: FilledButton.styleFrom(
        backgroundColor:
            isRecommended ? AppColors.primary : const Color(0xFFF6DFE6),
        foregroundColor: isRecommended ? Colors.white : AppColors.primary,
        padding: const EdgeInsets.symmetric(vertical: 12),
      ),
      child: busy
          ? const SizedBox(
              width: 16,
              height: 16,
              child: CircularProgressIndicator(strokeWidth: 2))
          : const Text('Bu pakete geç',
              style: TextStyle(fontWeight: FontWeight.w800)),
    );
  }

  Widget _emptyBox(String msg) => Container(
        padding: const EdgeInsets.all(24),
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.border),
        ),
        child: Text(msg,
            style: const TextStyle(fontSize: 12.5, color: AppColors.muted)),
      );
}

class _PaketData {
  _PaketData({
    this.plans = const [],
    this.usage = const {},
    this.tenant = const {},
    this.billing = const {},
    this.consent = const {},
    this.customers = const {},
  });
  final List<Map<String, dynamic>> plans;
  final Map<String, dynamic> usage;
  final Map<String, dynamic> tenant;

  /// Ödeme özeti: kayıtlı kart + son faturalar. Ödeme altyapısı kapalıysa boş gelir.
  final Map<String, dynamic> billing;

  /// Dijital onam hakkı (imzalı evrak, ödenmiş kapasite, sonraki kademe). Yetkisizse boş.
  final Map<String, dynamic> consent;

  /// Kayıtlı müşteri hakkı (müşteri sayısı, ödenmiş kapasite, sonraki kademe). Yetkisizse boş.
  final Map<String, dynamic> customers;
}

/// Kademe kartının boyuta göre dili — para kodu tek, yalnız metin ayrışır (web `TIER_TEXT` paritesi).
class _TierText {
  const _TierText({
    required this.title,
    required this.icon,
    required this.countLabel,
    required this.unit,
    required this.lockedText,
    required this.lockedTextNeutral,
    required this.footnote,
    required this.name,
  });
  final String title;
  final IconData icon;
  final String countLabel;
  final String unit;
  final String lockedText;

  /// iOS (App Store 3.1.1): ödeme / satın alma çağrışımı olmayan durum metni.
  final String lockedTextNeutral;
  final String footnote;
  final String name;
}

const _tierTexts = <String, _TierText>{
  'customers': _TierText(
    title: 'Kayıtlı Müşteri',
    icon: Icons.people_rounded,
    countLabel: 'kayıtlı müşteri',
    unit: 'müşteri',
    lockedText:
        'Ödenmiş müşteri kapasitesi doldu — bu kademenin bedeli ödenmeden yeni müşteri eklenemez; online kayıt da durur.',
    lockedTextNeutral: 'Kayıtlı müşteri sınırına ulaşıldı — yeni müşteri eklenemiyor.',
    footnote: 'Silinen müşteri sayaçtan düşer.',
    name: 'Müşteri kademesi',
  ),
  'consent': _TierText(
    title: 'Dijital Onam Evrakı',
    icon: Icons.draw_rounded,
    countLabel: 'imzalı evrak',
    unit: 'evrak',
    lockedText: 'Ödenmiş onam kapasitesi doldu — bu kademenin bedeli ödenmeden yeni onam imzalatılamaz.',
    lockedTextNeutral: 'İmzalı onam evrakı sınırına ulaşıldı — yeni onam imzalatılamıyor.',
    footnote: 'Silinen imzalı evrak da sayılır.',
    name: 'Onam kademesi',
  ),
};
