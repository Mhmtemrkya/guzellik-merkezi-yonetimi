import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/json_helpers.dart';
import '../../shared/widgets/async_list_page.dart';
import '../accounting/adisyon_detail_sheet.dart';
import '../customers/customer_picker.dart';
import 'appointment_detail_sheet.dart';
import 'appointment_form.dart';
import 'calendar_theme.dart';

/// Randevu ekranı görünüm modu — web'deki Gün/Hafta/Ay sekmeleriyle parite.
enum _CalView { day, week, month }

class AppointmentsScreen extends StatefulWidget {
  const AppointmentsScreen({required this.api, required this.auth, super.key});
  final ApiClient api;
  final AuthController auth;

  @override
  State<AppointmentsScreen> createState() => _AppointmentsScreenState();
}

class _AppointmentsScreenState extends State<AppointmentsScreen> {
  static const _startHour = 9;
  static const _endHour = 20;
  static const _hourHeight = 84.0;

  _CalView _view = _CalView.day;
  DateTime _selectedDate = DateUtils.dateOnly(DateTime.now());
  String? _selectedStaffId; // null => Tümü
  bool _showCancelled = true;
  late Future<_DayData> _future;
  _DayData? _lastData;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  void _reload() {
    _future = _load()..then((d) {
      if (mounted) _lastData = d;
    });
  }

  /// Aktif görünümün getirme aralığı: [from, to) yerel tarih sınırları.
  (DateTime, DateTime) _rangeFor(_CalView view, DateTime anchor) {
    final d = DateUtils.dateOnly(anchor);
    switch (view) {
      case _CalView.day:
        return (d, d.add(const Duration(days: 1)));
      case _CalView.week:
        final monday = d.subtract(Duration(days: d.weekday - 1));
        return (monday, monday.add(const Duration(days: 7)));
      case _CalView.month:
        final first = DateTime(d.year, d.month, 1);
        return (first, DateTime(d.year, d.month + 1, 1));
    }
  }

  String _isoDate(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  Future<_DayData> _load() async {
    final (from, to) = _rangeFor(_view, _selectedDate);
    final pageSize = _view == _CalView.day ? 200 : 500;
    final results = await Future.wait([
      widget.api.get(
        '/api/admin/appointments/',
        query: {
          'fromUtc': from.toUtc().toIso8601String(),
          'toUtc': to.toUtc().toIso8601String(),
          'page': 1,
          'pageSize': pageSize,
        },
      ),
      widget.api.get('/api/admin/staff/', query: {'page': 1, 'pageSize': 200}),
      widget.api
          .get(
            '/api/admin/schedule/timeoff',
            query: {
              'fromDate': _isoDate(from),
              'toDate': _isoDate(to.subtract(const Duration(days: 1))),
            },
          )
          .catchError((_) => const <dynamic>[]),
    ]);
    return _DayData(
      appointments: apiItems(results[0]),
      staff: apiItems(results[1]),
      timeOff: apiItems(results[2]),
    );
  }

  void _refresh() => setState(_reload);

  void _selectDate(DateTime date) {
    setState(() {
      _selectedDate = DateUtils.dateOnly(date);
      _reload();
    });
  }

  void _setView(_CalView v) {
    if (v == _view) return;
    setState(() {
      _view = v;
      _reload();
    });
  }

  /// Üst navigasyonda ‹ › ile aktif dönemi (gün/hafta/ay) kaydır.
  void _shiftPeriod(int dir) {
    setState(() {
      switch (_view) {
        case _CalView.day:
          _selectedDate = _selectedDate.add(Duration(days: dir));
        case _CalView.week:
          _selectedDate = _selectedDate.add(Duration(days: 7 * dir));
        case _CalView.month:
          final m = DateTime(_selectedDate.year, _selectedDate.month + dir, 1);
          final lastDay = DateTime(m.year, m.month + 1, 0).day;
          _selectedDate = DateTime(m.year, m.month, _selectedDate.day.clamp(1, lastDay));
      }
      _reload();
    });
  }

  /// Hafta/ay hücresinden gün görünümüne geç.
  void _openDay(DateTime day) {
    setState(() {
      _view = _CalView.day;
      _selectedDate = DateUtils.dateOnly(day);
      _reload();
    });
  }

  /// Üst navigasyondaki dönem etiketi.
  String _periodLabel() {
    switch (_view) {
      case _CalView.day:
        return CalendarText.longDate(_selectedDate);
      case _CalView.week:
        final (from, to) = _rangeFor(_CalView.week, _selectedDate);
        final end = to.subtract(const Duration(days: 1));
        return from.month == end.month
            ? '${from.day} – ${end.day} ${CalendarText.months[end.month - 1]} ${end.year}'
            : '${from.day} ${CalendarText.months[from.month - 1]} – ${end.day} ${CalendarText.months[end.month - 1]} ${end.year}';
      case _CalView.month:
        return '${CalendarText.months[_selectedDate.month - 1]} ${_selectedDate.year}';
    }
  }

  Future<void> _openCreate({DateTime? presetStart, String? presetStaffId}) async {
    final created = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => AppointmentForm(
        api: widget.api,
        presetStart: presetStart,
        presetStaffId: presetStaffId ?? _selectedStaffId,
        existing: _lastData?.appointments ?? const [],
      ),
    );
    if (created == true) _refresh();
  }

