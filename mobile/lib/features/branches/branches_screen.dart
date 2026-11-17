import 'package:flutter/material.dart';

import '../../core/network/api_client.dart';
import '../../core/network/idempotency.dart';
import '../../core/platform/store_policy.dart';
import '../../shared/crud/crud_screen.dart';
import '../../shared/json_helpers.dart';
import '../appointments/calendar_theme.dart';

/// İdempotency tuzu (web Ayarlar > Şube Ekle paritesi): sonucu BİLİNMEYEN deneme (ağ hatası, 5xx) aynı
/// tuzla tekrarlanır → sunucu ilk yanıtı oynatır, ikinci şube / ücret / fatura yazılmaz. Sunucu KESİN
/// yanıt verdiyse (başarı ya da 4xx) işlem bitmiştir ve tuz döner — saklanan 409 "ödeme doğrulanıyor"
/// yanıtı sonraki gerçek denemeye oynatılmasın.
String _branchSalt = newIdempotencySalt();

/// ŞUBE AÇMA — ücret onayı + mağaza kuralı + idempotency TEK YERDE (Şubeler ekranı ve Ayarlar kullanır).
///
/// Şube başına ücretlendirilen pakette ücretli dönem ortasında açılan şubenin dönem sonuna kadar
/// orantılı ücreti HEMEN işlenir: kayıtlı kart + açık ödeme altyapısı varsa karttan çekilir, yoksa
/// açık fatura kesilir. Tutar bu diyalogda gösterilir ve onaylanır; istek onaylanan tutarı taşır.
/// Tutar arada değişirse sunucu 409 döner — ücret asla sessizce işlenmez. Teklif okunamazsa (yetki
/// yok vb.) karar sunucunundur: ücret gerekiyorsa 409 gelir.
Future<dynamic> createBranchWithCharge(BuildContext context, ApiClient api, Map<String, dynamic> body) async {
  Map<String, dynamic>? charge;
  try {
    final q = await api.get('/api/admin/billing/branch-quote');
    if (q is Map) charge = q.cast<String, dynamic>();
  } catch (_) {
    charge = null;
  }

  if (charge != null && charge['chargeRequired'] == true) {
    // iOS (App Store 3.1.1): ücretli işlem / fiyat yüzeyi bu uygulamada gösterilmez — Paketim ile aynı
    // kural. Ücret ne çekilir ne faturalanır; dışarıya satın alma yönlendirmesi de yapılmaz.
    if (StorePolicy.hidesPurchaseFlows) {
      throw const ApiException('Ek şube ekleme bu uygulamadan yapılmaz.');
    }
    if (charge['canPurchase'] != true) {
      throw ApiException('${charge['reason'] ?? 'Şube ücreti şu an tahsil edilemiyor.'}');
    }
    final quote = charge['quote'] is Map ? (charge['quote'] as Map).cast<String, dynamic>() : const <String, dynamic>{};
    final total = numberOf(quote, const ['total']);
    final lines = (quote['lines'] as List? ?? const []).whereType<Map>().toList();
    final lineLabel = lines.isEmpty ? '' : '${lines.first['label'] ?? ''}';
    final card = '${charge['cardMasked'] ?? ''}';
    // Kart yoksa / ödeme altyapısı kapalıysa (web paritesi) aynı tutar AÇIK faturaya yazılır, tahsilatı
    // platform yapar — şube ÖDEMEDEN AÇILMAZ: platform faturayı "Ödendi" yapınca açılır.
    final byInvoice = '${charge['chargeMethod'] ?? ''}' == 'Invoice';
    if (!context.mounted) throw const ApiException('İşlem iptal edildi.');
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(byInvoice ? 'Ek şube faturası' : 'Ek şube ücreti'),
        content: Text(
          'Paketiniz şube başına ücretlendirilir.\n\n'
          '${byInvoice
              ? 'Bu şube için bugün ${CalendarText.tl(total)} (KDV dahil, dönem sonuna kadar orantılı) tutarında fatura kesilecek. Şube, ödeme alındığında açılır.'
              : 'Bu şube için bugün ${CalendarText.tl(total)} (KDV dahil) kayıtlı kartınızdan${card.isNotEmpty ? ' ($card)' : ''} çekilecek.'}'
          '${lineLabel.isNotEmpty ? '\n\n$lineLabel' : ''}'
          '\n\nSonraki dönemlerde tam şube ücreti eklenir. Onaylıyor musunuz?',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Vazgeç')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: Text(byInvoice ? 'Onayla (${CalendarText.tl(total)})' : '${CalendarText.tl(total)} öde'),
          ),
        ],
      ),
    );
    if (ok != true) {
      throw ApiException(byInvoice
          ? 'Şube oluşturma iptal edildi; fatura kesilmedi.'
          : 'Şube oluşturma iptal edildi; ücret çekilmedi.');
    }
    body = {...body, 'confirmedChargeTRY': total};
  }

  final key = idempotencyKey(_branchSalt, [
    'branch',
    '${body['name'] ?? ''}',
    '${body['city'] ?? ''}',
    body['isDefault'] == true ? 1 : 0,
    body['confirmedChargeTRY'],
  ]);
  try {
    final result = await api.post('/api/admin/branches/', body, key);
    _branchSalt = newIdempotencySalt();
    return result;
  } on ApiException catch (e) {
    final status = e.statusCode;
    if (status != null && status > 0 && status < 500) _branchSalt = newIdempotencySalt();
    if (e.code == 'BranchAwaitingPayment') {
      // ÖDEMEDEN AÇILMAZ: talep alındı, açık fatura kesildi; şube, platform ödemeyi "Ödendi" yapınca açılır.
      // Hata değil — kalıcı bilgi diyaloğu gösterilir; çağıranın "Şube oluşturuldu" mesajı yerine kısa durum düşer.
      if (context.mounted) {
        await showDialog<void>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text('Şube talebi alındı'),
            content: Text(e.message),
            actions: [FilledButton(onPressed: () => Navigator.pop(ctx), child: const Text('Tamam'))],
          ),
        );
      }
      throw const ApiException('Şube, ödeme alındığında açılacak.', code: 'BranchAwaitingPayment');
    }
    rethrow;
  }
}

