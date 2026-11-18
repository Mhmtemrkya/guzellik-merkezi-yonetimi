import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher_string.dart';

import '../../core/network/api_client.dart';
import '../../core/platform/store_policy.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/json_helpers.dart';
import '../appointments/calendar_theme.dart';

/// Şube teklifinin (`/api/admin/billing/branch-quote`) ekranda gösterilen hâli — web `BranchCreateModal` paritesi.
///
/// Tutarları SUNUCU hesaplar (`impact`): şube başı birim fiyat (KDV hariç), bugünkü aylık toplam ve bir şube daha
/// eklenince aylık / yıllık toplam (KDV dahil). Ücretli dönemde bugün işlenecek orantılı tutar `chargeTotal`'dır.
class BranchFeeView {
  const BranchFeeView({
    required this.chargeRequired,
    required this.canPurchase,
    required this.reason,
    required this.chargeTotal,
    required this.byInvoice,
    required this.payOnline,
    required this.cardMasked,
    required this.hasImpact,
    required this.planName,
    required this.trial,
    required this.branches,
    required this.unitMonthly,
    required this.unitYearly,
    required this.currentMonthly,
    required this.nextMonthly,
    required this.nextYearly,
    required this.yearly,
  });

  factory BranchFeeView.from(Map<String, dynamic> quote) {
    Map<String, dynamic> map(Object? v) => v is Map ? v.cast<String, dynamic>() : const <String, dynamic>{};
    final impact = map(quote['impact']);
    final chargeRequired = quote['chargeRequired'] == true;
    return BranchFeeView(
      chargeRequired: chargeRequired,
      canPurchase: quote['canPurchase'] == true,
      reason: _text(quote['reason']),
      chargeTotal: chargeRequired ? numberOf(map(quote['quote']), const ['total']) : null,
      byInvoice: '${quote['chargeMethod'] ?? ''}' == 'Invoice',
      payOnline: quote['invoicePayOnline'] == true,
      cardMasked: _text(quote['cardMasked']),
      hasImpact: impact.isNotEmpty,
      planName: _text(impact['planName']) ?? '',
      trial: impact['trial'] == true,
      branches: numberOf(impact, const ['branches']).toInt(),
      unitMonthly: numberOf(impact, const ['unitMonthly']),
      unitYearly: numberOf(impact, const ['unitYearly']),
      currentMonthly: numberOf(map(impact['currentMonthly']), const ['total']),
      nextMonthly: numberOf(map(impact['nextMonthly']), const ['total']),
      nextYearly: numberOf(map(impact['nextYearly']), const ['total']),
      yearly: '${impact['period'] ?? ''}' == 'yearly',
    );
  }

  final bool chargeRequired;
  final bool canPurchase;
  final String? reason;
  final double? chargeTotal;
  final bool byInvoice;
  final bool payOnline;
  final String? cardMasked;
  final bool hasImpact;
  final String planName;
  final bool trial;
  final int branches;
  final double unitMonthly;
  final double unitYearly;
  final double currentMonthly;
  final double nextMonthly;
  final double nextYearly;
  final bool yearly;

  /// Bir şube daha eklenince abonelik döneminin toplamı (yıllık abonelikte yıllık).
  double get nextPeriodTotal => yearly ? nextYearly : nextMonthly;

  /// Gösterilecek bir şey var mı? (Şube başına olmayan pakette ve ücretsiz durumda pencere açılmaz.)
  bool get worthShowing => chargeRequired || hasImpact;

  static String? _text(Object? v) {
    final s = v == null ? '' : '$v'.trim();
    return s.isEmpty ? null : s;
  }
}

/// Liste fiyatı: tam lira kuruşsuz (₺1.000), küsuratlıysa kuruşlu.
String listPrice(double value) {
  final exact = CalendarText.tl(value);
  return value == value.roundToDouble() ? exact.substring(0, exact.length - 3) : exact;
}

