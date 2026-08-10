import 'package:flutter/material.dart';

import '../../core/network/api_client.dart';
import '../../core/network/idempotency.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/json_helpers.dart';
import '../../shared/widgets/catalog_picker_field.dart';
import '../consent/consent_sale_notice.dart';
import '../customers/customer_picker.dart';
import 'adisyon_detail_sheet.dart';

/// Satışa eklenen ek kalemin türü — adisyon kartındaki kalem türlerinin satış alt kümesi.
enum _ExtraKind { service, package, product }

/// Satışa eklenmiş ek kalem (henüz kaydedilmedi — yalnız bellekte).
///
/// Adisyon BİLEREK önceden açılmaz: kullanıcı vazgeçerse ortada kalem toplamış açık bir fiş
/// kalırdı ve hizmet/paket fişleri "ilk randevuda otomatik işlenir" bayrağını taşıdığı için o
/// hayalet fiş müşterinin ilk randevusunda sessizce cariye borç yazardı.
class _SaleExtra {
  const _SaleExtra({
    required this.kind,
    required this.refId,
    required this.name,
    required this.unitPrice,
    required this.quantity,
    this.staffId,
  });

  final _ExtraKind kind;
  final String refId;
  final String name;
  final double unitPrice;
  final int quantity;
  final String? staffId;

  double get lineTotal => unitPrice * quantity;
}

const _extraKindLabels = <_ExtraKind, String>{
  _ExtraKind.service: 'Hizmet',
  _ExtraKind.package: 'Paket',
  _ExtraKind.product: 'Ürün',
};

const _extraKindIcons = <_ExtraKind, IconData>{
  _ExtraKind.service: Icons.auto_awesome_rounded,
  _ExtraKind.package: Icons.inventory_rounded,
  _ExtraKind.product: Icons.shopping_bag_rounded,
};

/// Web `PackageSaleDialog`'un mobil karşılığı.
///
/// - Varsayılan mod paket satışı; [serviceSale] hizmet, [productSale] ürün satışıdır.
/// - [customerId] verilirse müşteri sabittir (ör. randevu formundan);
///   verilmezse müşteri listeden seçilir (menüdeki Satış sayfası).
///
/// Akış web ile birebir: katalog kategori + alt kategori + aramayla bulunur, satışa EK hizmet /
/// paket / ürün eklenebilir, "Satışı kaydet" ile iş biter.
///
/// **ADİSYON KARTI KENDİLİĞİNDEN AÇILMAZ** (kullanıcı talebi: süreç uzuyordu). Ne olacağını
/// kullanıcıya sormak yerine TAHSİLAT belirler:
///  • **Peşinat alındıysa** → kaydedilir kaydedilmez onaylanır: cari borç, peşinat kasaya, seans/stok.
///  • **Alınmadıysa** → satış açık kalır, müşteri ilk randevusunu tamamlayınca otomatik işlenir.
///  • **Fişte ürün varsa** erteleme mümkün değildir → peşinatsız da olsa hemen onaylanır.
///
/// ERTELEME YALNIZ ÜRÜNSÜZ FİŞTE MÜMKÜNDÜR: bekleyen satış stok ayırmaz; fişteki ürün beklerken
/// tükenirse ilk randevunun otomatik onayı stok kontrolüne takılır ve randevunun tamamlanması
/// topluca başarısız olur (bkz. AppointmentService — onay başarısızsa tamamlama da başarısızdır).
class PackageSaleSheet extends StatefulWidget {
  const PackageSaleSheet({
    required this.api,
    this.customerId,
    this.customerName,
    this.serviceSale = false,
    this.productSale = false,
    super.key,
  });

  final ApiClient api;
  final String? customerId;
  final String? customerName;
  final bool serviceSale;
  final bool productSale;

  @override
  State<PackageSaleSheet> createState() => _PackageSaleSheetState();
}

class _PackageSaleSheetState extends State<PackageSaleSheet> {
  late Future<void> loading;
  List<Map<String, dynamic>> packages = [];
  List<Map<String, dynamic>> services = [];
  List<Map<String, dynamic>> products = [];
  List<Map<String, dynamic>> customers = [];
  List<Map<String, dynamic>> staff = [];
  List<String> categoryOrder = []; // özel kategori adları (SortOrder sırasında) — pill sırası

  String? customerId;
  String? packageId;
  String? serviceId;
  String? productId;
  int quantity = 1;
  String? staffId;
  bool installment = false;
  int installmentCount = 3;
  late DateTime firstDueDate;

  /// Ürün satışında satışın gerçekte yapıldığı gün (geçmişe dönük giriş).
  late DateTime saleDate;
  bool saving = false;

  /// SATIŞ AKIŞININ ÇİFT KAYIT FRENİ — web `PackageSaleDialog.saleSaltRef` ile aynı kural.
  ///
  /// Akış üç ayrı yazmadır (fiş aç → N kalem → onayla) ama TEK bir işlemdir: hepsi aynı tuzdan
  /// türer. Ağ kesilip kullanıcı tekrar gönderdiğinde fiş açma isteği ilk yanıtı oynatır, AYNI
  /// adisyon id'si döner ve kalemler de oynatılır — ikinci fiş açılmaz, kalemler çiftlenmez.
  String _saleSalt = newIdempotencySalt();
  final price = TextEditingController();
  final downPayment = TextEditingController();
  final notes = TextEditingController();

  // ---- Ek kalemler + kaydetme şekli ----
  final List<_SaleExtra> _extras = [];

  /// Açık ek kalem formunun türü; null = form kapalı.
  _ExtraKind? _extraKind;
  String? _extraRefId;
  int _extraQty = 1;
  String? _extraStaffId;
  final _extraPrice = TextEditingController();
  String _extraError = '';