class BranchesScreen extends StatelessWidget {
  const BranchesScreen({required this.api, super.key});
  final ApiClient api;

  /// Şehir + canlı personel sayısını tek satırda gösterebilmek için türetilmiş alan
  /// ekler ([valueOf] yalnızca ilk dolu anahtarı yazdırdığından iki alan yan yana gelmiyordu).
  Future<dynamic> _load() async {
    final items = apiItems(await api.get('/api/admin/branches/'));
    for (final item in items) {
      final city = valueOf(item, const ['city'], fallback: '');
      final staff = numberOf(item, const ['staffCount', 'staff']).toInt();
      item['_summary'] = [
        if (city.isNotEmpty) city,
        '$staff personel',
      ].join(' · ');
    }
    return items;
  }

  @override
  Widget build(BuildContext context) {
    return CrudListScreen(
      eyebrow: 'Kurum',
      title: 'Şubeler',
      subtitle: 'Şube yönetimi ve personel dağılımı.',
      icon: Icons.store_mall_directory_rounded,
      loader: _load,
      titleKeys: const ['name'],
      subtitleKeys: const ['_summary', 'city'],
      statusKeys: const ['isDefault'],
      createLabel: 'Yeni şube',
      // Personel sayısı şubeye kayıtlı personelden otomatik gelir; elle kapasite alanı yok.
      fields: const [
        CrudField(key: 'name', label: 'Şube adı', required: true),
        CrudField(key: 'city', label: 'Şehir', required: true),
        CrudField(
          key: 'isDefault',
          label: 'Varsayılan şube',
          type: CrudFieldType.toggle,
        ),
      ],
      onCreate: (body) => createBranchWithCharge(context, api, body),
      onUpdate: (item, body) =>
          api.put('/api/admin/branches/${item['id']}', body),
      // Şube silme ucu backend'de yok (randevu/personel/cari şubeye bağlı) — buton gösterilmiyor.
      canDelete: false,
    );
  }
}