/// Şube talebinin faturası (web `lib/branchInvoice.ts` paritesi): önce sunucu mesajındaki numara, yoksa fatura
/// notundaki "Ek şube · {ad} (ödenince açılacak)" — ad birebir. Yalnız ödemeye açık (Sent / Overdue) faturalar.
Map<String, dynamic>? findBranchInvoice(List<Map<String, dynamic>> invoices, String message, String branchName) {
  final open = invoices.where((inv) => inv['status'] == 'Sent' || inv['status'] == 'Overdue').toList();
  final number = RegExp(r'\b([A-Z]{2}-\d{4}-\d+)\b').firstMatch(message)?.group(1);
  if (number != null) {
    for (final inv in open) {
      if ('${inv['number'] ?? ''}' == number) return inv;
    }
  }
  final name = branchName.trim();
  if (name.isEmpty) return null;
  final marker = 'Ek şube · $name';
  for (final inv in open) {
    final notes = '${inv['notes'] ?? ''}';
    if (notes.contains('$marker (') || notes.endsWith(marker)) return inv;
  }
  return null;
}

/// Ücret etkisi + (ücretli dönemde) tutar onayı. `true` = kullanıcı onayladı.
Future<bool?> showBranchFeeSheet(BuildContext context, BranchFeeView view, {required String name, required String city}) {
  return showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _BranchFeeSheet(view: view, name: name, city: city),
  );
}

class _BranchFeeSheet extends StatefulWidget {
  const _BranchFeeSheet({required this.view, required this.name, required this.city});
  final BranchFeeView view;
  final String name;
  final String city;

  @override
  State<_BranchFeeSheet> createState() => _BranchFeeSheetState();
}

class _BranchFeeSheetState extends State<_BranchFeeSheet> {
  bool _ack = false;

