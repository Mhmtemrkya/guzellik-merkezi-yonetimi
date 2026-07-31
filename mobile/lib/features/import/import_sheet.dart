import 'package:excel/excel.dart' as xls;
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';

import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';

/// EXCEL'DEN TOPLU İÇERİ AKTARMA — web `ImportDialog` paritesi.
///
/// Akış web ile aynı: dosya seçilir → ilk sayfa okunur → başlıklar otomatik alanlara eşlenir →
/// tip tahmin edilir (kullanıcı değiştirebilir) → önizleme → 400'lük gruplar hâlinde
/// `/api/admin/import/` ucuna gönderilir → sonuç özeti gösterilir.
///
/// Kolon eşleştirme sözlüğü web `importAnalyzer.ts` ile birebir tutulur; bozuk kodlamalı
/// dosyalar için "harfleri eksik" varyantlar da listede (ör. "DOĞUM TARİHİ" → "doumtarh").
class ImportSheet extends StatefulWidget {
  const ImportSheet({required this.api, this.branchId, super.key});
  final ApiClient api;
  final String? branchId;

  @override
  State<ImportSheet> createState() => _ImportSheetState();
}

/// Sunucunun kabul ettiği kayıt türleri.
enum ImportType { customer, service, package, product, staff }

const _typeLabels = <ImportType, String>{
  ImportType.customer: 'Müşteri',
  ImportType.service: 'Hizmet',
  ImportType.package: 'Paket',
  ImportType.product: 'Ürün',
  ImportType.staff: 'Personel',
};

/// Sunucu gövdesindeki dizi adı (web ile aynı).
const _typeBodyKeys = <ImportType, String>{
  ImportType.customer: 'customers',
  ImportType.service: 'services',
  ImportType.package: 'packages',
  ImportType.product: 'products',
  ImportType.staff: 'staff',
};

/// Web importAnalyzer.ts FIELD_SYNONYMS ile birebir.
const _fieldSynonyms = <String, List<String>>{
  'firstName': ['ad', 'adi', 'isim', 'name', 'firstname'],
  'lastName': ['soyad', 'soyadi', 'soyisim', 'surname', 'lastname'],
  'fullName': ['adsoyad', 'adisoyadi', 'fullname', 'musteriadi', 'musteri', 'danisan', 'danisanadi', 'mteri', 'dansan'],
  'phone': ['telefon', 'tel', 'gsm', 'gms', 'cep', 'ceptelefonu', 'phone', 'mobile', 'numara'],
  'email': ['email', 'eposta', 'mail'],
  'birthDate': ['dogumtarihi', 'dogumtarih', 'dogum', 'birthdate', 'birthday', 'doumtarh', 'doumtarihi'],
  'gender': ['cinsiyet', 'gender', 'cnsyet', 'sex'],
  'notes': ['not', 'notlar', 'note', 'notes', 'comment'],
  'name': ['hizmetadi', 'hizmet', 'islemadi', 'islem', 'paketadi', 'paket', 'urunadi', 'urun', 'servicename', 'service', 'baslik', 'hzmet', 'lemad', 'rn'],
  'category': ['kategori', 'category', 'grup', 'kategor'],
  'duration': ['sure', 'suredakika', 'dakika', 'duration', 'durationminutes', 'islemsuresi', 'sre'],
  'price': ['fiyat', 'ucret', 'tutar', 'price', 'amount', 'birimfiyat', 'fyat', 'cret'],
  'totalPrice': ['toplamfiyat', 'toplamtutar', 'totalprice', 'pakettutari', 'paketfiyati'],
  'sessionCount': ['seans', 'seanssayisi', 'seansadedi', 'sessioncount', 'sessions'],
  'description': ['aciklama', 'description', 'detay', 'aklama'],
  'deposit': ['pesinat', 'onodeme', 'kapora', 'deposit', 'downpayment', 'peinat'],
  'installment': ['taksit', 'taksitsayisi', 'installment', 'installmentcount'],
  'barcode': ['barkod', 'barcode', 'ean'],
  'brand': ['marka', 'brand'],
  'unit': ['birim', 'unit', 'olcubirimi'],
  'cost': ['maliyet', 'alisfiyati', 'alisfiyat', 'cost', 'malyet'],
  'stock': ['stok', 'mevcutstok', 'stokadedi', 'currentstock', 'stokmiktari'],
  'minStock': ['minstok', 'minimumstok', 'kritikstok', 'minstokseviyesi', 'minstocklevel'],
  'title': ['unvan', 'gorev', 'pozisyon', 'title', 'jobtitle', 'unvani'],
  'specialties': ['uzmanlik', 'uzmanliklar', 'brans', 'specialty', 'specialties', 'uzmanlk'],
  'commission': ['komisyon', 'komisyonorani', 'prim', 'primorani', 'commission', 'commissionrate'],
};

