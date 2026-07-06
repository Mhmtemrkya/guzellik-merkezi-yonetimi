import 'package:flutter/material.dart';

import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/json_helpers.dart';
import '../../shared/widgets/app_background.dart';
import '../../shared/widgets/page_header.dart';
import '../appointments/calendar_theme.dart';

enum _SchedView { day, week, month }

/// Durum görsel kimliği (web çizelge paletiyle eşleştirildi).
class _StatusMeta {
  const _StatusMeta(this.bar, this.label, this.pillBg, this.pillText);
  final Color bar;
  final String label;
  final Color pillBg;
  final Color pillText;
}

_StatusMeta _statusMeta(String raw) {
  final k = raw.toLowerCase();
  if (['draft', 'taslak', 'pendingapproval'].contains(k)) {
    return const _StatusMeta(Color(0xFF8B6FC9), 'Taslak', Color(0x228B6FC9), Color(0xFF6D51B0));
  }
  if (['completed', 'tamamlandi', 'tamamlandı'].contains(k)) {
    return const _StatusMeta(Color(0xFF2F9E72), 'Tamamlandı', Color(0x222F9E72), Color(0xFF23805C));
  }
  if (['confirmed', 'inprogress', 'devam', 'arrived'].contains(k)) {
    return const _StatusMeta(Color(0xFF3B82F6), 'Devam', Color(0x223B82F6), Color(0xFF2563EB));
  }
  if (['cancelled', 'canceled', 'noshow', 'no_show', 'gelmedi', 'iptal'].contains(k)) {
    return const _StatusMeta(Color(0xFFD1556F), 'İptal', Color(0x22D1556F), Color(0xFFC23E5E));
  }
  return const _StatusMeta(Color(0xFFB88938), 'Bekliyor', Color(0x28B88938), Color(0xFF946D23));
}

/// Personel Çizelgesi — günlük ajanda (müşteri × işlem), haftalık doluluk ızgarası
/// ve aylık takvim. Hücreye/güne dokunarak izin aç/kapa, doluluk istatistikleri.
class ScheduleScreen extends StatefulWidget {
  const ScheduleScreen({required this.api, super.key});
  final ApiClient api;

  @override
  State<ScheduleScreen> createState() => _ScheduleScreenState();
}

class _ScheduleScreenState extends State<ScheduleScreen> {
  _SchedView _view = _SchedView.day;
  late DateTime _cursor;
  bool _busy = false;
  late Future<_ScheduleData> _future;

  @override
  void initState() {
    super.initState();
    _cursor = DateUtils.dateOnly(DateTime.now());
    _future = _load();
  }

  DateTime get _weekStart =>
      _cursor.subtract(Duration(days: _cursor.weekday - 1));
  DateTime get _monthFirst => DateTime(_cursor.year, _cursor.month, 1);
  DateTime get _monthLast => DateTime(_cursor.year, _cursor.month + 1, 0);

  DateTime get _rangeFrom => switch (_view) {
        _SchedView.day => _cursor,
        _SchedView.week => _weekStart,
        _SchedView.month => _monthFirst,
      };
  DateTime get _rangeLast => switch (_view) {
        _SchedView.day => _cursor,
        _SchedView.week => _weekStart.add(const Duration(days: 6)),
        _SchedView.month => _monthLast,
      };

