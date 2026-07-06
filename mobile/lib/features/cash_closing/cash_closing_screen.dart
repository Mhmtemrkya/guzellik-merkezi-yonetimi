import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';

import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/json_helpers.dart';
import '../../shared/widgets/app_background.dart';
import '../../shared/widgets/page_header.dart';
import '../appointments/calendar_theme.dart';

/// Gün Sonu Kasa Kapanışı (Z Raporu) — web `kasa-kapanis` sayfasının mobil
/// karşılığı.
///
/// Seçilen gün için önizleme (nakit tahsilat/gider/önerilen açılış) sunucudan
/// gelir; kullanıcı açılış + sayılan nakdi girince **sistem nakdi** ve **fark**
/// canlı hesaplanır. Altında günün nakit hareketleri + geçmiş kapanışlar.
class CashClosingScreen extends StatefulWidget {
  const CashClosingScreen({required this.api, super.key});
  final ApiClient api;

  @override
  State<CashClosingScreen> createState() => _CashClosingScreenState();
}

const _gold = Color(0xFF9A6F22);

class _CashClosingScreenState extends State<CashClosingScreen> {
  DateTime _businessDate = DateTime.now();
  final _opening = TextEditingController();
  final _counted = TextEditingController();
  final _note = TextEditingController();
  bool _busy = false;
  String? _error;
  late Future<_CcData> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  @override
  void dispose() {
    _opening.dispose();
    _counted.dispose();
    _note.dispose();
    super.dispose();
  }

  ({String from, String to}) _dayRange(DateTime d) {
    final start = DateTime(d.year, d.month, d.day);
    final end = start.add(const Duration(days: 1));
    return (
      from: start.toUtc().toIso8601String(),
      to: end.toUtc().toIso8601String()
    );
  }

  Future<_CcData> _load() async {
    final range = _dayRange(_businessDate);
    final dateStr = DateFormat('yyyy-MM-dd').format(_businessDate);
    final results = await Future.wait<dynamic>([
      widget.api
          .get('/api/admin/cash/closing/preview', query: {
            'businessDate': dateStr,
            'fromUtc': range.from,
            'toUtc': range.to,
          })
          .catchError((_) => const <String, dynamic>{}),
      widget.api
          .get('/api/admin/cash-flow/',
              query: {'fromUtc': range.from, 'toUtc': range.to})
          .catchError((_) => const <dynamic>[]),
      widget.api
          .get('/api/admin/cash/closing/')
          .catchError((_) => const <dynamic>[]),
    ]);
    final preview = results[0] is Map
        ? (results[0] as Map).cast<String, dynamic>()
        : <String, dynamic>{};
    final cashEntries =
        apiItems(results[1]).where((e) => _isCash(e['method'])).toList();
    final closings = apiItems(results[2]);
    return _CcData(preview: preview, cashEntries: cashEntries, closings: closings);
  }

  Future<void> _reload() async {
    setState(() {
      _future = _load();
    });
    await _future;
  }

  bool _isCash(dynamic m) {
    if (m is num) return m.toInt() == 0;
    final s = '$m'.toLowerCase();
    return s.startsWith('cash') || s == 'nakit';
  }

