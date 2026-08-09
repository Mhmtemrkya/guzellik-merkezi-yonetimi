import 'package:flutter_test/flutter_test.dart';
import 'package:beautyasist_mobile/features/customers/customer_sales_panel.dart';

/// İPTAL ARŞİVİ → SATIŞ PANELİ ÇEVİRİSİ.
///
/// İptal bir damga değil TAŞIMA'dır: canlı cari satırı silinir, anlık görüntü arşive gider.
/// Panel sekmeleri yalnız `saleStatus`e baktığı için, çeviri olmadan "İptal" sekmesi HER ZAMAN
/// boş kalıyordu (aynı kusur web'de `CariSalesWorkspace`'te de vardı).
void main() {
  Map<String, dynamic> archiveRow({
    String id = 'arsiv-1',
    String originalAccountId = 'cari-1',
    String customerId = 'must-1',
    double totalAmount = 30000,
    double retainedAmount = 5000,
  }) =>
      {
        'id': id,
        'originalAccountId': originalAccountId,
        'customerId': customerId,
        'customerName': 'Ayşe Yılmaz',
        'name': 'Lazer Paketi',
        'totalAmount': totalAmount,
        'retainedAmount': retainedAmount,
        'cancelledAtUtc': '2026-08-01T10:00:00Z',
        'cancellationReason': 'Müşteri vazgeçti',
      };

  test('arşiv satırı İptal sekmesine düşecek şekilde damgalanır', () {
    final rows = cancelledToPseudoAccounts([archiveRow()]);

    expect(rows, hasLength(1));
    expect(rows.first['saleStatus'], 'Cancelled');
  });

  test('iptalde alacak kalmaz: kalan 0, tahsil edilen kurumda kalan tutardır', () {
    final rows = cancelledToPseudoAccounts([archiveRow(retainedAmount: 5000)]);

    // Kalan borç sıfırlanmazsa iptal edilmiş satış cari borcunu şişirir.
    expect(rows.first['remainingAmount'], 0);
    expect(rows.first['paidAmount'], 5000);
  });

  test('kimlik ASIL CARİNİN kimliğidir — "İptali geri al" onu hedefler', () {
    final rows = cancelledToPseudoAccounts([archiveRow(id: 'arsiv-9', originalAccountId: 'cari-9')]);

    // /api/admin/accounts/{id}/restore-sale arşiv kimliğiyle çağrılırsa yanlış kaydı hedefler.
    expect(rows.first['id'], 'cari-9');
  });

  test('asıl cari kimliği yoksa arşiv kimliğine düşülür (kayıt kaybolmasın)', () {
    final row = archiveRow()..remove('originalAccountId');
    expect(cancelledToPseudoAccounts([row]).first['id'], 'arsiv-1');
  });

  test('müşteri süzgeci: kurum geneli arşivden BAŞKA müşterinin iptali sızmaz', () {
    final rows = cancelledToPseudoAccounts(
      [
        archiveRow(id: 'a1', originalAccountId: 'cari-1', customerId: 'must-1'),
        archiveRow(id: 'a2', originalAccountId: 'cari-2', customerId: 'must-2'),
      ],
      customerId: 'must-1',
    );

    // Ön Muhasebe ekranı arşivi kurum genelinde tutar; süzülmezse hem yabancı satış görünür
    // hem de özet şeridindeki iptal sayacı şişer.
    expect(rows, hasLength(1));
    expect(rows.first['customerId'], 'must-1');
    expect(rows.first['id'], 'cari-1');
  });

  test('süzgeç verilmezse tüm satırlar korunur (müşteri kartı yolu)', () {
    expect(cancelledToPseudoAccounts([archiveRow(id: 'a1'), archiveRow(id: 'a2')]), hasLength(2));
  });

  test('gerekçe ve iptal tarihi gibi arşiv alanları taşınır', () {
    final row = cancelledToPseudoAccounts([archiveRow()]).first;

    // Satır kartı iptal gerekçesini gösteriyor; çeviri alanları düşürürse kart boş görünür.
    expect(row['cancellationReason'], 'Müşteri vazgeçti');
    expect(row['cancelledAtUtc'], '2026-08-01T10:00:00Z');
    expect(row['totalAmount'], 30000);
  });
}