  String _dk(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  Future<_ScheduleData> _load() async {
    final from = _rangeFrom;
    final toExclusive = _rangeLast.add(const Duration(days: 1));
    final results = await Future.wait([
      widget.api.get('/api/admin/staff/', query: {'page': 1, 'pageSize': 200}),
      widget.api.get(
        '/api/admin/appointments/',
        query: {
          'fromUtc': from.toUtc().toIso8601String(),
          'toUtc': toExclusive.toUtc().toIso8601String(),
          'page': 1,
          'pageSize': 500,
        },
      ),
      widget.api
          .get(
            '/api/admin/schedule/timeoff',
            query: {'fromDate': _dk(from), 'toDate': _dk(_rangeLast)},
          )
          .catchError((_) => const <dynamic>[]),
    ]);
    return _ScheduleData(
      staff: apiItems(results[0]).where((s) => s['isActive'] != false).toList(),
      appointments: apiItems(results[1]),
      timeOff: apiItems(results[2]),
    );
  }

  void _reload() {
    setState(() {
      _future = _load();
    });
  }

  void _shift(int dir) {
    setState(() {
      _cursor = switch (_view) {
        _SchedView.day => _cursor.add(Duration(days: dir)),
        _SchedView.week => _cursor.add(Duration(days: 7 * dir)),
        _SchedView.month => DateTime(_cursor.year, _cursor.month + dir, 1),
      };
      _future = _load();
    });
  }

  void _setView(_SchedView v) {
    if (v == _view) return;
    setState(() {
      _view = v;
      _future = _load();
    });
  }

  void _jumpToDay(DateTime d) {
    setState(() {
      _cursor = DateUtils.dateOnly(d);
      _view = _SchedView.day;
      _future = _load();
    });
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _cursor,
      firstDate: DateTime(2020),
      lastDate: DateTime(2035),
      locale: const Locale('tr'),
    );
    if (picked != null) {
      setState(() {
        _cursor = DateUtils.dateOnly(picked);
        _future = _load();
      });
    }
  }

