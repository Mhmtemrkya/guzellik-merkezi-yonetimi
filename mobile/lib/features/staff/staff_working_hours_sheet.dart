import 'package:flutter/material.dart';

import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';

const _dayLabels = [
  'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar',
];

class _DayRow {
  _DayRow(this.day, this.start, this.end, this.off);
  final int day;
  int start;
  int end;
  bool off;
}

String _fmt(int m) =>
    '${(m ~/ 60).toString().padLeft(2, '0')}:${(m % 60).toString().padLeft(2, '0')}';

/// Personel haftalık çalışma saatleri — mesai penceresi dışına (mobil/web/online)
/// randevu alınamaz. Şablon hiç kaydedilmemişse personel kısıtsız çalışır.
/// Web StaffWorkingHoursDialog'un mobil karşılığı.
class StaffWorkingHoursSheet extends StatefulWidget {
  const StaffWorkingHoursSheet({
    required this.api,
    required this.staffId,
    required this.staffName,
    super.key,
  });
  final ApiClient api;
  final String staffId;
  final String staffName;

  @override
  State<StaffWorkingHoursSheet> createState() => _StaffWorkingHoursSheetState();
}

class _StaffWorkingHoursSheetState extends State<StaffWorkingHoursSheet> {
  bool _loading = true;
  bool _busy = false;
  bool _hasTemplate = false;
  // Kurum geneli anahtar: kapalıysa şablonlar saklanır ama denetlenmez.
  bool _enforced = true;
  late List<_DayRow> _rows;

  @override
  void initState() {
    super.initState();
    _rows = [
      for (var i = 0; i < 7; i++) _DayRow(i, 540, 1140, i == 6),
    ];
    _load();
  }

