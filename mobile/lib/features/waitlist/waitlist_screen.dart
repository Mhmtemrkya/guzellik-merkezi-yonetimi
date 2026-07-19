import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/json_helpers.dart';
import '../../shared/widgets/app_background.dart';
import '../../shared/widgets/page_header.dart';
import '../customers/customer_picker.dart';

/// Bekleme Listesi — web `bekleme-listesi` sayfasının mobil karşılığı.
///
/// 3 özet kartı + (katlanır) ekleme formu + numaralı kuyruk: aktif kayıtlar
/// (Bekliyor→Bilgilendirildi) üstte sıra numaralı, çözülenler (Randevu/İptal)
/// altta soluk. Hızlı durum aksiyonları: Bildirildi / Randevu / İptal /
/// Sıraya al / Sil.
class WaitlistScreen extends StatefulWidget {
  const WaitlistScreen({required this.api, super.key});
  final ApiClient api;

  @override
  State<WaitlistScreen> createState() => _WaitlistScreenState();
}

class _StatusMeta {
  const _StatusMeta(this.label, this.color, this.icon, this.order);
  final String label;
  final Color color;
  final IconData icon;
  final int order;
}

const _blue = Color(0xFF2F5FA6);

const _statusMeta = <String, _StatusMeta>{
  'Waiting':
      _StatusMeta('Bekliyor', AppColors.warning, Icons.schedule_rounded, 0),
  'Notified':
      _StatusMeta('Bilgilendirildi', _blue, Icons.notifications_active_rounded, 1),
  'Booked':
      _StatusMeta('Randevu yapıldı', AppColors.success, Icons.event_available_rounded, 2),
  'Cancelled':
      _StatusMeta('İptal', AppColors.danger, Icons.cancel_rounded, 3),
};

_StatusMeta _meta(String status) =>
    _statusMeta[status] ?? _statusMeta['Waiting']!;

class _WaitlistScreenState extends State<WaitlistScreen> {
  late Future<_WlData> _future;

  // Ekleme formu
  bool _formOpen = false;
  bool _busy = false;
  String? _error;
  String? _customerId;
  String? _serviceId;
  String? _staffId;
  DateTime? _preferredDate;
  TimeOfDay? _preferredTime;
  final _note = TextEditingController();

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<_WlData> _load() async {
    final results = await Future.wait<dynamic>([
      widget.api
          .get('/api/admin/waitlist/', query: {'activeOnly': false})
          .catchError((_) => const <dynamic>[]),
      widget.api
          .get('/api/admin/services/', query: {'page': 1, 'pageSize': 300})
          .catchError((_) => const <dynamic>[]),
      widget.api
          .get('/api/admin/staff/', query: {'page': 1, 'pageSize': 200})
          .catchError((_) => const <dynamic>[]),
    ]);
    // Sınırsız müşteri ölçeği: müşteri listesi çekilmez — satır adları DTO'dan
    // (customerName), seçim CustomerSelectField sunucu aramasıyla.
    return _WlData(
      entries: apiItems(results[0]),
      customers: const [],
      services: apiItems(results[1]),
      staff: apiItems(results[2]),
    );
  }

  Future<void> _reload() async {
    setState(() {
      _future = _load();
    });
    await _future;
  }

  List<Map<String, dynamic>> _sorted(List<Map<String, dynamic>> entries) {
    final list = [...entries];
    list.sort((a, b) {
      final oa = _meta('${a['status']}').order;
      final ob = _meta('${b['status']}').order;
      if (oa != ob) return oa.compareTo(ob);
      return '${a['createdAtUtc'] ?? ''}'.compareTo('${b['createdAtUtc'] ?? ''}');
    });
    return list;
  }

  // --- Aksiyonlar ---

