import 'dart:async';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/auth/permissions.dart';
import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/crud/crud_screen.dart';
import '../../shared/json_helpers.dart';
import '../accounting/account_installments.dart';
import '../accounting/adisyon_detail_sheet.dart';
import '../accounting/package_sale_sheet.dart';
import '../customers/consultation_form_screen.dart';
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
  List<Map<String, dynamic>> packages = [];
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

  /// MÜŞTERİ BİLGİ VE ONAY FORMU (web `ConsultationWarningBanner` paritesi).
  /// null = henüz bakılmadı / plan kapsamı dışı → hiçbir şey gösterme.
  /// false = form YOK (doldurulmalı), true = form var.
  bool? _hasConsultation;

  /// İŞLEM = HİZMET ya da PAKET (web AppointmentEditor paritesi).
  ///
  /// - **Hizmet**: katalogdan hizmet seçilir. Müşterinin o hizmete kalan seansı varsa randevu
  ///   O SEANSA açılır (satış yok); yoksa randevuyla birlikte hizmet SATIŞI açılır — cariye
  ///   şimdi işlenmez, randevu tamamlanınca borç ve seans oluşur.
  /// - **Paket**: YALNIZCA müşterinin satın aldığı paketler, içindeki her işlemden kaç seans
  ///   kaldığıyla listelenir; randevu seçilen satıra açılır. Buradan paket SATILMAZ — paket
  ///   satışının kendi modalı var ("Paket sat").
  ///
  /// Eskiden burada "Bu hizmeti sat" anahtarı vardı ve KAPALIYKEN randevu katalog fiyatıyla
  /// ÜCRETLİ açılıyordu: para ne adisyona ne cariye yazıldığı için Ön Muhasebe'de hiç
  /// görünmüyordu. Artık hakkı olmayan hizmet her zaman satışa dönüşür (web ile aynı).
  String _workKind = 'service'; // 'service' | 'package'
  /// Satın alınmış pakette seçilen satır: `${packageId}|${serviceDefinitionId}`
  String? _ownedPick;

  /// Seçilen paket satırının seans kaydı — randevu SUNUCUDA tam olarak buna bağlanır.
  /// Boş gönderilirse backend aynı hizmete ait en eski seansı tüketir (yanlış paketten düşme).
  String? _sourceSessionId;
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

  /// Bilgi ve onay formu var mı? Yoksa randevu adımında uyarı + "Formu doldur" çıkar.
  /// Hata/plan kapsamı dışı → null bırakılır ve hiçbir şey gösterilmez (akış bozulmasın).
  Future<void> _loadConsultation() async {
    final cid = customerId;
    if (cid == null || cid.isEmpty) {
      if (mounted) setState(() => _hasConsultation = null);
      return;
    }
    try {
      final res = await widget.api.get('/api/admin/customers/$cid/consultation');
      if (mounted) setState(() => _hasConsultation = res is Map && res.isNotEmpty);
    } catch (_) {
      if (mounted) setState(() => _hasConsultation = null);
    }
  }

  /// Müşteri değişince dosyayı tazeler. Satış/tahsilat sonrası da çağrılır.
  Future<void> _loadDossier() async {
    final cid = customerId;
    if (cid == null || cid.isEmpty) {
      if (mounted) setState(() { _accounts = []; _sessions = []; _hasConsultation = null; });
      return;
    }
    unawaited(_loadConsultation());
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
      // Açılış sekmesi: müşterinin kullanılabilir paketi varsa PAKET'ten başla (randevu
      // çoğunlukla ona açılır), yoksa HİZMET. Kullanıcı seçim yaptıysa dokunma.
      if (mounted && serviceId == null && _ownedPick == null) {
        setState(() => _workKind = _hasBookablePackage ? 'package' : 'service');
      }
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
      // Paket sekmesi: satın alınmış paketin ADI ve katalogdan yeni paket satışı için.
      widget.api
          .get('/api/admin/packages/', query: {'page': 1, 'pageSize': 200})
          .catchError((_) => const <String, dynamic>{}),
    ]);
    final presetCustomer =
        values[0] is Map ? (values[0] as Map).cast<String, dynamic>() : null;
    customers = presetCustomer != null && presetCustomer['id'] != null
        ? [presetCustomer]
        : [];
    staff = apiItems(values[1]);
    services = apiItems(values[2]);
    packages = apiItems(values[3]);
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

  /// GEÇERLİ BİR ŞUBE ID'Sİ — oturumdan, yoksa kurumun varsayılan şubesinden.
  ///
  /// KURUM YÖNETİCİSİNİN ŞUBESİ YOKTUR (`branchId = null`): kurumun tamamını yönetir.
  /// Backend ise `CreateAppointmentRequest.BranchId` alanını NULL OLAMAYAN `Guid` olarak
  /// bekliyor. Oturumdaki null doğrudan gönderildiğinde istek model bağlamada düşüyor ve
  /// gövdesiz bir 400 dönüyordu; mobil bunu çözemediği için kullanıcı yalnızca
  /// "İstek tamamlanamadı." görüyordu (hatanın nedeni hiçbir yerde görünmüyordu).
  /// Bu yüzden şube burada çözülür — hızlı müşteri kaydı zaten böyle yapıyordu,
  /// randevu ve bekleme listesi yolları atlanmıştı.
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
    throw const ApiException(
        'Şube bilgisi bulunamadı. Ayarlar → Şubeler bölümünden en az bir şube tanımlayın.');
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

  /// Hizmet → müşterinin kalan seans sayısı (0 olanlar da haritada değil, yalnız pozitifler).
  Map<String, int> get _remainingByService {
    final map = <String, int>{};
    for (final s in _sessions) {
      final id = '${s['serviceDefinitionId']}';
      if (id.isEmpty || id == 'null') continue;
      final remaining = (s['remainingSessions'] as num?)?.toInt() ?? 0;
      if (remaining <= 0) continue;
      map[id] = (map[id] ?? 0) + remaining;
    }
    return map;
  }

  /// MÜŞTERİNİN SATIN ALDIĞI PAKETLER — paket → içindeki hizmetlerin seans kırılımı.
  /// Tekil hizmet satışında ServicePackageId boş GUID gelir; o satırlar pakete girmez.
  List<Map<String, dynamic>> get _ownedPackages {
    const emptyGuid = '00000000-0000-0000-0000-000000000000';
    final map = <String, Map<String, dynamic>>{};
    for (final s in _sessions) {
      final pid = '${s['servicePackageId']}';
      final sid = '${s['serviceDefinitionId']}';
      if (pid.isEmpty || pid == 'null' || pid == emptyGuid) continue;
      if (sid.isEmpty || sid == 'null') continue;
      final pkg = packages.firstWhere((p) => '${p['id']}' == pid,
          orElse: () => const <String, dynamic>{});
      final entry = map[pid] ??= {
        'packageId': pid,
        'name': '${pkg['name'] ?? 'Paket'}',
        'rows': <Map<String, dynamic>>[],
      };
      final rows = entry['rows'] as List<Map<String, dynamic>>;
      final row = rows.firstWhere((r) => r['serviceDefinitionId'] == sid,
          orElse: () => const <String, dynamic>{});
      final remaining = (s['remainingSessions'] as num?)?.toInt() ?? 0;
      final total = (s['totalSessions'] as num?)?.toInt() ?? 0;
      final sessionId = '${s['id'] ?? ''}';
      if (row.isEmpty) {
        rows.add({
          'serviceDefinitionId': sid,
          'serviceName': '${s['serviceName'] ?? 'Hizmet'}',
          'remaining': remaining,
          'total': total,
          // Randevu TAM olarak bu seans kaydına bağlanır (aynı hizmet birden çok pakette olabilir).
          'sessionId': remaining > 0 && sessionId.isNotEmpty ? sessionId : null,
        });
      } else {
        row['remaining'] = (row['remaining'] as int) + remaining;
        row['total'] = (row['total'] as int) + total;
        if (row['sessionId'] == null && remaining > 0 && sessionId.isNotEmpty) {
          row['sessionId'] = sessionId;
        }
      }
    }
    final list = map.values.toList();
    list.sort((a, b) => _pkgRemaining(b).compareTo(_pkgRemaining(a)));
    return list;
  }

  static int _pkgRemaining(Map<String, dynamic> pkg) => (pkg['rows'] as List)
      .fold<int>(0, (n, r) => n + ((r as Map)['remaining'] as int));

  bool get _hasBookablePackage => _ownedPackages.any((p) => _pkgRemaining(p) > 0);

  /// MÜŞTERİNİN SATIN ALDIĞI TEKİL HİZMETLER — pakete bağlı OLMAYAN seans bakiyeleri
  /// (adisyonda hizmet satılınca `ServicePackageId = Guid.Empty` ile açılır).
  ///
  /// NEDEN AYRI LİSTE: Hizmet sekmesi yalnız katalog gösteriyordu; müşterinin ödediği hizmet
  /// hakları sadece seçim etiketindeki küçük bir metinden anlaşılıyordu. Paket sekmesindeki
  /// "satın alınmıştan seç" davranışının aynısı burada da olsun — katalog altta kalır.
  List<Map<String, dynamic>> get _ownedServices {
    const emptyGuid = '00000000-0000-0000-0000-000000000000';
    final map = <String, Map<String, dynamic>>{};
    for (final s in _sessions) {
      final pid = '${s['servicePackageId'] ?? ''}';
      final sid = '${s['serviceDefinitionId'] ?? ''}';
      if (sid.isEmpty || sid == 'null') continue;
      // Pakete bağlı satırlar Paket sekmesine aittir.
      if (pid.isNotEmpty && pid != 'null' && pid != emptyGuid) continue;
      final remaining = (s['remainingSessions'] as num?)?.toInt() ?? 0;
      final total = (s['totalSessions'] as num?)?.toInt() ?? 0;
      final sessionId = '${s['id'] ?? ''}';
      final row = map[sid];
      if (row == null) {
        map[sid] = {
          'serviceDefinitionId': sid,
          'serviceName': '${s['serviceName'] ?? 'Hizmet'}',
          'remaining': remaining,
          'total': total,
          // Randevu TAM olarak bu seans kaydına bağlanır (aynı hizmet birden çok kez satılmış olabilir).
          'sessionId': remaining > 0 && sessionId.isNotEmpty ? sessionId : null,
        };
      } else {
        row['remaining'] = (row['remaining'] as int) + remaining;
        row['total'] = (row['total'] as int) + total;
        if (row['sessionId'] == null && remaining > 0 && sessionId.isNotEmpty) {
          row['sessionId'] = sessionId;
        }
      }
    }
    final list = map.values.toList();
    // Kalanı olanlar üstte; sonra bitmeye en yakın önce.
    list.sort((a, b) {
      final ra = a['remaining'] as int, rb = b['remaining'] as int;
      if ((ra > 0) != (rb > 0)) return rb > 0 ? 1 : -1;
      return ra.compareTo(rb);
    });
    return list;
  }

  /// Seçimi sıfırlar — sekme değişince önceki seçim (ve satış riski) taşınmasın.
  void _clearWorkSelection() {
    serviceId = null;
    _ownedPick = null;
    _sourceSessionId = null;
  }

  Future<void> save() async {
    if (customerId == null || staffId == null) return;
    if (serviceId == null) {
      ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Lütfen bir hizmet/işlem seçin.')));
      return;
    }
    // Paket sekmesinden gelen hizmet katalogda bulunamazsa (silinmiş/pasif) boş harita döner;
    // süre varsayılana düşer ve yetki kontrolü atlanır — backend yine doğrular.
    final service = services.firstWhere((e) => '${e['id']}' == serviceId,
        orElse: () => const <String, dynamic>{});
    // Kategori yetkisi (backend de doğrular; burada erken uyarı).
    final chosenStaff = staff.firstWhere(
      (s) => '${s['id']}' == staffId,
      orElse: () => const {},
    );
    if (chosenStaff.isNotEmpty && service.isNotEmpty && !_staffCanPerform(chosenStaff, service)) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text(
              'Seçili personel bu hizmetin kategorisinde yetkili değil. Farklı personel seçin.')));
      return;
    }
    final duration = (service['durationMinutes'] as num?)?.toInt() ?? 60;
    final end = start.add(Duration(minutes: duration));
    // RANDEVU HER ZAMAN ÜCRETSİZ GİDER (price 0): ya paketten/hizmet hakkından karşılanır ya da
    // bedelini satış adisyonu tahsil eder. Randevuya da fiyat yazılsaydı aynı iş iki kez
    // ödetilirdi. Ayrıca backend yalnız price <= 0 iken kaynak seans bağını kurar ve hizmet
    // hakkını doğrular; ücretli gönderilen randevuda deterministik bağ hiç oluşmuyordu.
    //
    // SATIŞ, HAKKI OLMAYAN HİZMET SEÇİMİNDE AÇILIR (web ile aynı). Eskiden bu bir anahtara
    // bağlıydı ve KAPALIYKEN randevu katalog fiyatıyla ücretli açılıyordu: para ne adisyona ne
    // cariye yazıldığı için Ön Muhasebe'de hiç görünmüyordu. Paket satışı bu formun işi değil.
    final coveredByPackage = _hasSessionForSelected;
    final sellNow = !coveredByPackage;
    const price = 0;
    // Client-side ön kontrol: personelin bu slotta zaten 2 aktif randevusu varsa doğrudan
    // "bekleme listesine ekle?" teklifi göster (sunucuya gitmeden).
    if (_overlapCount(start, end) >= 2) {
      await _offerWaitlist(duration);
      return;
    }
    setState(() => saving = true);
    try {
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
        final appointment = {
          // Oturumdaki null DEĞİL: kurum yöneticisinin şubesi yoktur, backend ise
          // null olamayan Guid bekler (bkz. _resolveBranchId).
          'branchId': await _resolveBranchId(),
          'customerId': customerId,
          'staffMemberId': staffId,
          'serviceDefinitionId': serviceId,
          'startUtc': start.toUtc().toIso8601String(),
          'endUtc': end.toUtc().toIso8601String(),
          'price': price,
          'notes': notes.text.trim().isEmpty ? null : notes.text.trim(),
          // SEÇİLEN PAKETİN SEANSI (web paritesi): gönderilmezse backend aynı hizmete ait EN
          // ESKİ seansı tüketir ve kullanıcı B paketini seçse bile A paketinden düşerdi.
          'sourceCustomerPackageSessionId': _sourceSessionId,
        };
        if (sellNow) {
          // SATIS + RANDEVU TEK TRANSACTION. Ayri cagrilarla yapilsaydi randevu adimi
          // (slot dolu, yetki, ag) dustugunde musteriye yazilmis acik satis ortada kalirdi.
          await widget.api.post('/api/admin/appointments/with-sale', {
            'appointment': appointment,
            'sale': {
              'serviceDefinitionId': serviceId,
              'servicePackageId': null,
              'staffMemberId': staffId,
            },
          });
        } else {
          await widget.api.post('/api/admin/appointments/', appointment);
        }
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
      // Bekleme kaydı randevuyla AYNI şubeye düşsün. Bu alan backend'de NULLABLE
      // olduğundan, şube çözülemezse null gönderilir: kayıt kurum geneli olur ama
      // istek başarısız OLMAZ (randevudaki gibi zorunlu değil).
      String? branchId;
      try {
        branchId = await _resolveBranchId();
      } catch (_) {
        branchId = null;
      }
      await widget.api.post('/api/admin/waitlist/', {
        'customerId': customerId,
        'serviceDefinitionId': serviceId,
        'staffMemberId': staffId,
        'preferredDate': DateFormat('yyyy-MM-dd').format(start),
        'preferredStartUtc': start.toUtc().toIso8601String(),
        'durationMinutes': duration,
        'branchId': branchId,
        // SEÇİLEN PAKET/SEANS BEKLEME KAYDINDA DA SAKLANIR (web paritesi): taşınmazsa yer
        // açıldığında aynı hizmetin EN ESKİ seansı tüketilir, kullanıcının seçimi kaybolur.
        'sourceCustomerPackageSessionId': _sourceSessionId,
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

  /// HİZMET / PAKET sekmeleri — tek soruluk seçim.
  Widget _workKindTabs() {
    Widget tab(String v, String label, IconData icon) {
      final active = _workKind == v;
      return Expanded(
        child: GestureDetector(
          onTap: () => setState(() {
            _workKind = v;
            _clearWorkSelection();
          }),
          child: Container(
            padding: const EdgeInsets.symmetric(vertical: 9),
            decoration: BoxDecoration(
              color: active ? const Color(0xFF8E3F5B) : Colors.transparent,
              borderRadius: BorderRadius.circular(999),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(icon, size: 15, color: active ? Colors.white : const Color(0xFF7A6672)),
                const SizedBox(width: 6),
                Text(
                  label,
                  style: TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w700,
                    color: active ? Colors.white : const Color(0xFF7A6672),
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }

    final pkgCount = _ownedPackages.length;
    final svcCount = _ownedServices.length;
    return Container(
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: const Color(0xFFEFE1E7)),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(children: [
        // Sayaç = SATIN ALINMIŞ kayıt adedi; iki sekmede de aynı anlam.
        tab('service', svcCount > 0 ? 'Hizmet ($svcCount)' : 'Hizmet',
            Icons.content_cut_rounded),
        tab('package', pkgCount > 0 ? 'Paket ($pkgCount)' : 'Paket', Icons.card_giftcard_rounded),
      ]),
    );
  }

  /// HİZMET SEKMESİ — SATIN ALINAN hizmetler (paket sekmesindeki düzenin aynısı) + altında
  /// katalogdan yeni hizmet satışı.
  List<Widget> _serviceTab() {
    final owned = _ownedServices;
    final remainingMap = _remainingByService;
    // Hakkı olan hizmetler üstte ve rozetli: seçmeden önce satış açılıp açılmayacağı görünsün.
    final items = services.map((s) {
      final id = '${s['id']}';
      final remaining = remainingMap[id] ?? 0;
      return {
        ...s,
        '_label': remaining > 0 ? '${s['name']}  ·  $remaining seans hakkı' : '${s['name']}',
        '_remaining': remaining,
      };
    }).toList()
      ..sort((a, b) => (b['_remaining'] as int).compareTo(a['_remaining'] as int));

    final selected = serviceId == null
        ? null
        : services.firstWhere((s) => '${s['id']}' == serviceId,
            orElse: () => const <String, dynamic>{});
    final remaining = serviceId == null ? 0 : (remainingMap[serviceId!] ?? 0);

    return [
      // SATIN ALINAN HİZMETLER — paket sekmesindeki kartın aynısı. Müşterinin ödediği hak
      // önce gelir: yeni satış açmadan önce kullanılmamış seansı görünsün.
      if (owned.isNotEmpty) ...[
        _OwnedPackageCard(
          name: 'Satın alınan hizmetler',
          rows: owned,
          keyOf: (r) => 'svc:${r['serviceDefinitionId']}',
          selectedKey: _ownedPick,
          onPick: (row) => setState(() {
            final sid = '${row['serviceDefinitionId']}';
            _ownedPick = 'svc:$sid';
            serviceId = sid;
            // Seans kimliği SUNUCUYA gider: randevu tam olarak SEÇİLEN satışın bakiyesine bağlanır.
            _sourceSessionId = row['sessionId'] as String?;
            if (staffId != null && !_eligibleStaff.any((s) => '${s['id']}' == staffId)) {
              staffId = null;
            }
          }),
        ),
        const SizedBox(height: 12),
        _sectionLabel('Yeni hizmet sat'),
        const SizedBox(height: 6),
      ],
      _select(
        label: 'Hizmet',
        value: _ownedPick != null && _ownedPick!.startsWith('svc:') ? null : serviceId,
        items: items,
        titleKeys: const ['_label'],
        onChanged: (value) => setState(() {
          serviceId = value;
          _ownedPick = null;
          // Katalogdan hizmet seçimi bir paket satırına bağlı değildir.
          _sourceSessionId = null;
          // Hizmet değişince kategori-yetkisiz personel seçili kalmasın.
          if (staffId != null && !_eligibleStaff.any((s) => '${s['id']}' == staffId)) {
            staffId = null;
          }
        }),
      ),
      // Satın alınmış hizmetten seçildiğinde de ne olacağını yaz — katalogla aynı netlik.
      if (_ownedPick != null && _ownedPick!.startsWith('svc:')) ...[
        const SizedBox(height: 10),
        Builder(builder: (_) {
          final row = owned.firstWhere(
              (r) => 'svc:${r['serviceDefinitionId']}' == _ownedPick,
              orElse: () => const <String, dynamic>{});
          if (row.isEmpty) return const SizedBox.shrink();
          return _noteBox(
            icon: Icons.check_circle_rounded,
            bg: const Color(0xFFECFDF5),
            border: const Color(0xFFA7F3D0),
            fg: const Color(0xFF065F46),
            text: '${row['serviceName']} — satın alınmış hizmetten ${row['remaining']} seans '
                'kaldı. Yeni satış açılmaz; randevu bu bakiyeye açılır ve tamamlanınca '
                '1 seans düşer.',
          );
        }),
      ],
      if (_ownedPick == null && selected != null && selected.isNotEmpty) ...[
        const SizedBox(height: 10),
        if (remaining > 0)
          _noteBox(
            icon: Icons.check_circle_rounded,
            bg: const Color(0xFFECFDF5),
            border: const Color(0xFFA7F3D0),
            fg: const Color(0xFF065F46),
            text: '${selected['name']} için müşterinin $remaining seans hakkı var. '
                'Yeni satış açılmaz; randevu bu bakiyeye açılır ve tamamlanınca 1 seans düşer.',
          )
        else
          _noteBox(
            icon: Icons.shopping_bag_rounded,
            bg: const Color(0xFFFFF6F9),
            border: const Color(0xFFE8C2D1),
            fg: const Color(0xFF4A3A44),
            text: '${selected['name']} — ${_money(((selected['price'] as num?) ?? 0).toDouble())}. '
                'Müşterinin bu hizmete hakkı yok; randevuyla birlikte SATIŞ açılır. Cariye şimdi '
                'işlenmez, randevu tamamlanınca borç ve seans oluşur.',
          ),
      ],
    ];
  }

  /// PAKET SEKMESİ — YALNIZ satın alınmış paketler, işlem/seans kırılımıyla.
  ///
  /// Buradan paket SATILMAZ: satışın kendi modalı var ("Paket sat"), aynı işi iki yerde yapmayalım.
  List<Widget> _packageTab() {
    final owned = _ownedPackages;
    if (owned.isEmpty) {
      return [
        _noteBox(
          icon: Icons.card_giftcard_rounded,
          bg: const Color(0xFFFDF6EC),
          border: const Color(0xFFF0DCC4),
          fg: const Color(0xFF8A6524),
          text: 'Bu müşterinin satın aldığı paket yok. Yukarıdaki "Paket sat" ile paketi satabilir, '
              'sonra buradan randevusunu açabilirsin. Tek seferlik iş için "Hizmet" sekmesini kullan.',
        ),
      ];
    }
    return [
      for (final p in owned) ...[
        _OwnedPackageCard(
          name: '${p['name']}',
          rows: (p['rows'] as List).cast<Map<String, dynamic>>(),
          keyOf: (r) => '${p['packageId']}|${r['serviceDefinitionId']}',
          selectedKey: _ownedPick,
          onPick: (row) => setState(() {
            final sid = '${row['serviceDefinitionId']}';
            _ownedPick = '${p['packageId']}|$sid';
            serviceId = sid;
            // Seans kimliği SUNUCUYA gider: randevu tam olarak SEÇİLEN paketin bakiyesine bağlanır.
            _sourceSessionId = row['sessionId'] as String?;
            if (staffId != null && !_eligibleStaff.any((s) => '${s['id']}' == staffId)) {
              staffId = null;
            }
          }),
        ),
        const SizedBox(height: 8),
      ],
    ];
  }

  /// MÜŞTERİ BİLGİ VE ONAY FORMU bandı — eksikse doldurma butonuyla (web paritesi).
  ///
  /// Form randevu verilirken eksik görünüyor ama doldurmak için müşteri kartına gidip randevuyu
  /// yarıda bırakmak gerekiyordu. Buton formu üstte açar; dönüşte durum tazelenir.
  Widget _consultationBanner() {
    final has = _hasConsultation;
    if (has == null) return const SizedBox.shrink();
    // Form ekranı /consultation rotasıyla aynı izne tabidir; burada rota gating'i atlandığı
    // için kontrol elle yapılır (yetkisiz personel butonu görmez, uyarıyı görür).
    final canOpen = widget.api.auth?.user?.hasPage(Perm.customers) ?? false;

    Future<void> openForm() async {
      final cid = customerId;
      if (cid == null) return;
      await Navigator.of(context).push<void>(MaterialPageRoute(
        builder: (_) => ConsultationFormScreen(
          api: widget.api,
          customerId: cid,
          customerName: customerName,
          startInCreateMode: has == false,
        ),
      ));
      await _loadConsultation();
    }

    final missing = has == false;
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Container(
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: missing ? const Color(0xFFFFFBEB) : const Color(0xFFECFDF5),
          border: Border.all(color: missing ? const Color(0xFFFDE68A) : const Color(0xFFA7F3D0)),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(missing ? Icons.assignment_late_rounded : Icons.verified_rounded,
                size: 16, color: missing ? const Color(0xFF92400E) : const Color(0xFF065F46)),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                missing
                    ? 'Müşteri bilgi ve onay formu doldurulmamış. İşlemden önce alınması önerilir.'
                    : 'Müşteri bilgi ve onay formu mevcut.',
                style: TextStyle(
                  fontSize: 11.5,
                  height: 1.35,
                  color: missing ? const Color(0xFF92400E) : const Color(0xFF065F46),
                ),
              ),
            ),
            if (canOpen) ...[
              const SizedBox(width: 8),
              OutlinedButton(
                // Row içinde tema minimumSize'ı sonsuz genişlik verip yazıyı harf harf sarıyor.
                style: AppButtons.inline(height: 36),
                onPressed: openForm,
                child: Text(missing ? 'Formu doldur' : 'Formu aç',
                    style: const TextStyle(fontSize: 12)),
              ),
            ],
          ],
        ),
      ),
    );
  }

  /// Hizmet sekmesindeki iki bölümü ayıran küçük başlık ("satın alınan" ↔ "yeni sat").
  Widget _sectionLabel(String text) => Text(
        text.toUpperCase(),
        style: const TextStyle(
          fontSize: 10,
          fontWeight: FontWeight.w800,
          letterSpacing: .8,
          color: Color(0xFFA3576F),
        ),
      );

  /// Ne olacağını açıkça yazan bilgi kutusu (satış açılacak mı, seanstan mı düşecek).
  Widget _noteBox({
    required IconData icon,
    required Color bg,
    required Color border,
    required Color fg,
    required String text,
  }) =>
      Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: bg,
          border: Border.all(color: border),
          borderRadius: BorderRadius.circular(14),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, size: 16, color: fg),
            const SizedBox(width: 8),
            Expanded(
              child: Text(text, style: TextStyle(fontSize: 12, height: 1.4, color: fg)),
            ),
          ],
        ),
      );

  /// MÜŞTERİNİN PARASI — tek satır. Detay (satışlar, seanslar, tahsilatlar) alttaki geçmiş
  /// panelinde; ikisi eskiden aynı listeleri iki kez gösteriyordu (web paritesi).
  Widget _customerDossier() => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (_dossierLoading)
            const Padding(
              padding: EdgeInsets.only(bottom: 8),
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
        ],
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
                  // Bilgi/onay formu eksikse buradan doldurulur — randevu yarıda kalmasın.
                  _consultationBanner(),
                  _customerDossier(),
                  const SizedBox(height: 12),
                  // MÜŞTERİ GEÇMİŞİ — kullanılan seansların TARİHLERİ, işlem defteri
                  // ve tahsilat listesi (web AppointmentEditor paritesi).
                  CustomerHistoryPanel(
                    api: widget.api,
                    customerId: customerId!,
                    accounts: _accounts,
                    sessions: _sessions,
                    packages: packages,
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
                // İŞLEM — Hizmet mi, Paket mi (web AppointmentEditor 2. adımıyla parite).
                _workKindTabs(),
                const SizedBox(height: 10),
                if (_workKind == 'service') ..._serviceTab() else ..._packageTab(),
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

/// MÜŞTERİNİN SATIN ALDIĞI PAKET / HİZMET — içindeki her işlemin seans kırılımıyla.
///
/// Paket adı tek başına randevuya yetmez: bir paketin içinde birden çok işlem olabilir ve randevu
/// bunlardan BİRİNE açılır. Kart bu yüzden paketi başlık, işlemleri seçilebilir satır yapar;
/// kalanı biten satır seçilemez ama gizlenmez (paketin tamamı görünsün).
///
/// Aynı kart TEKİL HİZMET satışları için de kullanılır (pakete bağlı olmayan seanslar): iki
/// sekmede "satın alınmıştan seç" davranışı birebir aynı olsun. Satır anahtarını çağıran üretir
/// (`keyOf`) — paket satırı `paketId|hizmetId`, hizmet satırı `svc:hizmetId`.
class _OwnedPackageCard extends StatelessWidget {
  const _OwnedPackageCard({
    required this.name,
    required this.rows,
    required this.keyOf,
    required this.selectedKey,
    required this.onPick,
  });
  final String name;
  final List<Map<String, dynamic>> rows;

  /// Satırın seçim anahtarını üretir — paket ve hizmet kartları farklı biçim kullanır.
  final String Function(Map<String, dynamic> row) keyOf;

  /// Seçili satırın anahtarı.
  final String? selectedKey;

  /// Seçilen SATIRIN tamamı döner — çağıran hem hizmeti hem seans kaydını (sessionId) alır.
  final ValueChanged<Map<String, dynamic>> onPick;

  @override
  Widget build(BuildContext context) {
    final remainingTotal = rows.fold<int>(0, (n, r) => n + (r['remaining'] as int));
    final depleted = remainingTotal <= 0;

    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: depleted ? const Color(0xFFFBF5F7) : Colors.white,
        border: Border.all(
            color: depleted ? const Color(0xFFEFE1E7) : const Color(0xFFE8C2D1)),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.fromLTRB(12, 9, 12, 9),
            decoration: const BoxDecoration(
              border: Border(bottom: BorderSide(color: Color(0xFFF4E8EE))),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800),
                  ),
                ),
                // NET CEVAP: "3 / 4 seans" hangi sayının kalan olduğunu söylemiyordu.
                Text(
                  depleted ? 'Seans kalmadı' : '$remainingTotal seans kaldı',
                  style: TextStyle(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w700,
                    color: depleted ? const Color(0xFF7A6672) : const Color(0xFF8E3F5B),
                  ),
                ),
              ],
            ),
          ),
          for (final r in rows)
            _PackageRow(
              row: r,
              selected: selectedKey == keyOf(r),
              onTap: () => onPick(r),
            ),
        ],
      ),
    );
  }
}

