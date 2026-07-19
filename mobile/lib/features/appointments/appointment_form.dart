import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/network/api_client.dart';
import '../../shared/crud/crud_screen.dart';
import '../../shared/json_helpers.dart';
import '../accounting/package_sale_sheet.dart';
import '../customers/customer_picker.dart';
import 'calendar_theme.dart';

const _genderOptions = [
  CrudOption('Female', 'Kadın'),
  CrudOption('Male', 'Erkek'),
  CrudOption('Other', 'Diğer'),
  CrudOption('Unspecified', 'Belirtilmemiş'),
];

/// Bottom-sheet form to create a new appointment with customer / service /
/// staff pickers and a date-time selector.
class AppointmentForm extends StatefulWidget {
  const AppointmentForm({
    required this.api,
    this.presetStart,
    this.presetStaffId,
    this.presetCustomerId,
    this.existing = const [],
    super.key,
  });
  final ApiClient api;
  final DateTime? presetStart;
  final String? presetStaffId;

  /// Müşteri kartından açıldığında müşteri ön-seçili gelir.
  final String? presetCustomerId;

  /// Already-booked appointments for the viewed day, used to enforce the
  /// "max 2 appointments per staff per overlapping slot" rule.
  final List<Map<String, dynamic>> existing;

  @override
  State<AppointmentForm> createState() => _AppointmentFormState();
}

class _AppointmentFormState extends State<AppointmentForm> {
  late Future<void> loading;
  List<Map<String, dynamic>> customers = [];
  List<Map<String, dynamic>> staff = [];
  List<Map<String, dynamic>> services = [];
  String? customerId;
  // Seçici alt sayfasından dönen ad — customers listesinde bulunamazsa yedek.
  String? customerName;
  String? staffId;
  String? serviceId;
  late DateTime start;
  bool saving = false;
  final notes = TextEditingController();

  @override
  void initState() {
    super.initState();
    start = widget.presetStart ??
        DateTime.now().add(const Duration(hours: 1)).copyWith(
              minute: 0,
              second: 0,
              millisecond: 0,
              microsecond: 0,
            );
    loading = loadLookups();
  }

  Future<void> loadLookups() async {
    final values = await Future.wait([
      widget.api.getAllPaged('/api/admin/customers/'),
      widget.api.get('/api/admin/staff/', query: {'page': 1, 'pageSize': 200}),
      widget.api.get('/api/admin/services/', query: {'page': 1, 'pageSize': 200}),
    ]);
    customers = apiItems(values[0]);
    staff = apiItems(values[1]);
    services = apiItems(values[2]);
    // Binlerce müşteride ilk kaydı otomatik seçmek yanıltıcı — preset yoksa boş
    // başlar, aramalı seçiciyle seçilir.
    final preset = widget.presetCustomerId;
    customerId = (preset != null && customers.any((c) => '${c['id']}' == preset))
        ? preset
        : null;
    staffId = widget.presetStaffId ??
        (staff.isEmpty ? null : '${staff.first['id']}');
    serviceId = services.isEmpty ? null : '${services.first['id']}';
  }

  @override
  void dispose() {
    notes.dispose();
    super.dispose();
  }

  String? _cleanId(dynamic value) {
    final id = value?.toString().trim();
    if (id == null || id.isEmpty || id.toLowerCase() == 'null') return null;
    return id;
  }

  Future<String> _resolveBranchId() async {
    final sessionBranch = _cleanId(widget.api.auth?.user?.branchId);
    if (sessionBranch != null) return sessionBranch;
    final data = await widget.api.get('/api/admin/branches/');
    final branches = apiItems(data);
    if (branches.isNotEmpty) {
      final branch = branches.firstWhere(
        (b) => b['isDefault'] == true,
        orElse: () => branches.first,
      );
      final branchId = _cleanId(branch['id'] ?? branch['branchId']);
      if (branchId != null) return branchId;
    }
    throw const ApiException('Müşteri oluşturmak için şube bilgisi bulunamadı.');
  }

