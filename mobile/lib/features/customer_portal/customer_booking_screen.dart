import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/responsive.dart';
import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';

/// 4 adımlı online randevu: Hizmet → Uzman → Tarih & Saat → Onay.
/// Dolu slotlar pasif (tıklanamaz). Onayda randevu doğrudan sisteme (personel takvimine) düşer.
class CustomerBookingScreen extends StatefulWidget {
  const CustomerBookingScreen({required this.api, required this.branch, super.key});
  final ApiClient api;
  final Map<String, dynamic> branch;

  @override
  State<CustomerBookingScreen> createState() => _CustomerBookingScreenState();
}

class _CustomerBookingScreenState extends State<CustomerBookingScreen> {
  int _step = 0;

  // Adım verileri
  Map<String, dynamic>? _service;
  Map<String, dynamic>? _staff;
  DateTime _date = DateTime.now();
  Map<String, dynamic>? _slot; // {start,end,available}

  String get _branchId => widget.branch['id'].toString();

  static const _steps = ['Hizmet', 'Uzman', 'Tarih & Saat', 'Onay'];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Online Randevu'),
        backgroundColor: AppColors.background,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, size: 18),
          onPressed: () => _step == 0 ? context.pop() : setState(() => _step--),
        ),
      ),
      body: SafeArea(
        child: Column(children: [
          _StepHeader(steps: _steps, current: _step),
          Expanded(child: _body()),
        ]),
      ),
    );
  }

  Widget _body() {
    switch (_step) {
      case 0:
        return _ServiceStep(
          api: widget.api,
          branchId: _branchId,
          selectedId: _service?['id']?.toString(),
          onPick: (s) => setState(() {
            _service = s;
            _staff = null;
            _slot = null;
            _step = 1;
          }),
        );
      case 1:
        return _StaffStep(
          api: widget.api,
          branchId: _branchId,
          serviceId: _service!['id'].toString(),
          selectedId: _staff?['id']?.toString(),
          onPick: (s) => setState(() {
            _staff = s;
            _slot = null;
            _step = 2;
          }),
        );
      case 2:
        return _DateTimeStep(
          api: widget.api,
          branchId: _branchId,
          staffId: _staff!['id'].toString(),
          serviceId: _service!['id'].toString(),
          date: _date,
          selectedSlot: _slot,
          onDate: (d) => setState(() {
            _date = d;
            _slot = null;
          }),
          onSlot: (s) => setState(() {
            _slot = s;
            _step = 3;
          }),
        );
      default:
        return _ConfirmStep(
          api: widget.api,
          branch: widget.branch,
          service: _service!,
          staff: _staff!,
          date: _date,
          slot: _slot!,
          onDone: () => context.pop(),
        );
    }
  }
}

class _StepHeader extends StatelessWidget {
  const _StepHeader({required this.steps, required this.current});
  final List<String> steps;
  final int current;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
      child: Row(
        children: List.generate(steps.length, (i) {
          final done = i < current;
          final active = i == current;
          final color = (done || active) ? AppColors.primary : AppColors.border;
          return Expanded(
            child: Column(children: [
              Row(children: [
                Expanded(child: Container(height: 2, color: i == 0 ? Colors.transparent : (i <= current ? AppColors.primary : AppColors.border))),
                CircleAvatar(
                  radius: 13,
                  backgroundColor: color,
                  child: done
                      ? const Icon(Icons.check_rounded, size: 15, color: Colors.white)
                      : Text('${i + 1}', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: active ? Colors.white : AppColors.muted)),
                ),
                Expanded(child: Container(height: 2, color: i == steps.length - 1 ? Colors.transparent : (i < current ? AppColors.primary : AppColors.border))),
              ]),
              const SizedBox(height: 4),
              Text(steps[i], textAlign: TextAlign.center, style: TextStyle(fontSize: 10.5, fontWeight: active ? FontWeight.w700 : FontWeight.w500, color: active ? AppColors.primaryDark : AppColors.muted)),
            ]),
          );
        }),
      ),
    );
  }
}

// ----- Adım 1: Hizmet -----
class _ServiceStep extends StatefulWidget {
  const _ServiceStep({required this.api, required this.branchId, required this.selectedId, required this.onPick});
  final ApiClient api;
  final String branchId;
  final String? selectedId;
  final ValueChanged<Map<String, dynamic>> onPick;