class _PackageRow extends StatelessWidget {
  const _PackageRow({required this.row, required this.selected, required this.onTap});
  final Map<String, dynamic> row;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final remaining = row['remaining'] as int;
    final total = row['total'] as int;
    // Bakiyesi olsa da kullanılabilir seans KAYDI çözülemediyse seçtirme: randevu yanlış pakete
    // bağlanmaktansa hiç bağlanmasın.
    final usable = remaining > 0 && row['sessionId'] != null;
    final pct = total > 0 ? (total - remaining) / total : 0.0;

    return Material(
      color: selected ? const Color(0xFFFFF4F8) : Colors.transparent,
      child: InkWell(
        onTap: usable ? onTap : null,
        child: Opacity(
          opacity: usable ? 1 : 0.6,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
            child: Row(
              children: [
                Container(
                  width: 18,
                  height: 18,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: selected ? const Color(0xFF8E3F5B) : Colors.white,
                    border: Border.all(
                        color: selected ? const Color(0xFF8E3F5B) : const Color(0xFFE3D2DA)),
                  ),
                  child: selected
                      ? const Icon(Icons.check_rounded, size: 12, color: Colors.white)
                      : null,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '${row['serviceName']}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700),
                      ),
                      const SizedBox(height: 5),
                      ClipRRect(
                        borderRadius: BorderRadius.circular(999),
                        child: LinearProgressIndicator(
                          value: pct,
                          minHeight: 4,
                          backgroundColor: const Color(0xFFF4E4EA),
                          valueColor: const AlwaysStoppedAnimation(Color(0xFF8E3F5B)),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 10),
                // "3 / 4" okunmuyordu: kullanıcı KALAN seansı arıyor. Kalan büyük puntoda ve
                // kendi kelimesiyle; toplam/kullanılan ikinci satırda.
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      remaining > 0 ? '$remaining seans kaldı' : 'Seans kalmadı',
                      style: TextStyle(
                          fontSize: remaining > 0 ? 12.5 : 11.5,
                          fontWeight: FontWeight.w800,
                          color: remaining > 0
                              ? const Color(0xFF8E3F5B)
                              : const Color(0xFF7A6672)),
                    ),
                    Text(
                      '$total seanslık · ${total - remaining < 0 ? 0 : total - remaining} kullanıldı',
                      style: const TextStyle(fontSize: 10, color: Color(0xFF7A6672)),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
