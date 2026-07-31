import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/theme/app_theme.dart';
import '../../shared/json_helpers.dart';
import '../appointments/calendar_theme.dart';

/// MÜŞTERİ İŞLEM DEFTERİ — web `CustomerOperationsJournal` paritesi.
///
/// Mobilde yalnızca kapanmış adisyonlar listeleniyordu; hangi hizmetin ne zaman yapıldığı,
/// hangi tahsilatın hangi güne düştüğü tek akışta görünmüyordu. Burada adisyon KALEMLERİ
/// (satış/tahsilat/paket/indirim) ve TAMAMLANMIŞ RANDEVULAR tek kronolojik akışta birleşir;
/// gün/hafta/ay süzgeci ve dönem toplamları vardır.
class OperationsJournal extends StatefulWidget {
  const OperationsJournal({
    required this.adisyonlar,
    required this.appointments,
    required this.customerId,
    this.onOpenAdisyon,
    super.key,
  });

  /// Bu müşterinin iptal olmayan adisyonları (kalemleriyle birlikte).
  final List<Map<String, dynamic>> adisyonlar;

  /// Müşterinin randevuları — yalnız "Completed" olanlar seans satırı olur.
  final List<Map<String, dynamic>> appointments;
  final String customerId;
  final void Function(String adisyonId)? onOpenAdisyon;

  @override
  State<OperationsJournal> createState() => _OperationsJournalState();
}

enum _Gran { day, week, month }

const _granLabels = <_Gran, String>{
  _Gran.day: 'Gün',
  _Gran.week: 'Hafta',
  _Gran.month: 'Ay',
};

/// İşlem tipi → etiket + renk (web OP_META).
const _opMeta = <String, (String, Color)>{
  'Service': ('Hizmet', Color(0xFF0284C7)),
  'Product': ('Ürün', Color(0xFF7C3AED)),
  'PackageUse': ('Paketten', Color(0xFFB45309)),
  'Extra': ('Ek kalem', Color(0xFF475569)),
  'Payment': ('Tahsilat', Color(0xFF059669)),
  'Discount': ('İndirim', Color(0xFFE11D48)),
  'PackageSale': ('Paket satışı', Color(0xFFC026D3)),
  'Session': ('Seans', Color(0xFF0D9488)),
};

class _JournalRow {
  const _JournalRow({
    required this.at,
    required this.kind,
    required this.desc,
    required this.amount,
    required this.covered,
    this.staff,
    this.adisyonId,
  });
  final DateTime at;
  final String kind;
  final String desc;
  final double amount;

  /// Paketten karşılanan kalem borç yazmaz — dönem toplamına girmez.
  final bool covered;
  final String? staff;
  final String? adisyonId;
}

class _OperationsJournalState extends State<OperationsJournal> {
  _Gran _gran = _Gran.month;
  int _offset = 0;

  /// Tüm satırlar (süzgeçten önce), en yeni önce.
  List<_JournalRow> get _allRows {
    final rows = <_JournalRow>[];

    for (final a in widget.adisyonlar) {
      if ('${a['status']}' == 'Cancelled') continue;
      final fallback = parseUtcToLocal(a['approvedAtUtc']) ??
          parseUtcToLocal(a['openedAtUtc']) ??
          parseUtcToLocal(a['createdAtUtc']);
      for (final raw in (a['items'] as List? ?? const [])) {
        if (raw is! Map) continue;
        final it = raw.cast<String, dynamic>();
        final at = parseUtcToLocal(it['createdAtUtc']) ?? fallback;
        if (at == null) continue;
        rows.add(_JournalRow(
          at: at,
          kind: '${it['type']}',
          desc: valueOf(it, const ['description'], fallback: 'İşlem'),
          amount: numberOf(it, const ['lineTotal']),
          covered: it['coveredByPackage'] == true,
          staff: valueOf(it, const ['staffName'], fallback: '').trim().isEmpty
              ? null
              : valueOf(it, const ['staffName']),
          adisyonId: '${a['id']}',
        ));
      }
    }

    // Tamamlanmış randevu = "müşteri seansa geldi" olayı.
    for (final ap in widget.appointments) {
      if ('${ap['status']}' != 'Completed') continue;
      final at = parseUtcToLocal(ap['startUtc']);
      if (at == null) continue;
      rows.add(_JournalRow(
        at: at,
        kind: 'Session',
        desc: valueOf(ap, const ['serviceName'], fallback: 'Seans'),
        amount: numberOf(ap, const ['price']),
        covered: false,
        staff: valueOf(ap, const ['staffName'], fallback: '').trim().isEmpty
            ? null
            : valueOf(ap, const ['staffName']),
      ));
    }

    rows.sort((x, y) => y.at.compareTo(x.at));
    return rows;
  }