  @override
  State<_ServiceStep> createState() => _ServiceStepState();
}

class _ServiceStepState extends State<_ServiceStep> {
  late Future<List<dynamic>> _future;

  @override
  void initState() {
    super.initState();
    _future = widget.api.get('/api/customer/branches/${widget.branchId}/services').then((v) => (v as List).cast<dynamic>());
  }

  @override
  Widget build(BuildContext context) {
    return _AsyncList(
      future: _future,
      emptyText: 'Bu şubede aktif hizmet yok.',
      builder: (items) => ListView.separated(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
        itemCount: items.length,
        separatorBuilder: (_, _) => const SizedBox(height: 10),
        itemBuilder: (_, i) {
          final s = (items[i] as Map).cast<String, dynamic>();
          return Card(
            child: ListTile(
              leading: const CircleAvatar(backgroundColor: AppColors.rose, child: Icon(Icons.spa_rounded, color: AppColors.primaryDark)),
              title: Text(s['name']?.toString() ?? '', style: const TextStyle(fontWeight: FontWeight.w700)),
              subtitle: Text('${s['category'] ?? ''} · ${s['durationMinutes'] ?? '-'} dk'),
              trailing: Text('₺${_money(s['price'])}', style: const TextStyle(fontWeight: FontWeight.w800, color: AppColors.primaryDark)),
              onTap: () => widget.onPick(s),
            ),
          );
        },
      ),
    );
  }
}

// ----- Adım 2: Uzman -----
class _StaffStep extends StatefulWidget {
  const _StaffStep({required this.api, required this.branchId, required this.serviceId, required this.selectedId, required this.onPick});
  final ApiClient api;
  final String branchId;
  final String serviceId;
  final String? selectedId;
  final ValueChanged<Map<String, dynamic>> onPick;

  @override
  State<_StaffStep> createState() => _StaffStepState();
}

class _StaffStepState extends State<_StaffStep> {
  late Future<List<dynamic>> _future;

  @override
  void initState() {
    super.initState();
    _future = widget.api
        .get('/api/customer/branches/${widget.branchId}/staff', query: {'serviceId': widget.serviceId})
        .then((v) => (v as List).cast<dynamic>());
  }

  @override
  Widget build(BuildContext context) {
    return _AsyncList(
      future: _future,
      emptyText: 'Bu hizmet için uzman bulunamadı.',
      builder: (items) => ListView.separated(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
        itemCount: items.length,
        separatorBuilder: (_, _) => const SizedBox(height: 10),
        itemBuilder: (_, i) {
          final s = (items[i] as Map).cast<String, dynamic>();
          return Card(
            child: ListTile(
              leading: const CircleAvatar(backgroundColor: AppColors.rose, child: Icon(Icons.person_rounded, color: AppColors.primaryDark)),
              title: Text(s['fullName']?.toString() ?? '', style: const TextStyle(fontWeight: FontWeight.w700)),
              subtitle: Text(s['title']?.toString() ?? ''),
              trailing: OutlinedButton(onPressed: () => widget.onPick(s), child: const Text('Seç')),
              onTap: () => widget.onPick(s),
            ),
          );
        },
      ),
    );
  }
}

// ----- Adım 3: Tarih & Saat -----
class _DateTimeStep extends StatefulWidget {
  const _DateTimeStep({
    required this.api,
    required this.branchId,
    required this.staffId,
    required this.serviceId,
    required this.date,
    required this.selectedSlot,
    required this.onDate,
    required this.onSlot,
  });
  final ApiClient api;
  final String branchId;
  final String staffId;
  final String serviceId;
  final DateTime date;
  final Map<String, dynamic>? selectedSlot;
  final ValueChanged<DateTime> onDate;
  final ValueChanged<Map<String, dynamic>> onSlot;

  @override
  State<_DateTimeStep> createState() => _DateTimeStepState();
}

class _DateTimeStepState extends State<_DateTimeStep> {
  late Future<Map<String, dynamic>> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  @override
  void didUpdateWidget(covariant _DateTimeStep old) {
    super.didUpdateWidget(old);
    if (old.date != widget.date) _future = _load();
  }