  bool get _isProduct => widget.productSale;
  bool get _isService => !_isProduct && widget.serviceSale;

  /// Fişte ürün var mı? (ana satış ya da ek kalem) — erteleme kararının tek ölçütü.
  bool get _hasProductItem =>
      _isProduct || _extras.any((e) => e.kind == _ExtraKind.product);

  /// Ürünsüz fiş "ilk randevu tamamlanınca otomatik işle" ile bekleyebilir.
  bool get _canDefer => !_hasProductItem;

  /// Fişte SEANS üreten kalem (hizmet/paket satışı) var mı? "Ürün satışı değil" ile aynı şey
  /// DEĞİLDİR: ürün satışına ürün ek kalemi eklenince fiş hâlâ tamamen üründür — ayrım yapılmazsa
  /// kullanıcıya "seanslar tanımlanır" denip hiç seans açılmaz.
  bool get _hasSessionItem =>
      !_isProduct || _extras.any((e) => e.kind != _ExtraKind.product);

  /// Personelin onayı anında işlemez — yöneticinin Onaylar sayfasına düşer (bkz. _submit).
  bool get _isStaffUser => widget.api.auth?.user?.isStaff == true;

  /// KAYDEDİNCE NE OLACAK — kullanıcıya sorulmaz, tahsilattan türetilir (kullanıcı kuralı):
  /// peşinat alındıysa satış hemen cariye işlenir; alınmadıysa ilk randevuya ertelenir. Ürünlü fiş
  /// ertelenemediği için peşinatsız da olsa hemen işlenir. Her hâlde adisyon kartı AÇILMAZ.
  bool get _approveNow => _downPaymentValue > 0 || !_canDefer;

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    firstDueDate = DateTime(now.year, now.month + 1, now.day);
    saleDate = DateTime(now.year, now.month, now.day);
    loading = _loadLookups();
  }

  /// İstek düşerse boş liste — tek bir katalogun (ör. pakete dahil olmayan ürün modülü)
  /// erişilemez olması satış ekranını komple kırmasın (web'deki `.catch(() => ({items:[]}))`).
  Future<dynamic> _safeGet(String path, {Map<String, dynamic>? query}) async {
    try {
      return await widget.api.get(path, query: query);
    } catch (_) {
      return const {'items': <dynamic>[]};
    }
  }

  Future<void> _loadLookups() async {
    customerId = widget.customerId;
    // KATALOGLARIN TAMAMI HER MODDA ÇEKİLİR: ek kalem seçicisi paket satışında da hizmet/ürün
    // listesine ihtiyaç duyar (eskiden yalnız satılan türün listesi geliyordu).
    final values = await Future.wait([
      _safeGet('/api/admin/packages/', query: {'page': 1, 'pageSize': 200}),
      _safeGet('/api/admin/services/', query: {'page': 1, 'pageSize': 300}),
      _safeGet('/api/admin/products/', query: {'page': 1, 'pageSize': 500}),
      _safeGet('/api/admin/staff/', query: {'page': 1, 'pageSize': 200}),
      _safeGet('/api/admin/service-categories/'),
    ]);
    // Kategori pill sırası: backend SortOrder'a göre gelir, ad listesini o sırayla al.
    categoryOrder = apiItems(values[4]).map((c) => '${c['name'] ?? ''}').toList();
    packages = apiItems(values[0]).where((p) => p['isActive'] != false).toList(growable: false);
    services = apiItems(values[1]).where((s) => s['isActive'] != false).toList(growable: false);
    // Satılabilir ürün: satış fiyatı tanımlı VE stokta var (web ile aynı süzgeç).
    products = apiItems(values[2])
        .where((p) =>
            p['isActive'] != false &&
            ((p['salePrice'] as num?)?.toDouble() ?? 0) > 0 &&
            ((p['currentStock'] as num?)?.toDouble() ?? 0) > 0)
        .toList(growable: false);
    staff = apiItems(values[3]);
    // Satılan türün ilk kaydı ön-seçili gelsin (eski davranış).
    if (_isProduct) {
      productId = products.isEmpty ? null : '${products.first['id']}';
    } else if (_isService) {
      serviceId = services.isEmpty ? null : '${services.first['id']}';
    } else {
      packageId = packages.isEmpty ? null : '${packages.first['id']}';
    }
    // Sınırsız müşteri ölçeği: liste çekilmez; seçim CustomerSelectField'dan gelir
    // ve `customers` yalnızca seçilen kaydı tutar.
  }

  @override
  void dispose() {
    price.dispose();
    downPayment.dispose();
    notes.dispose();
    _extraPrice.dispose();
    super.dispose();
  }

  List<Map<String, dynamic>> get _catalog =>
      _isProduct ? products : (_isService ? services : packages);

  String? get _selectedId => _isProduct ? productId : (_isService ? serviceId : packageId);

  Map<String, dynamic>? get _selectedItem {
    for (final p in _catalog) {
      if ('${p['id']}' == _selectedId) return p;
    }
    return null;
  }

  double get _basePrice => _isProduct
      ? (_selectedItem?['salePrice'] as num?)?.toDouble() ?? 0
      : _isService
          ? (_selectedItem?['price'] as num?)?.toDouble() ?? 0
          : (_selectedItem?['totalPrice'] as num?)?.toDouble() ?? 0;

  /// Seçili ürünün stok adedi (ürün dışı satışta anlamsız).
  double get _stock => (_selectedItem?['currentStock'] as num?)?.toDouble() ?? 0;
  String get _unitLabel => valueOf(_selectedItem ?? const {}, const ['unit'], fallback: 'adet');

  double get _unitPrice {
    final raw = price.text.trim().replaceAll(',', '.');
    if (raw.isEmpty) return _basePrice;
    return double.tryParse(raw) ?? _basePrice;
  }

  int get _qty => (_isService || _isProduct) ? quantity : 1;

  double get _mainTotal => _unitPrice * _qty;
  double get _extrasTotal => _extras.fold<double>(0, (sum, e) => sum + e.lineTotal);
  double get _total => _mainTotal + _extrasTotal;

  String get _customerLabel {
    if (widget.customerName != null && widget.customerName!.isNotEmpty) {
      return widget.customerName!;
    }
    for (final c in customers) {
      if ('${c['id']}' == customerId) {
        return valueOf(c, const ['fullName', 'name']);
      }
    }
    return '';
  }

  /// PEŞİNAT ALANI HER SATIŞ TÜRÜNDE AÇIKTIR (9 Ağu 2026, kullanıcı kararı · web paritesi).
  ///
  /// Alan bir dönem hizmet satışında GİZLENİYORDU (o da bir kullanıcı talebiydi). Sonuç: hizmet
  /// satışında tahsilat alınamıyor, dolayısıyla satış cariye HEMEN işlenemiyor, her zaman ilk
  /// randevuya erteleniyordu — paket satışında yapılabilen şey hizmette yapılamıyordu.
  ///
  /// Alan OPSİYONELDİR: boş bırakılırsa davranış eskisi gibi (erteleme), tutar girilirse satış
  /// kaydedilir kaydedilmez cariye işlenir. Eski akış kaybolmaz, yanına ikinci yol eklenir.
  bool get _showDownPayment => true;

  double get _downPaymentValue {
    final raw = downPayment.text.trim().replaceAll(',', '.');
    if (raw.isEmpty) return 0;
    return double.tryParse(raw) ?? 0;
  }

  String _fmtDate(DateTime d) =>
      '${d.day.toString().padLeft(2, '0')}.${d.month.toString().padLeft(2, '0')}.${d.year}';

  String _isoDate(DateTime d) =>
      '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  /// Stok gösteriminde "3.0 adet" yerine "3 adet".
  static String _trimQty(double v) =>
      v == v.roundToDouble() ? v.toStringAsFixed(0) : v.toStringAsFixed(2);

  Map<String, dynamic>? _findById(List<Map<String, dynamic>> list, String? id) {
    if (id == null || id.isEmpty) return null;
    for (final item in list) {
      if ('${item['id']}' == id) return item;
    }
    return null;
  }

  List<Map<String, dynamic>> _extraCatalog(_ExtraKind kind) => switch (kind) {
        _ExtraKind.service => services,
        _ExtraKind.package => packages,
        _ExtraKind.product => products,
      };

  double _extraBasePrice(_ExtraKind kind, String? refId) {
    final item = _findById(_extraCatalog(kind), refId);
    if (item == null) return 0;
    return switch (kind) {
      _ExtraKind.service => (item['price'] as num?)?.toDouble() ?? 0,
      _ExtraKind.package => (item['totalPrice'] as num?)?.toDouble() ?? 0,
      _ExtraKind.product => (item['salePrice'] as num?)?.toDouble() ?? 0,
    };
  }

  /// Fişteki TÜM ürün kalemleri (ana satış + ek kalemler) için toplam stok kontrolü.
  /// Backend de stoğu ürün bazında TOPLAYARAK denetler (AdisyonService.ApproveCoreAsync);
  /// istemci aynı ölçütü kullanmazsa kullanıcı hatayı ancak onay anında görürdü.
  String _stockError({_SaleExtra? candidate}) {
    final need = <String, int>{};
    if (_isProduct && _selectedId != null) need[_selectedId!] = _qty;
    for (final e in [..._extras, ?candidate]) {
      if (e.kind == _ExtraKind.product) {
        need[e.refId] = (need[e.refId] ?? 0) + e.quantity;
      }
    }
    for (final entry in need.entries) {
      final p = _findById(products, entry.key);
      if (p == null) {
        return 'Fişteki ürünlerden biri listede bulunamadı — kalemi kaldırıp yeniden ekleyin.';
      }
      final stock = (p['currentStock'] as num?)?.toDouble() ?? 0;
      if (entry.value > stock) {
        return '${p['name']} için stok yetersiz — istenen ${entry.value}, mevcut ${_trimQty(stock)} ${valueOf(p, const ['unit'], fallback: 'adet')}.';
      }
    }
    return '';
  }

  Future<void> _pickDueDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: firstDueDate,
      firstDate: DateTime.now(),
      lastDate: DateTime.now().add(const Duration(days: 730)),
    );
    if (picked != null) setState(() => firstDueDate = picked);
  }

  /// Satış tarihi — geçmişe dönük giriş. Gelecek seçilemez (ciro ileri tarihe kaymasın).
  Future<void> _pickSaleDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: saleDate,
      firstDate: DateTime(now.year - 2),
      lastDate: DateTime(now.year, now.month, now.day),
    );
    if (picked != null) setState(() => saleDate = picked);
  }

  void _snack(String message) {
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }

  void _closeExtraForm() {
    setState(() {
      _extraKind = null;
      _extraRefId = null;
      _extraQty = 1;
      _extraStaffId = null;
      _extraPrice.clear();
      _extraError = '';
    });
  }

  void _addExtra() {
    final kind = _extraKind;
    if (kind == null) return;
    final item = _findById(_extraCatalog(kind), _extraRefId);
    if (item == null) {
      setState(() => _extraError = '${_extraKindLabels[kind]} seçin');
      return;
    }
    final raw = _extraPrice.text.trim().replaceAll(',', '.');
    final unit = raw.isEmpty
        ? _extraBasePrice(kind, _extraRefId)
        : (double.tryParse(raw) ?? _extraBasePrice(kind, _extraRefId));
    if (unit <= 0) {
      setState(() => _extraError = 'Birim fiyat pozitif olmalı');
      return;
    }
    final candidate = _SaleExtra(
      kind: kind,
      refId: '${item['id']}',
      name: valueOf(item, const ['name']),
      unitPrice: unit,
      quantity: _extraQty < 1 ? 1 : _extraQty,
      staffId: _extraStaffId,
    );
    final stockMsg = _stockError(candidate: candidate);
    if (stockMsg.isNotEmpty) {
      setState(() => _extraError = stockMsg);
      return;
    }
    setState(() => _extras.add(candidate));
    _closeExtraForm();
  }

  Future<void> _openAdisyonCard(String adisyonId) async {
    await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (_) => AdisyonDetailSheet(api: widget.api, adisyonId: adisyonId),
    );
  }

  /// Satışı kaydeder — tek tuş. Peşinat varsa (ya da fişte ürün varsa) fiş hemen onaylanır;
  /// yoksa açık kalıp ilk randevuya ertelenir. Adisyon kartı hiçbir hâlde kendiliğinden açılmaz.
  Future<void> _submit() async {
    final cid = customerId;
    if (cid == null || cid.isEmpty) return _snack('Müşteri seçin.');
    final selected = _selectedItem;
    if (selected == null) {
      return _snack(_isProduct
          ? 'Ürün seçin.'
          : _isService
              ? 'Hizmet seçin.'
              : 'Paket seçin.');
    }
    if (_unitPrice <= 0) return _snack('Satış fiyatı pozitif olmalı.');
    final stockMsg = _stockError();
    if (stockMsg.isNotEmpty) return _snack(stockMsg);
    final total = _total;
    final pay = _downPaymentValue;
    if (pay < 0 || pay > total) {
      return _snack('Peşinat 0 ile toplam tutar arasında olmalı.');
    }
    if (installment) {
      if (installmentCount < 1) return _snack('Taksit sayısı en az 1 olmalı.');
      if (pay >= total) {
        return _snack('Peşinat tutarın tamamını karşılıyor — peşin seçin.');
      }
    }

    final approveNow = _approveNow;
    // ERTELEME BAYRAĞI: ürünsüz fiş + (peşinatsız satış YA DA personelin onay isteği).
    //
    // Personelde bayrak "onayla" yolunda da AÇIK kalır çünkü personelin onayı anında işlemez,
    // yöneticinin Onaylar sayfasında bekler; o beklerken müşteri randevusuna gelebilir. Bayrak
    // kapalı olsaydı randevu, seansı henüz açılmamış bir satışla tamamlanır — hizmet bedelsiz
    // verilmiş, satış ortada kalmış olurdu. Hangisi önce gerçekleşirse satışı o işler; ikincisi
    // "yalnızca açık adisyon onaylanabilir" ile durur, çift kayıt oluşmaz.
    //
    // Yönetici rollerinde onay SENKRON işler; başarısız olursa fiş açık kalır ama bayrak KAPALIDIR:
    // hata gösterilen bir satış, kimse farkında değilken ilk randevuda sessizce işlenmemelidir.
    final willDefer = _canDefer && (!approveNow || _isStaffUser);

    setState(() => saving = true);
    String? createdId;
    var phase = 'build';
    try {
      // 1) Adisyonu aç + taksit planını yaz (peşin = 0).
      final adisyon = await widget.api.post(
        '/api/admin/adisyonlar/',
        {
          'customerId': cid,
          'customerAccountId': null,
          'notes': notes.text.trim().isEmpty ? null : notes.text.trim(),
          'installmentCount': installment ? installmentCount : 0,
          'firstDueDate': installment ? _isoDate(firstDueDate) : null,
          // Her satış KENDİ adisyonunu açar (mevcut açık fişe/cariye eklenmez).
          'forceNew': true,
          'autoApproveOnFirstAppointment': willDefer,
          // Geçmişe dönük satış tarihi (yalnız ürün). Günün ortasına sabitlenir ki saat dilimi
          // kayması tarihi bir gün öne/arkaya almasın.
          'saleDateUtc': _isProduct
              ? DateTime.utc(saleDate.year, saleDate.month, saleDate.day, 12).toIso8601String()
              : null,
        },
        // `forceNew` her çağrıda YENİ fiş açar — sunucudaki "açık fiş varsa onu döndür" koruması
        // burada devrede değildir, dolayısıyla çift gönderim iki satış fişi üretirdi.
        idempotencyKey(_saleSalt, [
          'create',
          cid,
          installment ? installmentCount : 0,
          installment ? _isoDate(firstDueDate) : null,
        ]),
      );
      final adisyonMap = adisyon is Map ? adisyon.cast<String, dynamic>() : null;
      final adisyonId = adisyonMap?['id']?.toString();
      if (adisyonMap == null || adisyonId == null || adisyonId.isEmpty) {
        // Staff onay kapısı: istek taslağa düşmüş olabilir.
        if (mounted) {
          Navigator.pop(context, false);
          _snack('Satış onaya gönderildi. Yönetici onaylayınca işlenecek.');
        }
        return;
      }
      createdId = adisyonId;

      // 2) Ana satış kalemi — onayda cariye borç (+ paketse seans bakiyesi, üründe stok düşümü).
      await widget.api.post(
        '/api/admin/adisyonlar/$adisyonId/items',
        {
          'type': _isProduct
              ? 'Product'
              : _isService
                  ? 'Service'
                  : 'PackageSale',
          'refId': _selectedId,
          'description': _isProduct || _isService
              ? '${selected['name']}'
              : 'Paket satışı: ${selected['name']}',
          'quantity': _qty,
          'unitPrice': _unitPrice,
          'staffMemberId': staffId,
          'coveredByPackage': false,
        },
        idempotencyKey(_saleSalt, ['main', _selectedId, _qty, _unitPrice, staffId]),
      );

      // 2b) Ek kalemler — ana satışla aynı fişe, aynı kurallarla yazılır.
      for (final (i, e) in _extras.indexed) {
        await widget.api.post(
          '/api/admin/adisyonlar/$adisyonId/items',
          {
            'type': switch (e.kind) {
              _ExtraKind.service => 'Service',
              _ExtraKind.package => 'PackageSale',
              _ExtraKind.product => 'Product',
            },
            'refId': e.refId,
            'description': e.kind == _ExtraKind.package ? 'Paket satışı: ${e.name}' : e.name,
            'quantity': e.quantity,
            'unitPrice': e.unitPrice,
            'staffMemberId': e.staffId ?? staffId,
            'coveredByPackage': false,
          },
          // SIRA NUMARASI ŞART: aynı hizmet iki ayrı ek kalem olabilir (meşru) ve yalnız
          // içerikten türeyen anahtar ikisini aynı sayıp birini yutardı. Tekrar denemede
          // `_extras` değişmediği için indeks kararlıdır.
          idempotencyKey(_saleSalt, ['extra', i, e.kind.name, e.refId, e.quantity, e.unitPrice]),
        );
      }

      // 3) Peşinat alındıysa tahsilat kalemi.
      if (pay > 0) {
        await widget.api.post(
          '/api/admin/adisyonlar/$adisyonId/items',
          {
            'type': 'Payment',
            'refId': null,
            'description': _extras.isNotEmpty
                ? 'Satış peşinatı'
                : _isProduct
                    ? 'Ürün peşinatı: ${selected['name']}'
                    : _isService
                        ? 'Peşinat: ${selected['name']}'
                        : 'Paket peşinatı: ${selected['name']}',
            'quantity': 1,
            'unitPrice': pay,
            'staffMemberId': null,
            'coveredByPackage': false,
          },
          idempotencyKey(_saleSalt, ['pay', pay]),
        );
      }

      if (approveNow) {
        phase = 'approve';
        // PERSONELDE DE ÇAĞRILIR: onay kapısı isteği yakalayıp yöneticinin Onaylar sayfasına
        // düşürür (200 + pendingApproval döner, hata fırlatmaz).
        final result = await widget.api.post('/api/admin/adisyonlar/$adisyonId/approve', const {});
        final pending = result is Map && result['pendingApproval'] == true;
        if (mounted) {
          Navigator.pop(context, true);
          _snack(pending
              ? 'Satış oluşturuldu · yönetici onayına düştü.'
              : _hasProductItem
                  ? 'Satış tamamlandı · cariye işlendi, stoktan düşüldü.'
                  : 'Satış tamamlandı · cariye işlendi.');
        }
        return;
      }

      // 4) Peşinat alınmadı → satış AÇIK kalır ve ilk randevuya ertelenir. Adisyon kartı AÇILMAZ
      //    (kullanıcı talebi: süreç uzuyordu); kart gerekirse müşteri kartından açılır.
      if (mounted) {
        Navigator.pop(context, true);
        _snack('Satış kaydedildi · ilk randevu tamamlanınca cariye işlenecek.');
      }
    } catch (e) {
      if (phase == 'approve' && createdId != null) {
        // FİŞ EKSİKSİZ — SİLİNMEZ. Yalnız onay adımı düştü; kullanıcı karttan tekrar onaylayabilir.
        if (mounted) {
          setState(() => saving = false);
          _snack('Satış kaydedildi ancak cariye işlenemedi: $e — karttan onaylayın.');
          await _openAdisyonCard(createdId);
          if (mounted) Navigator.pop(context, true);
        }
        return;
      }
      // YARIM FİŞ BIRAKILMAZ: kalemleri eksik kalmış açık adisyon Ön Muhasebe'de gerçek bir satış
      // gibi durur, hizmet/paket fişiyse ilk randevuda otomatik cariye işlenirdi. İptal edilen fiş
      // hiçbir sorguya (açık adisyon / bekleyen satış) girmez.
      if (createdId != null) {
        try {
          await widget.api.post('/api/admin/adisyonlar/$createdId/cancel', const {});
          // TUZ YALNIZ İPTAL BAŞARILIYSA DÖNER. Fiş gerçekten iptal edildiyse ölüdür; aynı
          // anahtarla tekrar denemek fiş açma isteğini oynatıp ÖLÜ fişin id'sini döndürür ve
          // kalemler iptal edilmiş fişe yazılmaya çalışılır. İptal de patladıysa (ağ kesik)
          // fiş ortadadır: aynı anahtarla devam edip onu tamamlamak doğrudur.
          _saleSalt = newIdempotencySalt();
        } catch (_) {
          // İptal de düşerse elde edilecek bir şey yok; asıl hata kullanıcıya gösterilir.
        }
      }
      if (mounted) _snack('$e');
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  // ---------------------------------------------------------------------------
  // EK KALEM BÖLÜMÜ
  // ---------------------------------------------------------------------------
  Widget _buildExtrasSection() {
    final kinds = <_ExtraKind>[
      _ExtraKind.service,
      _ExtraKind.package,
      if (products.isNotEmpty) _ExtraKind.product,
    ];
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.add_circle_outline_rounded, size: 16, color: AppColors.primaryDark),
              const SizedBox(width: 6),
              Text(
                _extras.isEmpty ? 'Ek kalem' : 'Ek kalem (${_extras.length})',
                style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13),
              ),
            ],
          ),
          const SizedBox(height: 4),
          const Text(
            'Bu satışa ek hizmet, paket veya ürün ekleyebilirsin; tutar toplama eklenir.',
            style: TextStyle(fontSize: 11.5, color: AppColors.muted),
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final k in kinds)
                ChoiceChip(
                  selected: _extraKind == k,
                  avatar: Icon(_extraKindIcons[k], size: 16),
                  label: Text(_extraKindLabels[k]!),
                  onSelected: saving
                      ? null
                      : (_) {
                          if (_extraKind == k) {
                            _closeExtraForm();
                          } else {
                            setState(() {
                              _extraKind = k;
                              _extraRefId = null;
                              _extraQty = 1;
                              _extraStaffId = staffId;
                              _extraPrice.clear();
                              _extraError = '';
                            });
                          }
                        },
                ),
            ],
          ),
          if (_extraKind != null) ...[
            const SizedBox(height: 10),
            if (_extraError.isNotEmpty) ...[
              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                decoration: BoxDecoration(
                  color: AppColors.danger.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  _extraError,
                  style: const TextStyle(fontSize: 11.5, color: AppColors.danger),
                ),
              ),
              const SizedBox(height: 10),
            ],
            CatalogPickerField(
              label: '${_extraKindLabels[_extraKind]} seç',
              items: _extraCatalog(_extraKind!),
              selectedId: _extraRefId,
              clearable: true,
              priceKeys: switch (_extraKind!) {
                _ExtraKind.service => const ['price'],
                _ExtraKind.package => const ['totalPrice'],
                _ExtraKind.product => const ['salePrice'],
              },
              subCategoryKey: _extraKind == _ExtraKind.product ? 'brand' : 'subCategory',
              onChanged: (id) => setState(() {
                _extraRefId = id;
                _extraPrice.clear();
                _extraError = '';
              }),
              categoryOrder: _extraKind == _ExtraKind.product ? const [] : categoryOrder,
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _extraPrice,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    decoration: InputDecoration(
                      labelText: 'Birim fiyat (₺)',
                      hintText: _extraBasePrice(_extraKind!, _extraRefId) > 0
                          ? _extraBasePrice(_extraKind!, _extraRefId).toStringAsFixed(0)
                          : null,
                    ),
                    onChanged: (_) => setState(() {}),
                  ),
                ),
                const SizedBox(width: 10),
                IconButton.outlined(
                  onPressed: _extraQty > 1 ? () => setState(() => _extraQty--) : null,
                  icon: const Icon(Icons.remove_rounded),
                ),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                  child: Text('$_extraQty', style: const TextStyle(fontWeight: FontWeight.w800)),
                ),
                IconButton.outlined(
                  onPressed: () => setState(() => _extraQty++),
                  icon: const Icon(Icons.add_rounded),
                ),
              ],
            ),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              initialValue: _extraStaffId,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Satışı yapan (opsiyonel)'),
              items: [
                const DropdownMenuItem<String>(value: null, child: Text('— Seçilmedi —')),
                ...staff.map(
                  (s) => DropdownMenuItem(
                    value: '${s['id']}',
                    child: Text(valueOf(s, const ['fullName'])),
                  ),
                ),
              ],
              onChanged: (value) => setState(() => _extraStaffId = value),
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                OutlinedButton(
                  style: AppButtons.inline(),
                  onPressed: saving ? null : _closeExtraForm,
                  child: const Text('Vazgeç'),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: FilledButton.tonal(
                    style: AppButtons.inline(),
                    onPressed: saving ? null : _addExtra,
                    child: const Text('Satışa ekle'),
                  ),
                ),
              ],
            ),
          ],
          if (_extras.isNotEmpty) ...[
            const SizedBox(height: 10),
            for (final e in _extras)
              Container(
                margin: const EdgeInsets.only(bottom: 6),
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                decoration: BoxDecoration(
                  color: AppColors.surfaceSoft,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppColors.border),
                ),
                child: Row(
                  children: [
                    Icon(_extraKindIcons[e.kind], size: 16, color: AppColors.primaryDark),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            e.name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700),
                          ),
                          Text(
                            '${_extraKindLabels[e.kind]}${e.quantity > 1 ? ' · ${e.quantity} × ₺${e.unitPrice.toStringAsFixed(0)}' : ''}',
                            style: const TextStyle(fontSize: 11, color: AppColors.muted),
                          ),
                        ],
                      ),
                    ),
                    Text(
                      '₺${e.lineTotal.toStringAsFixed(0)}',
                      style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13),
                    ),
                    IconButton(
                      visualDensity: VisualDensity.compact,
                      onPressed: saving ? null : () => setState(() => _extras.remove(e)),
                      icon: const Icon(Icons.delete_outline_rounded, size: 18),
                      color: AppColors.danger,
                      tooltip: 'Ek kalemi kaldır',
                    ),
                  ],
                ),
              ),
          ],
        ],
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // KAYDEDİNCE NE OLACAK — sorulmaz, tahsilattan türetilir
  // ---------------------------------------------------------------------------
  Widget _buildOutcomeNotice() {
    final approve = _approveNow;
    final String text;
    if (approve && _isStaffUser) {
      text = 'Kaydedince onay isteği yöneticine gider. Onaylandığında tutar cariye borç yazılır'
          '${_downPaymentValue > 0 ? ', peşinat kasaya girer' : ''}'
          '${_hasProductItem ? ', ürünler stoktan düşer' : ''}'
          '${_hasSessionItem ? ' ve seanslar tanımlanır.' : '.'}';
    } else if (approve) {
      text = '${_downPaymentValue > 0 ? 'Peşinat alındığı için' : 'Fişte ürün olduğu için'} satış '
          'kaydedilir kaydedilmez cariye işlenir: tutar borç'
          '${_downPaymentValue > 0 ? ', peşinat kasaya gelir' : ''}'
          '${_hasProductItem ? ', ürünler stoktan düşer' : ''}'
          '${_hasSessionItem ? ' ve seanslar tanımlanır.' : '.'} Adisyon kartı açılmaz.';
    } else {
      text = 'Peşinat alınmadı — satış cariye şimdi işlenmez. Müşteri ilk randevusunu tamamladığında '
          'tutar otomatik cariye borç yazılır ve '
          '${_isService ? 'hizmet seansı' : 'paket seansları'} tanımlanır. Randevu şimdiden '
          'verilebilir; adisyon kartı açılmaz.';
    }
    final color = approve ? AppColors.success : AppColors.primaryDark;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 10),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.25)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            approve ? Icons.verified_rounded : Icons.event_available_rounded,
            size: 16,
            color: color,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(text, style: TextStyle(fontSize: 11.5, color: color, height: 1.35)),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final perInstallment = installment && installmentCount > 0
        ? (_total / installmentCount)
        : 0.0;
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
          // Web modal paritesi: içerik kayar, "kaydet" butonu altta sabit kalır
          // (uzun formda bile her zaman görünür — kesilmez).
          return Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Flexible(
                child: SingleChildScrollView(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _isProduct
                            ? 'Ürün satışı'
                            : _isService
                                ? 'Hizmet satışı'
                                : 'Paket satışı',
                        style: Theme.of(context).textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        () {
                          final prefix = widget.customerId != null ? '$_customerLabel · ' : '';
                          if (_approveNow) {
                            return _isStaffUser
                                ? '${prefix}kaydedilince yönetici onayına gider'
                                : '${prefix}kaydedilince cariye işlenir'
                                    '${_hasProductItem ? ' ve stoktan düşer' : ''}';
                          }
                          // Buraya yalnız ertelenebilir fişte düşülür (_approveNow false ise
                          // _canDefer zorunlu olarak true'dur).
                          return '${prefix}ilk randevu tamamlanınca cariye işlenir';
                        }(),
                        style: const TextStyle(
                          fontSize: 12,
                          color: Colors.black54,
                        ),
                      ),
                      const SizedBox(height: 18),
                      if (widget.customerId == null) ...[
                        CustomerSelectField(
                          api: widget.api,
                          onSelected: (picked) => setState(() {
                            customerId = picked.id;
                            customers = [
                              {
                                'id': picked.id,
                                'fullName': picked.name,
                                'phone': picked.phone,
                              },
                            ];
                          }),
                        ),
                        const SizedBox(height: 12),
                      ],

                      // Katalog seçimi — arama + kategori + alt kategori + liste (web paritesi).
                      CatalogPickerField(
                        label: _isProduct ? 'Ürün' : (_isService ? 'Hizmet' : 'Paket'),
                        items: _catalog,
                        selectedId: _selectedId,
                        priceKeys: _isProduct
                            ? const ['salePrice']
                            : _isService
                                ? const ['price']
                                : const ['totalPrice'],
                        onChanged: (id) => setState(() {
                          if (_isProduct) {
                            productId = id;
                            quantity = 1; // yeni üründe adet sıfırlanır (stok farklı olabilir)
                          } else if (_isService) {
                            serviceId = id;
                          } else {
                            packageId = id;
                          }
                          price.clear();
                        }),
                        categoryOrder: categoryOrder,
                      ),

                      // Stok rozeti — kaç adet satılabileceği seçimden hemen sonra görünsün.
                      if (_isProduct && _selectedItem != null) ...[
                        const SizedBox(height: 8),
                        Container(
                          width: double.infinity,
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                          decoration: BoxDecoration(
                            color: AppColors.surfaceSoft,
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(color: AppColors.border),
                          ),
                          child: Row(
                            children: [
                              const Icon(Icons.inventory_2_rounded,
                                  size: 15, color: AppColors.primaryDark),
                              const SizedBox(width: 6),
                              Expanded(
                                child: Text(
                                  'Stok ${_trimQty(_stock)} $_unitLabel · birim ${_basePrice.toStringAsFixed(0)} ₺',
                                  style: const TextStyle(
                                      fontSize: 11.5, color: AppColors.muted),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],

                      // Onam formu bilgisi — satışı engellemez, personeli baştan haberdar eder.
                      // Ürün satışında onam formu kavramı yok.
                      if (!_isProduct)
                        ConsentSaleNotice(
                          api: widget.api,
                          packageId: _isService ? null : packageId,
                          serviceId: _isService ? serviceId : null,
                        ),

                      // SATIŞ TARİHİ — yalnız üründe (geçmişe dönük giriş).
                      if (_isProduct) ...[
                        const SizedBox(height: 12),
                        ListTile(
                          contentPadding:
                              const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(16),
                            side: const BorderSide(color: Color(0xFFEAD8DF)),
                          ),
                          leading: const Icon(Icons.event_rounded),
                          title: const Text('Satış tarihi'),
                          subtitle: Text(
                            '${_fmtDate(saleDate)} · cari ve peşinat bu güne yazılır',
                            style: const TextStyle(fontSize: 11.5),
                          ),
                          trailing: const Icon(Icons.edit_calendar_rounded, size: 18),
                          onTap: _pickSaleDate,
                        ),
                      ],

                      if (_isService || _isProduct) ...[
                        const SizedBox(height: 12),
                        Row(
                          children: [
                            const Expanded(
                              child: Text(
                                'Adet',
                                style: TextStyle(fontWeight: FontWeight.w700),
                              ),
                            ),
                            IconButton.outlined(
                              onPressed: quantity > 1
                                  ? () => setState(() => quantity--)
                                  : null,
                              icon: const Icon(Icons.remove_rounded),
                            ),
                            Padding(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 10,
                              ),
                              child: Text(
                                '$quantity',
                                style: const TextStyle(
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                            ),
                            IconButton.outlined(
                              // Üründe stok tavanı: satılamayacak adet seçilemesin.
                              onPressed: (_isProduct && quantity >= _stock)
                                  ? null
                                  : () => setState(() => quantity++),
                              icon: const Icon(Icons.add_rounded),
                            ),
                          ],
                        ),
                      ],
                      const SizedBox(height: 12),
                      Row(
                        children: [
                          Expanded(
                            child: TextField(
                              controller: price,
                              keyboardType:
                                  const TextInputType.numberWithOptions(
                                    decimal: true,
                                  ),
                              decoration: InputDecoration(
                                labelText: 'Satış fiyatı (₺)',
                                hintText: _basePrice > 0
                                    ? _basePrice.toStringAsFixed(0)
                                    : null,
                              ),
                              onChanged: (_) => setState(() {}),
                            ),
                          ),
                          // Peşinat her satış türünde girilebilir (bkz. _showDownPayment).
                          if (_showDownPayment) ...[
                            const SizedBox(width: 10),
                            Expanded(
                              child: TextField(
                                controller: downPayment,
                                keyboardType:
                                    const TextInputType.numberWithOptions(
                                      decimal: true,
                                    ),
                                decoration: const InputDecoration(
                                  labelText: 'Peşinat (₺)',
                                ),
                                onChanged: (_) => setState(() {}),
                              ),
                            ),
                          ],
                        ],
                      ),
                      const SizedBox(height: 12),
                      DropdownButtonFormField<String>(
                        initialValue: staffId,
                        isExpanded: true,
                        decoration: const InputDecoration(
                          labelText: 'Satışı yapan personel (opsiyonel)',
                        ),
                        items: [
                          const DropdownMenuItem<String>(
                            value: null,
                            child: Text('— Seçilmedi —'),
                          ),
                          ...staff.map(
                            (s) => DropdownMenuItem(
                              value: '${s['id']}',
                              child: Text(valueOf(s, const ['fullName'])),
                            ),
                          ),
                        ],
                        onChanged: (value) => setState(() => staffId = value),
                      ),
                      const SizedBox(height: 14),
                      SegmentedButton<bool>(
                        segments: const [
                          ButtonSegment(value: false, label: Text('Peşin')),
                          ButtonSegment(value: true, label: Text('Taksitli')),
                        ],
                        selected: {installment},
                        onSelectionChanged: (selection) =>
                            setState(() => installment = selection.first),
                      ),
                      if (installment) ...[
                        const SizedBox(height: 12),
                        Row(
                          children: [
                            IconButton.outlined(
                              onPressed: installmentCount > 1
                                  ? () => setState(() => installmentCount--)
                                  : null,
                              icon: const Icon(Icons.remove_rounded),
                            ),
                            Expanded(
                              child: Text(
                                '$installmentCount taksit · ₺${perInstallment.toStringAsFixed(0)}/ay',
                                textAlign: TextAlign.center,
                                style: const TextStyle(
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ),
                            IconButton.outlined(
                              onPressed: installmentCount < 24
                                  ? () => setState(() => installmentCount++)
                                  : null,
                              icon: const Icon(Icons.add_rounded),
                            ),
                          ],
                        ),
                        const SizedBox(height: 8),
                        ListTile(
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(16),
                            side: const BorderSide(color: Color(0xFFEAD8DF)),
                          ),
                          leading: const Icon(Icons.event_rounded),
                          title: const Text('İlk taksit vadesi'),
                          subtitle: Text(_fmtDate(firstDueDate)),
                          onTap: _pickDueDate,
                        ),
                      ],
                      const SizedBox(height: 12),
                      TextField(
                        controller: notes,
                        maxLines: 2,
                        decoration: const InputDecoration(labelText: 'Not'),
                      ),

                      // EK KALEMLER — adisyon kartındaki "kalem ekle" ile aynı mantık.
                      const SizedBox(height: 14),
                      _buildExtrasSection(),

                      // KAYDEDİNCE NE OLACAK — peşinat varsa cariye, yoksa ilk randevuya.
                      const SizedBox(height: 14),
                      _buildOutcomeNotice(),
                      const SizedBox(height: 4),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 14),
              // Tutar özeti — ek kalemler toplamı değiştirdiği için butonun hemen üstünde.
              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
                decoration: BoxDecoration(
                  color: AppColors.surfaceSoft,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppColors.border),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.receipt_long_rounded, size: 15, color: AppColors.primaryDark),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        _extrasTotal > 0
                            ? 'Satış ₺${_mainTotal.toStringAsFixed(0)} + ek ₺${_extrasTotal.toStringAsFixed(0)}'
                            : 'Adisyona yazılacak',
                        style: const TextStyle(fontSize: 11.5, color: AppColors.muted),
                      ),
                    ),
                    Text(
                      '₺${_total.toStringAsFixed(0)}',
                      style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 10),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: saving ? null : _submit,
                  child: Text(
                    saving
                        ? 'Kaydediliyor...'
                        : _approveNow
                            ? (_isStaffUser
                                ? 'Satışı kaydet · onaya gönder'
                                : 'Satışı kaydet · cariye işle')
                            : 'Satışı kaydet',
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}