  /// Randevudan ayrılmadan hızlı müşteri kaydı — müşteriler sayfasındaki formun aynısı.
  /// Oluşan müşteri listeye eklenip otomatik seçilir.
  Future<void> _quickCreateCustomer() async {
    final result = await showModalBottomSheet<CrudSheetResult>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => const CrudFormSheet(
        title: 'Yeni müşteri',
        icon: Icons.person_add_rounded,
        fields: [
          CrudField(key: 'fullName', label: 'Ad soyad', required: true),
          CrudField(
            key: 'phone',
            label: 'Telefon',
            required: true,
            hint: '05XXXXXXXXX',
            digitsOnly: true,
            maxLength: 11,
          ),
          CrudField(key: 'email', label: 'E-posta'),
          CrudField(
            key: 'birthDate',
            label: 'Doğum tarihi',
            type: CrudFieldType.date,
          ),
          CrudField(
            key: 'gender',
            label: 'Cinsiyet',
            type: CrudFieldType.select,
            options: _genderOptions,
            defaultValue: 'Female',
          ),
          CrudField(
            key: 'kvkkConsent',
            label: 'KVKK onayı var',
            type: CrudFieldType.toggle,
            defaultValue: true,
          ),
          CrudField(key: 'notes', label: 'Notlar', type: CrudFieldType.multiline),
        ],
      ),
    );
    final body = result?.body;
    if (body == null) return;
    try {
      body['branchId'] = await _resolveBranchId();
      final created = await widget.api.post('/api/admin/customers/', body);
      final map = created is Map ? created.cast<String, dynamic>() : null;
      final newId = _cleanId(map?['id']);
      if (map == null || newId == null) {
        // Staff onay kapısı: kayıt taslağa düşmüş olabilir — müşteri henüz seçilemez.
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
              content: Text(
                  'Müşteri kaydı onaya gönderildi. Onaylanınca randevu açabilirsin.')));
        }
        return;
      }
      setState(() {
        customers = [...customers, map];
        customerId = newId;
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Müşteri oluşturuldu ve seçildi.')));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }

  /// Randevudan ayrılmadan seçili müşteriye paket satışı (web paritesi).
  /// Onayda cariye/taksite ve seans bakiyesine işlenir.
  Future<void> _openPackageSale() async {
    final id = customerId;
    if (id == null) {
      ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Önce müşteri seçin.')));
      return;
    }
    final customer = customers.firstWhere(
      (c) => '${c['id']}' == id,
      orElse: () => const {},
    );
    final sold = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => PackageSaleSheet(
        api: widget.api,
        customerId: id,
        customerName: valueOf(customer, const ['fullName', 'name']),
      ),
    );
    if (sold == true && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text(
              'Satış adisyona eklendi. Yönetici onaylayınca cariye ve seansa işlenir.')));
    }
  }

  Future<void> pickDate() async {
    final date = await showDatePicker(
      context: context,
      initialDate: start,
      firstDate: DateTime.now().subtract(const Duration(days: 1)),
      lastDate: DateTime.now().add(const Duration(days: 730)),
    );
    if (!mounted || date == null) return;
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(start),
    );
    if (time == null) return;
    setState(() {
      start = DateTime(date.year, date.month, date.day, time.hour, time.minute);
    });
  }

  /// Counts existing active appointments for [staffId] that overlap the new slot.
  int _overlapCount(DateTime newStart, DateTime newEnd) {
    return widget.existing.where((a) {
      if ('${a['staffMemberId']}' != staffId) return false;
      final st = '${a['status']}'.toLowerCase();
      if (st == 'cancelled' || st == 'noshow') return false;
      final s = DateTime.tryParse('${a['startUtc']}')?.toLocal();
      final e = DateTime.tryParse('${a['endUtc']}')?.toLocal();
      if (s == null || e == null) return false;
      return s.isBefore(newEnd) && newStart.isBefore(e);
    }).length;
  }

  Future<void> save() async {
    if (customerId == null || staffId == null || serviceId == null) return;
    final service = services.firstWhere((e) => '${e['id']}' == serviceId);
    final duration = (service['durationMinutes'] as num?)?.toInt() ?? 60;
    final end = start.add(Duration(minutes: duration));
    // Client-side ön kontrol: personelin bu slotta zaten 2 aktif randevusu varsa doğrudan
    // "bekleme listesine ekle?" teklifi göster (sunucuya gitmeden).
    if (_overlapCount(start, end) >= 2) {
      await _offerWaitlist(duration);
      return;
    }
    setState(() => saving = true);
    try {
      await widget.api.post('/api/admin/appointments/', {
        'branchId': widget.api.auth?.user?.branchId,
        'customerId': customerId,
        'staffMemberId': staffId,
        'serviceDefinitionId': serviceId,
        'startUtc': start.toUtc().toIso8601String(),
        'endUtc': end.toUtc().toIso8601String(),
        'price': service['price'] ?? 0,
        'notes': notes.text.trim().isEmpty ? null : notes.text.trim(),
      });
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      // Sunucu da slotu dolu bulursa (SlotFull) aynı teklifi göster (fallback).
      if (e.code == 'SlotFull') {
        await _offerWaitlist(duration);
      } else if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.message)));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  /// Slot dolu → müşteriyi TAM o slot için bekleme listesine ekle. Yer açılınca (iptal)
  /// müşteriye WhatsApp'tan "yer açıldı, ister misiniz?" teklifi gider.
  Future<void> _offerWaitlist(int duration) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Bu saat dolu'),
        content: const Text(
            'Bu saatte personelin uygun yeri yok. Müşteriyi bu slot için bekleme '
            'listesine ekleyelim mi? Yer açılınca WhatsApp\'tan otomatik teklif gider.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Vazgeç')),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Bekleme listesine ekle')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await widget.api.post('/api/admin/waitlist/', {
        'customerId': customerId,
        'serviceDefinitionId': serviceId,
        'staffMemberId': staffId,
        'preferredDate': DateFormat('yyyy-MM-dd').format(start),
        'preferredStartUtc': start.toUtc().toIso8601String(),
        'durationMinutes': duration,
        'branchId': widget.api.auth?.user?.branchId,
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text('Bekleme listesine eklendi.')));
        Navigator.pop(context, true);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(
        20,
        18,
        20,
        MediaQuery.viewInsetsOf(context).bottom + 20,
      ),
      child: FutureBuilder<void>(
        future: loading,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const SizedBox(
              height: 320,
              child: Center(child: CircularProgressIndicator()),
            );
          }
          if (snapshot.hasError) {
            return SizedBox(
              height: 320,
              child: Center(child: Text('${snapshot.error}')),
            );
          }
          return SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Yeni randevu',
                  style: Theme.of(context).textTheme.titleLarge?.copyWith(
                        fontWeight: FontWeight.w800,
                      ),
                ),
                const SizedBox(height: 18),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    Expanded(child: _customerSelector()),
                    const SizedBox(width: 8),
                    IconButton.filledTonal(
                      tooltip: 'Yeni müşteri kaydet',
                      onPressed: _quickCreateCustomer,
                      icon: const Icon(Icons.person_add_rounded),
                    ),
                  ],
                ),
                Align(
                  alignment: Alignment.centerRight,
                  child: TextButton.icon(
                    onPressed: _openPackageSale,
                    icon: const Icon(Icons.point_of_sale_rounded, size: 18),
                    label: const Text('Paket satışı yap'),
                  ),
                ),
                const SizedBox(height: 12),
                _select(
                  label: 'Hizmet',
                  value: serviceId,
                  items: services,
                  titleKeys: const ['name'],
                  onChanged: (value) => setState(() => serviceId = value),
                ),
                const SizedBox(height: 12),
                _select(
                  label: 'Personel',
                  value: staffId,
                  items: staff,
                  titleKeys: const ['fullName'],
                  onChanged: (value) => setState(() => staffId = value),
                ),
                const SizedBox(height: 12),
                ListTile(
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(16),
                    side: const BorderSide(color: Color(0xFFEAD8DF)),
                  ),
                  leading: const Icon(Icons.event_rounded),
                  title: const Text('Tarih ve saat'),
                  subtitle: Text(
                    '${CalendarText.longDate(start)}  ${CalendarText.hm(start)}',
                  ),
                  onTap: pickDate,
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: notes,
                  maxLines: 3,
                  decoration: const InputDecoration(labelText: 'Not'),
                ),
                const SizedBox(height: 18),
                FilledButton(
                  onPressed: saving ? null : save,
                  child: Text(saving ? 'Kaydediliyor...' : 'Randevuyu oluştur'),
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  /// Aramalı müşteri seçimi — binlerce kayıtta dropdown yerine pickCustomer
  /// alt sayfası açılır (isim/telefon araması, satırda telefon görünür).
  Widget _customerSelector() {
    final selected = customerId == null
        ? null
        : customers.firstWhere(
            (c) => '${c['id']}' == customerId,
            orElse: () => const {},
          );
    final name = selected == null
        ? null
        : selected.isEmpty
            ? customerName
            : valueOf(selected, const ['fullName', 'name']);
    final phone = selected == null ? '' : '${selected['phone'] ?? ''}';
    return InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: () async {
        final picked = await pickCustomer(context, widget.api);
        if (picked != null) {
          setState(() {
            customerId = picked.id;
            customerName = picked.name;
          });
        }
      },
      child: InputDecorator(
        decoration: const InputDecoration(
          labelText: 'Müşteri',
          suffixIcon: Icon(Icons.search_rounded, size: 20),
        ),
        isEmpty: name == null,
        child: name == null
            ? const Text('Ara ve seç…',
                style: TextStyle(color: Colors.black38))
            : Row(
                children: [
                  Flexible(
                    child: Text(name,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontWeight: FontWeight.w600)),
                  ),
                  if (phone.isNotEmpty) ...[
                    const SizedBox(width: 8),
                    Text(phone,
                        style: const TextStyle(
                            fontSize: 12.5, color: Colors.black54)),
                  ],
                ],
              ),
      ),
    );
  }

  Widget _select({
    required String label,
    required String? value,
    required List<Map<String, dynamic>> items,
    required List<String> titleKeys,
    required ValueChanged<String?> onChanged,
  }) =>
      DropdownButtonFormField<String>(
        initialValue: items.any((e) => '${e['id']}' == value) ? value : null,
        isExpanded: true,
        decoration: InputDecoration(labelText: label),
        items: items
            .map(
              (item) => DropdownMenuItem(
                value: '${item['id']}',
                child: Text(valueOf(item, titleKeys)),
              ),
            )
            .toList(),
        onChanged: onChanged,
      );
}