  @override
  Widget build(BuildContext context) {
    final v = widget.view;
    final total = v.chargeTotal;
    final needsAck = total != null;
    final label = total == null
        ? 'Şube oluştur'
        : v.byInvoice
            ? '${CalendarText.tl(total)} faturayı onayla'
            : '${CalendarText.tl(total)} öde ve şube oluştur';
    return _SheetFrame(
      title: 'Yeni şube',
      subtitle: [widget.name, if (widget.city.isNotEmpty) widget.city].join(' · '),
      icon: Icons.store_mall_directory_rounded,
      actions: [
        TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Vazgeç')),
        FilledButton.icon(
          onPressed: needsAck && !_ack ? null : () => Navigator.pop(context, true),
          icon: Icon(total == null ? Icons.add_business_rounded : (v.byInvoice ? Icons.receipt_long_rounded : Icons.credit_card_rounded), size: 18),
          label: Text(label),
        ),
      ],
      children: [
        _FeeCard(view: v),
        if (needsAck) ...[
          const SizedBox(height: 12),
          InkWell(
            borderRadius: BorderRadius.circular(16),
            onTap: () => setState(() => _ack = !_ack),
            child: Container(
              padding: const EdgeInsets.fromLTRB(4, 6, 12, 6),
              decoration: BoxDecoration(
                color: const Color(0xFFFCF3F6),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: AppColors.primary.withValues(alpha: 0.3)),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Checkbox(value: _ack, activeColor: AppColors.primary, onChanged: (x) => setState(() => _ack = x == true)),
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.only(top: 12),
                      child: Text(
                        '${CalendarText.tl(total)} tutarındaki şube ücretini ve ücretime yansıyacak değişikliği okudum, onaylıyorum.',
                        style: const TextStyle(fontSize: 13, height: 1.4, color: Color(0xFF5A1730)),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ],
    );
  }
}

/// "Ücretinize etkisi" kartı: yeşil (para) bant + beyaz gövde.
class _FeeCard extends StatelessWidget {
  const _FeeCard({required this.view});
  final BranchFeeView view;

  @override
  Widget build(BuildContext context) {
    final v = view;
    const body = TextStyle(fontSize: 13.5, height: 1.45, color: AppColors.ink);
    const muted = TextStyle(fontSize: 12.5, height: 1.45, color: AppColors.muted);
    const strong = TextStyle(fontWeight: FontWeight.w700);
    const accent = TextStyle(fontWeight: FontWeight.w700, color: AppColors.primary);
    final next = '${v.branches + 1} şube';

    final List<Widget> lines;
    if (!v.hasImpact) {
      lines = [Text(v.reason ?? 'Paketiniz şube başına ücretlendirilmiyor; yeni şube ücretinizi değiştirmez.', style: muted)];
    } else {
      lines = [
        Text.rich(TextSpan(style: body, children: [
          TextSpan(text: 'Şube başı (${v.planName}): ', style: muted),
          TextSpan(text: '${listPrice(v.unitMonthly)} + KDV / ay', style: strong),
          TextSpan(text: ' · yıllıkta ${listPrice(v.unitYearly)} + KDV', style: muted),
        ])),
        const SizedBox(height: 10),
        _Well(children: [
          if (v.trial) ...[
            const Text.rich(TextSpan(style: body, children: [
              TextSpan(text: 'Deneme süresince ücretsiz. ', style: strong),
              TextSpan(text: 'Paket satın aldığınızda bu şube ücretinize yansır:'),
            ])),
            const SizedBox(height: 6),
            Text.rich(TextSpan(style: body, children: [
              const TextSpan(text: 'Aylık '),
              TextSpan(text: CalendarText.tl(v.currentMonthly), style: strong),
              const TextSpan(text: ' → '),
              TextSpan(text: CalendarText.tl(v.nextMonthly), style: accent),
              TextSpan(text: '  (KDV dahil, +${CalendarText.tl(v.nextMonthly - v.currentMonthly)})', style: muted),
            ])),
            Text('Yıllık ödemede ${CalendarText.tl(v.nextYearly)} (KDV dahil, $next)', style: muted),
          ] else if (v.chargeTotal != null) ...[
            Text.rich(TextSpan(style: body, children: [
              const TextSpan(text: 'Bugün '),
              TextSpan(text: CalendarText.tl(v.chargeTotal), style: accent),
              const TextSpan(text: ' (KDV dahil, dönem sonuna kadar orantılı) '),
              TextSpan(
                text: v.byInvoice
                    ? (v.payOnline
                        ? 'için fatura kesilir; şube, ödeme maydanozasist.com\'da alındığında açılır.'
                        : 'için fatura kesilir; şube, ödeme alındığında açılır.')
                    : 'kayıtlı kartınızdan${v.cardMasked != null ? ' (${v.cardMasked})' : ''} çekilir.',
              ),
            ])),
            const SizedBox(height: 6),
            Text.rich(TextSpan(style: muted, children: [
              TextSpan(text: 'Sonraki dönemden itibaren ${v.yearly ? 'yıllık' : 'aylık'} ücretiniz '),
              TextSpan(text: CalendarText.tl(v.nextPeriodTotal), style: const TextStyle(fontWeight: FontWeight.w700, color: AppColors.ink)),
              TextSpan(text: ' (KDV dahil, $next).'),
            ])),
          ] else ...[
            if (v.reason != null) ...[Text(v.reason!, style: body), const SizedBox(height: 6)],
            Text.rich(TextSpan(style: body, children: [
              TextSpan(text: '${v.yearly ? 'Yıllık' : 'Aylık'} ücretiniz '),
              TextSpan(text: CalendarText.tl(v.nextPeriodTotal), style: accent),
              TextSpan(text: ' olur (KDV dahil, $next).'),
            ])),
          ],
        ]),
      ];
    }

    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            color: AppColors.success,
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            child: const Row(children: [
              Icon(Icons.receipt_long_rounded, color: Colors.white, size: 18),
              SizedBox(width: 8),
              Text('Ücretinize etkisi', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 13)),
            ]),
          ),
          Padding(
            padding: const EdgeInsets.all(14),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: lines),
          ),
        ],
      ),
    );
  }
}

class _Well extends StatelessWidget {
  const _Well({required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: AppColors.surfaceSoft, borderRadius: BorderRadius.circular(14)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: children),
      );
}

/// Şube talebi faturalandı (ödemeden açılmaz). Fatura sitede ödenebiliyorsa (Maydanoz) "Faturayı öde" düğmesi
/// faturayı bulur ve maydanozasist.com ödeme sayfasını tarayıcıda açar. iOS'ta çağrılmaz (mağaza kuralı).
Future<void> showBranchAwaitingPaymentSheet(
  BuildContext context,
  ApiClient api, {
  required String message,
  required String branchName,
  required bool payOnline,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _AwaitingPaymentSheet(api: api, message: message, branchName: branchName, payOnline: payOnline),
  );
}

class _AwaitingPaymentSheet extends StatefulWidget {
  const _AwaitingPaymentSheet({required this.api, required this.message, required this.branchName, required this.payOnline});
  final ApiClient api;
  final String message;
  final String branchName;
  final bool payOnline;