  Future<void> _run(Future<void> Function() task) async {
    setState(() => _busy = true);
    try {
      await task();
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

  Future<void> _setStatus(Map<String, dynamic> entry, String status) =>
      _run(() => widget.api
          .post('/api/admin/waitlist/${entry['id']}/status', {'status': status}));

  // Manuel "Yer öner": kaydı Notified yapıp WhatsApp teklif mesajı gönderir.
  Future<void> _offer(Map<String, dynamic> entry) =>
      _run(() => widget.api.post('/api/admin/waitlist/${entry['id']}/offer', {}));

  // Manuel "Randevuya çevir": teklifi randevuya dönüştürür (yeni randevu açar).
  Future<void> _book(Map<String, dynamic> entry) =>
      _run(() => widget.api.post('/api/admin/waitlist/${entry['id']}/book', {}));

  Future<void> _delete(Map<String, dynamic> entry) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Sil'),
        content: const Text('Bu bekleme kaydını silmek istiyor musunuz?'),
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
    await _run(() => widget.api.delete('/api/admin/waitlist/${entry['id']}'));
  }

  Future<void> _create() async {
    if (_customerId == null) {
      setState(() => _error = 'Müşteri seçin.');
      return;
    }
    if (_preferredDate == null) {
      setState(() => _error = 'Tercih edilen tarihi seçin.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      // Saat girildiyse tam slot (UTC) kaydedilir → yer açılınca otomatik teklif/randevu mümkün olur.
      DateTime? startLocal;
      if (_preferredTime != null) {
        startLocal = DateTime(_preferredDate!.year, _preferredDate!.month,
            _preferredDate!.day, _preferredTime!.hour, _preferredTime!.minute);
      }
      await widget.api.post('/api/admin/waitlist/', {
        'customerId': _customerId,
        'serviceDefinitionId': _serviceId,
        'staffMemberId': _staffId,
        'preferredDate': DateFormat('yyyy-MM-dd').format(_preferredDate!),
        'preferredStartUtc': startLocal?.toUtc().toIso8601String(),
        'durationMinutes': startLocal != null ? 30 : null,
        'note': _note.text.trim().isEmpty ? null : _note.text.trim(),
        'branchId': widget.api.auth?.user?.branchId,
      });
      setState(() {
        _customerId = null;
        _serviceId = null;
        _staffId = null;
        _preferredDate = null;
        _preferredTime = null;
        _formOpen = false;
      });
      _note.clear();
      await _reload();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Bekleme listesine eklendi.')));
      }
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
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
            child: FutureBuilder<_WlData>(
              future: _future,
              builder: (context, snapshot) {
                if (snapshot.connectionState != ConnectionState.done &&
                    !snapshot.hasData) {
                  return const Center(child: CircularProgressIndicator());
                }
                final data =
                    snapshot.data ?? const _WlData(entries: [], customers: [], services: [], staff: []);
                final entries = _sorted(data.entries);
                final active = data.entries
                    .where((e) =>
                        '${e['status']}' == 'Waiting' ||
                        '${e['status']}' == 'Notified')
                    .length;
                final booked = data.entries
                    .where((e) => '${e['status']}' == 'Booked')
                    .length;
                var queueNo = 0;
                return ListView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.fromLTRB(16, 20, 16, 110),
                  children: [
                    const PageHeader(
                      eyebrow: 'Randevu',
                      title: 'Bekleme Listesi',
                      subtitle: 'Uygun saat bekleyen müşteriler ve tercihleri.',
                    ),
                    const SizedBox(height: 16),
                    _statsRow(data.entries.length, active, booked),
                    const SizedBox(height: 14),
                    _addCard(data),
                    const SizedBox(height: 16),
                    if (entries.isEmpty)
                      _empty()
                    else
                      for (final e in entries)
                        Builder(builder: (_) {
                          final isActive = '${e['status']}' == 'Waiting' ||
                              '${e['status']}' == 'Notified';
                          final no = isActive ? ++queueNo : null;
                          return _queueRow(e, no, data);
                        }),
                  ],
                );
              },
            ),
          ),
        ),
      ),
    );
  }

  Widget _statsRow(int total, int active, int booked) {
    return Row(
      children: [
        _statCard('Toplam kayıt', '$total', Icons.event_note_rounded,
            AppColors.primary),
        const SizedBox(width: 10),
        _statCard('Sırada bekleyen', '$active', Icons.hourglass_top_rounded,
            AppColors.warning),
        const SizedBox(width: 10),
        _statCard('Randevuya dönen', '$booked', Icons.check_circle_rounded,
            AppColors.success),
      ],
    );
  }

  Widget _statCard(String label, String value, IconData icon, Color color) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: AppColors.border),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 34,
              height: 34,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: color.withValues(alpha: .12),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(icon, size: 18, color: color),
            ),
            const SizedBox(height: 8),
            Text(label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                    fontSize: 10, color: AppColors.muted,
                    fontWeight: FontWeight.w600)),
            const SizedBox(height: 2),
            Text(value,
                style: const TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w800,
                    color: AppColors.ink)),
          ],
        ),
      ),
    );
  }

  // Katlanır ekleme formu
  Widget _addCard(_WlData data) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        children: [
          InkWell(
            borderRadius: BorderRadius.circular(20),
            onTap: () => setState(() => _formOpen = !_formOpen),
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Row(
                children: [
                  Container(
                    width: 32,
                    height: 32,
                    alignment: Alignment.center,
                    decoration: const BoxDecoration(
                      gradient: LinearGradient(
                          colors: [Color(0xFFF47699), Color(0xFFEF6088)]),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(Icons.add_rounded,
                        color: Colors.white, size: 19),
                  ),
                  const SizedBox(width: 10),
                  const Expanded(
                    child: Text('Bekleme listesine ekle',
                        style: TextStyle(
                            fontWeight: FontWeight.w800, fontSize: 14)),
                  ),
                  Icon(
                    _formOpen
                        ? Icons.keyboard_arrow_up_rounded
                        : Icons.keyboard_arrow_down_rounded,
                    color: AppColors.muted,
                  ),
                ],
              ),
            ),
          ),
          AnimatedCrossFade(
            duration: const Duration(milliseconds: 200),
            crossFadeState:
                _formOpen ? CrossFadeState.showSecond : CrossFadeState.showFirst,
            firstChild: const SizedBox(width: double.infinity),
            secondChild: _addForm(data),
          ),
        ],
      ),
    );
  }

  Widget _addForm(_WlData data) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 0, 14, 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Divider(height: 1, color: AppColors.border),
          const SizedBox(height: 14),
          CustomerSelectField(
            api: widget.api,
            label: 'Müşteri *',
            onSelected: (picked) => setState(() => _customerId = picked.id),
          ),
          const SizedBox(height: 12),
          _dropdown(
            label: 'Hizmet (ops.)',
            value: _serviceId,
            hint: 'Farketmez',
            items: data.services,
            nameKeys: const ['name'],
            onChanged: (v) => setState(() => _serviceId = v),
          ),
          const SizedBox(height: 12),
          _dropdown(
            label: 'Personel (ops.)',
            value: _staffId,
            hint: 'Farketmez',
            items: data.staff,
            nameKeys: const ['fullName', 'name'],
            onChanged: (v) => setState(() => _staffId = v),
          ),
          const SizedBox(height: 12),
          InkWell(
            borderRadius: BorderRadius.circular(12),
            onTap: _pickDate,
            child: InputDecorator(
              decoration: const InputDecoration(
                labelText: 'Tercih edilen tarih *',
                isDense: true,
                suffixIcon: Icon(Icons.calendar_today_rounded, size: 18),
              ),
              child: Text(
                _preferredDate == null
                    ? 'Seçin…'
                    : DateFormat('d MMMM yyyy', 'tr_TR').format(_preferredDate!),
                style: TextStyle(
                    color: _preferredDate == null
                        ? AppColors.muted
                        : AppColors.ink),
              ),
            ),
          ),
          const SizedBox(height: 12),
          InkWell(
            borderRadius: BorderRadius.circular(12),
            onTap: _pickTime,
            child: InputDecorator(
              decoration: const InputDecoration(
                labelText: 'Saat (ops.)',
                isDense: true,
                suffixIcon: Icon(Icons.schedule_rounded, size: 18),
                helperText: 'Girilirse yer açılınca otomatik WhatsApp teklifi gider.',
                helperMaxLines: 2,
              ),
              child: Text(
                _preferredTime == null
                    ? 'Farketmez'
                    : _preferredTime!.format(context),
                style: TextStyle(
                    color: _preferredTime == null
                        ? AppColors.muted
                        : AppColors.ink),
              ),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _note,
            decoration: const InputDecoration(
              labelText: 'Not (ops.)',
              isDense: true,
              hintText: 'örn. öğleden sonrası uygun',
            ),
          ),
          if (_error != null) ...[
            const SizedBox(height: 10),
            Text(_error!,
                style:
                    const TextStyle(color: AppColors.danger, fontSize: 12.5)),
          ],
          const SizedBox(height: 14),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: _busy ? null : _create,
              icon: _busy
                  ? const SizedBox.square(
                      dimension: 16,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: Colors.white))
                  : const Icon(Icons.playlist_add_rounded),
              label: const Text('Listeye ekle'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _dropdown({
    required String label,
    required String? value,
    required String hint,
    required List<Map<String, dynamic>> items,
    required List<String> nameKeys,
    required ValueChanged<String?> onChanged,
  }) {
    return DropdownButtonFormField<String>(
      initialValue: items.any((it) => '${it['id']}' == value) ? value : null,
      isExpanded: true,
      decoration: InputDecoration(labelText: label, isDense: true),
      hint: Text(hint, style: const TextStyle(color: AppColors.muted)),
      items: [
        for (final it in items)
          DropdownMenuItem(
            value: '${it['id']}',
            child: Text(valueOf(it, nameKeys), overflow: TextOverflow.ellipsis),
          ),
      ],
      onChanged: onChanged,
    );
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _preferredDate ?? now,
      firstDate: now.subtract(const Duration(days: 1)),
      lastDate: now.add(const Duration(days: 365)),
    );
    if (picked != null) setState(() => _preferredDate = picked);
  }

  Future<void> _pickTime() async {
    final picked = await showTimePicker(
      context: context,
      initialTime: _preferredTime ?? const TimeOfDay(hour: 10, minute: 0),
    );
    if (picked != null) setState(() => _preferredTime = picked);
  }

  Widget _empty() => Padding(
        padding: const EdgeInsets.symmetric(vertical: 36),
        child: Center(
          child: Column(
            children: [
              Icon(Icons.hourglass_empty_rounded,
                  size: 44, color: AppColors.primary.withValues(alpha: .5)),
              const SizedBox(height: 12),
              const Text(
                'Bekleme listesi boş.\nDolu bir güne talep gelirse buradan ekleyebilirsin.',
                textAlign: TextAlign.center,
                style: TextStyle(color: AppColors.muted, fontSize: 13),
              ),
            ],
          ),
        ),
      );

  // Kuyruk satırı
  Widget _queueRow(Map<String, dynamic> e, int? queueNo, _WlData data) {
    final status = '${e['status']}';
    final meta = _meta(status);
    final resolved = status == 'Booked' || status == 'Cancelled';
    final name = '${e['customerName'] ?? ''}'.isNotEmpty
        ? '${e['customerName']}'
        : data.customerName('${e['customerId']}');
    final service = e['serviceDefinitionId'] == null
        ? null
        : data.serviceName('${e['serviceDefinitionId']}');
    final staff = e['staffMemberId'] == null
        ? null
        : data.staffName('${e['staffMemberId']}');
    final wait = _waitDuration(e['createdAtUtc']);

    return Opacity(
      opacity: resolved ? .68 : 1,
      child: Container(
        margin: const EdgeInsets.only(bottom: 10),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: AppColors.border),
          boxShadow: [
            BoxShadow(
              color: AppColors.primaryDark.withValues(alpha: .04),
              blurRadius: 20,
              offset: const Offset(0, 10),
            ),
          ],
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(18),
          child: IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Container(width: 5, color: meta.color),
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(12, 12, 10, 12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            _queueBadge(queueNo, meta),
                            const SizedBox(width: 10),
                            _avatar(name),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(name,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(
                                          fontSize: 14.5,
                                          fontWeight: FontWeight.w800)),
                                  const SizedBox(height: 3),
                                  _statusPill(meta),
                                ],
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 10),
                        Wrap(
                          spacing: 12,
                          runSpacing: 5,
                          children: [
                            _metaItem(Icons.calendar_today_rounded,
                                _formatPreferred('${e['preferredDate'] ?? ''}')),
                            if ('${e['preferredStartUtc'] ?? ''}'.isNotEmpty)
                              _metaItem(Icons.access_time_rounded,
                                  _formatSlotTime(e['preferredStartUtc']),
                                  color: AppColors.primary),
                            if (service != null)
                              _metaItem(Icons.content_cut_rounded, service),
                            if (staff != null)
                              _metaItem(Icons.person_rounded, staff),
                            if (wait != null)
                              _metaItem(Icons.schedule_rounded, wait),
                            if ('${e['note'] ?? ''}'.trim().isNotEmpty)
                              _metaItem(Icons.format_quote_rounded,
                                  '${e['note']}', color: const Color(0xFF9A6F22)),
                          ],
                        ),
                        const SizedBox(height: 10),
                        _actions(e, status, resolved),
                      ],
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

  Widget _actions(Map<String, dynamic> e, String status, bool resolved) {
    final hasSlot = '${e['preferredStartUtc'] ?? ''}'.isNotEmpty;
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        if (!resolved) ...[
          if (hasSlot) ...[
            _actionBtn(Icons.send_rounded,
                status == 'Notified' ? 'Tekrar öner' : 'Yer öner', _blue,
                () => _offer(e)),
            _actionBtn(Icons.event_available_rounded, 'Randevuya çevir',
                AppColors.success, () => _book(e)),
          ] else
            _actionBtn(Icons.event_available_rounded, 'Randevu yapıldı',
                AppColors.success, () => _setStatus(e, 'Booked')),
          _actionBtn(Icons.cancel_rounded, 'İptal', AppColors.muted,
              () => _setStatus(e, 'Cancelled')),
        ] else
          _actionBtn(Icons.replay_rounded, 'Sıraya al', AppColors.primaryDark,
              () => _setStatus(e, 'Waiting')),
        _actionBtn(Icons.delete_outline_rounded, 'Sil', AppColors.danger,
            () => _delete(e)),
      ],
    );
  }

  Widget _actionBtn(
      IconData icon, String label, Color color, VoidCallback onTap) {
    return Material(
      color: color.withValues(alpha: .1),
      borderRadius: BorderRadius.circular(11),
      child: InkWell(
        borderRadius: BorderRadius.circular(11),
        onTap: _busy ? null : onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 7),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 15, color: color),
              const SizedBox(width: 5),
              Text(label,
                  style: TextStyle(
                      fontSize: 11.5,
                      fontWeight: FontWeight.w700,
                      color: color)),
            ],
          ),
        ),
      ),
    );
  }

  Widget _queueBadge(int? queueNo, _StatusMeta meta) {
    if (queueNo != null) {
      return Container(
        width: 30,
        height: 30,
        alignment: Alignment.center,
        decoration: const BoxDecoration(
          gradient:
              LinearGradient(colors: [Color(0xFFF47699), Color(0xFFEF6088)]),
          shape: BoxShape.circle,
        ),
        child: Text('$queueNo',
            style: const TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w800,
                fontSize: 13)),
      );
    }
    return Container(
      width: 30,
      height: 30,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: meta.color.withValues(alpha: .12),
        shape: BoxShape.circle,
      ),
      child: Icon(meta.icon, size: 15, color: meta.color),
    );
  }

  Widget _avatar(String name) {
    final initials = name
        .trim()
        .split(RegExp(r'\s+'))
        .where((p) => p.isNotEmpty)
        .take(2)
        .map((p) => p[0].toUpperCase())
        .join();
    return Container(
      width: 38,
      height: 38,
      alignment: Alignment.center,
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          colors: [Color(0xFFFDE7EF), Color(0xFFF0AAC2)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        shape: BoxShape.circle,
      ),
      child: Text(initials.isEmpty ? '•' : initials,
          style: const TextStyle(
              color: Color(0xFF7F4057),
              fontWeight: FontWeight.w800,
              fontSize: 13)),
    );
  }

  Widget _statusPill(_StatusMeta meta) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
        decoration: BoxDecoration(
          color: meta.color.withValues(alpha: .12),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: meta.color.withValues(alpha: .3)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(meta.icon, size: 11, color: meta.color),
            const SizedBox(width: 4),
            Text(meta.label,
                style: TextStyle(
                    fontSize: 9.5,
                    fontWeight: FontWeight.w800,
                    color: meta.color)),
          ],
        ),
      );

  Widget _metaItem(IconData icon, String text, {Color? color}) => Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 13, color: color ?? AppColors.primary),
          const SizedBox(width: 4),
          Text(text,
              style: TextStyle(
                  fontSize: 11.5,
                  fontWeight: FontWeight.w600,
                  color: color ?? AppColors.muted)),
        ],
      );

  String _formatPreferred(String d) {
    if (d.isEmpty) return '—';
    final date = DateTime.tryParse(d);
    if (date == null) return d;
    return DateFormat('d MMMM yyyy', 'tr_TR').format(date);
  }

  String _formatSlotTime(dynamic iso) {
    final d = parseUtcToLocal(iso);
    if (d == null) return '';
    return DateFormat('HH:mm').format(d);
  }

  String? _waitDuration(dynamic createdAtUtc) {
    final d = parseUtcToLocal(createdAtUtc);
    if (d == null) return null;
    final days = DateTime.now().difference(d).inDays;
    if (days <= 0) return 'bugün eklendi';
    return '$days gündür listede';
  }
}

class _WlData {
  const _WlData({
    required this.entries,
    required this.customers,
    required this.services,
    required this.staff,
  });
  final List<Map<String, dynamic>> entries;
  final List<Map<String, dynamic>> customers;
  final List<Map<String, dynamic>> services;
  final List<Map<String, dynamic>> staff;

  String customerName(String id) => _name(customers, id,
      keys: const ['fullName', 'name'], fallback: 'Müşteri');
  String serviceName(String id) =>
      _name(services, id, keys: const ['name'], fallback: 'Hizmet');
  String staffName(String id) => _name(staff, id,
      keys: const ['fullName', 'name'], fallback: 'Personel');

  String _name(List<Map<String, dynamic>> list, String id,
      {required List<String> keys, required String fallback}) {
    for (final it in list) {
      if ('${it['id']}' == id) return valueOf(it, keys, fallback: fallback);
    }
    return fallback;
  }
}
