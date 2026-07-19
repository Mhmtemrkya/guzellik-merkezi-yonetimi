import 'package:flutter/material.dart';

import '../../core/network/api_client.dart';
import '../../shared/json_helpers.dart';
import '../customers/customer_picker.dart';

/// Web `PackageSaleDialog`'un mobil karşılığı.
///
/// - Varsayılan mod paket satışı; [serviceSale] true ise hizmet satışı
///   (katalogdan hizmet seçilir, adet girilebilir).
/// - [customerId] verilirse müşteri sabittir (ör. randevu formundan);
///   verilmezse müşteri listeden seçilir (menüdeki Satış sayfası).
///
/// Akış web ile birebir: açık adisyon bulunur/açılır (taksit planı adisyona
/// yazılır), PackageSale/Service kalemi eklenir, peşinat varsa Payment kalemi
/// eklenir. Kurum yöneticisi adisyonu onayladığında cari borç (+paketse seans
/// bakiyesi) oluşur.
class PackageSaleSheet extends StatefulWidget {
  const PackageSaleSheet({
    required this.api,
    this.customerId,
    this.customerName,
    this.serviceSale = false,
    super.key,
  });

  final ApiClient api;
  final String? customerId;
  final String? customerName;
  final bool serviceSale;

  @override
  State<PackageSaleSheet> createState() => _PackageSaleSheetState();
}

class _PackageSaleSheetState extends State<PackageSaleSheet> {
  late Future<void> loading;
  List<Map<String, dynamic>> packages = [];
  List<Map<String, dynamic>> services = [];
  List<Map<String, dynamic>> customers = [];
  List<Map<String, dynamic>> staff = [];

