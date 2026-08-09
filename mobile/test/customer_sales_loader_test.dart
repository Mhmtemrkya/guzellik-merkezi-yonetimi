import 'package:flutter_test/flutter_test.dart';
import 'package:beautyasist_mobile/core/network/api_client.dart';
import 'package:beautyasist_mobile/core/storage/session_storage.dart';
import 'package:beautyasist_mobile/features/customers/customer_sales_panel.dart';

/// SATIŞ YÜKLEYİCİSİ — ARŞİV CANLI LİSTEYİ DÜŞÜREMEZ.
///
/// Gerçek olay: arşiv ucunun adresi bir kez YANLIŞ yazıldı. `flutter analyze` ve saf fonksiyon
/// testleri yeşil kaldı, ama iki çağrı birbirine bağlı olduğu için her istek hataya düşüyor ve
/// satış paneli HİÇ AÇILMIYORDU. Bu testler o kaplini kalıcı olarak sabitler.
void main() {
  /// `get`i ele geçiren sahte istemci. `getAllPaged` içeriden `get` çağırdığı için
  /// tek override iki yolu birden kontrol eder.
  ///
  /// KAYIT TUTAR: hangi adreslerin çağrıldığı da bir iddiadır — yanlış uç adresi ancak
  /// böyle yakalanır.
  final calls = <String>[];

  ApiClient client({
    List<Map<String, dynamic>>? live,
    List<Map<String, dynamic>>? cancelled,
    bool archiveThrows = false,
    bool liveThrows = false,
  }) =>
      _FakeApi(
        calls: calls,
        live: live ?? const [],
        cancelled: cancelled ?? const [],
        archiveThrows: archiveThrows,
        liveThrows: liveThrows,
      );

  setUp(calls.clear);

  test('canlı satışlar + arşivden geri kurulan iptaller birleşir', () async {
    final load = await loadCustomerSalesAccounts(
      client(
        live: [
          {'id': 'cari-1', 'customerId': 'm1', 'name': 'Cilt Bakımı', 'saleStatus': 'Active'},
        ],
        cancelled: [
          {'id': 'ars-1', 'originalAccountId': 'cari-9', 'customerId': 'm1', 'retainedAmount': 750},
        ],
      ),
      'm1',
    );

    expect(load.accounts, hasLength(2));
    expect(load.accounts.where((r) => r['saleStatus'] == 'Cancelled'), hasLength(1));
    expect(load.archiveUnavailable, isFalse);
  });

  test('DOĞRU uç adresleri çağrılır (yanlış adres sessizce özelliği kapatıyordu)', () async {
    await loadCustomerSalesAccounts(client(), 'm1');

    expect(calls.any((c) => c.startsWith('/api/admin/accounts/with-archive')), isTrue,
        reason: 'birleşik uç çağrılmadı ya da adres yanlış: $calls');
    // TEK istek: ikiye bölünürse aradaki iptal satışı çift saydırır ya da kaybettirir.
    expect(calls, hasLength(1), reason: 'canlı ve arşiv ayrı çekilmiş: $calls');
  });

  test('istek patlarsa hata YUTULMAZ — kısmi liste "tam" sayılmaz', () async {
    // Tek uçta "arşiv ayrı çöktü" durumu yoktur: ya ikisi de gelir ya hiçbiri. Yarım veriyi
    // tam sanmaktansa hata göstermek doğrudur (para ekranı).
    await expectLater(
      loadCustomerSalesAccounts(client(archiveThrows: true), 'm1'),
      throwsA(isA<Exception>()),
    );
  });

  test('CANLI liste patlarsa hata YUTULMAZ — çağıran uyarıyı gösterebilmeli', () async {
    // Boş liste "satış yok" gibi okunur; kullanıcı eksik veri üzerinden iptal işlemi yapabilir.
    await expectLater(
      loadCustomerSalesAccounts(client(liveThrows: true), 'm1'),
      throwsA(isA<Exception>()),
    );
  });

  test('başka müşterinin arşiv kaydı sızmaz', () async {
    final load = await loadCustomerSalesAccounts(
      client(cancelled: [
        {'id': 'ars-1', 'originalAccountId': 'cari-1', 'customerId': 'm1', 'retainedAmount': 100},
        {'id': 'ars-2', 'originalAccountId': 'cari-2', 'customerId': 'BASKA', 'retainedAmount': 200},
      ]),
      'm1',
    );

    expect(load.accounts, hasLength(1));
    expect(load.accounts.first['id'], 'cari-1');
  });
}

class _FakeApi extends ApiClient {
  _FakeApi({
    required this.calls,
    required this.live,
    required this.cancelled,
    required this.archiveThrows,
    required this.liveThrows,
  }) : super(const SessionStorage());

  final List<String> calls;
  final List<Map<String, dynamic>> live;
  final List<Map<String, dynamic>> cancelled;
  final bool archiveThrows;
  final bool liveThrows;

  @override
  Future<dynamic> get(String path, {Map<String, dynamic>? query}) async {
    calls.add('$path?${query ?? const {}}');

    // TEK UÇ: canlı + arşiv aynı anlık görüntüden döner (yarış penceresi yok).
    if (liveThrows || archiveThrows) throw Exception('satışlar alınamadı');
    return {
      'live': {'items': live, 'totalCount': live.length},
      'cancelled': cancelled,
    };
  }
}
