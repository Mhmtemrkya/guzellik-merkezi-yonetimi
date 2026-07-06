import 'package:flutter/material.dart';

import '../../core/network/api_client.dart';
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

class _PaketScreenState extends State<PaketScreen> {
  late Future<_PaketData> _future;
  String _period = 'Yearly'; // Monthly | Yearly
  String? _busyPlanId;
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
    );
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

  Future<void> _choose(Map<String, dynamic> plan) async {
    final yearly = _period == 'Yearly';
    final price = numberOf(
        plan, [yearly ? 'yearlyPriceTRY' : 'monthlyPriceTRY']);
    final periodText = yearly ? 'yıllık' : 'aylık';
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('${plan['name']} paketine geç'),
        content: Text(
            '"${plan['name']}" paketine $periodText dönemle geçeceksin.\n\nTutar: ${price == 0 ? 'Özel teklif' : _tl(price)}\nAbonelik bugünden ${yearly ? '1 yıl' : '1 ay'} geçerli olur.\n\nDevam edilsin mi?'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Vazgeç')),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Pakete geç')),
        ],
      ),
    );
    if (ok != true) return;
    setState(() {
      _busyPlanId = '${plan['id']}';
      _actionMsg = null;
    });
    try {
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
    final metrics = (usage['metrics'] as List? ?? const [])
        .whereType<Map>()
        .map((e) => e.cast<String, dynamic>())
        .toList();
    final planName = valueOf(usage, const ['planName'], fallback: 'Atanmamış');
    final monthlyPrice = numberOf(usage, const ['planMonthlyPriceTRY']);
    final currentPlanId = '${usage['subscriptionPlanId'] ?? ''}';
    final maxPercent = numberOf(usage, const ['maxPercent']).round();
    final hasOverflow = usage['hasOverflow'] == true ||
        usage['hasAnyOverflow'] == true ||
        metrics.any((m) => m['isOver'] == true);
    final hasWarning = usage['hasWarning'] == true ||
        metrics.any((m) => m['isWarning'] == true);

    final currentIndex =
        d.plans.indexWhere((p) => '${p['id']}' == currentPlanId);
    final upgradePath =
        currentIndex >= 0 ? d.plans.sublist(currentIndex + 1) : d.plans;
    Map<String, dynamic>? recommended;
    for (final p in upgradePath) {
      if (numberOf(p, const ['monthlyPriceTRY']) > 0) {
        recommended = p;
        break;
      }
    }
    if (recommended == null) {
      final paid = d.plans
          .where((p) =>
              numberOf(p, const ['monthlyPriceTRY']) > 0 &&
              '${p['id']}' != currentPlanId)
          .toList()
        ..sort((a, b) => numberOf(b, const ['monthlyPriceTRY'])
            .compareTo(numberOf(a, const ['monthlyPriceTRY'])));
      if (paid.isNotEmpty) recommended = paid.first;
    }

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

    return [
      const PageHeader(
        eyebrow: 'Aboneliğim',
        title: 'Paketim',
        subtitle: 'Mevcut abonelik, kullanım ve yükseltme yolu.',
      ),
      const SizedBox(height: 16),
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
          const SizedBox(width: 10),
          _statCard(
            Icons.credit_card_rounded,
            'Aylık fiyat',
            monthlyPrice == 0 ? 'Özel' : _tl(monthlyPrice),
            sub: 'Aylık faturalandırılır',
          ),
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
          const SizedBox(width: 10),
          _statCard(
            Icons.auto_awesome_rounded,
            'Üst paketler',
            '${upgradePath.length}',
            badge: recommended != null ? '${recommended['name']} (Önerilen)' : null,
            badgeColor: AppColors.primary,
            sub: recommended == null ? 'en üst paktesin' : null,
          ),
        ],
      ),
      const SizedBox(height: 16),
      // BU AYKİ KULLANIM
      _sectionTitle(Icons.insights_rounded, 'Bu Ayki Kullanım'),
      const SizedBox(height: 10),
      if (metrics.isEmpty)
        _emptyBox('Kullanım verisi alınamadı.')
      else
        ...metrics.map(_usageCell),
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
              isRecommended:
                  recommended != null && '${p['id']}' == '${recommended['id']}' &&
                      '${p['id']}' != currentPlanId,
            )),
    ];
  }

  // ----------------------------- parçalar -----------------------------

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
                    color: const Color(0xFFFFF1F6),
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
            color: on ? const Color(0xFFFFF1F6) : Colors.white,
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
                      : const Color(0xFFFFF1F6),
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
                  child: Text('/ay',
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
            child: _planAction(p, isCurrent, isCustom, isRecommended, busy),
          ),
        ],
      ),
    );
  }

  Widget _planAction(Map<String, dynamic> p, bool isCurrent, bool isCustom,
      bool isRecommended, bool busy) {
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
            isRecommended ? AppColors.primary : const Color(0xFFFFF1F6),
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
  });
  final List<Map<String, dynamic>> plans;
  final Map<String, dynamic> usage;
  final Map<String, dynamic> tenant;
}