  Future<void> _toggleLeave(
    String staffId,
    DateTime day,
    String? existingId,
  ) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      if (existingId != null) {
        await widget.api.delete('/api/admin/schedule/timeoff/$existingId');
      } else {
        await widget.api.post('/api/admin/schedule/timeoff', {
          'staffMemberId': staffId,
          'date': _dk(day),
          'reason': null,
        });
      }
      _reload();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppBackground(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        floatingActionButton: FloatingActionButton.small(
          backgroundColor: AppColors.primary,
          foregroundColor: Colors.white,
          elevation: 2,
          onPressed: () {
            setState(() {
              _cursor = DateUtils.dateOnly(DateTime.now());
              _future = _load();
            });
          },
          child: const Icon(Icons.today_rounded),
        ),
        body: SafeArea(
          child: FutureBuilder<_ScheduleData>(
            future: _future,
            builder: (context, snapshot) {
              final data = snapshot.data;
              return ListView(
                padding: const EdgeInsets.fromLTRB(16, 20, 16, 110),
                children: [
                  const PageHeader(
                    eyebrow: 'Personel',
                    title: 'Çizelge',
                    subtitle: 'Günlük ajanda, haftalık doluluk ve randevular.',
                  ),
                  const SizedBox(height: 14),
                  _dateBar(),
                  const SizedBox(height: 12),
                  _segmented(),
                  const SizedBox(height: 14),
                  if (snapshot.connectionState != ConnectionState.done && data == null)
                    const Padding(
                      padding: EdgeInsets.all(48),
                      child: Center(child: CircularProgressIndicator()),
                    )
                  else if (snapshot.hasError)
                    _errorBox('${snapshot.error}')
                  else ...[
                    _statsRow(data!),
                    const SizedBox(height: 16),
                    switch (_view) {
                      _SchedView.day => _dayAgenda(data),
                      _SchedView.week => _weekGrid(data),
                      _SchedView.month => _monthGrid(data),
                    },
                    const SizedBox(height: 16),
                    _legend(),
                  ],
                ],
              );
            },
          ),
        ),
      ),
    );
  }

  // --- Üst kontroller --------------------------------------------------------

  Widget _dateBar() {
    final label = switch (_view) {
      _SchedView.day =>
        '${_cursor.day} ${CalendarText.months[_cursor.month - 1]} ${CalendarText.weekdayLong[_cursor.weekday - 1]}',
      _SchedView.week => () {
          final e = _weekStart.add(const Duration(days: 6));
          return '${_weekStart.day} ${CalendarText.months[_weekStart.month - 1]} – ${e.day} ${CalendarText.months[e.month - 1]}';
        }(),
      _SchedView.month =>
        '${CalendarText.months[_cursor.month - 1]} ${_cursor.year}',
    };
    return Container(
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: .65),
        borderRadius: BorderRadius.circular(99),
        border: Border.all(color: AppColors.border),
      ),
      padding: const EdgeInsets.all(6),
      child: Row(
        children: [
          _roundBtn(Icons.chevron_left_rounded, () => _shift(-1)),
          Expanded(
            child: GestureDetector(
              onTap: _pickDate,
              child: Text(
                label,
                textAlign: TextAlign.center,
                style: const TextStyle(
                    fontWeight: FontWeight.w800, color: AppColors.ink),
              ),
            ),
          ),
          _roundBtn(Icons.chevron_right_rounded, () => _shift(1)),
        ],
      ),
    );
  }

  Widget _roundBtn(IconData icon, VoidCallback onTap) => Material(
        color: Colors.white,
        shape: const CircleBorder(),
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: onTap,
          child: SizedBox(
            width: 38,
            height: 38,
            child: Icon(icon, color: AppColors.muted, size: 22),
          ),
        ),
      );

  Widget _segmented() {
    Widget tab(_SchedView v, String label) {
      final active = _view == v;
      return Expanded(
        child: GestureDetector(
          onTap: () => _setView(v),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 200),
            padding: const EdgeInsets.symmetric(vertical: 10),
            decoration: BoxDecoration(
              gradient: active
                  ? const LinearGradient(
                      colors: [Color(0xFFF47699), Color(0xFFEF6088)])
                  : null,
              borderRadius: BorderRadius.circular(99),
              boxShadow: active
                  ? [
                      BoxShadow(
                          color: AppColors.primary.withValues(alpha: .35),
                          blurRadius: 16,
                          offset: const Offset(0, 6))
                    ]
                  : null,
            ),
            alignment: Alignment.center,
            child: Text(
              label,
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: active ? Colors.white : AppColors.muted,
              ),
            ),
          ),
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: const Color(0xFFF7ECF1),
        borderRadius: BorderRadius.circular(99),
      ),
      child: Row(
        children: [
          tab(_SchedView.day, 'Günlük'),
          tab(_SchedView.week, 'Haftalık'),
          tab(_SchedView.month, 'Aylık'),
        ],
      ),
    );
  }

  Widget _statsRow(_ScheduleData data) {
    final keys = switch (_view) {
      _SchedView.day => [_dk(_cursor)],
      _SchedView.week =>
        List.generate(7, (i) => _dk(_weekStart.add(Duration(days: i)))),
      _SchedView.month => <String>[],
    };
    // doluluk
    int occupancy;
    final counts = <String, int>{}; // staffId|dayKey -> n
    final workedDays = <String>{}; // dayKey having appts
    var planned = 0;
    for (final a in data.appointments) {
      final st = '${a['status']}'.toLowerCase();
      if (st == 'cancelled' || st == 'noshow') continue;
      planned++;
      final d = parseUtcToLocal(a['startUtc']);
      if (d == null) continue;
      final dk = _dk(d);
      workedDays.add(dk);
      final key = '${a['staffMemberId']}|$dk';
      counts[key] = (counts[key] ?? 0) + 1;
    }
    if (_view == _SchedView.month) {
      final inMonth = _monthLast.day;
      occupancy = inMonth == 0 ? 0 : (workedDays.length / inMonth * 100).round();
    } else {
      final total = (data.staff.length * keys.length).clamp(1, 1 << 30);
      var filled = 0;
      for (final s in data.staff) {
        for (final k in keys) {
          if ((counts['${s['id']}|$k'] ?? 0) > 0) filled++;
        }
      }
      occupancy = (filled / total * 100).round();
    }
    return Row(
      children: [
        _stat('Doluluk', '%$occupancy', Icons.donut_large_rounded, AppColors.primary),
        _stat('Randevu', '$planned', Icons.event_available_rounded, const Color(0xFFB88938)),
        _stat('İzinli', '${data.timeOff.length}', Icons.beach_access_rounded, const Color(0xFF5AA9E6)),
        _stat('Personel', '${data.staff.length}', Icons.people_alt_rounded, const Color(0xFF2F9E72)),
      ],
    );
  }

  Widget _stat(String label, String value, IconData icon, Color color) {
    return Expanded(
      child: Container(
        margin: const EdgeInsets.symmetric(horizontal: 3),
        padding: const EdgeInsets.symmetric(vertical: 11, horizontal: 4),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.border),
        ),
        child: Column(
          children: [
            Container(
              width: 30,
              height: 30,
              decoration: BoxDecoration(
                color: color.withValues(alpha: .12),
                shape: BoxShape.circle,
              ),
              child: Icon(icon, color: color, size: 17),
            ),
            const SizedBox(height: 6),
            Text(value,
                style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
            const SizedBox(height: 1),
            Text(label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 10, color: AppColors.muted)),
          ],
        ),
      ),
    );
  }

  // --- Günlük ajanda ---------------------------------------------------------

  Widget _dayAgenda(_ScheduleData data) {
    final dk = _dk(_cursor);
    // o günün randevuları
    final appts = <_ApptVM>[];
    for (final a in data.appointments) {
      final start = parseUtcToLocal(a['startUtc']);
      if (start == null || _dk(start) != dk) continue;
      final end = parseUtcToLocal(a['endUtc']);
      appts.add(_ApptVM(
        start: start,
        durationMin: end != null ? end.difference(start).inMinutes : 0,
        customer: valueOf(a, const ['customerName'], fallback: 'Müşteri'),
        service: valueOf(a, const ['serviceName'], fallback: 'Hizmet'),
        staff: valueOf(a, const ['staffName'], fallback: '—'),
        status: '${a['status']}',
      ));
    }
    appts.sort((x, y) => x.start.compareTo(y.start));

    // o gün izinli personel
    final onLeave = <String>{};
    for (final t in data.timeOff) {
      final d = DateTime.tryParse('${t['date']}');
      if (d != null && _dk(d) == dk) onLeave.add('${t['staffMemberId']}');
    }
    final leaveStaff = data.staff
        .where((s) => onLeave.contains('${s['id']}'))
        .map((s) => valueOf(s, const ['fullName', 'name'], fallback: 'Personel'))
        .toList();

    if (appts.isEmpty && leaveStaff.isEmpty) {
      return _emptyBox('Bu gün için randevu yok.');
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(bottom: 10, left: 2),
          child: Text(
            'Bugün · ${appts.length} randevu',
            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: AppColors.ink),
          ),
        ),
        for (final a in appts) ...[
          _apptCard(a),
          const SizedBox(height: 10),
        ],
        for (final name in leaveStaff) ...[
          _leaveCard(name),
          const SizedBox(height: 10),
        ],
      ],
    );
  }

  Widget _apptCard(_ApptVM a) {
    final meta = _statusMeta(a.status);
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.border),
        boxShadow: [
          BoxShadow(
            color: AppColors.primary.withValues(alpha: .06),
            blurRadius: 18,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      clipBehavior: Clip.antiAlias,
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(width: 5, color: meta.bar),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
              child: SizedBox(
                width: 56,
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(CalendarText.hm(a.start),
                        style: const TextStyle(
                            fontSize: 17,
                            fontWeight: FontWeight.w800,
                            color: AppColors.ink)),
                    if (a.durationMin > 0)
                      Text('${a.durationMin}dk',
                          style: const TextStyle(
                              fontSize: 11, color: AppColors.muted)),
                  ],
                ),
              ),
            ),
            Container(width: 1, color: AppColors.border),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(14, 12, 12, 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(a.customer,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w700,
                            color: AppColors.ink)),
                    const SizedBox(height: 2),
                    Text(a.service,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                            color: AppColors.primary)),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        const Icon(Icons.person_rounded, size: 14, color: AppColors.muted),
                        const SizedBox(width: 4),
                        Expanded(
                          child: Text(a.staff,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(fontSize: 12, color: AppColors.muted)),
                        ),
                        const SizedBox(width: 6),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                          decoration: BoxDecoration(
                            color: meta.pillBg,
                            borderRadius: BorderRadius.circular(99),
                          ),
                          child: Text(meta.label,
                              style: TextStyle(
                                  fontSize: 10,
                                  fontWeight: FontWeight.w700,
                                  color: meta.pillText)),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _leaveCard(String name) {
    return Container(
      decoration: BoxDecoration(
        color: const Color(0xFFEFF5FC),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFFCFE2F5)),
      ),
      padding: const EdgeInsets.all(14),
      child: Row(
        children: [
          Container(
            width: 42,
            height: 42,
            decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle),
            child: const Icon(Icons.beach_access_rounded, color: Color(0xFF5AA9E6), size: 20),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                        fontSize: 14, fontWeight: FontWeight.w700, color: Color(0xFF2C5378))),
                const SizedBox(height: 2),
                const Text('Tüm gün izinli',
                    style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Color(0xFF3E86C0))),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // --- Haftalık ızgara -------------------------------------------------------

  Widget _weekGrid(_ScheduleData data) {
    if (data.staff.isEmpty) return _emptyBox('Personel bulunamadı.');
    final days = List.generate(7, (i) => _weekStart.add(Duration(days: i)));
    // izin: staffId|dayKey -> id
    final leave = <String, String>{};
    for (final t in data.timeOff) {
      final date = DateTime.tryParse('${t['date']}');
      if (date != null) leave['${t['staffMemberId']}|${_dk(date)}'] = '${t['id']}';
    }
    // sayım: staffId|dayKey -> n
    final counts = <String, int>{};
    for (final a in data.appointments) {
      final st = '${a['status']}'.toLowerCase();
      if (st == 'cancelled' || st == 'noshow') continue;
      final d = parseUtcToLocal(a['startUtc']);
      if (d == null) continue;
      final key = '${a['staffMemberId']}|${_dk(d)}';
      counts[key] = (counts[key] ?? 0) + 1;
    }

    const nameW = 110.0;
    const cellW = 46.0;
    final today = _dk(DateUtils.dateOnly(DateTime.now()));
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.border),
      ),
      clipBehavior: Clip.antiAlias,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // başlık satırı (gün → günlük görünüme atlar)
            Container(
              color: const Color(0xFFF7ECF1).withValues(alpha: .5),
              child: Row(
                children: [
                  const SizedBox(width: nameW, height: 52),
                  for (final d in days)
                    GestureDetector(
                      onTap: () => _jumpToDay(d),
                      child: SizedBox(
                        width: cellW,
                        height: 52,
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Text(CalendarText.weekdayShort[d.weekday - 1],
                                style: TextStyle(
                                    fontSize: 11,
                                    fontWeight: FontWeight.w700,
                                    color: _dk(d) == today ? AppColors.primary : AppColors.muted)),
                            const SizedBox(height: 2),
                            Container(
                              width: 24,
                              height: 24,
                              alignment: Alignment.center,
                              decoration: _dk(d) == today
                                  ? const BoxDecoration(color: AppColors.primary, shape: BoxShape.circle)
                                  : null,
                              child: Text('${d.day}',
                                  style: TextStyle(
                                      fontSize: 12,
                                      fontWeight: FontWeight.w800,
                                      color: _dk(d) == today ? Colors.white : AppColors.ink)),
                            ),
                          ],
                        ),
                      ),
                    ),
                ],
              ),
            ),
            const Divider(height: 1, color: AppColors.border),
            for (final s in data.staff)
              _weekRow(s, days, nameW, cellW, leave, counts),
          ],
        ),
      ),
    );
  }

  Widget _weekRow(
    Map<String, dynamic> staff,
    List<DateTime> days,
    double nameW,
    double cellW,
    Map<String, String> leave,
    Map<String, int> counts,
  ) {
    final staffId = '${staff['id']}';
    final name = valueOf(staff, const ['fullName', 'name'], fallback: 'Personel');
    final role = valueOf(staff, const ['title'], fallback: '');
    return Container(
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: Color(0xFFF0E7EC))),
      ),
      child: Row(
        children: [
          SizedBox(
            width: nameW,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
                  if (role.isNotEmpty)
                    Text(role,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 9.5, color: AppColors.muted)),
                ],
              ),
            ),
          ),
          for (final d in days)
            _weekCell(staffId, d, cellW, leave, counts),
        ],
      ),
    );
  }

  Widget _weekCell(
    String staffId,
    DateTime day,
    double cellW,
    Map<String, String> leave,
    Map<String, int> counts,
  ) {
    final key = '$staffId|${_dk(day)}';
    final leaveId = leave[key];
    final count = counts[key] ?? 0;
    Color bg;
    Widget child;
    if (leaveId != null) {
      bg = const Color(0xFF5AA9E6).withValues(alpha: .18);
      child = const Icon(Icons.beach_access_rounded, size: 16, color: Color(0xFF3E86C0));
    } else if (count == 0) {
      bg = const Color(0xFF2F9E72).withValues(alpha: .08);
      child = const SizedBox.shrink();
    } else if (count >= 4) {
      bg = const Color(0xFFE0617F).withValues(alpha: .18);
      child = Text('$count',
          style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13, color: Color(0xFFC23E5E)));
    } else {
      bg = const Color(0xFFB88938).withValues(alpha: .16);
      child = Text('$count',
          style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13, color: Color(0xFF946D23)));
    }
    return GestureDetector(
      onTap: () => _toggleLeave(staffId, day, leaveId),
      child: Container(
        width: cellW,
        height: 48,
        margin: const EdgeInsets.all(2),
        alignment: Alignment.center,
        decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(9)),
        child: child,
      ),
    );
  }

  // --- Aylık takvim ----------------------------------------------------------

  Widget _monthGrid(_ScheduleData data) {
    final apptByDay = <String, int>{};
    for (final a in data.appointments) {
      final st = '${a['status']}'.toLowerCase();
      if (st == 'cancelled' || st == 'noshow') continue;
      final d = parseUtcToLocal(a['startUtc']);
      if (d == null) continue;
      apptByDay[_dk(d)] = (apptByDay[_dk(d)] ?? 0) + 1;
    }
    final leaveByDay = <String, int>{};
    for (final t in data.timeOff) {
      final d = DateTime.tryParse('${t['date']}');
      if (d != null) leaveByDay[_dk(d)] = (leaveByDay[_dk(d)] ?? 0) + 1;
    }
    final maxCount = apptByDay.values.fold<int>(1, (m, v) => v > m ? v : m);

    final first = _monthFirst;
    final startDow = (first.weekday - 1) % 7; // Pzt=0
    final daysInMonth = _monthLast.day;
    final cells = <DateTime?>[
      ...List.filled(startDow, null),
      ...List.generate(daysInMonth, (i) => DateTime(first.year, first.month, i + 1)),
    ];
    while (cells.length % 7 != 0) {
      cells.add(null);
    }
    final today = _dk(DateUtils.dateOnly(DateTime.now()));

    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.border),
      ),
      padding: const EdgeInsets.all(12),
      child: Column(
        children: [
          Row(
            children: [
              for (final w in CalendarText.weekdayShort)
                Expanded(
                  child: Center(
                    child: Text(w,
                        style: const TextStyle(
                            fontSize: 10, fontWeight: FontWeight.w700, color: AppColors.muted)),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 8),
          GridView.builder(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            itemCount: cells.length,
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 7,
              mainAxisSpacing: 6,
              crossAxisSpacing: 6,
              childAspectRatio: .82,
            ),
            itemBuilder: (context, i) {
              final d = cells[i];
              if (d == null) return const SizedBox.shrink();
              final dk = _dk(d);
              final count = apptByDay[dk] ?? 0;
              final leaves = leaveByDay[dk] ?? 0;
              final isToday = dk == today;
              return GestureDetector(
                onTap: () => _jumpToDay(d),
                child: Container(
                  decoration: BoxDecoration(
                    color: isToday ? AppColors.surfaceSoft : Colors.white,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(
                        color: isToday ? AppColors.primary.withValues(alpha: .5) : AppColors.border),
                  ),
                  padding: const EdgeInsets.all(5),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text('${d.day}',
                              style: TextStyle(
                                  fontSize: 13,
                                  fontWeight: FontWeight.w800,
                                  color: isToday ? AppColors.primary : AppColors.ink)),
                          if (leaves > 0)
                            const Icon(Icons.beach_access_rounded, size: 11, color: Color(0xFF5AA9E6)),
                        ],
                      ),
                      const Spacer(),
                      if (count > 0) ...[
                        Text('$count',
                            style: const TextStyle(
                                fontSize: 14, fontWeight: FontWeight.w800, color: AppColors.primary)),
                        const SizedBox(height: 2),
                        ClipRRect(
                          borderRadius: BorderRadius.circular(99),
                          child: LinearProgressIndicator(
                            value: (count / maxCount).clamp(0.12, 1.0),
                            minHeight: 4,
                            backgroundColor: const Color(0xFFF7E9EE),
                            valueColor: const AlwaysStoppedAnimation(Color(0xFFE0617F)),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              );
            },
          ),
        ],
      ),
    );
  }

  // --- Ortak -----------------------------------------------------------------

  Widget _legend() {
    const items = [
      [Color(0xFF2F9E72), 'Tamamlandı'],
      [Color(0xFF3B82F6), 'Devam'],
      [Color(0xFFB88938), 'Bekliyor'],
      [Color(0xFF8B6FC9), 'Taslak'],
      [Color(0xFF5AA9E6), 'İzinli'],
    ];
    return Wrap(
      alignment: WrapAlignment.center,
      spacing: 14,
      runSpacing: 6,
      children: [
        for (final it in items)
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 9,
                height: 9,
                decoration: BoxDecoration(color: it[0] as Color, shape: BoxShape.circle),
              ),
              const SizedBox(width: 5),
              Text(it[1] as String,
                  style: const TextStyle(fontSize: 11.5, color: AppColors.muted)),
            ],
          ),
      ],
    );
  }

  Widget _emptyBox(String message) => Container(
        padding: const EdgeInsets.symmetric(vertical: 40, horizontal: 20),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: AppColors.border),
        ),
        child: Center(
          child: Text(message,
              style: const TextStyle(color: AppColors.muted, fontSize: 13)),
        ),
      );

  Widget _errorBox(String message) => Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          children: [
            const Icon(Icons.cloud_off_rounded, size: 40, color: AppColors.primary),
            const SizedBox(height: 10),
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: _reload,
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('Tekrar dene'),
            ),
          ],
        ),
      );
}

class _ApptVM {
  _ApptVM({
    required this.start,
    required this.durationMin,
    required this.customer,
    required this.service,
    required this.staff,
    required this.status,
  });
  final DateTime start;
  final int durationMin;
  final String customer;
  final String service;
  final String staff;
  final String status;
}

class _ScheduleData {
  _ScheduleData({
    required this.staff,
    required this.appointments,
    required this.timeOff,
  });
  final List<Map<String, dynamic>> staff;
  final List<Map<String, dynamic>> appointments;
  final List<Map<String, dynamic>> timeOff;
}