/// Sunucu tek istekte çok satır kabul eder; 400 web ile aynı grup boyutu.
const _chunkSize = 400;

class _ImportSheetState extends State<ImportSheet> {
  String? _fileName;
  List<String> _headers = const [];
  List<Map<String, String>> _rows = const [];
  Map<String, String> _mapping = const {}; // başlık → alan
  ImportType _type = ImportType.customer;

  bool _busy = false;
  String? _error;
  int _progress = 0;
  Map<String, dynamic>? _result;

  /// Türkçe karakterleri sadeleştirip yalnız harf+rakam bırakır (web normalizeText).
  static String _normalize(String h) => h
      .toLowerCase()
      .replaceAll('ı', 'i')
      .replaceAll('ğ', 'g')
      .replaceAll('ü', 'u')
      .replaceAll('ş', 's')
      .replaceAll('ö', 'o')
      .replaceAll('ç', 'c')
      .replaceAll(RegExp(r'[^a-z0-9]'), '');

  /// Başlığı bir alana eşle; EN UZUN eşleşme kazanır ("Min. Stok" → minStock, "Stok" değil).
  static String? _matchField(String header) {
    final n = _normalize(header);
    if (n.isEmpty) return null;
    String? best;
    var bestLen = 0;
    _fieldSynonyms.forEach((field, synonyms) {
      for (final s in synonyms) {
        if (n.contains(s) && s.length > bestLen) {
          best = field;
          bestLen = s.length;
        }
      }
    });
    return best;
  }

  /// Alanlara bakarak dosyanın hangi kayıt türü olduğunu tahmin eder.
  static ImportType _guessType(Set<String> fields) {
    if (fields.contains('phone') || fields.contains('birthDate') || fields.contains('gender')) {
      // Personel de telefon içerir; unvan/komisyon varsa personeldir.
      if (fields.contains('title') || fields.contains('commission') || fields.contains('specialties')) {
        return ImportType.staff;
      }
      return ImportType.customer;
    }
    if (fields.contains('barcode') || fields.contains('stock') || fields.contains('minStock')) {
      return ImportType.product;
    }
    if (fields.contains('totalPrice') || fields.contains('sessionCount') || fields.contains('installment')) {
      return ImportType.package;
    }
    return ImportType.service;
  }

  Future<void> _pickFile() async {
    setState(() {
      _error = null;
      _result = null;
    });
    try {
      // file_picker v11: pickFiles STATİK (eski sürümdeki FilePicker.platform kaldırıldı).
      final picked = await FilePicker.pickFiles(
        type: FileType.custom,
        allowedExtensions: const ['xlsx', 'xls'],
        withData: true, // bayt dizisi doğrudan gelsin (yol izni gerekmesin)
      );
      final bytes = picked?.files.single.bytes;
      if (bytes == null) return;

      final book = xls.Excel.decodeBytes(bytes);
      final sheetName = book.tables.keys.isEmpty ? null : book.tables.keys.first;
      if (sheetName == null) {
        setState(() => _error = 'Dosyada sayfa bulunamadı.');
        return;
      }
      final table = book.tables[sheetName]!;
      if (table.rows.length < 2) {
        setState(() => _error = 'Sayfada başlık satırı ve en az bir veri satırı olmalı.');
        return;
      }

      final headers = table.rows.first
          .map((c) => (c?.value?.toString() ?? '').trim())
          .toList(growable: false);

      final rows = <Map<String, String>>[];
      for (final row in table.rows.skip(1)) {
        final map = <String, String>{};
        var hasValue = false;
        for (var i = 0; i < headers.length && i < row.length; i++) {
          final key = headers[i];
          if (key.isEmpty) continue;
          final v = (row[i]?.value?.toString() ?? '').trim();
          if (v.isNotEmpty) hasValue = true;
          map[key] = v;
        }
        if (hasValue) rows.add(map);
      }

      final mapping = <String, String>{};
      for (final h in headers) {
        final f = _matchField(h);
        if (f != null) mapping[h] = f;
      }

      setState(() {
        _fileName = picked!.files.single.name;
        _headers = headers.where((h) => h.isNotEmpty).toList();
        _rows = rows;
        _mapping = mapping;
        _type = _guessType(mapping.values.toSet());
      });
    } catch (e) {
      setState(() => _error = 'Dosya okunamadı. Geçerli bir Excel dosyası olduğundan emin olun. ($e)');
    }
  }

