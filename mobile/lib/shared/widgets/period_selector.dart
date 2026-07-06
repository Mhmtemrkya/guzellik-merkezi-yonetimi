import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/theme/app_theme.dart';

/// Veri aralığı: gün / hafta / ay / yıl / özel tarih aralığı.
enum PeriodKind { day, week, month, year, custom }

/// Seçili dönem değeri (tür + çapa tarih + özel aralık). Değişmezdir.
class PeriodValue {
  const PeriodValue({this.kind = PeriodKind.day, required this.anchor, this.custom});

  factory PeriodValue.today() => PeriodValue(anchor: DateTime.now());

  final PeriodKind kind;
  final DateTime anchor;
  final DateTimeRange? custom;

  bool get canShift => kind != PeriodKind.custom;

  /// [başlangıç, bitiş) yerel tarih aralığı (bitiş hariç).
  ({DateTime start, DateTime end}) localRange() {
    final a = DateTime(anchor.year, anchor.month, anchor.day);
    switch (kind) {
      case PeriodKind.day:
        return (start: a, end: a.add(const Duration(days: 1)));
      case PeriodKind.week:
        final monday = a.subtract(Duration(days: a.weekday - 1));
        return (start: monday, end: monday.add(const Duration(days: 7)));
      case PeriodKind.month:
        return (start: DateTime(a.year, a.month, 1), end: DateTime(a.year, a.month + 1, 1));
      case PeriodKind.year:
        return (start: DateTime(a.year, 1, 1), end: DateTime(a.year + 1, 1, 1));
      case PeriodKind.custom:
        final r = custom;
        if (r == null) return (start: a, end: a.add(const Duration(days: 1)));
        final s = DateTime(r.start.year, r.start.month, r.start.day);
        final e = DateTime(r.end.year, r.end.month, r.end.day).add(const Duration(days: 1));
        return (start: s, end: e);
    }
  }

  String label() {
    final r = localRange();
    final lastDay = r.end.subtract(const Duration(days: 1));
    final df = DateFormat('d MMM yyyy', 'tr_TR');
    switch (kind) {
      case PeriodKind.day:
        return DateFormat('d MMMM yyyy, EEEE', 'tr_TR').format(r.start);
      case PeriodKind.month:
        return DateFormat('MMMM yyyy', 'tr_TR').format(r.start);
      case PeriodKind.year:
        return DateFormat('yyyy', 'tr_TR').format(r.start);
      case PeriodKind.week:
      case PeriodKind.custom:
        return '${df.format(r.start)} – ${df.format(lastDay)}';
    }
  }

  PeriodValue withKind(PeriodKind k) => PeriodValue(kind: k, anchor: DateTime.now());

  PeriodValue withCustom(DateTimeRange range) =>
      PeriodValue(kind: PeriodKind.custom, anchor: anchor, custom: range);

  PeriodValue shifted(int dir) {
    switch (kind) {
      case PeriodKind.day:
        return PeriodValue(kind: kind, anchor: anchor.add(Duration(days: dir)));
      case PeriodKind.week:
        return PeriodValue(kind: kind, anchor: anchor.add(Duration(days: 7 * dir)));
      case PeriodKind.month:
        return PeriodValue(kind: kind, anchor: DateTime(anchor.year, anchor.month + dir, 1));
      case PeriodKind.year:
        return PeriodValue(kind: kind, anchor: DateTime(anchor.year + dir, 1, 1));
      case PeriodKind.custom:
        return this;
    }
  }
}

/// Gün/Hafta/Ay/Özel seçimi + ileri/geri navigasyon + özel aralık seçici.
class PeriodSelector extends StatelessWidget {
  const PeriodSelector({
    required this.value,
    required this.onChanged,
    this.showYear = false,
    super.key,
  });

  final PeriodValue value;
  final ValueChanged<PeriodValue> onChanged;

  /// true ise "Yıl" seçeneği de gösterilir (kasa / ön muhasebe).
  final bool showYear;

  List<(PeriodKind, String)> get _items => [
    (PeriodKind.day, 'Gün'),
    (PeriodKind.week, 'Hafta'),
    (PeriodKind.month, 'Ay'),
    if (showYear) (PeriodKind.year, 'Yıl'),
    (PeriodKind.custom, 'Özel'),
  ];

  Future<void> _pickCustom(BuildContext context) async {
    final now = DateTime.now();
    final picked = await showDateRangePicker(
      context: context,
      firstDate: DateTime(now.year - 3),
      lastDate: DateTime(now.year + 1, 12, 31),
      initialDateRange: value.custom ??
          DateTimeRange(start: now.subtract(const Duration(days: 6)), end: now),
    );
    if (picked != null) onChanged(value.withCustom(picked));
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Row(
          children: _items.map((it) {
            final selected = it.$1 == value.kind;
            return Expanded(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 3),
                child: GestureDetector(
                  onTap: () => it.$1 == PeriodKind.custom
                      ? _pickCustom(context)
                      : onChanged(value.withKind(it.$1)),
                  child: Container(
                    height: 38,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: selected ? AppColors.primary : Colors.white,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(
                        color: selected ? AppColors.primary : AppColors.border,
                      ),
                    ),
                    child: Text(
                      it.$2,
                      style: TextStyle(
                        fontWeight: FontWeight.w700,
                        fontSize: 13,
                        color: selected ? Colors.white : AppColors.ink,
                      ),
                    ),
                  ),
                ),
              ),
            );
          }).toList(),
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            if (value.canShift)
              _NavBtn(icon: Icons.chevron_left_rounded, onTap: () => onChanged(value.shifted(-1))),
            Expanded(
              child: GestureDetector(
                onTap: value.kind == PeriodKind.custom ? () => _pickCustom(context) : null,
                child: Container(
                  height: 38,
                  alignment: Alignment.center,
                  margin: const EdgeInsets.symmetric(horizontal: 6),
                  decoration: BoxDecoration(
                    color: AppColors.surfaceSoft,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: AppColors.border),
                  ),
                  child: Text(
                    value.label(),
                    style: const TextStyle(
                      fontWeight: FontWeight.w700,
                      fontSize: 12.5,
                      color: AppColors.primaryDark,
                    ),
                  ),
                ),
              ),
            ),
            if (value.canShift)
              _NavBtn(icon: Icons.chevron_right_rounded, onTap: () => onChanged(value.shifted(1))),
          ],
        ),
      ],
    );
  }
}

class _NavBtn extends StatelessWidget {
  const _NavBtn({required this.icon, required this.onTap});
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    borderRadius: BorderRadius.circular(10),
    child: Container(
      width: 38,
      height: 38,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.border),
      ),
      child: Icon(icon, color: AppColors.primaryDark),
    ),
  );
}