  double _parse(String s) =>
      double.tryParse(s.trim().replaceAll(',', '.')) ?? 0;

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _businessDate,
      firstDate: DateTime(2020),
      lastDate: DateTime.now().add(const Duration(days: 1)),
    );
    if (picked != null) {
      setState(() => _businessDate = picked);
      await _reload();
    }
  }

  Future<void> _save(double opening, double counted) async {
    if (_counted.text.trim().isEmpty) {
      setState(() => _error = 'Sayılan nakdi girin.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final range = _dayRange(_businessDate);
      await widget.api.post('/api/admin/cash/closing/', {
        'businessDate': DateFormat('yyyy-MM-dd').format(_businessDate),
        'fromUtc': range.from,
        'toUtc': range.to,
        'openingBalance': opening,
        'countedCash': counted,
        'note': _note.text.trim().isEmpty ? null : _note.text.trim(),
        'branchId': widget.api.auth?.user?.branchId,
      });
      _counted.clear();
      _note.clear();
      _opening.clear();
      await _reload();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Kasa kapanışı kaydedildi.')));
      }
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _delete(Map<String, dynamic> c) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Sil'),
        content: const Text('Bu kasa kapanışı kaydını silmek istiyor musunuz?'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Vazgeç')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Sil'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    setState(() => _busy = true);
    try {
      await widget.api.delete('/api/admin/cash/closing/${c['id']}');
      await _reload();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$e')));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
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
            child: FutureBuilder<_CcData>(
              future: _future,
              builder: (context, snapshot) {
                final data = snapshot.data ??
                    const _CcData(preview: {}, cashEntries: [], closings: []);
                final loading =
                    snapshot.connectionState != ConnectionState.done &&
                        !snapshot.hasData;
                final p = data.preview;
                final cashIncome = (p['cashIncome'] as num?)?.toDouble() ?? 0;
                final cashExpense = (p['cashExpense'] as num?)?.toDouble() ?? 0;
                final suggestedOpening =
                    (p['suggestedOpening'] as num?)?.toDouble() ?? 0;
                final alreadyClosed = p['alreadyClosed'] == true;
                final opening = _opening.text.trim().isEmpty
                    ? suggestedOpening
                    : _parse(_opening.text);
                final systemCash = opening + cashIncome - cashExpense;
                final hasCounted = _counted.text.trim().isNotEmpty;
                final counted = _parse(_counted.text);
                final difference = counted - systemCash;

                return ListView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.fromLTRB(16, 20, 16, 110),
                  children: [
                    const PageHeader(
                      eyebrow: 'Finans',
                      title: 'Gün Sonu Kasa Kapanışı',
                      subtitle: 'Gün sonu nakit mutabakatı — Z raporu.',
                    ),
                    const SizedBox(height: 14),
                    _zChip(),
                    const SizedBox(height: 14),
                    _closingCard(
                      cashIncome: cashIncome,
                      cashExpense: cashExpense,
                      suggestedOpening: suggestedOpening,
                      opening: opening,
                      systemCash: systemCash,
                      hasCounted: hasCounted,
                      difference: difference,
                      alreadyClosed: alreadyClosed,
                      counted: counted,
                      loading: loading,
                    ),
                    const SizedBox(height: 14),
                    _infoCard(suggestedOpening),
                    if (data.cashEntries.isNotEmpty) ...[
                      const SizedBox(height: 14),
                      _cashFlowCard(data.cashEntries),
                    ],
                    const SizedBox(height: 14),
                    _historyCard(data.closings),
                  ],
                );
              },
            ),
          ),
        ),
      ),
    );
  }

  Widget _zChip() => Row(
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 5),
            decoration: BoxDecoration(
              color: const Color(0xFFFBF3E6),
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: const Color(0xFFE7CFA6)),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.workspace_premium_rounded, size: 13, color: _gold),
                const SizedBox(width: 5),
                Text('Z RAPORU',
                    style: TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 1.4,
                        color: _gold)),
              ],
            ),
          ),
          const SizedBox(width: 8),
          const Expanded(
            child: Text('Gün sonu nakit mutabakatı',
                style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: AppColors.muted)),
          ),
        ],
      );

  Widget _closingCard({
    required double cashIncome,
    required double cashExpense,
    required double suggestedOpening,
    required double opening,
    required double systemCash,
    required bool hasCounted,
    required double difference,
    required bool alreadyClosed,
    required double counted,
    required bool loading,
  }) {
    return _card(
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
                  color: AppColors.primary.withValues(alpha: .12),
                  shape: BoxShape.circle,
                ),
                child: const Icon(Icons.event_available_rounded,
                    size: 18, color: AppColors.primaryDark),
              ),
              const SizedBox(width: 10),
              const Text('Kapanış (Z Raporu)',
                  style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800)),
              if (loading) ...[
                const Spacer(),
                const SizedBox.square(
                    dimension: 16,
                    child: CircularProgressIndicator(strokeWidth: 2)),
              ],
            ],
          ),
          const SizedBox(height: 14),
          // İş günü + açılış
          Row(
            children: [
              Expanded(
                child: InkWell(
                  borderRadius: BorderRadius.circular(12),
                  onTap: _pickDate,
                  child: InputDecorator(
                    decoration: const InputDecoration(
                      labelText: 'İş günü',
                      isDense: true,
                      suffixIcon: Icon(Icons.calendar_today_rounded, size: 17),
                    ),
                    child: Text(
                        DateFormat('d MMM yyyy', 'tr_TR').format(_businessDate)),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: TextField(
                  controller: _opening,
                  keyboardType:
                      const TextInputType.numberWithOptions(decimal: true),
                  inputFormatters: [
                    FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]'))
                  ],
                  onChanged: (_) => setState(() {}),
                  decoration: InputDecoration(
                    labelText: 'Açılış (devir)',
                    isDense: true,
                    prefixText: '₺ ',
                    hintText: _trimNum(suggestedOpening),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          // Makbuz / döküm
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: AppColors.surfaceSoft.withValues(alpha: .5),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: AppColors.border),
            ),
            child: Column(
              children: [
                _receiptRow(Icons.account_balance_wallet_rounded,
                    'Açılış (devir)', opening, AppColors.ink),
                _dashed(),
                _receiptRow(Icons.arrow_upward_rounded,
                    '+ Günün nakit tahsilatı', cashIncome, AppColors.success),
                _receiptRow(Icons.arrow_downward_rounded,
                    '− Günün nakit gideri', cashExpense, AppColors.danger),
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 8),
                  child: Divider(height: 1, thickness: 1.4, color: AppColors.border),
                ),
                _receiptRow(Icons.calculate_rounded, '= Sistem nakdi (beklenen)',
                    systemCash, _gold,
                    bold: true),
              ],
            ),
          ),
          const SizedBox(height: 16),
          // Sayılan fiziki nakit
          const Text('Sayılan fiziki nakit ₺ *',
              style: TextStyle(fontSize: 13, fontWeight: FontWeight.w800)),
          const SizedBox(height: 8),
          TextField(
            controller: _counted,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            inputFormatters: [
              FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]'))
            ],
            onChanged: (_) => setState(() {}),
            style: const TextStyle(
                fontSize: 22, fontWeight: FontWeight.w800, color: AppColors.ink),
            decoration: InputDecoration(
              prefixText: '₺ ',
              prefixStyle: const TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.w800,
                  color: AppColors.primary),
              hintText: 'kasada saydığın tutar',
              hintStyle: const TextStyle(
                  fontSize: 14, fontWeight: FontWeight.w500, color: AppColors.muted),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(14),
                borderSide:
                    const BorderSide(color: Color(0xFFF3B6C8), width: 1.6),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(14),
                borderSide: const BorderSide(color: AppColors.primary, width: 2),
              ),
            ),
          ),
          // Fark banner
          if (hasCounted) ...[
            const SizedBox(height: 12),
            _diffBanner(difference),
          ],
          const SizedBox(height: 12),
          TextField(
            controller: _note,
            decoration: const InputDecoration(
              labelText: 'Not (ops.)',
              isDense: true,
              hintText: 'örn. 50₺ bozuk para eksik',
            ),
          ),
          if (alreadyClosed) ...[
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: AppColors.warning.withValues(alpha: .1),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: AppColors.warning.withValues(alpha: .3)),
              ),
              child: const Text(
                'Bu gün zaten kapatılmış — kaydetmek mevcut kaydı günceller.',
                style: TextStyle(color: AppColors.warning, fontSize: 11.5),
              ),
            ),
          ],
          if (_error != null) ...[
            const SizedBox(height: 10),
            Text(_error!,
                style: const TextStyle(color: AppColors.danger, fontSize: 12.5)),
          ],
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: _busy ? null : () => _save(opening, counted),
              icon: _busy
                  ? const SizedBox.square(
                      dimension: 16,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: Colors.white))
                  : const Icon(Icons.lock_rounded, size: 18),
              label: Text(alreadyClosed ? 'Güncelle' : 'Günü kapat'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _receiptRow(IconData icon, String label, double value, Color color,
      {bool bold = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          Icon(icon, size: 15, color: color),
          const SizedBox(width: 6),
          Expanded(
            child: Text(label,
                style: TextStyle(
                    fontSize: bold ? 14 : 13,
                    fontWeight: bold ? FontWeight.w800 : FontWeight.w600,
                    color: color)),
          ),
          Text(CalendarText.tl(value),
              style: TextStyle(
                  fontSize: bold ? 15 : 13,
                  fontWeight: FontWeight.w800,
                  color: color)),
        ],
      ),
    );
  }

  Widget _dashed() => const Padding(
        padding: EdgeInsets.symmetric(vertical: 6),
        child: DottedLine(),
      );

  Widget _diffBanner(double diff) {
    final (label, color, icon) = diff == 0
        ? ('Kasa tuttu', AppColors.success, Icons.check_circle_rounded)
        : diff > 0
            ? ('Kasa fazlası', AppColors.warning, Icons.trending_up_rounded)
            : ('Kasa eksiği', AppColors.danger, Icons.trending_down_rounded);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: color.withValues(alpha: .1),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: color.withValues(alpha: .35)),
      ),
      child: Row(
        children: [
          Icon(icon, size: 20, color: color),
          const SizedBox(width: 8),
          Text(label,
              style: TextStyle(
                  fontSize: 14.5, fontWeight: FontWeight.w800, color: color)),
          const Spacer(),
          Text('Fark: ${diff > 0 ? '+' : ''}${CalendarText.tl(diff)}',
              style: TextStyle(
                  fontSize: 16, fontWeight: FontWeight.w900, color: color)),
        ],
      ),
    );
  }

  Widget _infoCard(double suggestedOpening) {
    const bullets = [
      'Sistem, seçtiğin günün nakit tahsilat ve giderini kasadan otomatik hesaplar.',
      'Sen yalnızca kasadaki fiziki parayı sayıp girersin; fark anında çıkar.',
      'Açılış (devir) bir önceki günün sayımından otomatik önerilir.',
      'Yalnızca nakit hesaba katılır; kart/havale kasada para olmadığı için hariç tutulur.',
    ];
    return _card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: const [
              Icon(Icons.help_outline_rounded, size: 17, color: AppColors.primary),
              SizedBox(width: 7),
              Text('Nasıl çalışır?',
                  style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800)),
            ],
          ),
          const SizedBox(height: 12),
          for (final b in bullets)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(Icons.check_circle_rounded,
                      size: 16, color: AppColors.success),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(b,
                        style: const TextStyle(
                            fontSize: 12.5, height: 1.4, color: AppColors.ink)),
                  ),
                ],
              ),
            ),
          const SizedBox(height: 8),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [Color(0xFFFDF1EA), Color(0xFFFBF3E6)],
              ),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: const Color(0xFFF3D9CF)),
            ),
            child: Column(
              children: [
                Text('ÖNERİLEN AÇILIŞ (DEVİR)',
                    style: TextStyle(
                        fontSize: 9.5,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 1.2,
                        color: _gold)),
                const SizedBox(height: 4),
                Text(CalendarText.tl(suggestedOpening),
                    style: const TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.w900,
                        color: Color(0xFFB06A26))),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _cashFlowCard(List<Map<String, dynamic>> entries) {
    return _card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.receipt_long_rounded, size: 17, color: AppColors.primary),
              const SizedBox(width: 7),
              const Text('Günün nakit hareketleri',
                  style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800)),
              const SizedBox(width: 6),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                decoration: BoxDecoration(
                    color: AppColors.surfaceSoft,
                    borderRadius: BorderRadius.circular(20)),
                child: Text('${entries.length} kayıt',
                    style: const TextStyle(
                        fontSize: 9.5,
                        fontWeight: FontWeight.w700,
                        color: AppColors.muted)),
              ),
            ],
          ),
          const SizedBox(height: 10),
          for (final e in entries) _cashFlowRow(e),
        ],
      ),
    );
  }

  Widget _cashFlowRow(Map<String, dynamic> e) {
    final income = '${e['type']}'.toLowerCase() == 'income' || e['type'] == 0;
    final when = parseUtcToLocal(e['occurredAtUtc']);
    final amount = (e['amount'] as num?)?.toDouble() ?? 0;
    final desc = valueOf(e, const ['description', 'category'],
        fallback: income ? 'Tahsilat' : 'Gider');
    final customer = '${e['customerName'] ?? ''}'.trim();
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(
                color: income ? AppColors.success : AppColors.danger,
                shape: BoxShape.circle),
          ),
          const SizedBox(width: 8),
          if (when != null)
            Text(CalendarText.hm(when),
                style: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    color: AppColors.muted)),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
                customer.isEmpty ? desc : '$desc · $customer',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 12.5, color: AppColors.ink)),
          ),
          Text('${income ? '+' : '−'}${CalendarText.tl(amount)}',
              style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w800,
                  color: income ? AppColors.success : AppColors.danger)),
        ],
      ),
    );
  }

  Widget _historyCard(List<Map<String, dynamic>> closings) {
    return _card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: const [
              Icon(Icons.history_rounded, size: 17, color: AppColors.primary),
              SizedBox(width: 7),
              Text('Geçmiş kapanışlar',
                  style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800)),
            ],
          ),
          const SizedBox(height: 12),
          if (closings.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 16),
              child: Center(
                  child: Text('Henüz kasa kapanışı yapılmadı.',
                      style: TextStyle(color: AppColors.muted, fontSize: 13))),
            )
          else
            for (final c in closings) _historyRow(c),
        ],
      ),
    );
  }

  Widget _historyRow(Map<String, dynamic> c) {
    final diff = (c['difference'] as num?)?.toDouble() ?? 0;
    final (color) = diff == 0
        ? AppColors.success
        : diff > 0
            ? AppColors.warning
            : AppColors.danger;
    final date = DateTime.tryParse('${c['businessDate']}');
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surfaceSoft.withValues(alpha: .45),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(
                  date != null
                      ? DateFormat('d MMM yyyy', 'tr_TR').format(date)
                      : '${c['businessDate'] ?? '—'}',
                  style: const TextStyle(
                      fontWeight: FontWeight.w800, fontSize: 13.5)),
              const Spacer(),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                    color: color.withValues(alpha: .12),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: color.withValues(alpha: .3))),
                child: Text(
                    'Fark ${diff > 0 ? '+' : ''}${CalendarText.tl(diff)}',
                    style: TextStyle(
                        fontSize: 10.5,
                        fontWeight: FontWeight.w800,
                        color: color)),
              ),
              IconButton(
                visualDensity: VisualDensity.compact,
                onPressed: _busy ? null : () => _delete(c),
                icon: const Icon(Icons.delete_outline_rounded,
                    size: 18, color: AppColors.danger),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Wrap(
            spacing: 16,
            runSpacing: 6,
            children: [
              _histCell('Açılış', (c['openingBalance'] as num?)?.toDouble() ?? 0,
                  AppColors.ink),
              _histCell('Nakit gelir',
                  (c['cashIncome'] as num?)?.toDouble() ?? 0, AppColors.success),
              _histCell('Nakit gider',
                  (c['cashExpense'] as num?)?.toDouble() ?? 0, AppColors.danger),
              _histCell('Sistem', (c['systemCash'] as num?)?.toDouble() ?? 0,
                  AppColors.ink),
              _histCell('Sayılan', (c['countedCash'] as num?)?.toDouble() ?? 0,
                  AppColors.primaryDark),
            ],
          ),
        ],
      ),
    );
  }

  Widget _histCell(String label, double value, Color color) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label,
              style: const TextStyle(fontSize: 9.5, color: AppColors.muted)),
          Text(CalendarText.tl(value),
              style: TextStyle(
                  fontSize: 12.5, fontWeight: FontWeight.w700, color: color)),
        ],
      );

  Widget _card({required Widget child}) => Container(
        width: double.infinity,
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: AppColors.border),
          boxShadow: [
            BoxShadow(
              color: AppColors.primaryDark.withValues(alpha: .04),
              blurRadius: 24,
              offset: const Offset(0, 12),
            ),
          ],
        ),
        child: child,
      );

  String _trimNum(double v) =>
      v == v.roundToDouble() ? '${v.toInt()}' : '$v';
}

class _CcData {
  const _CcData({
    required this.preview,
    required this.cashEntries,
    required this.closings,
  });
  final Map<String, dynamic> preview;
  final List<Map<String, dynamic>> cashEntries;
  final List<Map<String, dynamic>> closings;
}

/// Makbuzdaki kesik çizgi.
class DottedLine extends StatelessWidget {
  const DottedLine({super.key});
  @override
  Widget build(BuildContext context) => LayoutBuilder(
        builder: (context, constraints) {
          const dashW = 4.0;
          final count = (constraints.maxWidth / (dashW * 2)).floor();
          return Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: List.generate(
              count,
              (_) => Container(
                width: dashW,
                height: 1,
                color: AppColors.border,
              ),
            ),
          );
        },
      );
}