  @override
  State<_AwaitingPaymentSheet> createState() => _AwaitingPaymentSheetState();
}

class _AwaitingPaymentSheetState extends State<_AwaitingPaymentSheet> {
  bool _paying = false;
  String? _error;

  Future<void> _pay() async {
    setState(() {
      _paying = true;
      _error = null;
    });
    try {
      final invoices = apiItems(await widget.api.get('/api/admin/billing/invoices'));
      if (!mounted) return;
      final invoice = findBranchInvoice(invoices, widget.message, widget.branchName);
      if (invoice == null) {
        setState(() => _error = 'Fatura bulunamadı. Paketim sayfasındaki faturalardan ödeyebilirsiniz.');
        return;
      }
      final started = await widget.api.post('/api/admin/billing/invoices/${invoice['id']}/pay', const {});
      final url = started is Map ? '${started['redirectUrl'] ?? ''}' : '';
      final opened = url.isNotEmpty && await launchUrlString(url, mode: LaunchMode.externalApplication);
      if (!mounted) return;
      if (!opened) {
        setState(() => _error = 'Ödeme sayfası açılamadı. Paketim sayfasındaki faturalardan ödeyebilirsiniz.');
        return;
      }
      Navigator.pop(context);
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _paying = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return _SheetFrame(
      title: 'Şube talebiniz alındı',
      subtitle: 'Şube, ödeme alındığında açılacak.',
      icon: Icons.mark_email_read_rounded,
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: Text(widget.payOnline ? 'Daha sonra' : 'Tamam')),
        if (widget.payOnline)
          FilledButton.icon(
            style: FilledButton.styleFrom(backgroundColor: AppColors.success),
            onPressed: _paying ? null : _pay,
            icon: _paying
                ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                : const Icon(Icons.credit_card_rounded, size: 18),
            label: const Text('Faturayı öde'),
          ),
      ],
      children: [
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: const Color(0xFFDFF3EA),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: AppColors.success.withValues(alpha: 0.25)),
          ),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Icon(Icons.check_circle_rounded, color: Color(0xFF15694A), size: 20),
            const SizedBox(width: 10),
            Expanded(child: Text(widget.message, style: const TextStyle(fontSize: 13.5, height: 1.45, color: Color(0xFF15694A)))),
          ]),
        ),
        const SizedBox(height: 12),
        Text(
          widget.payOnline
              ? 'Faturayı şimdi maydanozasist.com\'un güvenli ödeme sayfasında ödeyebilirsiniz. Daha sonra ödemek isterseniz Paketim → Faturalar bölümünde bekler.'
              : 'Faturanız Paketim → Faturalar bölümünde görünür; ödeme alındığında şube kendiliğinden açılır.',
          style: const TextStyle(fontSize: 12.5, height: 1.45, color: AppColors.muted),
        ),
        if (_error != null) ...[
          const SizedBox(height: 12),
          Text(_error!, style: const TextStyle(fontSize: 12.5, color: AppColors.danger)),
        ],
      ],
    );
  }
}

/// Ortak çerçeve: dolu marka rengi bant (beyaz yazı) + kayan gövde + sabit alt düğmeler.
class _SheetFrame extends StatelessWidget {
  const _SheetFrame({required this.title, required this.subtitle, required this.icon, required this.children, required this.actions});
  final String title;
  final String subtitle;
  final IconData icon;
  final List<Widget> children;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.of(context).viewPadding.bottom;
    return Container(
      constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.9),
      decoration: const BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            color: AppColors.primary,
            padding: const EdgeInsets.fromLTRB(20, 20, 20, 18),
            child: Row(children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: Colors.white.withValues(alpha: 0.25)),
                ),
                child: Icon(icon, color: Colors.white, size: 22),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(title, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w700)),
                  if (subtitle.isNotEmpty)
                    Text(subtitle, style: TextStyle(color: Colors.white.withValues(alpha: 0.85), fontSize: 12.5)),
                ]),
              ),
            ]),
          ),
          Flexible(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(20, 18, 20, 8),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children),
            ),
          ),
          Container(
            padding: EdgeInsets.fromLTRB(16, 10, 16, 12 + bottom),
            decoration: const BoxDecoration(
              color: AppColors.surfaceSoft,
              border: Border(top: BorderSide(color: AppColors.border)),
            ),
            child: Wrap(alignment: WrapAlignment.end, spacing: 8, runSpacing: 8, children: actions),
          ),
        ],
      ),
    );
  }
}

