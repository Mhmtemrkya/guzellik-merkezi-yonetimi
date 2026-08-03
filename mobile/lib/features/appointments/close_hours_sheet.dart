import 'package:flutter/material.dart';

import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/json_helpers.dart';
import 'calendar_theme.dart';

/// "Gün Kapat" — seçilen personellerin o gündeki bir SAAT ARALIĞINI (ya da tüm günü)
/// randevuya kapatır. Web'deki DayScheduleModal → CloseHoursPanel ile paritededir.
class CloseHoursSheet extends StatefulWidget {
  const CloseHoursSheet({
    required this.api,
    required this.date,
    required this.staff,
    required this.dayAppointments,
    required this.existingTimeOff,
    this.presetStaffId,
    super.key,
  });

  final ApiClient api;
  final DateTime date;
  final List<Map<String, dynamic>> staff;
  final List<Map<String, dynamic>> dayAppointments;
  final List<Map<String, dynamic>> existingTimeOff;
  final String? presetStaffId;

  @override
  State<CloseHoursSheet> createState() => _CloseHoursSheetState();
}

class _CloseHoursSheetState extends State<CloseHoursSheet> {
  static const _presets = [
    ('Öğle arası', 12 * 60, 13 * 60),
    ('Sabah', 9 * 60, 13 * 60),
    ('Öğleden sonra', 13 * 60, 19 * 60),
  ];