  /// Seçili dönemin [başlangıç, bitiş) aralığı ve etiketi.
  (DateTime, DateTime, String) get _window {
    final now = DateTime.now();
    switch (_gran) {
      case _Gran.day:
        final start = DateTime(now.year, now.month, now.day + _offset);
        return (
          start,
          start.add(const Duration(days: 1)),
          DateFormat('d MMMM yyyy', 'tr_TR').format(start),
        );
      case _Gran.week:
        final today = DateTime(now.year, now.month, now.day);
        final monday = today.subtract(Duration(days: today.weekday - 1));
        final start = monday.add(Duration(days: _offset * 7));
        final end = start.add(const Duration(days: 7));
        final last = end.subtract(const Duration(days: 1));
        return (
          start,
          end,
          '${DateFormat('d MMM', 'tr_TR').format(start)} – ${DateFormat('d MMM', 'tr_TR').format(last)}',
        );
      case _Gran.month:
        final start = DateTime(now.year, now.month + _offset, 1);
        final end = DateTime(start.year, start.month + 1, 1);
        return (start, end, DateFormat('MMMM yyyy', 'tr_TR').format(start));
    }
  }

  @override
  Widget build(BuildContext context) {
    final (start, end, label) = _window;
    final rows = _allRows
        .where((r) => !r.at.isBefore(start) && r.at.isBefore(end))
        .toList();

    // Dönem özeti: tahsil edilen ve borçlandırılan (indirim düşer, paketten karşılanan girmez).
    var collected = 0.0;
    var charged = 0.0;
    for (final r in rows) {
      if (r.kind == 'Payment') {
        collected += r.amount;
      } else if (r.kind == 'Discount') {
        charged -= r.amount;
      } else if (!r.covered &&
          (r.kind == 'Service' ||
              r.kind == 'Product' ||
              r.kind == 'Extra' ||
              r.kind == 'PackageSale')) {
        charged += r.amount;
      }
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Dönem seçici + ileri/geri
        Row(
          children: [
            Container(
              padding: const EdgeInsets.all(3),
              decoration: BoxDecoration(
                color: AppColors.surfaceSoft,
                borderRadius: BorderRadius.circular(999),
                border: Border.all(color: AppColors.border),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  for (final g in _Gran.values)
                    GestureDetector(
                      onTap: () => setState(() {
                        _gran = g;
                        _offset = 0; // dönem tipi değişince bugüne dön
                      }),
                      child: AnimatedContainer(
                        duration: const Duration(milliseconds: 160),
                        padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 5),
                        decoration: BoxDecoration(
                          color: _gran == g ? AppColors.primary : Colors.transparent,
                          borderRadius: BorderRadius.circular(999),
                        ),
                        child: Text(
                          _granLabels[g]!,
                          style: TextStyle(
                            fontSize: 11.5,
                            fontWeight: FontWeight.w800,
                            color: _gran == g ? Colors.white : AppColors.muted,
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
            const Spacer(),
            IconButton(
              visualDensity: VisualDensity.compact,
              onPressed: () => setState(() => _offset--),
              icon: const Icon(Icons.chevron_left_rounded, size: 20),
            ),
            // Bugüne dönüş: etikete dokunmak offset'i sıfırlar.
            GestureDetector(
              onTap: _offset == 0 ? null : () => setState(() => _offset = 0),
              child: Text(label,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: _offset == 0 ? AppColors.ink : AppColors.primaryDark,
                  )),
            ),
            IconButton(
              visualDensity: VisualDensity.compact,
              // Geleceğe gitmenin anlamı yok — bugünün ötesine kapalı.
              onPressed: _offset >= 0 ? null : () => setState(() => _offset++),
              icon: const Icon(Icons.chevron_right_rounded, size: 20),
            ),
          ],
        ),
        const SizedBox(height: 10),

        // Dönem toplamları
        Row(
          children: [
            _total('İşlem', '${rows.length}', AppColors.ink),
            const SizedBox(width: 8),
            _total('Borç', CalendarText.tl(charged), AppColors.primaryDark),
            const SizedBox(width: 8),
            _total('Tahsilat', CalendarText.tl(collected), AppColors.success),
          ],
        ),
        const SizedBox(height: 12),

        if (rows.isEmpty)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(vertical: 26, horizontal: 14),
            decoration: BoxDecoration(
              color: AppColors.surfaceSoft.withValues(alpha: .45),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppColors.border),
            ),
            child: const Text('Bu dönemde işlem yok.',
                textAlign: TextAlign.center,
                style: TextStyle(color: AppColors.muted, fontSize: 12.5)),
          )
        else
          for (final r in rows) _row(r),
      ],
    );
  }

  Widget _total(String label, String value, Color tone) => Expanded(
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 10),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppColors.border),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(value,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                      fontWeight: FontWeight.w900, fontSize: 13.5, color: tone)),
              Text(label,
                  style: const TextStyle(fontSize: 10.5, color: AppColors.muted)),
            ],
          ),
        ),
      );

  Widget _row(_JournalRow r) {
    final meta = _opMeta[r.kind] ?? ('İşlem', AppColors.muted);
    final isPayment = r.kind == 'Payment';
    final isDiscount = r.kind == 'Discount';

    final content = Container(
      margin: const EdgeInsets.only(bottom: 7),
      padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 10),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          // Gün rozeti
          SizedBox(
            width: 42,
            child: Column(
              children: [
                Text('${r.at.day}',
                    style: const TextStyle(
                        fontWeight: FontWeight.w800, fontSize: 13, height: 1)),
                Text(DateFormat('MMM', 'tr_TR').format(r.at),
                    style: const TextStyle(fontSize: 9, color: AppColors.muted)),
                Text(DateFormat('HH:mm').format(r.at),
                    style: const TextStyle(fontSize: 8.5, color: AppColors.muted)),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: meta.$2.withValues(alpha: .12),
                        borderRadius: BorderRadius.circular(999),
                      ),
                      child: Text(meta.$1,
                          style: TextStyle(
                              fontSize: 9.5,
                              fontWeight: FontWeight.w800,
                              color: meta.$2)),
                    ),
                    if (r.covered) ...[
                      const SizedBox(width: 4),
                      const Text('paketten',
                          style: TextStyle(fontSize: 9, color: AppColors.muted)),
                    ],
                  ],
                ),
                const SizedBox(height: 3),
                Text(r.desc,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600)),
                if (r.staff != null)
                  Text(r.staff!,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 10.5, color: AppColors.muted)),
              ],
            ),
          ),
          const SizedBox(width: 6),
          Text(
            '${isPayment ? '+' : isDiscount ? '−' : ''}${CalendarText.tl(r.amount)}',
            style: TextStyle(
              fontWeight: FontWeight.w800,
              fontSize: 12.5,
              color: isPayment
                  ? AppColors.success
                  : isDiscount
                      ? AppColors.danger
                      : AppColors.ink,
            ),
          ),
        ],
      ),
    );

    if (r.adisyonId == null || widget.onOpenAdisyon == null) return content;
    return InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: () => widget.onOpenAdisyon!(r.adisyonId!),
      child: content,
    );
  }
}