  /// Bir Excel satırını sunucunun beklediği nesneye çevirir.
  Map<String, dynamic> _toPayload(Map<String, String> row) {
    final out = <String, dynamic>{};
    _mapping.forEach((header, field) {
      final raw = row[header];
      if (raw == null || raw.isEmpty) return;
      out[field] = raw;
    });

    // Ad/soyad ayrı geldiyse birleştir (sunucu fullName bekler).
    if (!out.containsKey('fullName')) {
      final first = '${out['firstName'] ?? ''}'.trim();
      final last = '${out['lastName'] ?? ''}'.trim();
      final full = [first, last].where((s) => s.isNotEmpty).join(' ');
      if (full.isNotEmpty) out['fullName'] = full;
    }
    return out;
  }

  Future<void> _runImport() async {
    if (_rows.isEmpty) return;
    final branchId = widget.branchId ?? widget.api.auth?.user?.branchId;
    if (branchId == null || branchId.isEmpty) {
      setState(() => _error = 'Önce bir şube seçmelisiniz.');
      return;
    }

    setState(() {
      _busy = true;
      _error = null;
      _progress = 0;
      _result = null;
    });

    final payloads = _rows.map(_toPayload).where((p) {
      // Müşteride telefon zorunlu (web ile aynı kural) — yoksa satır atlanır.
      if (_type == ImportType.customer) return '${p['phone'] ?? ''}'.trim().isNotEmpty;
      return p.isNotEmpty;
    }).toList();

    final skippedNoPhone = _type == ImportType.customer ? _rows.length - payloads.length : 0;
    final acc = <String, dynamic>{'failed': skippedNoPhone, 'errors': <String>[]};
    if (skippedNoPhone > 0) {
      (acc['errors'] as List).add('$skippedNoPhone satır geçerli telefon olmadığı için aktarılmadı.');
    }

    try {
      final key = _typeBodyKeys[_type]!;
      for (var i = 0; i < payloads.length; i += _chunkSize) {
        final chunk = payloads.sublist(
            i, i + _chunkSize > payloads.length ? payloads.length : i + _chunkSize);
        final res = await widget.api.post('/api/admin/import/', {
          'branchId': branchId,
          key: chunk,
        });
        if (res is Map) {
          res.forEach((k, v) {
            if (k == 'errors' && v is List) {
              final errs = acc['errors'] as List;
              if (errs.length < 20) errs.addAll(v.take(20 - errs.length));
            } else if (v is num) {
              acc[k] = (acc[k] as num? ?? 0) + v;
            }
          });
        }
        if (mounted) {
          setState(() => _progress = (((i + chunk.length) / payloads.length) * 100).round());
        }
      }
      if (mounted) setState(() => _result = acc);
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(18, 16, 18, MediaQuery.viewInsetsOf(context).bottom + 24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  color: AppColors.primary.withValues(alpha: .10),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Icon(Icons.upload_file_rounded,
                    color: AppColors.primaryDark, size: 20),
              ),
              const SizedBox(width: 10),
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Excel ile içeri aktar',
                        style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                    Text('Müşteri, hizmet, paket, ürün ve personel listelerini toplu yükle',
                        style: TextStyle(fontSize: 11.5, color: AppColors.muted)),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),

          if (_error != null) ...[
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: AppColors.danger.withValues(alpha: .07),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.danger.withValues(alpha: .3)),
              ),
              child: Text(_error!,
                  style: const TextStyle(fontSize: 12, color: AppColors.danger)),
            ),
            const SizedBox(height: 10),
          ],

          if (_result != null)
            _resultView()
          else if (_rows.isEmpty)
            _pickView()
          else
            Flexible(child: SingleChildScrollView(child: _previewView())),
        ],
      ),
    );
  }

  Widget _pickView() => Column(
        children: [
          const SizedBox(height: 10),
          const Icon(Icons.table_chart_rounded, size: 44, color: AppColors.muted),
          const SizedBox(height: 10),
          const Text(
            'İlk satır başlık olmalı. Kolonlar otomatik eşleştirilir;\nşubeye göre yüklenir ve mükerrer kayıtlar atlanır.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 12, color: AppColors.muted),
          ),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: _pickFile,
              icon: const Icon(Icons.folder_open_rounded, size: 18),
              label: const Text('Excel dosyası seç (.xlsx)'),
            ),
          ),
          const SizedBox(height: 8),
        ],
      );

  Widget _previewView() {
    final mapped = _mapping.length;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: AppColors.surfaceSoft,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppColors.border),
          ),
          child: Row(
            children: [
              const Icon(Icons.description_rounded, size: 16, color: AppColors.primaryDark),
              const SizedBox(width: 8),
              Expanded(
                child: Text('$_fileName · ${_rows.length} satır · $mapped/${_headers.length} kolon eşleşti',
                    maxLines: 2,
                    style: const TextStyle(fontSize: 11.5, color: AppColors.muted)),
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),

        const Text('Kayıt türü', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5)),
        const SizedBox(height: 6),
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            for (final t in ImportType.values)
              ChoiceChip(
                label: Text(_typeLabels[t]!, style: const TextStyle(fontSize: 11.5)),
                selected: _type == t,
                onSelected: _busy ? null : (_) => setState(() => _type = t),
              ),
          ],
        ),
        const SizedBox(height: 12),

        const Text('Kolon eşleşmeleri',
            style: TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5)),
        const SizedBox(height: 6),
        for (final h in _headers.take(12))
          Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: Row(
              children: [
                Expanded(
                  child: Text(h,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 11.5)),
                ),
                const Icon(Icons.arrow_forward_rounded, size: 13, color: AppColors.muted),
                const SizedBox(width: 6),
                SizedBox(
                  width: 110,
                  child: Text(
                    _mapping[h] ?? 'atlanacak',
                    textAlign: TextAlign.right,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      color: _mapping[h] == null ? AppColors.muted : AppColors.success,
                    ),
                  ),
                ),
              ],
            ),
          ),
        if (_headers.length > 12)
          Text('+${_headers.length - 12} kolon daha',
              style: const TextStyle(fontSize: 10.5, color: AppColors.muted)),

        const SizedBox(height: 14),
        if (_busy) ...[
          LinearProgressIndicator(value: _progress / 100),
          const SizedBox(height: 6),
          Text('Aktarılıyor… %$_progress',
              style: const TextStyle(fontSize: 11.5, color: AppColors.muted)),
          const SizedBox(height: 8),
        ],
        Row(
          children: [
            Expanded(
              child: OutlinedButton(
                onPressed: _busy ? null : _pickFile,
                child: const Text('Başka dosya'),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              flex: 2,
              child: FilledButton.icon(
                onPressed: _busy ? null : _runImport,
                icon: const Icon(Icons.cloud_upload_rounded, size: 18),
                label: Text(_busy ? 'Aktarılıyor…' : '${_rows.length} kaydı aktar'),
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _resultView() {
    final r = _result!;
    final errors = (r['errors'] as List? ?? const []).cast<dynamic>();
    // Sayısal alanları "created/skipped" olarak ikiye ayırıp okunur satırlar üret.
    final lines = <String>[];
    r.forEach((k, v) {
      if (v is num && v > 0 && k != 'failed') {
        lines.add('${_metricLabel(k)}: ${v.toInt()}');
      }
    });
    final failed = (r['failed'] as num?)?.toInt() ?? 0;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(failed > 0 ? Icons.warning_amber_rounded : Icons.check_circle_rounded,
                color: failed > 0 ? AppColors.warning : AppColors.success, size: 22),
            const SizedBox(width: 8),
            Text(failed > 0 ? 'Aktarım tamamlandı (uyarılı)' : 'Aktarım tamamlandı',
                style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
          ],
        ),
        const SizedBox(height: 10),
        if (lines.isEmpty)
          const Text('Yeni kayıt eklenmedi (hepsi zaten mevcut olabilir).',
              style: TextStyle(fontSize: 12, color: AppColors.muted))
        else
          for (final l in lines)
            Padding(
              padding: const EdgeInsets.only(bottom: 3),
              child: Text('• $l', style: const TextStyle(fontSize: 12.5)),
            ),
        if (failed > 0) ...[
          const SizedBox(height: 6),
          Text('$failed satır aktarılamadı.',
              style: const TextStyle(fontSize: 12, color: AppColors.danger)),
        ],
        if (errors.isNotEmpty) ...[
          const SizedBox(height: 8),
          Container(
            constraints: const BoxConstraints(maxHeight: 140),
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: AppColors.surfaceSoft,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppColors.border),
            ),
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  for (final e in errors)
                    Text('· $e',
                        style: const TextStyle(fontSize: 11, color: AppColors.muted)),
                ],
              ),
            ),
          ),
        ],
        const SizedBox(height: 14),
        SizedBox(
          width: double.infinity,
          child: FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Kapat'),
          ),
        ),
      ],
    );
  }

  static String _metricLabel(String key) => switch (key) {
        'customersCreated' => 'Müşteri eklendi',
        'customersSkipped' => 'Müşteri atlandı (mevcut)',
        'servicesCreated' => 'Hizmet eklendi',
        'servicesSkipped' => 'Hizmet atlandı (mevcut)',
        'packagesCreated' => 'Paket eklendi',
        'packagesSkipped' => 'Paket atlandı (mevcut)',
        'productsCreated' => 'Ürün eklendi',
        'productsSkipped' => 'Ürün atlandı (mevcut)',
        'staffCreated' => 'Personel eklendi',
        'staffSkipped' => 'Personel atlandı (mevcut)',
        _ => key,
      };
}