  Future<void> _toggleEnforcement(bool enabled) async {
    setState(() => _enforced = enabled);
    try {
      await widget.api.put('/api/admin/schedule/working-hours-enforcement',
          {'enabled': enabled});
    } catch (e) {
      if (mounted) {
        setState(() => _enforced = !enabled);
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }

  Future<void> _load() async {
    try {
      final enf = await widget.api
          .get('/api/admin/schedule/working-hours-enforcement')
          .catchError((_) => const <String, dynamic>{});
      if (enf is Map && mounted) {
        setState(() => _enforced = enf['enabled'] != false);
      }
      final res = await widget.api
          .get('/api/admin/schedule/working-hours/${widget.staffId}');
      final days = res is Map ? (res['days'] as List? ?? const []) : const [];
      if (!mounted) return;
      setState(() {
        _hasTemplate = days.isNotEmpty;
        if (days.isNotEmpty) {
          final map = <int, Map>{};
          for (final d in days) {
            if (d is Map) map[(d['dayOfWeek'] as num?)?.toInt() ?? 0] = d;
          }
          _rows = [
            for (var i = 0; i < 7; i++)
              map.containsKey(i)
                  ? _DayRow(
                      i,
                      (map[i]!['startMinute'] as num?)?.toInt() ?? 540,
                      (map[i]!['endMinute'] as num?)?.toInt() ?? 1140,
                      map[i]!['isDayOff'] == true,
                    )
                  : _DayRow(i, 540, 1140, true),
          ];
        }
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _pickTime(_DayRow r, bool isStart) async {
    final current = isStart ? r.start : r.end;
    final picked = await showTimePicker(
      context: context,
      initialTime: TimeOfDay(hour: current ~/ 60, minute: current % 60),
    );
    if (picked == null) return;
    setState(() {
      final m = picked.hour * 60 + picked.minute;
      if (isStart) {
        r.start = m;
      } else {
        r.end = m;
      }
    });
  }

  Future<void> _save({bool clear = false}) async {
    setState(() => _busy = true);
    try {
      await widget.api
          .put('/api/admin/schedule/working-hours/${widget.staffId}', {
        'days': clear
            ? const []
            : [
                for (final r in _rows)
                  {
                    'dayOfWeek': r.day,
                    'startMinute': r.start,
                    'endMinute': r.end,
                    'isDayOff': r.off,
                  },
              ],
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(clear
                ? 'Şablon temizlendi — personel kısıtsız çalışır.'
                : 'Çalışma saatleri kaydedildi.')));
        Navigator.pop(context, true);
      }
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
    return Padding(
      padding:
          EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(18, 16, 18, 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Çalışma Saatleri · ${widget.staffName}',
                style: const TextStyle(
                    fontSize: 16, fontWeight: FontWeight.w800)),
            const SizedBox(height: 4),
            const Text(
              'Mesai penceresi dışına (online dahil) randevu alınamaz.',
              style: TextStyle(fontSize: 11.5, color: AppColors.muted),
            ),
            const SizedBox(height: 12),
            if (_loading)
              const Center(
                  child: Padding(
                padding: EdgeInsets.symmetric(vertical: 40),
                child: CircularProgressIndicator(),
              ))
            else ...[
              // Kurum geneli anahtar — yönetici kısıtı tamamen kapatabilir.
              Container(
                margin: const EdgeInsets.only(bottom: 10),
                padding: const EdgeInsets.symmetric(horizontal: 10),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppColors.border),
                ),
                child: SwitchListTile.adaptive(
                  contentPadding: EdgeInsets.zero,
                  value: _enforced,
                  onChanged: _busy ? null : _toggleEnforcement,
                  title: const Text('Çalışma saatleri kısıtı (kurum geneli)',
                      style: TextStyle(
                          fontSize: 12.5, fontWeight: FontWeight.w700)),
                  subtitle: Text(
                    _enforced
                        ? 'Açık — mesai dışına randevu alınamaz'
                        : 'Kapalı — şablonlar saklanır ama denetlenmez',
                    style: const TextStyle(
                        fontSize: 10.5, color: AppColors.muted),
                  ),
                ),
              ),
              if (!_hasTemplate)
                Container(
                  margin: const EdgeInsets.only(bottom: 10),
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFFF8E6),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: const Color(0xFFF2DFA8)),
                  ),
                  child: const Text(
                    'Şablon kaydedilmemiş — personel şu an her saatte randevu alabilir. Kaydedince pencere geçerli olur.',
                    style: TextStyle(fontSize: 11.5, color: Color(0xFF8A6D1E)),
                  ),
                ),
              for (final r in _rows)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Row(
                    children: [
                      SizedBox(
                          width: 82,
                          child: Text(_dayLabels[r.day],
                              style: const TextStyle(
                                  fontSize: 12.5,
                                  fontWeight: FontWeight.w700))),
                      Expanded(
                        child: r.off
                            ? const Text('Tatil',
                                style: TextStyle(
                                    fontSize: 12, color: AppColors.muted))
                            : Row(
                                children: [
                                  _timeChip(_fmt(r.start),
                                      () => _pickTime(r, true)),
                                  const Padding(
                                    padding:
                                        EdgeInsets.symmetric(horizontal: 6),
                                    child: Text('–'),
                                  ),
                                  _timeChip(
                                      _fmt(r.end), () => _pickTime(r, false)),
                                ],
                              ),
                      ),
                      Switch(
                        value: !r.off,
                        onChanged: (v) => setState(() => r.off = !v),
                      ),
                    ],
                  ),
                ),
              const SizedBox(height: 8),
              FilledButton.icon(
                onPressed: _busy ? null : () => _save(),
                icon: const Icon(Icons.schedule_rounded, size: 18),
                label: Text(_busy ? 'Kaydediliyor…' : 'Kaydet'),
              ),
              if (_hasTemplate)
                TextButton(
                  onPressed: _busy ? null : () => _save(clear: true),
                  child: const Text('Şablonu temizle (kısıtsız çalışsın)',
                      style: TextStyle(fontSize: 12)),
                ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _timeChip(String text, VoidCallback onTap) => InkWell(
        borderRadius: BorderRadius.circular(10),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: AppColors.border),
          ),
          child: Text(text,
              style: const TextStyle(
                  fontSize: 12.5, fontWeight: FontWeight.w700)),
        ),
      );
}