  Future<Map<String, dynamic>> _load() async {
    final d = '${widget.date.year.toString().padLeft(4, '0')}-${widget.date.month.toString().padLeft(2, '0')}-${widget.date.day.toString().padLeft(2, '0')}';
    final data = await widget.api.get('/api/customer/availability', query: {
      'branchId': widget.branchId,
      'staffId': widget.staffId,
      'serviceId': widget.serviceId,
      'date': d,
    });
    return (data as Map).cast<String, dynamic>();
  }

  @override
  Widget build(BuildContext context) {
    final today = DateTime.now();
    final days = List.generate(14, (i) => DateTime(today.year, today.month, today.day).add(Duration(days: i)));
    const wd = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
    return Column(children: [
      SizedBox(
        height: 76,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 16),
          itemCount: days.length,
          separatorBuilder: (_, _) => const SizedBox(width: 8),
          itemBuilder: (_, i) {
            final d = days[i];
            final sel = d.year == widget.date.year && d.month == widget.date.month && d.day == widget.date.day;
            return GestureDetector(
              onTap: () => widget.onDate(d),
              child: Container(
                width: 54,
                decoration: BoxDecoration(
                  color: sel ? AppColors.primary : AppColors.surface,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: sel ? AppColors.primary : AppColors.border),
                ),
                child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                  Text(wd[d.weekday - 1], style: TextStyle(fontSize: 11, color: sel ? Colors.white70 : AppColors.muted)),
                  const SizedBox(height: 3),
                  Text('${d.day}', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: sel ? Colors.white : AppColors.ink)),
                ]),
              ),
            );
          },
        ),
      ),
      const SizedBox(height: 8),
      Expanded(
        child: FutureBuilder<Map<String, dynamic>>(
          future: _future,
          builder: (context, snap) {
            if (snap.connectionState == ConnectionState.waiting) {
              return const Center(child: CircularProgressIndicator());
            }
            if (snap.hasError) {
              return Center(child: Text('${snap.error}', style: const TextStyle(color: AppColors.muted)));
            }
            final slots = ((snap.data!['slots'] as List?) ?? const []).cast<dynamic>();
            if (slots.isEmpty) {
              return const Center(child: Text('Bu gün için uygun saat yok.', style: TextStyle(color: AppColors.muted)));
            }
            return GridView.builder(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
              gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: gridCols(context, 4), childAspectRatio: 2.1, crossAxisSpacing: 8, mainAxisSpacing: 8),
              itemCount: slots.length,
              itemBuilder: (_, i) {
                final s = (slots[i] as Map).cast<String, dynamic>();
                final available = s['available'] == true;
                final selected = widget.selectedSlot?['start'] == s['start'];
                return InkWell(
                  onTap: available ? () => widget.onSlot(s) : null,
                  borderRadius: BorderRadius.circular(12),
                  child: Container(
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: selected ? AppColors.primary : (available ? AppColors.surface : AppColors.surfaceSoft),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: selected ? AppColors.primary : AppColors.border),
                    ),
                    child: Text(
                      s['start']?.toString() ?? '',
                      style: TextStyle(
                        fontWeight: FontWeight.w700,
                        color: selected ? Colors.white : (available ? AppColors.ink : AppColors.muted),
                        decoration: available ? null : TextDecoration.lineThrough,
                      ),
                    ),
                  ),
                );
              },
            );
          },
        ),
      ),
    ]);
  }
}

// ----- Adım 4: Onay -----
class _ConfirmStep extends StatefulWidget {
  const _ConfirmStep({
    required this.api,
    required this.branch,
    required this.service,
    required this.staff,
    required this.date,
    required this.slot,
    required this.onDone,
  });
  final ApiClient api;
  final Map<String, dynamic> branch;
  final Map<String, dynamic> service;
  final Map<String, dynamic> staff;
  final DateTime date;
  final Map<String, dynamic> slot;
  final VoidCallback onDone;

  @override
  State<_ConfirmStep> createState() => _ConfirmStepState();
}

class _ConfirmStepState extends State<_ConfirmStep> {
  bool _saving = false;
  String? _error;

