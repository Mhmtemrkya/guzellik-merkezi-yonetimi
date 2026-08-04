import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/json_helpers.dart';
import '../accounting/adisyon_receipt_sheet.dart' show adisyonItemTypeKey, adisyonItemVisual;

/// Müşterinin geçmişi — web `CustomerHistoryPanel` paritesi. Üç sekme, ÜÇ FARKLI SORU:
///
/// - **Seanslar** = PAKETTEN. Satın alınan paketlerde hangi işlemden kaç seans kaldı ve
///   geçmişte o paketlerden hangi günler seans kullanıldı.
/// - **İşlemler** = HİZMETTEN. Tek tek hizmet seçilerek yaptırılan işler; KİM SATTI ve
///   SEANSI KİM YAPTI ile birlikte.
/// - **Ödemeler** = carilere yapılan tahsilatlar (yöntem + hangi satış).
///
/// Eskiden "Seanslar" ve "İşlemler" ikisi de tamamlanmış randevuları listeliyordu; aynı satır
/// iki sekmede birden görünüyor ve aradaki fark okunmuyordu. Ayrım artık KAYNAK üzerinden.
///
/// Adisyon ve randevular SUNUCUDA müşteriye göre süzülür (customerId) — tüm kurum çekilmez.
class CustomerHistoryPanel extends StatefulWidget {
  const CustomerHistoryPanel({
    required this.api,
    required this.customerId,
    this.accounts = const [],
    this.sessions = const [],
    this.packages = const [],
    this.refreshKey = 0,
    super.key,
  });

  final ApiClient api;
  final String customerId;

  /// Randevu formunda zaten yüklü olan açık cariler — ödeme listesi buradan kurulur.
  final List<Map<String, dynamic>> accounts;

  /// Müşterinin seans bakiyeleri — çağıran zaten çekiyor, ikinci kez istenmez.
  final List<Map<String, dynamic>> sessions;

  /// Paket adını çözmek için katalog.
  final List<Map<String, dynamic>> packages;

  /// Satış/tahsilat sonrası paneli tazelemek için sayaç.
  final int refreshKey;

  @override
  State<CustomerHistoryPanel> createState() => _CustomerHistoryPanelState();
}

/// Pakete bağlı OLMAYAN seans satırı (tekil hizmet satışı) bu GUID ile gelir.
const _emptyGuid = '00000000-0000-0000-0000-000000000000';

final _money = NumberFormat.currency(locale: 'tr_TR', symbol: '₺', decimalDigits: 0);

/// Bir tablo satırı: tarih · işlem · sağ sütun.
class _Row {
  const _Row({
    required this.at,
    required this.tag,
    required this.desc,
    this.appliedBy,
    this.soldBy,
    this.amount = '',
    this.tone,
  });

  final DateTime? at;

  /// Sağ sütunda ya da alt satırda görünen kısa etiket (kaynak / yöntem).
  final String tag;
  final String desc;

  /// İşi UYGULAYAN personel.
  final String? appliedBy;

  /// İşi SATAN personel (yalnız İşlemler sekmesinde anlamlı).
  final String? soldBy;
  final String amount;
  final Color? tone;
}

class _CustomerHistoryPanelState extends State<CustomerHistoryPanel> {
  int _tab = 0;
  bool _loading = false;
  List<Map<String, dynamic>> _appts = const [];
  List<Map<String, dynamic>> _adisyonlar = const [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant CustomerHistoryPanel old) {
    super.didUpdateWidget(old);
    if (old.customerId != widget.customerId || old.refreshKey != widget.refreshKey) {
      _load();
    }
  }