  final _selected = <String>{};
  final _reason = TextEditingController();
  bool _allDay = false;
  int _start = 12 * 60;
  int _end = 13 * 60;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    if (widget.presetStaffId != null) _selected.add(widget.presetStaffId!);
  }

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  String get _isoDate =>
      '${widget.date.year.toString().padLeft(4, '0')}-'
      '${widget.date.month.toString().padLeft(2, '0')}-'
      '${widget.date.day.toString().padLeft(2, '0')}';

  bool get _rangeValid => _allDay || _end > _start;

  /// Kapatılacak aralıkta kalan randevular — kapatma bunları İPTAL ETMEZ, uyarı gösterilir.
  int get _affectedCount {
    if (_selected.isEmpty || !_rangeValid) return 0;
    final s = _allDay ? 0 : _start;
    final e = _allDay ? 24 * 60 : _end;
    var count = 0;
    for (final a in widget.dayAppointments) {
      if (!_selected.contains('${a['staffMemberId']}')) continue;
      if ('${a['status']}'.toLowerCase() == 'cancelled') continue;
      final start = DateTime.tryParse('${a['startUtc']}')?.toLocal();
      final end = DateTime.tryParse('${a['endUtc']}')?.toLocal();
      if (start == null || end == null) continue;
      if (!DateUtils.isSameDay(start, widget.date)) continue;
      final aStart = start.hour * 60 + start.minute;
      final aEnd = end.hour * 60 + end.minute;
      if (aStart < e && s < aEnd) count++;
    }
    return count;
  }

  /// Seçili personellerden bu aralığı zaten kapalı olanlar — sunucu çakışma döndürmeden söylenir.
  List<String> get _alreadyClosed {
    if (_selected.isEmpty || !_rangeValid) return const [];
    final s = _allDay ? 0 : _start;
    final e = _allDay ? 24 * 60 : _end;
    final names = <String>[];
    for (final st in widget.staff) {
      final id = '${st['id']}';
      if (!_selected.contains(id)) continue;
      for (final t in widget.existingTimeOff) {
        if ('${t['staffMemberId']}' != id) continue;
        final ts = timeOffIsFullDay(t) ? 0 : (asInt(t['startMinute']) ?? 0);
        final te = timeOffIsFullDay(t) ? 24 * 60 : (asInt(t['endMinute']) ?? 24 * 60);
        if (ts < e && s < te) {
          names.add(valueOf(st, const ['fullName', 'name']));
          break;
        }
      }
    }
    return names;
  }

  Future<void> _pickTime({required bool isStart}) async {
    final base = isStart ? _start : _end;
    final picked = await showTimePicker(
      context: context,
      initialTime: TimeOfDay(hour: base ~/ 60, minute: base % 60),
      builder: (ctx, child) => MediaQuery(
        data: MediaQuery.of(ctx).copyWith(alwaysUse24HourFormat: true),
        child: child!,
      ),
    );
    if (picked == null) return;
    setState(() {
      final value = picked.hour * 60 + picked.minute;
      if (isStart) {
        _start = value;
        if (_end <= _start) _end = (_start + 60).clamp(0, 24 * 60);
      } else {
        _end = value == 0 ? 24 * 60 : value;
      }
      _error = null;
    });
  }

  Future<void> _submit() async {
    if (_selected.isEmpty) {
      setState(() => _error = 'En az bir personel seçin.');
      return;
    }
    if (!_rangeValid) {
      setState(() => _error = 'Bitiş saati başlangıçtan sonra olmalı.');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    final failures = <String>[];
    for (final id in _selected) {
      try {
        await widget.api.post('/api/admin/schedule/timeoff', {
          'staffMemberId': id,
          'date': _isoDate,
          'reason': _reason.text.trim().isEmpty ? null : _reason.text.trim(),
          'startMinute': _allDay ? null : _start,
          'endMinute': _allDay ? null : _end,
        });
      } catch (e) {
        // "zaten kapalı / zaten izin tanımlı" = hedef durum sağlanmış, hata sayma.
        final msg = '$e';
        if (msg.toLowerCase().contains('zaten')) continue;
        final name = widget.staff.firstWhere(
          (s) => '${s['id']}' == id,
          orElse: () => const {},
        );
        failures.add('${valueOf(name, const ['fullName', 'name'], fallback: 'Personel')}: $msg');
      }
    }
    if (!mounted) return;
    if (failures.isNotEmpty) {
      setState(() {
        _saving = false;
        _error = failures.join('\n');
      });
      return;
    }
    Navigator.pop(context, true);
  }

  @override
  Widget build(BuildContext context) {
    final affected = _affectedCount;
    final closed = _alreadyClosed;
    return Padding(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 18,
        bottom: MediaQuery.of(context).viewInsets.bottom + 24,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.lock_clock_rounded, color: AppColors.primary),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Gün / Saat Kapat',
                        style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
                      ),
                      Text(
                        CalendarText.longDate(widget.date),
                        style: const TextStyle(fontSize: 12, color: AppColors.muted),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  onPressed: _saving ? null : () => Navigator.pop(context, false),
                  icon: const Icon(Icons.close_rounded),
                ),
              ],
            ),
            const SizedBox(height: 12),

            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Personel', style: TextStyle(fontWeight: FontWeight.w700)),
                if (widget.staff.length > 1)
                  TextButton(
                    onPressed: _saving
                        ? null
                        : () => setState(() {
                            if (_selected.length == widget.staff.length) {
                              _selected.clear();
                            } else {
                              _selected
                                ..clear()
                                ..addAll(widget.staff.map((s) => '${s['id']}'));
                            }
                          }),
                    child: Text(
                      _selected.length == widget.staff.length ? 'Seçimi kaldır' : 'Tümünü seç',
                    ),
                  ),
              ],
            ),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final s in widget.staff)
                  FilterChip(
                    label: Text(valueOf(s, const ['fullName', 'name'])),
                    selected: _selected.contains('${s['id']}'),
                    onSelected: _saving
                        ? null
                        : (on) => setState(() {
                            final id = '${s['id']}';
                            if (on) {
                              _selected.add(id);
                            } else {
                              _selected.remove(id);
                            }
                            _error = null;
                          }),
                  ),
              ],
            ),
            const SizedBox(height: 16),

            const Text('Kapatılacak zaman', style: TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            SegmentedButton<bool>(
              segments: const [
                ButtonSegment(value: false, label: Text('Saat aralığı')),
                ButtonSegment(value: true, label: Text('Tüm gün')),
              ],
              selected: {_allDay},
              onSelectionChanged: _saving
                  ? null
                  : (v) => setState(() {
                      _allDay = v.first;
                      _error = null;
                    }),
            ),
            if (!_allDay) ...[
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: _saving ? null : () => _pickTime(isStart: true),
                      icon: const Icon(Icons.schedule_rounded, size: 18),
                      label: Text(CalendarText.minuteLabel(_start)),
                    ),
                  ),
                  const Padding(
                    padding: EdgeInsets.symmetric(horizontal: 8),
                    child: Text('→'),
                  ),
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: _saving ? null : () => _pickTime(isStart: false),
                      icon: const Icon(Icons.schedule_rounded, size: 18),
                      label: Text(CalendarText.minuteLabel(_end)),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final p in _presets)
                    ActionChip(
                      label: Text(
                        '${p.$1} · ${CalendarText.minuteLabel(p.$2)}-${CalendarText.minuteLabel(p.$3)}',
                        style: const TextStyle(fontSize: 11.5),
                      ),
                      onPressed: _saving
                          ? null
                          : () => setState(() {
                              _start = p.$2;
                              _end = p.$3;
                              _error = null;
                            }),
                    ),
                ],
              ),
            ],
            const SizedBox(height: 16),

            TextField(
              controller: _reason,
              enabled: !_saving,
              maxLength: 300,
              decoration: const InputDecoration(
                labelText: 'Sebep (isteğe bağlı)',
                hintText: 'Eğitim, izin, bakım…',
                counterText: '',
              ),
            ),

            if (closed.isNotEmpty) ...[
              const SizedBox(height: 8),
              _Notice(
                icon: Icons.lock_outline_rounded,
                bg: const Color(0xFFFAF1F5),
                fg: const Color(0xFF7C5568),
                text: '${closed.join(', ')} için bu aralık zaten kapalı — atlanacak.',
              ),
            ],
            if (affected > 0) ...[
              const SizedBox(height: 8),
              _Notice(
                icon: Icons.warning_amber_rounded,
                bg: const Color(0xFFFFF7E6),
                fg: const Color(0xFF8A6416),
                text:
                    'Bu aralıkta $affected randevu var. Kapatma bunları iptal etmez; '
                    'gerekirse ayrıca taşıyın veya iptal edin.',
              ),
            ],
            if (_error != null) ...[
              const SizedBox(height: 8),
              _Notice(
                icon: Icons.error_outline_rounded,
                bg: const Color(0xFFFDECEF),
                fg: const Color(0xFFB3253F),
                text: _error!,
              ),
            ],

            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: _saving ? null : () => Navigator.pop(context, false),
                    child: const Text('Vazgeç'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: FilledButton.icon(
                    onPressed: _saving || _selected.isEmpty || !_rangeValid ? null : _submit,
                    icon: _saving
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.lock_rounded, size: 18),
                    label: Text(
                      _saving
                          ? 'Kapatılıyor…'
                          : _allDay
                          ? 'Günü kapat'
                          : 'Saatleri kapat',
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _Notice extends StatelessWidget {
  const _Notice({
    required this.icon,
    required this.bg,
    required this.fg,
    required this.text,
  });
  final IconData icon;
  final Color bg;
  final Color fg;
  final String text;

  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
    decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(12)),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 16, color: fg),
        const SizedBox(width: 8),
        Expanded(
          child: Text(text, style: TextStyle(fontSize: 12, color: fg)),
        ),
      ],
    ),
  );
}