/// Şube silinince paket tutarı (web `lib/branchRemoval.ts` paritesi). Tutarlar sunucunun teklifinden: `current`
/// bugünkü şube sayısıyla, `next` bir eksikle. Yıllık pakette (sunucu bugünkü yıllığı da verdiyse) yıllık, öteki
/// durumlarda aylık. Şube başına olmayan pakette etki yok (null).
class BranchRemovalView {
  const BranchRemovalView({required this.headline, required this.current, required this.next, required this.branchesAfter, required this.note});

  final String headline;
  final double current;
  final double next;
  final int branchesAfter;
  final String note;

  static BranchRemovalView? from(Map<String, dynamic>? impact) {
    if (impact == null) return null;
    double total(dynamic quote) => quote is Map ? numberOf(quote.cast<String, dynamic>(), const ['total']).toDouble() : 0;
    final trial = impact['trial'] == true;
    final branches = numberOf(impact, const ['branches']).toInt();
    final yearly = impact['period'] == 'yearly' && impact['currentYearly'] is Map;
    return BranchRemovalView(
      headline: trial
          ? 'Deneme süresince ücret alınmaz. Paket satın aldığınızda aylık ücretiniz'
          : yearly
              ? 'Sonraki ödemenizden itibaren yıllık ücretiniz'
              : 'Sonraki ödemenizden itibaren aylık ücretiniz',
      current: total(yearly ? impact['currentYearly'] : impact['currentMonthly']),
      next: total(yearly ? impact['nextYearly'] : impact['nextMonthly']),
      branchesAfter: branches > 1 ? branches - 1 : 1,
      note: trial ? 'Silinen şube ilk ödemenizde hesaba katılmaz.' : 'Ödenmiş dönem için iade yapılmaz; yeni tutar bir sonraki ödemenizde geçerli olur.',
    );
  }
}

/// ŞUBE SİLME (web `BranchDeleteModal` paritesi, 18 Kas 2026). Kayıtlar SİLİNMEZ: şubenin müşteri, personel,
/// kullanıcı, randevu, satış ve diğer kayıtları seçilen şubeye aktarılır; şube ardından kaldırılır. Paket tutarı
/// sonraki ödemeden itibaren bir şube eksik hesaplanır. iOS (App Store 3.1.1): fiyat gösterilmez. Silindiyse true.
Future<bool> showBranchDeleteSheet(BuildContext context, ApiClient api, Map<String, dynamic> branch, List<Map<String, dynamic>> branches) async {
  final result = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _BranchDeleteSheet(api: api, branch: branch, branches: branches),
  );
  return result == true;
}

class _BranchDeleteSheet extends StatefulWidget {
  const _BranchDeleteSheet({required this.api, required this.branch, required this.branches});
  final ApiClient api;
  final Map<String, dynamic> branch;
  final List<Map<String, dynamic>> branches;

  @override
  State<_BranchDeleteSheet> createState() => _BranchDeleteSheetState();
}

class _BranchDeleteSheetState extends State<_BranchDeleteSheet> {
  Map<String, dynamic>? _preview;
  bool _loading = true;
  bool _busy = false;
  bool _ack = false;
  String? _target;
  String? _error;

  String get _id => '${widget.branch['id']}';

  List<Map<String, dynamic>> get _targets => widget.branches.where((b) => '${b['id']}' != _id).toList();

  @override
  void initState() {
    super.initState();
    final targets = _targets;
    final preferred = targets.where((b) => b['isDefault'] == true).toList();
    final fallback = preferred.isNotEmpty ? preferred.first : (targets.isNotEmpty ? targets.first : null);
    _target = fallback == null ? null : '${fallback['id']}';
    _load();
  }

  Future<void> _load() async {
    try {
      final data = await widget.api.get('/api/admin/branches/$_id/delete-preview');
      if (!mounted) return;
      setState(() {
        _preview = data is Map ? data.cast<String, dynamic>() : null;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e is ApiException ? e.message : 'Şube bilgisi alınamadı.';
      });
    }
  }