  String? customerId;
  String? packageId;
  String? serviceId;
  int quantity = 1;
  String? staffId;
  bool installment = false;
  int installmentCount = 3;
  late DateTime firstDueDate;
  bool saving = false;
  final price = TextEditingController();
  final downPayment = TextEditingController();
  final notes = TextEditingController();

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    firstDueDate = DateTime(now.year, now.month + 1, now.day);
    loading = _loadLookups();
  }

  Future<void> _loadLookups() async {
    customerId = widget.customerId;
    final values = await Future.wait([
      widget.serviceSale
          ? widget.api
              .get('/api/admin/services/', query: {'page': 1, 'pageSize': 200})
          : widget.api
              .get('/api/admin/packages/', query: {'page': 1, 'pageSize': 200}),
      widget.api.get('/api/admin/staff/', query: {'page': 1, 'pageSize': 200}),
      if (widget.customerId == null)
        widget.api
            .getAllPaged('/api/admin/customers/'),
    ]);
    final catalog = apiItems(values[0])
        .where((p) => p['isActive'] != false)
        .toList(growable: false);
    if (widget.serviceSale) {
      services = catalog;
      serviceId = services.isEmpty ? null : '${services.first['id']}';
    } else {
      packages = catalog;
      packageId = packages.isEmpty ? null : '${packages.first['id']}';
    }
    staff = apiItems(values[1]);
    if (widget.customerId == null && values.length > 2) {
      customers = apiItems(values[2]);
    }
  }

  @override
  void dispose() {
    price.dispose();
    downPayment.dispose();
    notes.dispose();
    super.dispose();
  }

  Map<String, dynamic>? get _selectedItem {
    final list = widget.serviceSale ? services : packages;
    final id = widget.serviceSale ? serviceId : packageId;
    for (final p in list) {
      if ('${p['id']}' == id) return p;
    }
    return null;
  }

  double get _basePrice => widget.serviceSale
      ? (_selectedItem?['price'] as num?)?.toDouble() ?? 0
      : (_selectedItem?['totalPrice'] as num?)?.toDouble() ?? 0;

  double get _unitPrice {
    final raw = price.text.trim().replaceAll(',', '.');
    if (raw.isEmpty) return _basePrice;
    return double.tryParse(raw) ?? _basePrice;
  }

  int get _qty => widget.serviceSale ? quantity : 1;

  double get _total => _unitPrice * _qty;

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

  double get _downPaymentValue {
    final raw = downPayment.text.trim().replaceAll(',', '.');
    if (raw.isEmpty) return 0;
    return double.tryParse(raw) ?? 0;
  }

  String _fmtDate(DateTime d) =>
      '${d.day.toString().padLeft(2, '0')}.${d.month.toString().padLeft(2, '0')}.${d.year}';

  String _isoDate(DateTime d) =>
      '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  Future<void> _pickDueDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: firstDueDate,
      firstDate: DateTime.now(),
      lastDate: DateTime.now().add(const Duration(days: 730)),
    );
    if (picked != null) setState(() => firstDueDate = picked);
  }

  void _snack(String message) {
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _submit() async {
    final cid = customerId;
    if (cid == null || cid.isEmpty) return _snack('Müşteri seçin.');
    final selected = _selectedItem;
    if (selected == null) {
      return _snack(widget.serviceSale ? 'Hizmet seçin.' : 'Paket seçin.');
    }
    if (_unitPrice <= 0) return _snack('Satış fiyatı pozitif olmalı.');
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

    setState(() => saving = true);
    try {
      // 1) Açık adisyonu bul/aç + taksit planını yaz (peşin = 0).
      final adisyon = await widget.api.post('/api/admin/adisyonlar/', {
        'customerId': cid,
        'customerAccountId': null,
        'notes': notes.text.trim().isEmpty ? null : notes.text.trim(),
        'installmentCount': installment ? installmentCount : 0,
        'firstDueDate': installment ? _isoDate(firstDueDate) : null,
      });
      final adisyonMap =
          adisyon is Map ? adisyon.cast<String, dynamic>() : null;
      final adisyonId = adisyonMap?['id']?.toString();
      if (adisyonMap == null || adisyonId == null || adisyonId.isEmpty) {
        // Staff onay kapısı: istek taslağa düşmüş olabilir.
        if (mounted) {
          Navigator.pop(context, false);
          _snack('Satış onaya gönderildi. Yönetici onaylayınca işlenecek.');
        }
        return;
      }

      // 2) Satış kalemi — onayda cariye borç (+ paketse müşteriye seans bakiyesi).
      await widget.api.post('/api/admin/adisyonlar/$adisyonId/items', {
        'type': widget.serviceSale ? 'Service' : 'PackageSale',
        'refId': widget.serviceSale ? serviceId : packageId,
        'description': widget.serviceSale
            ? '${selected['name']}'
            : 'Paket satışı: ${selected['name']}',
        'quantity': _qty,
        'unitPrice': _unitPrice,
        'staffMemberId': staffId,
        'coveredByPackage': false,
      });

      // 3) Peşinat alındıysa tahsilat kalemi.
      if (pay > 0) {
        await widget.api.post('/api/admin/adisyonlar/$adisyonId/items', {
          'type': 'Payment',
          'refId': null,
          'description': widget.serviceSale
              ? 'Peşinat: ${selected['name']}'
              : 'Paket peşinatı: ${selected['name']}',
          'quantity': 1,
          'unitPrice': pay,
          'staffMemberId': null,
          'coveredByPackage': false,
        });
      }

      if (mounted) {
        Navigator.pop(context, true);
      }
    } catch (e) {
      if (mounted) _snack('$e');
    } finally {
      if (mounted) setState(() => saving = false);
    }
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
          return SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  widget.serviceSale ? 'Hizmet satışı' : 'Paket satışı',
                  style: Theme.of(context).textTheme.titleLarge?.copyWith(
                        fontWeight: FontWeight.w800,
                      ),
                ),
                const SizedBox(height: 4),
                Text(
                  widget.customerId != null
                      ? '$_customerLabel · onayda cariye${widget.serviceSale ? '' : ' ve seans bakiyesine'} işlenir'
                      : 'Onayda cariye${widget.serviceSale ? '' : ' ve seans bakiyesine'} işlenir',
                  style: const TextStyle(fontSize: 12, color: Colors.black54),
                ),
                const SizedBox(height: 18),
                if (widget.customerId == null) ...[
                  CustomerSelectField(
                    api: widget.api,
                    onSelected: (picked) =>
                        setState(() => customerId = picked.id),
                  ),
                  const SizedBox(height: 12),
                ],
                if (widget.serviceSale)
                  DropdownButtonFormField<String>(
                    initialValue: serviceId,
                    isExpanded: true,
                    decoration: const InputDecoration(labelText: 'Hizmet'),
                    items: services
                        .map(
                          (s) => DropdownMenuItem(
                            value: '${s['id']}',
                            child: Text(
                              '${s['name']} · ₺${(s['price'] as num?)?.toStringAsFixed(0) ?? '0'}',
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        )
                        .toList(),
                    onChanged: (value) => setState(() => serviceId = value),
                  )
                else
                  DropdownButtonFormField<String>(
                    initialValue: packageId,
                    isExpanded: true,
                    decoration: const InputDecoration(labelText: 'Paket'),
                    items: packages
                        .map(
                          (p) => DropdownMenuItem(
                            value: '${p['id']}',
                            child: Text(
                              '${p['name']} · ₺${(p['totalPrice'] as num?)?.toStringAsFixed(0) ?? '0'}',
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        )
                        .toList(),
                    onChanged: (value) => setState(() => packageId = value),
                  ),
                if (widget.serviceSale) ...[
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      const Expanded(
                        child: Text('Adet',
                            style: TextStyle(fontWeight: FontWeight.w700)),
                      ),
                      IconButton.outlined(
                        onPressed: quantity > 1
                            ? () => setState(() => quantity--)
                            : null,
                        icon: const Icon(Icons.remove_rounded),
                      ),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 10),
                        child: Text('$quantity',
                            style:
                                const TextStyle(fontWeight: FontWeight.w800)),
                      ),
                      IconButton.outlined(
                        onPressed: () => setState(() => quantity++),
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
                        keyboardType: const TextInputType.numberWithOptions(
                            decimal: true),
                        decoration: InputDecoration(
                          labelText: 'Satış fiyatı (₺)',
                          hintText: _basePrice > 0
                              ? _basePrice.toStringAsFixed(0)
                              : null,
                        ),
                        onChanged: (_) => setState(() {}),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: TextField(
                        controller: downPayment,
                        keyboardType: const TextInputType.numberWithOptions(
                            decimal: true),
                        decoration:
                            const InputDecoration(labelText: 'Peşinat (₺)'),
                        onChanged: (_) => setState(() {}),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  initialValue: staffId,
                  isExpanded: true,
                  decoration: const InputDecoration(
                      labelText: 'Satışı yapan personel (opsiyonel)'),
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
                          style: const TextStyle(fontWeight: FontWeight.w700),
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
                const SizedBox(height: 18),
                FilledButton(
                  onPressed: saving ? null : _submit,
                  child: Text(saving ? 'Kaydediliyor...' : 'Satışı kaydet'),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}