  Future<void> _openDetail(Map<String, dynamic> appointment) async {
    final changed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (_) => AppointmentDetailSheet(
        api: widget.api,
        appointment: appointment,
      ),
    );
    if (changed == true) _refresh();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.auth.user?.isPlatform == true) {
      return AsyncListPage(
        eyebrow: 'Platform',
        title: 'Abonelik finansı',
        subtitle: 'Kurum planları ve ücret bilgileri.',
        loader: () => widget.api.get('/api/platform/subscription-plans/'),
        icon: Icons.workspace_premium_rounded,
        titleKeys: const ['name', 'displayName'],
        subtitleKeys: const ['description', 'key'],
        trailingKeys: const ['monthlyPriceTRY', 'monthlyPrice'],
        statusKeys: const ['isActive', 'status'],
      );
    }
    return Scaffold(
      backgroundColor: Colors.white,
      drawer: _NavDrawer(auth: widget.auth),
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            _Header(
              onFilter: _openFilter,
              onAdisyon: _openCustomerAdisyon,
              // Kurum geneli randevu takvim aboneliği yalnızca yöneticide (personel hariç).
              onCalendarLink: (widget.auth.user?.isStaff ?? false) ? null : _calendarLink,
            ),
            _ViewTabs(value: _view, onChanged: _setView),
            if (_view == _CalView.day) ...[
              _WeekStrip(selected: _selectedDate, onSelect: _selectDate),
              FutureBuilder<_DayData>(
                future: _future,
                builder: (context, snapshot) {
                  final staff = snapshot.data?.staff ?? const [];
                  return _StaffStrip(
                    staff: staff,
                    selectedId: _selectedStaffId,
                    onSelect: (id) => setState(() => _selectedStaffId = id),
                  );
                },
              ),
              const _Legend(),
            ] else
              _PeriodNav(
                label: _periodLabel(),
                onPrev: () => _shiftPeriod(-1),
                onNext: () => _shiftPeriod(1),
                onToday: () => _selectDate(DateTime.now()),
              ),
            Expanded(
              child: FutureBuilder<_DayData>(
                future: _future,
                builder: (context, snapshot) {
                  if (snapshot.connectionState != ConnectionState.done) {
                    return const Center(child: CircularProgressIndicator());
                  }
                  if (snapshot.hasError) {
                    return _ErrorBox(
                      message: '${snapshot.error}',
                      onRetry: _refresh,
                    );
                  }
                  final data = snapshot.data!;
                  final filtered = _filteredAppointments(data);
                  switch (_view) {
                    case _CalView.day:
                      return _Timeline(
                        appointments: filtered,
                        timeOff: _filteredTimeOff(data),
                        staff: data.staff,
                        selectedStaffId: _selectedStaffId,
                        date: _selectedDate,
                        startHour: _startHour,
                        endHour: _endHour,
                        hourHeight: _hourHeight,
                        onTap: _openDetail,
                        onEmptyTap: (time, staffId) =>
                            _openCreate(presetStart: time, presetStaffId: staffId),
                      );
                    case _CalView.week:
                      final monday = _selectedDate
                          .subtract(Duration(days: _selectedDate.weekday - 1));
                      return _WeekAgenda(
                        appointments: filtered,
                        weekStart: DateUtils.dateOnly(monday),
                        onTapAppt: _openDetail,
                        onOpenDay: _openDay,
                        onCreateForDay: (d) => _openCreate(
                          presetStart: DateTime(d.year, d.month, d.day, _startHour),
                        ),
                      );
                    case _CalView.month:
                      return _MonthGrid(
                        appointments: filtered,
                        month: _selectedDate,
                        onOpenDay: _openDay,
                      );
                  }
                },
              ),
            ),
            FutureBuilder<_DayData>(
              future: _future,
              builder: (context, snapshot) => _StatsBar(
                appointments: snapshot.data == null
                    ? const []
                    : _filteredAppointments(snapshot.data!),
              ),
            ),
            _CreateButton(onTap: _openCreate),
          ],
        ),
      ),
    );
  }

  List<Map<String, dynamic>> _filteredAppointments(_DayData data) {
    return data.appointments.where((a) {
      if (_selectedStaffId != null &&
          '${a['staffMemberId']}' != _selectedStaffId) {
        return false;
      }
      if (!_showCancelled &&
          '${a['status']}'.toLowerCase() == 'cancelled') {
        return false;
      }
      return true;
    }).toList();
  }

  List<Map<String, dynamic>> _filteredTimeOff(_DayData data) {
    return data.timeOff.where((t) {
      if (_selectedStaffId != null &&
          '${t['staffMemberId']}' != _selectedStaffId) {
        return false;
      }
      return true;
    }).toList();
  }

  Future<void> _openFilter() async {
    await showModalBottomSheet<void>(
      context: context,
      builder: (_) => StatefulBuilder(
        builder: (context, setSheet) => Padding(
          padding: const EdgeInsets.fromLTRB(20, 20, 20, 28),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Filtrele',
                style: TextStyle(fontWeight: FontWeight.w800, fontSize: 18),
              ),
              const SizedBox(height: 8),
              SwitchListTile.adaptive(
                contentPadding: EdgeInsets.zero,
                value: _showCancelled,
                title: const Text('İptal edilenleri göster'),
                onChanged: (v) {
                  setSheet(() {});
                  setState(() => _showCancelled = v);
                },
              ),
              const SizedBox(height: 4),
              FilledButton(
                onPressed: () => Navigator.pop(context),
                child: const Text('Uygula'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Kurum geneli randevu ICS takvim aboneliği — Google/Apple takvim "URL ile abone ol".
  /// (Personel takvim aboneliğiyle aynı mekanizma; yalnızca yöneticiye gösterilir.)
  Future<void> _calendarLink() async {
    try {
      final res = await widget.api.get('/api/admin/schedule/appointments-calendar-link');
      final url = res is Map ? '${res['url'] ?? ''}' : '';
      if (url.isEmpty || !mounted) return;
      await showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Randevu Takvimi Aboneliği'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Bu linki Google Takvim (Ayarlar → URL ile ekle) veya iPhone '
                '(Ayarlar → Takvim → Takvim Aboneliği) ile ekleyin; kurumun tüm '
                'randevuları telefonun takviminde canlı görünür.',
                style: TextStyle(fontSize: 12.5),
              ),
              const SizedBox(height: 10),
              SelectableText(url, style: const TextStyle(fontSize: 11)),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () async {
                await Clipboard.setData(ClipboardData(text: url));
                if (ctx.mounted) Navigator.pop(ctx);
                if (mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Takvim linki kopyalandı.')),
                  );
                }
              },
              child: const Text('Kopyala'),
            ),
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Kapat')),
          ],
        ),
      );
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }

  /// Müşteri bazlı adisyon aç — müşteri seç, açık adisyonu yoksa oluştur, adisyon kartını aç.
  Future<void> _openCustomerAdisyon() async {
    final picked = await pickCustomer(context, widget.api);
    if (picked == null || !mounted) return;
    final cid = picked.id;
    try {
      final open = await widget.api.get('/api/admin/adisyonlar/open/$cid');
      String? id = open is Map ? '${open['id']}' : null;
      if (id == null || id.isEmpty || id == 'null') {
        final created = await widget.api.post('/api/admin/adisyonlar/', {
          'customerId': cid,
          'customerAccountId': null,
          'notes': null,
        });
        id = created is Map ? '${created['id']}' : null;
      }
      if (!mounted) return;
      final adisyonId = id;
      if (adisyonId != null && adisyonId.isNotEmpty && adisyonId != 'null') {
        await showModalBottomSheet<bool>(
          context: context,
          isScrollControlled: true,
          useSafeArea: true,
          backgroundColor: Colors.transparent,
          builder: (_) => AdisyonDetailSheet(api: widget.api, adisyonId: adisyonId),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }
}

class _DayData {
  _DayData({
    required this.appointments,
    required this.staff,
    required this.timeOff,
  });
  final List<Map<String, dynamic>> appointments;
  final List<Map<String, dynamic>> staff;
  final List<Map<String, dynamic>> timeOff;
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------
class _Header extends StatelessWidget {
  const _Header({required this.onFilter, this.onCalendarLink, this.onAdisyon});
  final VoidCallback onFilter;
  final VoidCallback? onCalendarLink;
  final VoidCallback? onAdisyon;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 8),
      child: Row(
        children: [
          _SquareButton(
            icon: Icons.menu_rounded,
            onTap: () => Scaffold.of(context).openDrawer(),
          ),
          const Expanded(
            child: Center(
              child: Text(
                'Randevular',
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
              ),
            ),
          ),
          if (onAdisyon != null) ...[
            _SquareButton(icon: Icons.receipt_long_rounded, tint: true, onTap: onAdisyon!),
            const SizedBox(width: 8),
          ],
          if (onCalendarLink != null) ...[
            _SquareButton(icon: Icons.event_available_rounded, tint: true, onTap: onCalendarLink!),
            const SizedBox(width: 8),
          ],
          _SquareButton(
            icon: Icons.calendar_month_rounded,
            tint: true,
            onTap: () async {
              final state = context
                  .findAncestorStateOfType<_AppointmentsScreenState>();
              final picked = await showDatePicker(
                context: context,
                initialDate: state?._selectedDate ?? DateTime.now(),
                firstDate: DateTime.now().subtract(const Duration(days: 365)),
                lastDate: DateTime.now().add(const Duration(days: 365)),
              );
              if (picked != null) state?._selectDate(picked);
            },
          ),
          const SizedBox(width: 8),
          _SquareButton(icon: Icons.tune_rounded, tint: true, onTap: onFilter),
        ],
      ),
    );
  }
}