  Future<void> _load() async {
    final cid = widget.customerId;
    if (cid.isEmpty) {
      if (mounted) setState(() { _appts = const []; _adisyonlar = const []; });
      return;
    }
    if (mounted) setState(() => _loading = true);
    try {
      // SAYFALAR SONUNA KADAR (web paritesi): tek sayfa 200 kayıtla sınırlıydı, uzun süreli
      // müşteride geçmişin eski kısmı sessizce eksik görünüyordu.
      final res = await Future.wait([
        widget.api
            .getAllPaged('/api/admin/appointments/', query: {'customerId': cid}, pageSize: 200)
            .catchError((_) => const <String, dynamic>{}),
        widget.api
            .getAllPaged('/api/admin/adisyonlar/', query: {'customerId': cid}, pageSize: 200)
            .catchError((_) => const <String, dynamic>{}),
      ]);
      if (!mounted) return;
      setState(() {
        _appts = apiItems(res[0]);
        // İptal edilmiş adisyon geçmişte yaşanmış sayılmaz.
        _adisyonlar =
            apiItems(res[1]).where((a) => '${a['status']}' != 'Cancelled').toList();
      });
    } catch (_) {
      if (mounted) setState(() { _appts = const []; _adisyonlar = const []; });
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  DateTime? _itemAt(Map<String, dynamic> adisyon, Map<String, dynamic> item) =>
      parseUtcToLocal(item['createdAtUtc']) ??
      parseUtcToLocal(adisyon['approvedAtUtc']) ??
      parseUtcToLocal(adisyon['openedAtUtc']);

  /// Paketten gelen seans satırları, pakete göre gruplanmış (kalan bakiye görünümü).
  List<Map<String, dynamic>> get _packageGroups {
    final map = <String, Map<String, dynamic>>{};
    for (final s in widget.sessions) {
      final pid = '${s['servicePackageId']}';
      final sid = '${s['serviceDefinitionId']}';
      if (pid.isEmpty || pid == 'null' || pid == _emptyGuid) continue;
      if (sid.isEmpty || sid == 'null') continue;
      final pkg = widget.packages.firstWhere((p) => '${p['id']}' == pid,
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
      if (row.isEmpty) {
        rows.add({
          'serviceDefinitionId': sid,
          'serviceName': '${s['serviceName'] ?? 'Hizmet'}',
          'remaining': remaining,
          'total': total,
        });
      } else {
        row['remaining'] = (row['remaining'] as int) + remaining;
        row['total'] = (row['total'] as int) + total;
      }
    }
    return map.values.toList();
  }

  /// Paketten karşılanan hizmetler — bir işin hangi sekmeye ait olduğunu bu küme belirler.
  Set<String> get _packageServiceIds {
    final set = <String>{};
    for (final s in widget.sessions) {
      final pid = '${s['servicePackageId']}';
      final sid = '${s['serviceDefinitionId']}';
      if (pid.isEmpty || pid == 'null' || pid == _emptyGuid) continue;
      if (sid.isEmpty || sid == 'null') continue;
      set.add(sid);
    }
    return set;
  }

  /// Hizmet → o hizmeti satan personel (satışın carisinden). "Kim verdi" sorusunun cevabı.
  Map<String, String> get _soldByService {
    final byAccount = <String, String>{};
    for (final a in widget.accounts) {
      final seller = '${a['soldByStaffName'] ?? ''}';
      if (seller.isNotEmpty) byAccount['${a['id']}'] = seller;
    }
    final map = <String, String>{};
    for (final s in widget.sessions) {
      final sid = '${s['serviceDefinitionId']}';
      final seller = byAccount['${s['customerAccountId']}'];
      if (sid.isEmpty || sid == 'null' || seller == null) continue;
      map.putIfAbsent(sid, () => seller);
    }
    return map;
  }

  /// PAKETTEN kullanılan seanslar: tamamlanmış ücretsiz randevular + adisyon "Paketten" kalemleri.
  List<_Row> get _sessionRows {
    final fromPackage = _packageServiceIds;
    final rows = <_Row>[];
    for (final a in _appts) {
      if ('${a['status']}' != 'Completed') continue;
      // ÜCRETLİ randevu seans TÜKETMEZ; paket defterine girmez (İşlemler'de görünür).
      if (((a['price'] as num?)?.toDouble() ?? 0) > 0) continue;
      final sid = '${a['serviceDefinitionId']}';
      if (sid.isNotEmpty && sid != 'null' && !fromPackage.contains(sid)) continue;
      rows.add(_Row(
        at: parseUtcToLocal(a['startUtc']),
        tag: 'Randevu',
        desc: valueOf(a, const ['serviceName'], fallback: 'Seans'),
        appliedBy: valueOf(a, const ['staffName'], fallback: ''),
      ));
    }
    for (final ad in _adisyonlar) {
      for (final raw in (ad['items'] as List? ?? const [])) {
        if (raw is! Map) continue;
        final it = raw.cast<String, dynamic>();
        if (adisyonItemTypeKey(it['type']) != 'PackageUse') continue;
        rows.add(_Row(
          at: _itemAt(ad, it),
          tag: 'Adisyon',
          desc: valueOf(it, const ['description'], fallback: 'Paket kullanımı'),
          appliedBy: valueOf(it, const ['staffName'], fallback: ''),
          tone: AppColors.warning,
        ));
      }
    }
    return _sorted(rows);
  }

  /// HİZMETTEN yaptırılanlar: tekil hizmet satışına/ücretli randevuya dayanan işler.
  List<_Row> get _operationRows {
    final fromPackage = _packageServiceIds;
    final sellers = _soldByService;
    final rows = <_Row>[];
    for (final a in _appts) {
      if ('${a['status']}' != 'Completed') continue;
      final price = (a['price'] as num?)?.toDouble() ?? 0;
      final sid = '${a['serviceDefinitionId']}';
      final covered = price <= 0 && sid.isNotEmpty && sid != 'null' && fromPackage.contains(sid);
      if (covered) continue;
      rows.add(_Row(
        at: parseUtcToLocal(a['startUtc']),
        tag: 'Randevu',
        desc: valueOf(a, const ['serviceName'], fallback: 'Hizmet'),
        appliedBy: valueOf(a, const ['staffName'], fallback: ''),
        soldBy: sellers[sid],
        amount: price > 0 ? _money.format(price) : 'Hizmet hakkı',
      ));
    }
    // Adisyonda salonda verilen hizmetler (randevusuz ek işlem dahil).
    for (final ad in _adisyonlar) {
      for (final raw in (ad['items'] as List? ?? const [])) {
        if (raw is! Map) continue;
        final it = raw.cast<String, dynamic>();
        final key = adisyonItemTypeKey(it['type']);
        if (key != 'Service' && key != 'Extra') continue;
        if (it['coveredByPackage'] == true) continue;
        final staffName = valueOf(it, const ['staffName'], fallback: '');
        rows.add(_Row(
          at: _itemAt(ad, it),
          tag: adisyonItemVisual(it['type']).label,
          desc: valueOf(it, const ['description'], fallback: 'İşlem'),
          appliedBy: staffName,
          soldBy: staffName,
          amount: _money.format((it['lineTotal'] as num?)?.toDouble() ?? 0),
        ));
      }
    }
    return _sorted(rows);
  }

  /// Ödeme listesi carilerin TAHSİLAT satırlarından kurulur (adisyondaki ödeme kalemi onayda
  /// zaten cariye tahsilat olarak yazılır — ikisini toplamak aynı parayı iki kez gösterirdi).
  List<_Row> get _paymentRows {
    final rows = <_Row>[];
    for (final acc in widget.accounts) {
      final name = valueOf(acc, const ['servicePackageName', 'name'], fallback: 'Satış');
      for (final raw in (acc['payments'] as List? ?? const [])) {
        if (raw is! Map) continue;
        final p = raw.cast<String, dynamic>();
        rows.add(_Row(
          at: parseUtcToLocal(p['occurredAtUtc']),
          tag: _methodLabel('${p['method'] ?? ''}'),
          desc: name,
          appliedBy: _methodLabel('${p['method'] ?? ''}'),
          amount: '+${_money.format((p['amount'] as num?)?.toDouble() ?? 0)}',
          tone: AppColors.success,
        ));
      }
    }
    return _sorted(rows);
  }

  static List<_Row> _sorted(List<_Row> rows) {
    rows.sort((x, y) {
      final a = x.at?.millisecondsSinceEpoch ?? 0;
      final b = y.at?.millisecondsSinceEpoch ?? 0;
      return b.compareTo(a);
    });
    return rows;
  }

  static String _methodLabel(String method) {
    final key = method.toLowerCase();
    if (key.contains('cash') || key.contains('nakit')) return 'Nakit';
    if (key.contains('card') || key.contains('kart')) return 'Kart';
    if (key.contains('transfer') || key.contains('havale') || key.contains('eft')) {
      return 'Havale';
    }
    return method.isEmpty ? 'Tahsilat' : method;
  }

  @override
  Widget build(BuildContext context) {
    final sessions = _sessionRows;
    final payments = _paymentRows;
    final rows = _tab == 0
        ? sessions
        : _tab == 1
            ? _operationRows
            : payments;
    final isSessions = _tab == 0;

    final paidTotal = widget.accounts.fold<double>(0, (sum, a) {
      var acc = 0.0;
      for (final raw in (a['payments'] as List? ?? const [])) {
        if (raw is Map) acc += (raw['amount'] as num?)?.toDouble() ?? 0;
      }
      return sum + acc;
    });

    final groups = _packageGroups;
    final remainingTotal = groups.fold<int>(
        0,
        (n, g) => n +
            (g['rows'] as List).fold<int>(0, (m, r) => m + ((r as Map)['remaining'] as int)));

    final caption = _tab == 0
        ? (groups.isEmpty
            ? 'Satın alınmış paket yok'
            : '${groups.length} paket · $remainingTotal seans kaldı · ${sessions.length} kullanım')
        : _tab == 1
            ? '${rows.length} işlem'
            : '${payments.length} tahsilat · ${_money.format(paidTotal)}';

    final emptyText = _tab == 0
        ? 'Paketten henüz seans kullanılmamış.'
        : _tab == 1
            ? 'Tek tek hizmet seçilerek yaptırılmış işlem yok.'
            : 'Bu müşteriden henüz tahsilat alınmamış.';

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
          const Text('Müşteri geçmişi',
              style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w800)),
          const SizedBox(height: 10),
          Row(
            children: [
              for (final (i, t) in const [
                (0, ('Seanslar', Icons.event_available_rounded)),
                (1, ('İşlemler', Icons.receipt_long_rounded)),
                (2, ('Ödemeler', Icons.payments_rounded)),
              ])
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.only(right: 6),
                    child: _tabButton(i, t.$1, t.$2),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 8),
          Text(caption, style: const TextStyle(fontSize: 11.5, color: AppColors.muted)),
          // SEANSLAR: önce kalan bakiye (paket → işlem kırılımı), sonra kullanım geçmişi.
          if (isSessions && groups.isNotEmpty) ...[
            const SizedBox(height: 8),
            for (final g in groups) _balanceCard(g),
          ],
          const SizedBox(height: 6),
          // Tablo başlığı
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Row(
              children: [
                const SizedBox(
                  width: 68,
                  child: Text('TARİH',
                      style: TextStyle(
                          fontSize: 9.5,
                          fontWeight: FontWeight.w800,
                          letterSpacing: .6,
                          color: AppColors.primaryDark)),
                ),
                Expanded(
                  child: Text(
                      isSessions
                          ? 'KULLANILAN SEANS'
                          : _tab == 1
                              ? 'İŞLEM'
                              : 'SATIŞ',
                      style: const TextStyle(
                          fontSize: 9.5,
                          fontWeight: FontWeight.w800,
                          letterSpacing: .6,
                          color: AppColors.primaryDark)),
                ),
                Text(isSessions ? 'KAYNAK' : 'TUTAR',
                    style: const TextStyle(
                        fontSize: 9.5,
                        fontWeight: FontWeight.w800,
                        letterSpacing: .6,
                        color: AppColors.primaryDark)),
              ],
            ),
          ),
          if (_loading && rows.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 18),
              child: Center(
                child: SizedBox(
                    height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2)),
              ),
            )
          else if (rows.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 18),
              child: Center(
                child: Text(emptyText,
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 12, color: AppColors.muted)),
              ),
            )
          else
            // Uzun geçmişte panel şişmesin diye liste kendi içinde kayar.
            ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 280),
              child: ListView.separated(
                shrinkWrap: true,
                padding: EdgeInsets.zero,
                itemCount: rows.length,
                separatorBuilder: (_, _) => const Divider(height: 1, color: Color(0xFFF7EEF2)),
                itemBuilder: (_, i) => _row(rows[i], isSessions, _tab == 1),
              ),
            ),
        ],
      ),
    );
  }

  Widget _tabButton(int index, String label, IconData icon) {
    final selected = _tab == index;
    return GestureDetector(
      onTap: () => setState(() => _tab = index),
      child: Container(
        height: 34,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: selected ? AppColors.primaryDark : Colors.white,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: selected ? AppColors.primaryDark : AppColors.border),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 13, color: selected ? Colors.white : AppColors.primaryDark),
            const SizedBox(width: 4),
            Flexible(
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 11.5,
                  fontWeight: FontWeight.w700,
                  color: selected ? Colors.white : AppColors.ink,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Satın alınan paketin kalan seans kırılımı — "hangi işlemden kaç seans kaldı".
  Widget _balanceCard(Map<String, dynamic> g) {
    final rows = (g['rows'] as List).cast<Map<String, dynamic>>();
    final remaining = rows.fold<int>(0, (n, r) => n + (r['remaining'] as int));
    final total = rows.fold<int>(0, (n, r) => n + (r['total'] as int));
    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: const Color(0xFFFDF9FB),
        border: Border.all(color: const Color(0xFFF0E2E9)),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text('${g['name']}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800)),
              ),
              Text('$remaining / $total seans',
                  style: const TextStyle(
                      fontSize: 11, fontWeight: FontWeight.w700, color: AppColors.primaryDark)),
            ],
          ),
          const SizedBox(height: 4),
          for (final r in rows)
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Row(
                children: [
                  Expanded(
                    child: Text('${r['serviceName']}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 11.5, color: AppColors.ink)),
                  ),
                  Text('${r['remaining']} / ${r['total']} kaldı',
                      style: const TextStyle(
                          fontSize: 11, fontWeight: FontWeight.w700, color: AppColors.muted)),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _row(_Row r, bool isSessions, bool isOperations) {
    // İşlemler sekmesinde İKİ KİŞİ vardır: satan ve uygulayan.
    final sub = isOperations
        ? [
            (r.soldBy ?? '').isEmpty ? 'Satan belirtilmemiş' : 'Satan: ${r.soldBy}',
            (r.appliedBy ?? '').isEmpty ? 'Yapan belirtilmemiş' : 'Yapan: ${r.appliedBy}',
          ].join(' · ')
        : isSessions
            ? ((r.appliedBy ?? '').isEmpty ? 'Personel belirtilmemiş' : r.appliedBy!)
            : (r.appliedBy ?? '');
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 68,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(_date(r.at),
                    style: const TextStyle(fontSize: 11.5, color: AppColors.muted)),
                if (_time(r.at).isNotEmpty)
                  Text(_time(r.at),
                      style: const TextStyle(fontSize: 10, color: AppColors.muted)),
              ],
            ),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(r.desc,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600)),
                Text(sub,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 11, color: AppColors.muted)),
              ],
            ),
          ),
          const SizedBox(width: 6),
          Text(
            isSessions ? r.tag : (r.amount.isEmpty ? '—' : r.amount),
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: r.tone ?? AppColors.ink,
            ),
          ),
        ],
      ),
    );
  }

  static String _date(DateTime? at) =>
      at == null ? '—' : DateFormat('dd.MM.yyyy').format(at);
  static String _time(DateTime? at) =>
      at == null ? '' : DateFormat('HH:mm').format(at);
}
