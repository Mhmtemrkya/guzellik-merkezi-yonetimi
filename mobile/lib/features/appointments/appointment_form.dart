import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/crud/crud_screen.dart';
import '../../shared/json_helpers.dart';
import '../accounting/account_installments.dart';
import '../accounting/adisyon_detail_sheet.dart';
import '../accounting/package_sale_sheet.dart';
import '../customers/customer_picker.dart';
import 'appointment_help_sheet.dart';
import 'calendar_theme.dart';
import 'customer_history_panel.dart';

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
    this.presetServiceId,
    this.waitlistEntryId,
    this.existing = const [],
    super.key,
  });
  final ApiClient api;
  final DateTime? presetStart;
  final String? presetStaffId;

  /// Müşteri kartından açıldığında müşteri ön-seçili gelir.
  final String? presetCustomerId;

  /// Bekleme listesinden açıldığında beklenen hizmet ön-seçili gelir.
  final String? presetServiceId;

  /// Bekleme listesinden "Randevuya aktar" ile açıldıysa kaydın Id'si. Doluysa randevu
  /// /waitlist/{id}/schedule ucundan açılır: kayıt Booked olur + müşteriye WhatsApp bilgisi gider.
  final String? waitlistEntryId;

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

  /// MÜŞTERİ DOSYASI (web AppointmentEditor sağ rayıyla parite): açık cariler ve
  /// seans bakiyeleri. "Bu müşteri ne ödedi, kaç seansı kaldı, paketi kim sattı"
  /// sorusu için başka ekrana gitmek gerekmesin.
  List<Map<String, dynamic>> _accounts = [];
  List<Map<String, dynamic>> _sessions = [];

  /// KATALOGDAN SAT (web paritesi): seçilen hizmetin kalan seansı yoksa randevu normalde
  /// katalog fiyatıyla ÜCRETLİ açılır. Bu anahtar açıkken bunun yerine hizmet SATIŞI açılır
  /// (kendi adisyonu, cariye şimdi işlenmez) ve randevu ücretsiz gider; randevu tamamlanınca
  /// backend satışı otomatik onaylar ve seans o an oluşur.
  bool _sellFromCatalog = false;
  bool _dossierLoading = false;

  /// Geçmiş panelini (seans/işlem/ödeme tabloları) tazeleyen sayaç — satış veya
  /// tahsilat sonrası artar. Müşteri değişiminde panel zaten kendi yeniler.
  int _historyKey = 0;

  double get _openDebt =>
      _accounts.fold<double>(0, (s, a) => s + _positive(a['remainingAmount']));
  double get _paidTotal =>
      _accounts.fold<double>(0, (s, a) => s + _positive(a['paidAmount']));

  static double _positive(dynamic v) {
    final n = (v is num) ? v.toDouble() : double.tryParse('$v') ?? 0;
    return n > 0 ? n : 0;
  }

  /// Satış / tahsilat sonrası: müşteri dosyası + geçmiş tabloları birlikte tazelenir.
  Future<void> _refreshCustomerData() async {
    if (mounted) setState(() => _historyKey++);
    await _loadDossier();
  }

  /// Müşteri değişince dosyayı tazeler. Satış/tahsilat sonrası da çağrılır.
  Future<void> _loadDossier() async {
    final cid = customerId;
    if (cid == null || cid.isEmpty) {
      if (mounted) setState(() { _accounts = []; _sessions = []; });
      return;
    }
    if (mounted) setState(() => _dossierLoading = true);
    try {
      final res = await Future.wait([
        widget.api.get('/api/admin/accounts/',
            query: {'customerId': cid, 'page': 1, 'pageSize': 50}),
        widget.api
            .get('/api/admin/accounts/sessions/$cid')
            .catchError((_) => const <dynamic>[]),
      ]);
      if (!mounted) return;
      setState(() {
        // İptal edilmiş satışın borcu tahsil edilmez; listeye girmesin.
        _accounts = apiItems(res[0])
            .where((a) => a['cancelledAtUtc'] == null)
            .toList();
        _sessions = apiItems(res[1]);
      });
    } catch (_) {
      if (mounted) setState(() { _accounts = []; _sessions = []; });
    } finally {
      if (mounted) setState(() => _dossierLoading = false);
    }
  }

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
    // Sınırsız müşteri ölçeği: müşteri listesi ÇEKİLMEZ — seçim aramalı alt sayfadan,
    // preset müşteri tekil uçtan gelir. `customers` yalnızca preset + hızlı kayıt tutar.
    final preset = widget.presetCustomerId;
    final values = await Future.wait([
      preset != null
          ? widget.api
              .get('/api/admin/customers/$preset')
              .catchError((_) => const <String, dynamic>{})
          : Future.value(const <String, dynamic>{}),
      widget.api.get('/api/admin/staff/', query: {'page': 1, 'pageSize': 200}),
      widget.api.get('/api/admin/services/', query: {'page': 1, 'pageSize': 200}),
    ]);
    final presetCustomer =
        values[0] is Map ? (values[0] as Map).cast<String, dynamic>() : null;
    customers = presetCustomer != null && presetCustomer['id'] != null
        ? [presetCustomer]
        : [];
    staff = apiItems(values[1]);
    services = apiItems(values[2]);
    customerId =
        (preset != null && customers.isNotEmpty) ? preset : null;
    staffId = widget.presetStaffId ??
        (staff.isEmpty ? null : '${staff.first['id']}');
    // Ön-seçili hizmet (bekleme listesinden aktarım) varsa onu seç; yoksa tek hizmet
    // varsa otomatik seç, birden fazlaysa seçimi kullanıcı yapar.
    final presetService = widget.presetServiceId;
    serviceId = presetService != null &&
            services.any((x) => '${x['id']}' == presetService)
        ? presetService
        : (services.length == 1 ? '${services.first['id']}' : null);
    // Müşteri ön-seçili geldiyse (müşteri kartından açılış) dosyayı hemen getir.
    if (customerId != null) await _loadDossier();
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
      await _loadDossier();
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

  /// Randevudan ayrılmadan seçili müşteriye paket ya da hizmet satışı (web paritesi).
  /// Onaylandığında cariye/taksite ve seans bakiyesine işlenir; satılan paket/hizmet
  /// randevuda hemen kullanılabilir.
  Future<void> _openSale({bool serviceSale = false}) async {
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
    final name = customer.isNotEmpty
        ? valueOf(customer, const ['fullName', 'name'])
        : (customerName ?? 'Müşteri');
    // Satış sheet'i kendi onay/sonuç bildirimini gösterir.
    await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => PackageSaleSheet(
        api: widget.api,
        customerId: id,
        customerName: name,
        serviceSale: serviceSale,
      ),
    );
    // Satış onaylandıysa seans/borç değişmiştir — dosyayı ve geçmişi tazele.
    await _refreshCustomerData();
  }

  /// Personel bu hizmeti yapabilir mi? Uzmanlık listesi boşsa kısıt yok; doluysa
  /// hizmetin kategorisi VEYA adı listede olmalı (eski kayıtlar hizmet adı saklar).
  static bool _staffCanPerform(Map<String, dynamic> s, Map<String, dynamic>? service) {
    if (service == null) return true;
    final raw = '${s['specialties'] ?? ''}';
    final list = raw
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .where((e) => e.isNotEmpty && e != 'null')
        .toList();
    if (list.isEmpty) return true;
    final category = '${service['category'] ?? ''}'.trim().toLowerCase();
    final name = '${service['name'] ?? ''}'.trim().toLowerCase();
    return (category.isNotEmpty && list.contains(category)) ||
        (name.isNotEmpty && list.contains(name));
  }

  Map<String, dynamic>? get _selectedService {
    for (final s in services) {
      if ('${s['id']}' == serviceId) return s;
    }
    return null;
  }

  /// Seçili hizmete göre yetkili personeller — hizmet seçilmemişse tümü.
  List<Map<String, dynamic>> get _eligibleStaff =>
      staff.where((s) => _staffCanPerform(s, _selectedService)).toList();

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

  /// Seçili hizmetin kullanılabilir seansı var mı? (varsa satış gerekmez)
  bool get _hasSessionForSelected => _sessions.any((s) =>
      '${s['serviceDefinitionId']}' == serviceId &&
      (((s['remainingSessions'] as num?)?.toInt() ?? 0) > 0));

  /// Hizmeti satış olarak açar — web'deki "Katalogdan sat" ile aynı kurallar:
  /// kendi adisyonu (forceNew) + cariye şimdi işlenmez (autoApproveOnFirstAppointment).
  Future<void> _sellSelectedServiceAsync(Map<String, dynamic> service) async {
    final adisyon = await widget.api.post('/api/admin/adisyonlar/', {
      'customerId': customerId,
      'customerAccountId': null,
      'notes': null,
      'installmentCount': 0,
      'firstDueDate': null,
      'forceNew': true,
      'autoApproveOnFirstAppointment': true,
    });
    final adisyonId = adisyon is Map ? '${adisyon['id']}' : null;
    if (adisyonId == null || adisyonId.isEmpty || adisyonId == 'null') {
      throw Exception('Satis icin adisyon acilamadi.');
    }
    await widget.api.post('/api/admin/adisyonlar/$adisyonId/items', {
      'type': 'Service',
      'refId': service['id'],
      'description': '${service['name']}',
      'quantity': 1,
      'unitPrice': service['price'] ?? 0,
      'staffMemberId': staffId,
      'coveredByPackage': false,
    });
  }

  Future<void> save() async {
    if (customerId == null || staffId == null) return;
    if (serviceId == null) {
      ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Lütfen bir hizmet/işlem seçin.')));
      return;
    }
    final service = services.firstWhere((e) => '${e['id']}' == serviceId);
    // Kategori yetkisi (backend de doğrular; burada erken uyarı).
    final chosenStaff = staff.firstWhere(
      (s) => '${s['id']}' == staffId,
      orElse: () => const {},
    );
    if (chosenStaff.isNotEmpty && !_staffCanPerform(chosenStaff, service)) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text(
              'Seçili personel bu hizmetin kategorisinde yetkili değil. Farklı personel seçin.')));
      return;
    }
    final duration = (service['durationMinutes'] as num?)?.toInt() ?? 60;
    final end = start.add(Duration(minutes: duration));
    // WEB PARİTESİ: paketten karşılanan randevu ÜCRETSİZ gönderilir (price 0). Mobil katalog
    // fiyatını gönderdiği için randevu "ücretli" sayılıyordu: backend yalnız price <= 0 iken
    // kaynak seans bağını kurar ve hizmet hakkını doğrular → mobilde deterministik bağ hiç
    // oluşmuyor, satış iptalinde tahminî eşleştirmeye düşülüyor ve paket randevusu ücretli
    // görünüyordu. Kalan seansı olmayan hizmet katalog fiyatıyla (ücretli) açılmaya devam eder.
    final coveredByPackage = _hasSessionForSelected;
    // Katalogdan satışta da randevu ÜCRETSİZ gider: parayı satış adisyonu tahsil eder,
    // randevuya da fiyat yazılsaydı aynı iş iki kez ödetilirdi.
    final sellNow = _sellFromCatalog && !coveredByPackage;
    final price = (coveredByPackage || sellNow) ? 0 : (service['price'] ?? 0);
    // Client-side ön kontrol: personelin bu slotta zaten 2 aktif randevusu varsa doğrudan
    // "bekleme listesine ekle?" teklifi göster (sunucuya gitmeden).
    if (_overlapCount(start, end) >= 2) {
      await _offerWaitlist(duration);
      return;
    }
    setState(() => saving = true);
    try {
      // Sıra bilinçli: satış başarısızsa randevu HİÇ oluşturulmaz.
      if (sellNow) await _sellSelectedServiceAsync(service);
      if (widget.waitlistEntryId != null) {
        // Bekleme listesinden aktarım: tek uçta randevu açılır, kayıt "Randevu yapıldı"
        // olur ve müşteriye "randevunuz oluşturuldu" WhatsApp mesajı kuyruğa alınır.
        await widget.api.post(
          '/api/admin/waitlist/${widget.waitlistEntryId}/schedule',
          {
            'startUtc': start.toUtc().toIso8601String(),
            'durationMinutes': duration,
            'staffMemberId': staffId,
            'serviceDefinitionId': serviceId,
          },
        );
      } else {
        await widget.api.post('/api/admin/appointments/', {
          'branchId': widget.api.auth?.user?.branchId,
          'customerId': customerId,
          'staffMemberId': staffId,
          'serviceDefinitionId': serviceId,
          'startUtc': start.toUtc().toIso8601String(),
          'endUtc': end.toUtc().toIso8601String(),
          'price': price,
          'notes': notes.text.trim().isEmpty ? null : notes.text.trim(),
        });
      }
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

  /// Açık cariden tahsilat — kırılım (nakit+kart) destekli ortak sayfa.
  /// Birden çok cari varsa önce hangisi olduğu sorulur.
  Future<void> _openCollect() async {
    if (_accounts.isEmpty) return;
    var account = _accounts.first;
    if (_accounts.length > 1) {
      final picked = await showModalBottomSheet<Map<String, dynamic>>(
        context: context,
        isScrollControlled: true,
        backgroundColor: Colors.white,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        ),
        builder: (ctx) => SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Hangi cari?',
                    style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
                const SizedBox(height: 12),
                Flexible(
                  child: ListView.separated(
                    shrinkWrap: true,
                    itemCount: _accounts.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 8),
                    itemBuilder: (_, i) {
                      final a = _accounts[i];
                      return Card(
                        margin: EdgeInsets.zero,
                        child: ListTile(
                          title: Text('${a['name'] ?? 'Satış'}',
                              style: const TextStyle(fontWeight: FontWeight.w700)),
                          subtitle: Text(
                              'Kalan ${_money(_positive(a['remainingAmount']))}'),
                          onTap: () => Navigator.of(ctx).pop(a),
                        ),
                      );
                    },
                  ),
                ),
              ],
            ),
          ),
        ),
      );
      if (picked == null || !mounted) return;
      account = picked;
    }
    final done = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (_) => InstallmentPaymentSheet(api: widget.api, account: account),
    );
    if (done == true) await _refreshCustomerData();
  }

  static String _money(double v) =>
      NumberFormat.currency(locale: 'tr_TR', symbol: '₺', decimalDigits: 0).format(v);

  /// Para durumu + satışlar (kim sattı) + seans dökümü + son tahsilatlar.
  Widget _customerDossier() {
    // Hizmet bazında seans dökümü: yapılan / toplam.
    final ledger = <String, List<int>>{};
    for (final s in _sessions) {
      final name = '${s['serviceName'] ?? 'Hizmet'}';
      final used = (s['usedSessions'] as num?)?.toInt() ?? 0;
      final total = (s['totalSessions'] as num?)?.toInt() ?? 0;
      final e = ledger[name] ?? [0, 0];
      ledger[name] = [e[0] + used, e[1] + total];
    }

    // Son tahsilatlar — tüm carilerin ödemeleri, yeniden eskiye.
    final payments = <Map<String, dynamic>>[];
    for (final a in _accounts) {
      for (final p in (a['payments'] as List? ?? const [])) {
        if (p is Map) payments.add(p.cast<String, dynamic>());
      }
    }
    payments.sort((x, y) => '${y['occurredAtUtc']}'.compareTo('${x['occurredAtUtc']}'));

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFEFE1E7)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (_dossierLoading)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 6),
              child: SizedBox(
                height: 16,
                width: 16,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            ),
          Row(
            children: [
              Expanded(child: _metric('Açık borç', _money(_openDebt), debt: _openDebt > 0)),
              const SizedBox(width: 8),
              Expanded(child: _metric('Tahsil edilen', _money(_paidTotal))),
            ],
          ),

          // SATIŞLAR — kim sattı
          if (_accounts.isNotEmpty) ...[
            const SizedBox(height: 12),
            _dossierTitle('Satışlar'),
            for (final a in _accounts.take(4))
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text('${a['name'] ?? 'Satış'}',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                  fontSize: 12.5, fontWeight: FontWeight.w600)),
                        ),
                        Text(_money(_positive(a['totalAmount'])),
                            style: const TextStyle(
                                fontSize: 12, fontWeight: FontWeight.w700)),
                      ],
                    ),
                    Text(
                      '${a['soldByStaffName'] != null && '${a['soldByStaffName']}'.isNotEmpty ? 'Satan: ${a['soldByStaffName']}' : 'Satan belirtilmemiş'}'
                      '${_positive(a['remainingAmount']) > 0 ? ' · ${_money(_positive(a['remainingAmount']))} kalan' : ''}',
                      style: const TextStyle(fontSize: 11.5, color: Color(0xFF705A66)),
                    ),
                  ],
                ),
              ),
          ],

          // SEANSLAR — yapılan / toplam
          if (ledger.isNotEmpty) ...[
            const SizedBox(height: 12),
            _dossierTitle('Seanslar'),
            for (final e in ledger.entries)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(e.key,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                  fontSize: 12.5, fontWeight: FontWeight.w600)),
                        ),
                        Text('${e.value[0]} / ${e.value[1]} yapıldı',
                            style: const TextStyle(
                                fontSize: 11.5, color: Color(0xFF705A66))),
                      ],
                    ),
                    const SizedBox(height: 4),
                    ClipRRect(
                      borderRadius: BorderRadius.circular(4),
                      child: LinearProgressIndicator(
                        value: e.value[1] > 0 ? e.value[0] / e.value[1] : 0,
                        minHeight: 4,
                        backgroundColor: const Color(0xFFF4E4EA),
                        valueColor:
                            const AlwaysStoppedAnimation(Color(0xFF8E3F5B)),
                      ),
                    ),
                  ],
                ),
              ),
          ],

          // SON TAHSİLATLAR
          if (payments.isNotEmpty) ...[
            const SizedBox(height: 12),
            _dossierTitle('Son tahsilatlar'),
            for (final p in payments.take(4))
              Padding(
                padding: const EdgeInsets.only(top: 5),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        '${_shortDate(p['occurredAtUtc'])}  ${_methodLabel('${p['method'] ?? ''}')}',
                        style: const TextStyle(
                            fontSize: 12, color: Color(0xFF705A66)),
                      ),
                    ),
                    Text(_money(_positive(p['amount'])),
                        style: const TextStyle(
                            fontSize: 12, fontWeight: FontWeight.w700)),
                  ],
                ),
              ),
          ],
        ],
      ),
    );
  }

  Widget _dossierTitle(String text) => Text(
        text.toUpperCase(),
        style: const TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w800,
          letterSpacing: 0.8,
          color: Color(0xFFA3576F),
        ),
      );

  Widget _metric(String label, String value, {bool debt = false}) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(
          color: debt ? const Color(0xFFFFF4F8) : const Color(0xFFFDF9FB),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
              color: debt ? const Color(0xFFE8C2D1) : const Color(0xFFEFE1E7)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label,
                style: const TextStyle(fontSize: 11, color: Color(0xFF705A66))),
            const SizedBox(height: 2),
            Text(value,
                style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w800,
                    color: debt ? const Color(0xFF8E3F5B) : const Color(0xFF2B1E29))),
          ],
        ),
      );

  static String _shortDate(dynamic iso) {
    final d = DateTime.tryParse('$iso')?.toLocal();
    return d == null ? '—' : DateFormat('dd MMM', 'tr_TR').format(d);
  }

  static String _methodLabel(String m) {
    final k = m.toLowerCase();
    if (k.contains('cash') || k.contains('nakit')) return 'Nakit';
    if (k.contains('card') || k.contains('kart')) return 'Kart';
    if (k.contains('transfer') || k.contains('havale') || k.contains('eft')) return 'Havale';
    return m;
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
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        'Yeni randevu',
                        style: Theme.of(context).textTheme.titleLarge?.copyWith(
                              fontWeight: FontWeight.w800,
                            ),
                      ),
                    ),
                    TextButton.icon(
                      onPressed: () => AppointmentHelpSheet.show(context),
                      icon: const Icon(Icons.help_outline_rounded, size: 18),
                      label: const Text('Nasil calisir?'),
                      style: TextButton.styleFrom(
                        foregroundColor: AppColors.primary,
                        visualDensity: VisualDensity.compact,
                        textStyle: const TextStyle(
                          fontSize: 12.5,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ],
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
                if (customerId != null) ...[
                  const SizedBox(height: 12),
                  _customerDossier(),
                  const SizedBox(height: 12),
                  // MÜŞTERİ GEÇMİŞİ — kullanılan seansların TARİHLERİ, işlem defteri
                  // ve tahsilat listesi (web AppointmentEditor paritesi).
                  CustomerHistoryPanel(
                    api: widget.api,
                    customerId: customerId!,
                    accounts: _accounts,
                    refreshKey: _historyKey,
                  ),
                ],
                const SizedBox(height: 10),
                // Müşteriye yapılan işlemler — randevudan çıkmadan.
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    FilledButton.icon(
                      onPressed: _accounts.isEmpty ? null : _openCollect,
                      icon: const Icon(Icons.payments_rounded, size: 18),
                      label: const Text('Tahsilat al'),
                    ),
                    OutlinedButton.icon(
                      onPressed: () => _openSale(),
                      icon: const Icon(Icons.card_giftcard_rounded, size: 18),
                      label: const Text('Paket sat'),
                    ),
                    OutlinedButton.icon(
                      onPressed: () => _openSale(serviceSale: true),
                      icon: const Icon(Icons.point_of_sale_rounded, size: 18),
                      label: const Text('Hizmet sat'),
                    ),
                    OutlinedButton.icon(
                      onPressed: _openAdisyon,
                      icon: const Icon(Icons.receipt_long_rounded, size: 18),
                      label: const Text('Adisyon aç'),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                // SEANS KURALI: seansi olan hizmet paketten dusulur, olmayan UCRETLI acilir.
                // Kullanici "neden bu randevu ucretli cikti" sorusunu burada gorsun.
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFFF6F9),
                    border: Border.all(color: const Color(0xFFE8C2D1)),
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Icon(Icons.shopping_bag_rounded,
                          size: 16, color: Color(0xFF8E3F5B)),
                      const SizedBox(width: 8),
                      const Expanded(
                        child: Text(
                          'Kalan seansi olan hizmet ucretsiz acilir. Seansi yoksa randevu katalog '
                          'fiyatiyla UCRETLI acilir; asagidaki anahtari acarsan bunun yerine HIZMET '
                          'SATISI acilir ve randevu tamamlaninca cariye/seansa otomatik islenir.',
                          style: TextStyle(fontSize: 12, height: 1.4),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 12),
                _select(
                  label: 'Hizmet',
                  value: serviceId,
                  items: services,
                  titleKeys: const ['name'],
                  onChanged: (value) => setState(() {
                    serviceId = value;
                    // Hizmet değişince kategori-yetkisiz personel seçili kalmasın.
                    if (staffId != null &&
                        !_eligibleStaff.any((s) => '${s['id']}' == staffId)) {
                      staffId = null;
                    }
                  }),
                ),
                // Seansı olmayan hizmette: ücretli randevu mu, satış mı?
                if (serviceId != null && !_hasSessionForSelected)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: SwitchListTile.adaptive(
                      contentPadding: EdgeInsets.zero,
                      dense: true,
                      value: _sellFromCatalog,
                      onChanged: (v) => setState(() => _sellFromCatalog = v),
                      title: const Text(
                        'Bu hizmeti sat',
                        style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
                      ),
                      subtitle: const Text(
                        'Randevuyla birlikte satis acilir; cariye simdi islenmez, randevu '
                        'tamamlaninca borc ve seans olusur.',
                        style: TextStyle(fontSize: 11.5, height: 1.35),
                      ),
                    ),
                  ),
                const SizedBox(height: 12),
                _select(
                  label: 'Personel',
                  value: staffId,
                  items: _eligibleStaff,
                  titleKeys: const ['fullName'],
                  onChanged: (value) => setState(() => staffId = value),
                ),
                if (_selectedService != null &&
                    _eligibleStaff.length < staff.length)
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Text(
                      'Bu hizmetin kategorisinde yetkili olmayan ${staff.length - _eligibleStaff.length} personel listelenmiyor.',
                      style:
                          const TextStyle(fontSize: 11, color: Colors.black54),
                    ),
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

  /// Randevu formundan müşterinin adisyonunu aç (yoksa oluştur) — Ön Muhasebe'ye gitmeden.
  Future<void> _openAdisyon() async {
    final cid = customerId;
    if (cid == null || cid.isEmpty) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Önce müşteri seçin.')));
      return;
    }
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
          await _loadDossier();
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