class _SquareButton extends StatelessWidget {
  const _SquareButton({required this.icon, required this.onTap, this.tint = false});
  final IconData icon;
  final VoidCallback onTap;
  final bool tint;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: tint ? AppColors.surfaceSoft : Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: const BorderSide(color: AppColors.border),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: SizedBox(
          width: 46,
          height: 46,
          child: Icon(
            icon,
            size: 22,
            color: tint ? AppColors.primary : AppColors.ink,
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Week strip
// ---------------------------------------------------------------------------
class _WeekStrip extends StatelessWidget {
  const _WeekStrip({required this.selected, required this.onSelect});
  final DateTime selected;
  final ValueChanged<DateTime> onSelect;

  @override
  Widget build(BuildContext context) {
    final monday = selected.subtract(Duration(days: selected.weekday - 1));
    final days = List.generate(7, (i) => monday.add(Duration(days: i)));
    return Container(
      margin: const EdgeInsets.fromLTRB(12, 4, 12, 8),
      padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 4),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: days.map((d) {
          final isSelected = DateUtils.isSameDay(d, selected);
          final isSunday = d.weekday == DateTime.sunday;
          return Expanded(
            child: GestureDetector(
              onTap: () => onSelect(d),
              behavior: HitTestBehavior.opaque,
              child: Column(
                children: [
                  Text(
                    CalendarText.weekdayShort[d.weekday - 1],
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: isSunday ? AppColors.primary : AppColors.muted,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Container(
                    width: 38,
                    height: 38,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: isSelected ? AppColors.primary : Colors.transparent,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      '${d.day}',
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                        color: isSelected
                            ? Colors.white
                            : (isSunday ? AppColors.primary : AppColors.ink),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          );
        }).toList(),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Görünüm sekmeleri (Gün · Hafta · Ay) — web modalıyla parite
// ---------------------------------------------------------------------------
class _ViewTabs extends StatelessWidget {
  const _ViewTabs({required this.value, required this.onChanged});
  final _CalView value;
  final ValueChanged<_CalView> onChanged;

  @override
  Widget build(BuildContext context) {
    Widget tab(_CalView v, String label) {
      final selected = v == value;
      return Expanded(
        child: GestureDetector(
          onTap: () => onChanged(v),
          behavior: HitTestBehavior.opaque,
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 180),
            curve: Curves.easeOut,
            margin: const EdgeInsets.all(3),
            padding: const EdgeInsets.symmetric(vertical: 9),
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: selected ? AppColors.primary : Colors.transparent,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Text(
              label,
              style: TextStyle(
                fontSize: 13.5,
                fontWeight: FontWeight.w700,
                color: selected ? Colors.white : AppColors.muted,
              ),
            ),
          ),
        ),
      );
    }

    return Container(
      margin: const EdgeInsets.fromLTRB(16, 2, 16, 6),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(15),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          tab(_CalView.day, 'Gün'),
          tab(_CalView.week, 'Hafta'),
          tab(_CalView.month, 'Ay'),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Dönem navigasyonu (Hafta/Ay) — ‹ etiket › + Bugün
// ---------------------------------------------------------------------------
class _PeriodNav extends StatelessWidget {
  const _PeriodNav({
    required this.label,
    required this.onPrev,
    required this.onNext,
    this.onToday,
  });
  final String label;
  final VoidCallback onPrev;
  final VoidCallback onNext;
  final VoidCallback? onToday;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 2, 16, 8),
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          _RoundIcon(icon: Icons.chevron_left_rounded, onTap: onPrev),
          Expanded(
            child: Center(
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w800,
                  color: AppColors.ink,
                ),
              ),
            ),
          ),
          if (onToday != null)
            GestureDetector(
              onTap: onToday,
              behavior: HitTestBehavior.opaque,
              child: Container(
                margin: const EdgeInsets.only(right: 4),
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(
                  color: AppColors.surfaceSoft,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: const Text(
                  'Bugün',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: AppColors.primary,
                  ),
                ),
              ),
            ),
          _RoundIcon(icon: Icons.chevron_right_rounded, onTap: onNext),
        ],
      ),
    );
  }
}

class _RoundIcon extends StatelessWidget {
  const _RoundIcon({required this.icon, required this.onTap});
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(10),
        onTap: onTap,
        child: SizedBox(
          width: 40,
          height: 40,
          child: Icon(icon, color: AppColors.primaryDark),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Hafta görünümü — 7 günlük ajanda (gün başlığına dokun → gün görünümü)
// ---------------------------------------------------------------------------
class _WeekAgenda extends StatelessWidget {
  const _WeekAgenda({
    required this.appointments,
    required this.weekStart,
    required this.onTapAppt,
    required this.onOpenDay,
    required this.onCreateForDay,
  });
  final List<Map<String, dynamic>> appointments;
  final DateTime weekStart;
  final void Function(Map<String, dynamic>) onTapAppt;
  final void Function(DateTime) onOpenDay;
  final void Function(DateTime) onCreateForDay;

  static String _key(DateTime d) =>
      '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  @override
  Widget build(BuildContext context) {
    final today = DateUtils.dateOnly(DateTime.now());
    final days = List.generate(7, (i) => weekStart.add(Duration(days: i)));
    final byDay = <String, List<Map<String, dynamic>>>{};
    for (final a in appointments) {
      final s = DateTime.tryParse('${a['startUtc']}')?.toLocal();
      if (s == null) continue;
      byDay.putIfAbsent(_key(DateUtils.dateOnly(s)), () => []).add(a);
    }
    for (final list in byDay.values) {
      list.sort((a, b) {
        final sa = DateTime.tryParse('${a['startUtc']}') ?? DateTime(0);
        final sb = DateTime.tryParse('${b['startUtc']}') ?? DateTime(0);
        return sa.compareTo(sb);
      });
    }
    return ListView(
      padding: const EdgeInsets.fromLTRB(14, 2, 14, 10),
      children: [
        for (final d in days)
          _DaySection(
            day: d,
            isToday: DateUtils.isSameDay(d, today),
            appts: byDay[_key(d)] ?? const [],
            onOpenDay: onOpenDay,
            onTapAppt: onTapAppt,
            onCreate: onCreateForDay,
          ),
      ],
    );
  }
}

class _DaySection extends StatelessWidget {
  const _DaySection({
    required this.day,
    required this.isToday,
    required this.appts,
    required this.onOpenDay,
    required this.onTapAppt,
    required this.onCreate,
  });
  final DateTime day;
  final bool isToday;
  final List<Map<String, dynamic>> appts;
  final void Function(DateTime) onOpenDay;
  final void Function(Map<String, dynamic>) onTapAppt;
  final void Function(DateTime) onCreate;

  @override
  Widget build(BuildContext context) {
    final active =
        appts.where((a) => '${a['status']}'.toLowerCase() != 'cancelled').length;
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: isToday ? AppColors.primary : AppColors.border,
          width: isToday ? 1.4 : 1,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          InkWell(
            borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
            onTap: () => onOpenDay(day),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(14, 11, 10, 11),
              child: Row(
                children: [
                  Container(
                    width: 40,
                    height: 40,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: isToday ? AppColors.primary : AppColors.surfaceSoft,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      '${day.day}',
                      style: TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.w800,
                        color: isToday ? Colors.white : AppColors.primaryDark,
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          CalendarText.weekdayLong[day.weekday - 1],
                          style: const TextStyle(
                            fontSize: 14.5,
                            fontWeight: FontWeight.w800,
                            color: AppColors.ink,
                          ),
                        ),
                        Text(
                          '${day.day} ${CalendarText.months[day.month - 1]}',
                          style: const TextStyle(
                            fontSize: 12,
                            color: AppColors.muted,
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (active > 0)
                    Container(
                      padding:
                          const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                      decoration: BoxDecoration(
                        color: AppColors.rose,
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: Text(
                        '$active randevu',
                        style: const TextStyle(
                          fontSize: 11.5,
                          fontWeight: FontWeight.w700,
                          color: AppColors.primaryDark,
                        ),
                      ),
                    ),
                  const SizedBox(width: 2),
                  const Icon(Icons.chevron_right_rounded, color: AppColors.muted),
                ],
              ),
            ),
          ),
          if (appts.isEmpty)
            GestureDetector(
              onTap: () => onCreate(day),
              behavior: HitTestBehavior.opaque,
              child: const Padding(
                padding: EdgeInsets.fromLTRB(14, 2, 14, 14),
                child: Row(
                  children: [
                    Icon(Icons.add_circle_outline_rounded,
                        size: 18, color: AppColors.muted),
                    SizedBox(width: 8),
                    Text(
                      'Boş — randevu ekle',
                      style: TextStyle(fontSize: 12.5, color: AppColors.muted),
                    ),
                  ],
                ),
              ),
            )
          else
            Padding(
              padding: const EdgeInsets.fromLTRB(10, 2, 10, 10),
              child: Column(
                children: [
                  for (final a in appts)
                    _AgendaCard(appointment: a, onTap: () => onTapAppt(a)),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _AgendaCard extends StatelessWidget {
  const _AgendaCard({required this.appointment, required this.onTap});
  final Map<String, dynamic> appointment;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final a = appointment;
    final start = DateTime.tryParse('${a['startUtc']}')?.toLocal();
    final end = DateTime.tryParse('${a['endUtc']}')?.toLocal();
    final style = CalendarTheme.styleFor('${a['status']}');
    final name = valueOf(a, const ['customerName', 'fullName']);
    final service = valueOf(a, const ['serviceName'], fallback: '');
    final time = start == null
        ? ''
        : (end == null
              ? CalendarText.hm(start)
              : '${CalendarText.hm(start)} - ${CalendarText.hm(end)}');
    final cancelled = '${a['status']}'.toLowerCase() == 'cancelled';
    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 3, horizontal: 2),
        padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 10),
        decoration: BoxDecoration(
          color: style.bg,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: style.border),
        ),
        child: Row(
          children: [
            Container(
              width: 4,
              height: 38,
              decoration: BoxDecoration(
                color: style.title,
                borderRadius: BorderRadius.circular(3),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 13.5,
                      fontWeight: FontWeight.w800,
                      color: style.title,
                      decoration: cancelled ? TextDecoration.lineThrough : null,
                    ),
                  ),
                  if (service.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 1),
                      child: Text(
                        service,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(fontSize: 12, color: style.sub),
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  time,
                  style: TextStyle(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w700,
                    color: style.sub,
                  ),
                ),
                if (style.showCheck)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Icon(Icons.check_circle, size: 15, color: style.title),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Ay görünümü — takvim ızgarası (hücreye dokun → gün görünümü)
// ---------------------------------------------------------------------------
class _MonthGrid extends StatelessWidget {
  const _MonthGrid({
    required this.appointments,
    required this.month,
    required this.onOpenDay,
  });
  final List<Map<String, dynamic>> appointments;
  final DateTime month;
  final void Function(DateTime) onOpenDay;

  static String _key(DateTime d) =>
      '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  @override
  Widget build(BuildContext context) {
    final today = DateUtils.dateOnly(DateTime.now());
    final first = DateTime(month.year, month.month, 1);
    final gridStart = first.subtract(Duration(days: first.weekday - 1));
    final cells = List.generate(42, (i) => gridStart.add(Duration(days: i)));
    final byDay = <String, List<Map<String, dynamic>>>{};
    for (final a in appointments) {
      final s = DateTime.tryParse('${a['startUtc']}')?.toLocal();
      if (s == null) continue;
      byDay.putIfAbsent(_key(DateUtils.dateOnly(s)), () => []).add(a);
    }
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 2, 12, 6),
          child: Row(
            children: [
              for (var i = 0; i < 7; i++)
                Expanded(
                  child: Center(
                    child: Text(
                      CalendarText.weekdayShort[i],
                      style: TextStyle(
                        fontSize: 11.5,
                        fontWeight: FontWeight.w700,
                        color: i >= 5 ? AppColors.primary : AppColors.muted,
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
        Expanded(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
            child: GridView.count(
              crossAxisCount: 7,
              childAspectRatio: 0.74,
              mainAxisSpacing: 5,
              crossAxisSpacing: 5,
              children: [
                for (final c in cells)
                  _MonthCell(
                    day: c,
                    inMonth: c.month == month.month,
                    isToday: DateUtils.isSameDay(c, today),
                    appts: byDay[_key(c)] ?? const [],
                    onTap: () => onOpenDay(c),
                  ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _MonthCell extends StatelessWidget {
  const _MonthCell({
    required this.day,
    required this.inMonth,
    required this.isToday,
    required this.appts,
    required this.onTap,
  });
  final DateTime day;
  final bool inMonth;
  final bool isToday;
  final List<Map<String, dynamic>> appts;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final active = appts
        .where((a) => '${a['status']}'.toLowerCase() != 'cancelled')
        .toList();
    final weekend = day.weekday >= 6;
    return GestureDetector(
      onTap: inMonth ? onTap : null,
      behavior: HitTestBehavior.opaque,
      child: Opacity(
        opacity: inMonth ? 1 : 0.35,
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 5, horizontal: 2),
          decoration: BoxDecoration(
            color: isToday ? AppColors.rose : Colors.white,
            borderRadius: BorderRadius.circular(11),
            border: Border.all(
              color: isToday ? AppColors.primary : AppColors.border,
              width: isToday ? 1.3 : 1,
            ),
          ),
          child: Column(
            children: [
              Text(
                '${day.day}',
                style: TextStyle(
                  fontSize: 13.5,
                  fontWeight: FontWeight.w800,
                  color: isToday
                      ? AppColors.primaryDark
                      : (weekend ? AppColors.primary : AppColors.ink),
                ),
              ),
              const SizedBox(height: 3),
              if (active.isNotEmpty) ...[
                Wrap(
                  spacing: 2,
                  runSpacing: 2,
                  alignment: WrapAlignment.center,
                  children: [
                    for (final a in active.take(3))
                      Container(
                        width: 6,
                        height: 6,
                        decoration: BoxDecoration(
                          color: CalendarText.statusColor('${a['status']}'),
                          shape: BoxShape.circle,
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 2),
                Text(
                  '${active.length}',
                  style: const TextStyle(
                    fontSize: 10.5,
                    fontWeight: FontWeight.w800,
                    color: AppColors.primaryDark,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Staff strip
// ---------------------------------------------------------------------------
class _StaffStrip extends StatelessWidget {
  const _StaffStrip({
    required this.staff,
    required this.selectedId,
    required this.onSelect,
  });
  final List<Map<String, dynamic>> staff;
  final String? selectedId;
  final ValueChanged<String?> onSelect;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 92,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 14),
        children: [
          _AllChip(selected: selectedId == null, onTap: () => onSelect(null)),
          for (final s in staff)
            _StaffAvatar(
              staff: s,
              selected: selectedId == '${s['id']}',
              onTap: () => onSelect('${s['id']}'),
            ),
        ],
      ),
    );
  }
}

class _AllChip extends StatelessWidget {
  const _AllChip({required this.selected, required this.onTap});
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 6),
        child: Column(
          children: [
            Container(
              width: 58,
              height: 58,
              decoration: BoxDecoration(
                color: selected ? AppColors.rose : AppColors.surfaceSoft,
                borderRadius: BorderRadius.circular(18),
                border: Border.all(
                  color: selected ? AppColors.primary : AppColors.border,
                  width: selected ? 1.6 : 1,
                ),
              ),
              child: const Icon(Icons.groups_rounded, color: AppColors.primary),
            ),
            const SizedBox(height: 6),
            Text(
              'Tümü',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: selected ? AppColors.primaryDark : AppColors.muted,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _StaffAvatar extends StatelessWidget {
  const _StaffAvatar({
    required this.staff,
    required this.selected,
    required this.onTap,
  });
  final Map<String, dynamic> staff;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final name = valueOf(staff, const ['fullName', 'name']);
    final photo = '${staff['photoUrl'] ?? ''}';
    final active = staff['isActive'] == true;
    final parts = name.trim().split(' ');
    final short = parts.length > 1
        ? '${parts.first} ${parts.last.characters.first}.'
        : name;
    final initials = parts
        .take(2)
        .map((p) => p.isEmpty ? '' : p.characters.first)
        .join()
        .toUpperCase();
    return GestureDetector(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 6),
        child: Column(
          children: [
            Stack(
              children: [
                Container(
                  width: 58,
                  height: 58,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(
                      color: selected ? AppColors.primary : AppColors.border,
                      width: selected ? 2 : 1,
                    ),
                  ),
                  child: ClipOval(
                    child: photo.isNotEmpty
                        ? Image.network(
                            photo,
                            fit: BoxFit.cover,
                            errorBuilder: (_, _, _) =>
                                _InitialsCircle(initials: initials),
                          )
                        : _InitialsCircle(initials: initials),
                  ),
                ),
                if (active)
                  Positioned(
                    right: 2,
                    bottom: 2,
                    child: Container(
                      width: 14,
                      height: 14,
                      decoration: BoxDecoration(
                        color: const Color(0xFF3CCB6E),
                        shape: BoxShape.circle,
                        border: Border.all(color: Colors.white, width: 2),
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 6),
            SizedBox(
              width: 64,
              child: Text(
                short,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: selected ? AppColors.primaryDark : AppColors.muted,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _InitialsCircle extends StatelessWidget {
  const _InitialsCircle({required this.initials});
  final String initials;

  @override
  Widget build(BuildContext context) => Container(
    color: AppColors.surfaceSoft,
    alignment: Alignment.center,
    child: Text(
      initials,
      style: const TextStyle(
        color: AppColors.primaryDark,
        fontWeight: FontWeight.w800,
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------
class _Legend extends StatelessWidget {
  const _Legend();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: const [
          _LegendDot(color: Color(0xFF3CCB6E), label: 'Dolu'),
          _LegendDot(color: Color(0xFF4A86E8), label: 'Boş'),
          _LegendDot(color: Color(0xFFF5A623), label: 'İzinli'),
          _LegendDot(color: Color(0xFFBFC3C9), label: 'Müsait değil'),
        ],
      ),
    );
  }
}

class _LegendDot extends StatelessWidget {
  const _LegendDot({required this.color, required this.label});
  final Color color;
  final String label;

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      Container(
        width: 10,
        height: 10,
        decoration: BoxDecoration(color: color, shape: BoxShape.circle),
      ),
      const SizedBox(width: 6),
      Text(
        label,
        style: const TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w600,
          color: AppColors.muted,
        ),
      ),
    ],
  );
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------
class _Timeline extends StatelessWidget {
  const _Timeline({
    required this.appointments,
    required this.timeOff,
    required this.staff,
    required this.selectedStaffId,
    required this.date,
    required this.startHour,
    required this.endHour,
    required this.hourHeight,
    required this.onTap,
    required this.onEmptyTap,
  });

  final List<Map<String, dynamic>> appointments;
  final List<Map<String, dynamic>> timeOff;
  final List<Map<String, dynamic>> staff;
  final String? selectedStaffId;
  final DateTime date;
  final int startHour;
  final int endHour;
  final double hourHeight;
  final void Function(Map<String, dynamic>) onTap;
  final void Function(DateTime start, String? staffId) onEmptyTap;

  static const double _gutter = 54;
  static const double _minColWidth = 168;

  List<String> get _columns => selectedStaffId != null
      ? [selectedStaffId!]
      : (staff.isEmpty
            ? const ['_']
            : staff.map((s) => '${s['id']}').toList());

  @override
  Widget build(BuildContext context) {
    final hours = endHour - startHour;
    final totalHeight = hours * hourHeight + 24;
    final columns = _columns;
    final events = _layout(columns);
    return LayoutBuilder(
      builder: (context, constraints) {
        final available = constraints.maxWidth - _gutter;
        final perColumn = available / columns.length;
        final colWidth = perColumn < _minColWidth ? _minColWidth : perColumn;
        final contentWidth = colWidth * columns.length;
        return SingleChildScrollView(
          padding: const EdgeInsets.only(bottom: 8),
          child: SizedBox(
            height: totalHeight,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // fixed time gutter
                SizedBox(
                  width: _gutter,
                  height: totalHeight,
                  child: Stack(
                    children: [
                      for (int h = 0; h <= hours; h++)
                        Positioned(
                          top: h * hourHeight + 8,
                          left: 0,
                          width: _gutter - 8,
                          child: Text(
                            '${(startHour + h).toString().padLeft(2, '0')}:00',
                            textAlign: TextAlign.right,
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
                // scrollable column area
                Expanded(
                  child: SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: SizedBox(
                      width: contentWidth,
                      height: totalHeight,
                      child: Stack(
                        children: [
                          // horizontal hour lines
                          for (int h = 0; h <= hours; h++)
                            Positioned(
                              top: h * hourHeight + 14,
                              left: 0,
                              width: contentWidth,
                              child: const IgnorePointer(
                                child: Divider(
                                  height: 1,
                                  color: Color(0xFFF0E7EC),
                                ),
                              ),
                            ),
                          // vertical staff column dividers
                          for (int c = 1; c < columns.length; c++)
                            Positioned(
                              left: c * colWidth,
                              top: 8,
                              height: totalHeight - 16,
                              child: const IgnorePointer(
                                child: SizedBox(
                                  width: 1,
                                  child: ColoredBox(color: Color(0xFFEFE6EC)),
                                ),
                              ),
                            ),
                          // empty-area tap to create
                          Positioned.fill(
                            child: GestureDetector(
                              behavior: HitTestBehavior.translucent,
                              onTapUp: (d) {
                                final rawMin =
                                    ((d.localPosition.dy - 14) /
                                            hourHeight *
                                            60)
                                        .round();
                                final snapped = (rawMin / 15).round() * 15;
                                final clamped = snapped.clamp(
                                  0,
                                  hours * 60 - 15,
                                );
                                final colIndex =
                                    (d.localPosition.dx / colWidth)
                                        .floor()
                                        .clamp(0, columns.length - 1);
                                final staffId = columns[colIndex] == '_'
                                    ? null
                                    : columns[colIndex];
                                onEmptyTap(
                                  DateTime(
                                    date.year,
                                    date.month,
                                    date.day,
                                    startHour,
                                  ).add(Duration(minutes: clamped)),
                                  selectedStaffId ?? staffId,
                                );
                              },
                            ),
                          ),
                          // events
                          ...events.map(
                            (e) => _buildEvent(context, e, colWidth),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildEvent(BuildContext context, _Ev e, double colWidth) {
    final style = e.style;
    final subWidth = colWidth / e.subCount;
    return Positioned(
      top: e.top,
      left: e.colIndex * colWidth + e.subLane * subWidth,
      width: subWidth,
      height: e.height,
      child: GestureDetector(
        onTap: e.onTap,
        child: Container(
          margin: const EdgeInsets.only(left: 2, right: 3, top: 2, bottom: 2),
          padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 7),
          decoration: BoxDecoration(
            color: style.bg,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: style.border),
          ),
          child: ClipRect(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        e.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w800,
                          color: style.title,
                        ),
                      ),
                    ),
                    if (style.showCheck)
                      Icon(Icons.check_circle, size: 15, color: style.title),
                  ],
                ),
                if (e.subtitle.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(
                      e.subtitle,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: 12, color: style.sub),
                    ),
                  ),
                if (e.height > 52)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(
                      e.timeLabel,
                      style: TextStyle(
                        fontSize: 11.5,
                        fontWeight: FontWeight.w600,
                        color: style.sub,
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  List<_Ev> _layout(List<String> columns) {
    final hours = endHour - startHour;
    int colOf(String? staffId) {
      final i = columns.indexOf('$staffId');
      return i < 0 ? 0 : i;
    }

    // group raw events per column
    final perColumn = <int, List<_Ev>>{};
    void add(_Ev e) => perColumn.putIfAbsent(e.colIndex, () => []).add(e);

    for (final a in appointments) {
      final start = DateTime.tryParse('${a['startUtc']}')?.toLocal();
      final end = DateTime.tryParse('${a['endUtc']}')?.toLocal();
      if (start == null || end == null) continue;
      final startMin = (start.hour - startHour) * 60 + start.minute;
      final endMin = (end.hour - startHour) * 60 + end.minute;
      add(
        _Ev(
          startMin: startMin,
          endMin: endMin,
          top: (startMin / 60 * hourHeight + 14).clamp(14, hours * hourHeight),
          height: ((endMin - startMin) / 60 * hourHeight).clamp(
            38,
            hours * hourHeight,
          ),
          title: valueOf(a, const ['customerName', 'fullName']),
          subtitle: valueOf(a, const ['serviceName'], fallback: ''),
          timeLabel: '${CalendarText.hm(start)} - ${CalendarText.hm(end)}',
          style: CalendarTheme.styleFor('${a['status']}'),
          colIndex: colOf('${a['staffMemberId']}'),
          onTap: () => onTap(a),
        ),
      );
    }
    for (final t in timeOff) {
      final ci = selectedStaffId != null
          ? 0
          : columns.indexOf('${t['staffMemberId']}');
      if (ci < 0) continue;
      add(
        _Ev(
          startMin: 0,
          endMin: hours * 60,
          top: 14,
          height: hours * hourHeight,
          title: 'İzinli',
          subtitle: valueOf(t, const ['staffName'], fallback: ''),
          timeLabel: 'Tüm gün',
          style: CalendarTheme.timeOff,
          colIndex: ci,
        ),
      );
    }

    // within each column assign side-by-side sub-lanes for overlaps
    final result = <_Ev>[];
    for (final entry in perColumn.entries) {
      final list = entry.value..sort((a, b) => a.startMin.compareTo(b.startMin));
      final laneEnds = <int>[];
      for (final e in list) {
        var placed = false;
        for (var i = 0; i < laneEnds.length; i++) {
          if (e.startMin >= laneEnds[i]) {
            laneEnds[i] = e.endMin;
            e.subLane = i;
            placed = true;
            break;
          }
        }
        if (!placed) {
          e.subLane = laneEnds.length;
          laneEnds.add(e.endMin);
        }
      }
      final subCount = laneEnds.isEmpty ? 1 : laneEnds.length;
      for (final e in list) {
        e.subCount = subCount;
        result.add(e);
      }
    }
    return result;
  }
}

class _Ev {
  _Ev({
    required this.startMin,
    required this.endMin,
    required this.top,
    required this.height,
    required this.title,
    required this.subtitle,
    required this.timeLabel,
    required this.style,
    required this.colIndex,
    this.onTap,
  });
  final int startMin;
  final int endMin;
  final double top;
  final double height;
  final String title;
  final String subtitle;
  final String timeLabel;
  final EventStyle style;
  final int colIndex;
  final VoidCallback? onTap;
  int subLane = 0;
  int subCount = 1;
}

// ---------------------------------------------------------------------------
// Stats bar
// ---------------------------------------------------------------------------
class _StatsBar extends StatelessWidget {
  const _StatsBar({required this.appointments});
  final List<Map<String, dynamic>> appointments;

  @override
  Widget build(BuildContext context) {
    int countOf(List<String> statuses) => appointments
        .where((a) => statuses.contains('${a['status']}'.toLowerCase()))
        .length;
    final total = appointments.length;
    final done = countOf(['completed']);
    final waiting = countOf(['scheduled', 'confirmed', 'draft']);
    final cancelled = countOf(['cancelled', 'noshow']);
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 4, 12, 6),
      child: Row(
        children: [
          _StatCard(
            icon: Icons.calendar_today_rounded,
            color: AppColors.primary,
            value: '$total',
            label: 'Toplam Randevu',
          ),
          _StatCard(
            icon: Icons.check_circle_rounded,
            color: const Color(0xFF3CCB6E),
            value: '$done',
            label: 'Tamamlanan',
          ),
          _StatCard(
            icon: Icons.schedule_rounded,
            color: const Color(0xFF4A86E8),
            value: '$waiting',
            label: 'Bekleyen',
          ),
          _StatCard(
            icon: Icons.cancel_rounded,
            color: const Color(0xFFF5A623),
            value: '$cancelled',
            label: 'İptal Edilen',
          ),
        ],
      ),
    );
  }
}

class _StatCard extends StatelessWidget {
  const _StatCard({
    required this.icon,
    required this.color,
    required this.value,
    required this.label,
  });
  final IconData icon;
  final Color color;
  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Container(
        margin: const EdgeInsets.symmetric(horizontal: 4),
        padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 6),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.border),
        ),
        child: Column(
          children: [
            Icon(icon, color: color, size: 20),
            const SizedBox(height: 4),
            Text(
              value,
              style: const TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 10, color: AppColors.muted),
            ),
          ],
        ),
      ),
    );
  }
}

class _CreateButton extends StatelessWidget {
  const _CreateButton({required this.onTap});
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 2, 14, 10),
      child: SizedBox(
        height: 54,
        width: double.infinity,
        child: FilledButton.icon(
          onPressed: onTap,
          icon: const Icon(Icons.add_rounded),
          label: const Text(
            'Yeni Randevu Oluştur',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
          ),
        ),
      ),
    );
  }
}

class _ErrorBox extends StatelessWidget {
  const _ErrorBox({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(28),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.cloud_off_rounded, size: 42, color: AppColors.primary),
          const SizedBox(height: 12),
          Text(message, textAlign: TextAlign.center),
          const SizedBox(height: 14),
          OutlinedButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh_rounded),
            label: const Text('Tekrar dene'),
          ),
        ],
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Navigation drawer (hamburger)
// ---------------------------------------------------------------------------
class _NavDrawer extends StatelessWidget {
  const _NavDrawer({required this.auth});
  final AuthController auth;

  @override
  Widget build(BuildContext context) {
    final user = auth.user;
    final links = <List<dynamic>>[
      ['Ana Sayfa', Icons.home_rounded, '/home'],
      ['Randevular', Icons.calendar_month_rounded, '/appointments'],
      ['Müşteriler', Icons.people_alt_rounded, '/customers'],
      ['Paket & Hizmet', Icons.spa_rounded, '/services'],
      ['Stok & Ürün', Icons.inventory_2_rounded, '/stock'],
      ['Ön Muhasebe', Icons.account_balance_rounded, '/accounting'],
      ['Bildirimler', Icons.notifications_active_rounded, '/notifications'],
      ['Raporlar', Icons.bar_chart_rounded, '/reports'],
      ['Profilim', Icons.account_circle_rounded, '/profile'],
    ];
    return Drawer(
      backgroundColor: Colors.white,
      child: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.all(18),
              child: Row(
                children: [
                  CircleAvatar(
                    radius: 24,
                    backgroundColor: AppColors.rose,
                    child: Text(
                      user?.initials ?? '',
                      style: const TextStyle(
                        color: AppColors.primaryDark,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          user?.fullName ?? '',
                          style: const TextStyle(fontWeight: FontWeight.w800),
                        ),
                        Text(
                          user?.email ?? '',
                          style: const TextStyle(
                            fontSize: 12,
                            color: AppColors.muted,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const Divider(height: 1, color: AppColors.border),
            Expanded(
              child: ListView(
                children: [
                  for (final l in links)
                    ListTile(
                      leading: Icon(l[1] as IconData, color: AppColors.primaryDark),
                      title: Text(l[0] as String),
                      onTap: () {
                        Navigator.pop(context);
                        context.push(l[2] as String);
                      },
                    ),
                ],
              ),
            ),
            const Divider(height: 1, color: AppColors.border),
            ListTile(
              leading: const Icon(Icons.logout_rounded, color: AppColors.danger),
              title: const Text('Çıkış yap'),
              onTap: auth.signOut,
            ),
          ],
        ),
      ),
    );
  }
}