  Future<void> _delete() async {
    final target = _target;
    if (_busy || target == null || !_ack) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.api.delete('/api/admin/branches/$_id?targetBranchId=${Uri.encodeQueryComponent(target)}');
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = e is ApiException ? e.message : 'Şube silinemedi.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final name = '${widget.branch['name'] ?? 'Şube'}';
    final preview = _preview;
    final blocker = preview == null ? null : preview['blocker'] as String?;
    final impact = preview?['impact'];
    final removal = BranchRemovalView.from(impact is Map ? impact.cast<String, dynamic>() : null);
    final chosen = _targets.where((b) => '${b['id']}' == _target).toList();
    final targetName = chosen.isEmpty ? '' : '${chosen.first['name']}';
    int count(String key) => preview == null ? 0 : numberOf(preview, [key]).toInt();

    return _SheetFrame(
      title: '$name şubesini sil',
      subtitle: 'Kayıtlar silinmez; seçtiğiniz şubeye aktarılır.',
      icon: Icons.delete_outline_rounded,
      actions: [
        TextButton(onPressed: _busy ? null : () => Navigator.of(context).pop(false), child: const Text('Vazgeç')),
        if (preview != null && blocker == null)
          FilledButton.icon(
            style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
            onPressed: _busy || !_ack || _target == null ? null : _delete,
            icon: _busy
                ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                : const Icon(Icons.delete_outline_rounded),
            label: const Text('Şubeyi sil'),
          ),
      ],
      children: [
        if (_loading)
          const Padding(padding: EdgeInsets.symmetric(vertical: 24), child: Center(child: CircularProgressIndicator()))
        else if (preview == null)
          Text(_error ?? 'Şube bilgisi alınamadı.', style: const TextStyle(color: AppColors.muted))
        else if (blocker != null)
          _Well(children: [Text(blocker, style: const TextStyle(fontWeight: FontWeight.w600))])
        else ...[
          const Text('Aktarılacak kayıtlar', style: TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          _Well(children: [
            Text('Müşteri: ${count('customers')} · Aktif personel: ${count('staff')} · Kullanıcı: ${count('users')}'),
            const SizedBox(height: 4),
            Text('Randevu: ${count('appointments')} (${count('upcomingAppointments')} yaklaşan) · Adisyon: ${count('sales')}'),
            const SizedBox(height: 6),
            const Text('Kasa, cari, ürün ve geçmiş kayıtlar dahil hiçbir kayıt silinmez.', style: TextStyle(color: AppColors.muted, fontSize: 12)),
          ]),
          const SizedBox(height: 14),
          DropdownButtonFormField<String>(
            initialValue: _target,
            decoration: const InputDecoration(labelText: 'Kayıtların aktarılacağı şube'),
            items: [
              for (final b in _targets)
                DropdownMenuItem(value: '${b['id']}', child: Text('${b['name']}${b['isDefault'] == true ? ' (varsayılan)' : ''}')),
            ],
            onChanged: _busy ? null : (value) => setState(() => _target = value),
          ),
          if (!StorePolicy.hidesPurchaseFlows) ...[
            const SizedBox(height: 14),
            _Well(children: [
              const Text('Ücretinize etkisi', style: TextStyle(fontWeight: FontWeight.w700, color: AppColors.success)),
              const SizedBox(height: 6),
              if (removal == null)
                const Text('Paketiniz şube başına ücretlendirilmiyor; şube silmek ücretinizi değiştirmez.')
              else ...[
                Text('${removal.headline} ${CalendarText.tl(removal.current)} → ${CalendarText.tl(removal.next)} (KDV dahil, ${removal.branchesAfter} şube)'),
                const SizedBox(height: 4),
                Text(removal.note, style: const TextStyle(color: AppColors.muted, fontSize: 12)),
              ],
            ]),
          ],
          const SizedBox(height: 10),
          CheckboxListTile(
            value: _ack,
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
            onChanged: _busy ? null : (value) => setState(() => _ack = value == true),
            title: Text('$name şubesinin silineceğini ve bütün kayıtlarının $targetName şubesine aktarılacağını anladım.', style: const TextStyle(fontSize: 13)),
          ),
          if (_error != null) Text(_error!, style: const TextStyle(color: AppColors.danger)),
        ],
      ],
    );
  }
}
