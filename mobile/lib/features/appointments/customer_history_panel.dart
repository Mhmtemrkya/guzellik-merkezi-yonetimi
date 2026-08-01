import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/network/api_client.dart';
import '../../core/theme/app_theme.dart';
import '../../shared/json_helpers.dart';
import '../accounting/adisyon_receipt_sheet.dart' show adisyonItemTypeKey, adisyonItemVisual;

/// Müşterinin PAKET SONRASI geçmişi — web `CustomerHistoryPanel` paritesi.
///
/// Üç tablo tek panelde:
/// - **Seanslar**: kullanılan seansların TARİHLERİ (tamamlanmış randevular + adisyondaki
///   "paketten kullan" kalemleri). Bakiye "kaç seans kaldı"yı söylüyordu ama "hangi gün
///   geldi" hiçbir ekranda yazmıyordu.
/// - **İşlemler**: satış, ürün, ek kalem, indirim, paket kullanımı — kronolojik.
/// - **Ödemeler**: carilere yapılan tüm tahsilatlar (yöntem + hangi satış).
///
/// Adisyon ve randevular SUNUCUDA müşteriye göre süzülür (customerId) — tüm kurum çekilmez.
class CustomerHistoryPanel extends StatefulWidget {
  const CustomerHistoryPanel({
    required this.api,
    required this.customerId,
    this.accounts = const [],
    this.refreshKey = 0,
    super.key,
  });

  final ApiClient api;
  final String customerId;

  /// Randevu formunda zaten yüklü olan açık cariler — ödeme listesi buradan kurulur.
  final List<Map<String, dynamic>> accounts;

  /// Satış/tahsilat sonrası paneli tazelemek için sayaç.
  final int refreshKey;

  @override
  State<CustomerHistoryPanel> createState() => _CustomerHistoryPanelState();
}

final _money = NumberFormat.currency(locale: 'tr_TR', symbol: '₺', decimalDigits: 0);

/// Bir tablo satırı: tarih · işlem · sağ sütun.
class _Row {
  const _Row({
    required this.at,
    required this.tag,
    required this.desc,
    this.meta,
    this.amount = '',
    this.tone,
  });

  final DateTime? at;
  final String tag;
  final String desc;
  final String? meta;
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

  List<_Row> get _sessionRows {
    final rows = <_Row>[];
    for (final a in _appts) {
      if ('${a['status']}' != 'Completed') continue;
      // ÜCRETLİ randevu seans TÜKETMEZ (web paritesi): bu sekme "paket kullanımı" listesidir,
      // ücretli ziyaretler "İşlemler" sekmesinde görünür.
      if (((a['price'] as num?)?.toDouble() ?? 0) > 0) continue;
      rows.add(_Row(
        at: parseUtcToLocal(a['startUtc']),
        tag: 'Randevu',
        desc: valueOf(a, const ['serviceName'], fallback: 'Seans'),
        meta: valueOf(a, const ['staffName'], fallback: ''),
      ));
    }
    for (final ad in _adisyonlar) {
      for (final raw in (ad['items'] as List? ?? const [])) {
        if (raw is! Map) continue;
        final it = raw.cast<String, dynamic>();
        if (adisyonItemTypeKey(it['type']) != 'PackageUse') continue;
        rows.add(_Row(
          at: _itemAt(ad, it),
          tag: 'Paketten',
          desc: valueOf(it, const ['description'], fallback: 'Paket kullanımı'),
          meta: valueOf(it, const ['staffName'], fallback: ''),
          amount: 'paket',
          tone: AppColors.warning,
        ));
      }
    }
    return _sorted(rows);
  }

  List<_Row> get _operationRows {
    final rows = <_Row>[];
    for (final ad in _adisyonlar) {
      for (final raw in (ad['items'] as List? ?? const [])) {
        if (raw is! Map) continue;
        final it = raw.cast<String, dynamic>();
        final key = adisyonItemTypeKey(it['type']);
        final covered = it['coveredByPackage'] == true;
        final total = (it['lineTotal'] as num?)?.toDouble() ?? 0;
        final sign = key == 'Payment' ? '+' : (key == 'Discount' ? '−' : '');
        rows.add(_Row(
          at: _itemAt(ad, it),
          tag: adisyonItemVisual(it['type']).label,
          desc: valueOf(it, const ['description'], fallback: 'İşlem'),
          meta: valueOf(it, const ['staffName'], fallback: ''),
          amount: covered ? 'paket' : '$sign${_money.format(total)}',
          tone: covered
              ? AppColors.warning
              : key == 'Payment'
                  ? AppColors.success
                  : key == 'Discount'
                      ? AppColors.danger
                      : null,
        ));
      }
    }
    for (final a in _appts) {
      if ('${a['status']}' != 'Completed') continue;
      rows.add(_Row(
        at: parseUtcToLocal(a['startUtc']),
        tag: 'Seans',
        desc: valueOf(a, const ['serviceName'], fallback: 'Seans'),
        meta: valueOf(a, const ['staffName'], fallback: ''),
      ));
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
          meta: valueOf(p, const ['reference'], fallback: ''),
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

    final caption = _tab == 0
        ? (sessions.isEmpty
            ? 'Henüz kullanılmış seans yok'
            : '${sessions.length} kullanım · son ${_date(sessions.first.at)}')
        : _tab == 1
            ? '${rows.length} işlem'
            : '${payments.length} tahsilat · ${_money.format(paidTotal)}';

    final emptyText = _tab == 0
        ? 'Paket alındı ama henüz seans kullanılmamış.'
        : _tab == 1
            ? 'Bu müşteri için işlem kaydı yok.'
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
                const Expanded(
                  child: Text('İŞLEM',
                      style: TextStyle(
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
                itemBuilder: (_, i) => _row(rows[i], isSessions),
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

  Widget _row(_Row r, bool isSessions) {
    // Seans sekmesinde tür zaten sağ sütunda; orta satırda personel yazar.
    final sub = isSessions
        ? ((r.meta ?? '').isEmpty ? 'Personel belirtilmemiş' : r.meta!)
        : [r.tag, if ((r.meta ?? '').isNotEmpty) r.meta!].join(' · ');
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
