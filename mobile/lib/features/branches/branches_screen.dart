import 'package:flutter/material.dart';

import '../../core/network/api_client.dart';
import '../../core/network/idempotency.dart';
import '../../core/platform/store_policy.dart';
import '../../shared/crud/crud_screen.dart';
import '../../shared/json_helpers.dart';
import 'branch_fee.dart';

/// İdempotency tuzu (web Ayarlar > Şube Ekle paritesi): sonucu BİLİNMEYEN deneme (ağ hatası, 5xx) aynı
/// tuzla tekrarlanır → sunucu ilk yanıtı oynatır, ikinci şube / ücret / fatura yazılmaz. Sunucu KESİN
/// yanıt verdiyse (başarı ya da 4xx) işlem bitmiştir ve tuz döner — saklanan 409 "ödeme doğrulanıyor"
/// yanıtı sonraki gerçek denemeye oynatılmasın.
String _branchSalt = newIdempotencySalt();

/// ŞUBE AÇMA — ücret etkisi + tutar onayı + mağaza kuralı + idempotency TEK YERDE (Şubeler ekranı ve Ayarlar
/// kullanır; web `BranchCreateModal` paritesi).
///
/// Android: ücret etkisi her zaman gösterilir (deneme dahil: "paket alınca ücretinize +X yansır"). Ücretli dönemde
/// yeni şubenin dönem sonuna kadar orantılı ücreti HEMEN işlenir — kayıtlı kart varsa karttan çekilir, yoksa açık
/// fatura kesilir; tutar onaylanır ve istek onaylanan tutarı taşır (arada değişirse sunucu 409 döner, ücret asla
/// sessizce işlenmez). Fatura kesilirse ödeme WEB'de alınır: "Faturayı öde" maydanozasist.com ödeme sayfasını
/// tarayıcıda açar (kullanıcı kararı 18 Kas 2026: mobilde satın alma web'e yönlendirilir).
/// iOS (App Store 3.1.1): fiyat / ödeme yüzeyi ve dışarıya satın alma yönlendirmesi YOK — ücretli şube eklenmez.
/// Teklif okunamazsa (yetki yok vb.) karar sunucunundur: ücret gerekiyorsa 409 gelir.
Future<dynamic> createBranchWithCharge(BuildContext context, ApiClient api, Map<String, dynamic> body) async {
  BranchFeeView? view;
  try {
    final q = await api.get('/api/admin/billing/branch-quote');
    if (q is Map) view = BranchFeeView.from(q.cast<String, dynamic>());
  } catch (_) {
    view = null;
  }

  if (view != null && view.chargeRequired) {
    if (StorePolicy.hidesPurchaseFlows) throw const ApiException(_storeNeutral);
    if (!view.canPurchase) throw ApiException(view.reason ?? 'Şube ücreti şu an tahsil edilemiyor.');
  }
  if (view != null && view.worthShowing && !StorePolicy.hidesPurchaseFlows) {
    if (!context.mounted) throw const ApiException('İşlem iptal edildi.');
    final ok = await showBranchFeeSheet(context, view, name: '${body['name'] ?? ''}', city: '${body['city'] ?? ''}');
    if (ok != true) {
      throw ApiException(view.chargeTotal == null
          ? 'Şube oluşturma iptal edildi.'
          : view.byInvoice
              ? 'Şube oluşturma iptal edildi; fatura kesilmedi.'
              : 'Şube oluşturma iptal edildi; ücret çekilmedi.');
    }
    if (view.chargeTotal != null) body = {...body, 'confirmedChargeTRY': view.chargeTotal};
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
    // iOS: sunucunun "tutarı onaylayın" mesajı da fiyat taşır — nötr metin.
    if (e.code == 'BranchChargeRequired' && StorePolicy.hidesPurchaseFlows) {
      throw const ApiException(_storeNeutral, code: 'BranchChargeRequired');
    }
    if (e.code == 'BranchAwaitingPayment') {
      // ÖDEMEDEN AÇILMAZ: talep alındı, açık fatura kesildi; şube ödeme alınınca açılır. Hata değil — ödeme adımı
      // gösterilir (fatura sitede ödenebiliyorsa "Faturayı öde" web'i açar); çağıranın "Şube oluşturuldu" mesajı
      // yerine kısa durum düşer.
      if (context.mounted) {
        await showBranchAwaitingPaymentSheet(context, api,
            message: e.message,
            branchName: '${body['name'] ?? ''}',
            payOnline: view?.payOnline == true && !StorePolicy.hidesPurchaseFlows);
      }
      throw const ApiException('Şube, ödeme alındığında açılacak.', code: 'BranchAwaitingPayment');
    }
    rethrow;
  }
}

const _storeNeutral = 'Ek şube ekleme bu uygulamadan yapılmaz.';

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