  DateTime _startUtc() {
    final parts = (widget.slot['start'] as String).split(':');
    final hh = int.parse(parts[0]);
    final mm = int.parse(parts[1]);
    // Yerel Türkiye saati (+03:00) → UTC instant.
    return DateTime.utc(widget.date.year, widget.date.month, widget.date.day, hh, mm).subtract(const Duration(hours: 3));
  }

  Future<void> _confirm() async {
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await widget.api.post('/api/customer/appointments', {
        'branchId': widget.branch['id'],
        'staffMemberId': widget.staff['id'],
        'serviceDefinitionId': widget.service['id'],
        'startUtc': _startUtc().toIso8601String(),
        'notes': null,
      });
      if (!mounted) return;
      showDialog<void>(
        context: context,
        builder: (_) => AlertDialog(
          icon: const Icon(Icons.check_circle_rounded, color: AppColors.success, size: 48),
          title: const Text('Randevunuz alındı'),
          content: const Text('Randevunuz oluşturuldu ve kurumun takvimine işlendi. "Randevularım" sayfasından takip edebilirsiniz.'),
          actions: [FilledButton(onPressed: () { Navigator.pop(context); widget.onDone(); }, child: const Text('Tamam'))],
        ),
      );
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
      children: [
        const Text('Randevu Bilgileriniz', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
        const SizedBox(height: 4),
        const Text('Lütfen bilgileri kontrol edip onaylayın.', style: TextStyle(color: AppColors.muted)),
        const SizedBox(height: 16),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(children: [
              if ((widget.branch['tenantName']?.toString() ?? '').isNotEmpty)
                _row(Icons.business_rounded, 'Kurum', '${widget.branch['tenantName']}'),
              _row(Icons.storefront_rounded, 'Şube', '${widget.branch['name']} · ${widget.branch['city']}'),
              _row(Icons.spa_rounded, 'Hizmet', '${widget.service['name']}  ·  ₺${_money(widget.service['price'])}'),
              _row(Icons.person_rounded, 'Uzman', '${widget.staff['fullName']}'),
              _row(Icons.event_rounded, 'Tarih', _fmtDate(widget.date)),
              _row(Icons.schedule_rounded, 'Saat', '${widget.slot['start']} - ${widget.slot['end']}'),
            ]),
          ),
        ),
        if (_error != null) ...[
          const SizedBox(height: 12),
          Text(_error!, style: const TextStyle(color: AppColors.danger, fontWeight: FontWeight.w600)),
        ],
        const SizedBox(height: 20),
        FilledButton.icon(
          onPressed: _saving ? null : _confirm,
          icon: _saving
              ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
              : const Icon(Icons.check_rounded),
          label: const Text('Randevuyu Onayla'),
        ),
      ],
    );
  }

  Widget _row(IconData icon, String label, String value) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Row(children: [
          Icon(icon, size: 18, color: AppColors.primary),
          const SizedBox(width: 12),
          SizedBox(width: 64, child: Text(label, style: const TextStyle(color: AppColors.muted, fontSize: 13))),
          Expanded(child: Text(value, textAlign: TextAlign.right, style: const TextStyle(fontWeight: FontWeight.w600))),
        ]),
      );
}

// ----- ortak -----
class _AsyncList extends StatelessWidget {
  const _AsyncList({required this.future, required this.builder, required this.emptyText});
  final Future<List<dynamic>> future;
  final Widget Function(List<dynamic>) builder;
  final String emptyText;

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<dynamic>>(
      future: future,
      builder: (context, snap) {
        if (snap.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }
        if (snap.hasError) {
          return Center(child: Padding(padding: const EdgeInsets.all(24), child: Text('${snap.error}', textAlign: TextAlign.center, style: const TextStyle(color: AppColors.muted))));
        }
        final items = snap.data ?? const [];
        if (items.isEmpty) {
          return Center(child: Text(emptyText, style: const TextStyle(color: AppColors.muted)));
        }
        return builder(items);
      },
    );
  }
}

String _money(dynamic v) {
  final n = (v is num) ? v : num.tryParse('$v') ?? 0;
  return n.toStringAsFixed(n == n.roundToDouble() ? 0 : 2);
}

String _fmtDate(DateTime d) {
  const months = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  const wd = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
  return '${d.day} ${months[d.month - 1]} ${d.year}, ${wd[d.weekday - 1]}';
}
