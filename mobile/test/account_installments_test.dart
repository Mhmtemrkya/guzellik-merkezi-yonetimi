import 'package:beautyasist_mobile/features/accounting/account_installments.dart';
import 'package:flutter_test/flutter_test.dart';

/// TAKSİT KURALLARI — WEB/BACKEND İLE PARİTE.
///
/// Bu mantık backend'de de yazılı (`AccountInstallment.RemainingAmount`, `normalizeAccount`),
/// yani AYNI İŞ KURALI İKİ YERDE duruyor ve sapması sessiz: aynı kayıt webde kapalı, mobilde
/// açık borç görünebiliyor. Gerçek bir sapma bulundu — `remaining` hesabı `cancelled` alanını
/// yok sayıyordu; testler kuralı sabitler.
void main() {
  Map<String, dynamic> account(List<Map<String, dynamic>> installments) =>
      <String, dynamic>{'installments': installments};

  Map<String, dynamic> inst({
    required String id,
    required double amount,
    double paid = 0,
    String due = '2026-01-15',
    String status = 'pending',
    int no = 1,
  }) =>
      <String, dynamic>{
        'id': id,
        'no': no,
        'dueDate': due,
        'amount': amount,
        'paidAmount': paid,
        'status': status,
      };

  group('kalan borç (remaining)', () {
    test('İPTAL EDİLMİŞ taksitin kalanı SIFIRDIR (backend RemainingAmount ile aynı)', () {
      // ASIL BULGU: burası `cancelled`ı yok sayıyordu; iptal edilmiş 500 ₺'lik taksit
      // mobilde "Kalan 500 ₺" görünürken backend/web 0 diyordu.
      final list = parseInstallments(account([
        inst(id: 'a', amount: 500, paid: 0, status: 'cancelled'),
      ]));

      expect(list.single.cancelled, isTrue);
      expect(list.single.remaining, 0);
      expect(list.single.isPaid, isTrue, reason: 'kalanı 0 olan taksit kapalı sayılmalı');
    });

    test('ödenmemiş taksitin kalanı tutarın kendisidir', () {
      final list = parseInstallments(account([inst(id: 'a', amount: 500)]));
      expect(list.single.remaining, 500);
      expect(list.single.isPaid, isFalse);
      expect(list.single.isPartial, isFalse);
    });

    test('KISMİ ödemede kalan fark kadardır', () {
      final list = parseInstallments(account([inst(id: 'a', amount: 500, paid: 200)]));
      expect(list.single.remaining, 300);
      expect(list.single.isPartial, isTrue);
      expect(list.single.isPaid, isFalse);
    });

    test('tam ödenmiş taksit kapalıdır ve kalan eksiye DÜŞMEZ', () {
      // Fazla ödeme (paid > amount) sunucuda oluşamaz ama gelirse kalan negatif olmamalı:
      // negatif kalan, tahsilat dağıtımında "bu taksit para İADE ediyor" gibi davranırdı.
      final list = parseInstallments(account([
        inst(id: 'a', amount: 500, paid: 500),
        inst(id: 'b', amount: 500, paid: 900, no: 2, due: '2026-02-15'),
      ]));
      expect(list[0].remaining, 0);
      expect(list[0].isPaid, isTrue);
      expect(list[1].remaining, 0);
    });
  });

  group('gecikme (overdue)', () {
    test('İPTAL EDİLMİŞ taksit ASLA gecikmiş sayılmaz', () {
      final list = parseInstallments(account([
        inst(id: 'a', amount: 500, due: '2020-01-15', status: 'cancelled'),
      ]));
      expect(list.single.overdue, isFalse);
    });

    test('ödenmiş taksit gecikmiş sayılmaz (vadesi çok geçmiş olsa bile)', () {
      final list = parseInstallments(account([
        inst(id: 'a', amount: 500, paid: 500, due: '2020-01-15'),
      ]));
      expect(list.single.overdue, isFalse);
    });
  });

  group('taksitli hesap ayrımı', () {
    test('tek taksit PEŞİN sayılır (taksitli değil)', () {
      expect(isInstallmentAccount(account([inst(id: 'a', amount: 500)])), isFalse);
    });

    test('iki taksit taksitli sayılır', () {
      expect(
        isInstallmentAccount(account([
          inst(id: 'a', amount: 250),
          inst(id: 'b', amount: 250, no: 2, due: '2026-02-15'),
        ])),
        isTrue,
      );
    });

    test('İPTAL EDİLMİŞ taksitler SAYILMAZ — biri iptalse hesap peşin sayılır', () {
      // İptal edilen taksit plandan çıkmıştır; sayıma katılırsa tek taksitli bir satış
      // hatalı biçimde "taksitli" görünür ve ekran taksit tahsilatı önerir.
      expect(
        isInstallmentAccount(account([
          inst(id: 'a', amount: 250),
          inst(id: 'b', amount: 250, no: 2, due: '2026-02-15', status: 'cancelled'),
        ])),
        isFalse,
      );
    });

    test('taksiti olmayan hesap peşindir', () {
      expect(isInstallmentAccount(account(const [])), isFalse);
    });
  });

  group('durum çözümleme', () {
    test('iptal durumu hem metin hem SAYISAL kodla tanınır', () {
      // Sunucu enum'u kimi yerde metin ("cancelled"), kimi yerde sayı ("2") döndürüyor;
      // yalnız birini tanımak iptal edilmiş taksiti açık borç gösterirdi.
      final byText = parseInstallments(account([inst(id: 'a', amount: 100, status: 'cancelled')]));
      final byCode = parseInstallments(account([inst(id: 'b', amount: 100, status: '2')]));
      expect(byText.single.cancelled, isTrue);
      expect(byCode.single.cancelled, isTrue);
    });

    test('sıra numarası verilmemişse listedeki konumdan türetilir', () {
      final list = parseInstallments(account([
        inst(id: 'a', amount: 100, no: 0),
        inst(id: 'b', amount: 100, no: 0, due: '2026-02-15'),
      ]));
      expect(list[0].no, 1);
      expect(list[1].no, 2);
    });
  });

  /// DÜZENSİZ ÖDEME (DEVİR) — web lib/accountGrouping.test.ts ile AYNI senaryo.
  ///
  /// 30.000 TL paket, 5.000 pesin, kalan 25.000 -> 5 ay x 5.000. Kural: odenmeyen ayin
  /// borcu sonraki ayin taksitinin ustune biner. Ayni is kurali iki dilde yazili oldugu
  /// icin (TS + Dart) senaryo BURADA DA sabitlenir; sapma sessiz olmasin.
  group('devir (duzensiz odeme) - Ela senaryosu', () {
    List<AccountInstallment> plan(List<double> paidPerInstallment) {
      const dues = [
        '2026-01-10',
        '2026-02-10',
        '2026-03-10',
        '2026-04-10',
        '2026-05-10',
      ];
      return parseInstallments(account([
        for (var i = 0; i < dues.length; i++)
          inst(
            id: 'i${i + 1}',
            no: i + 1,
            amount: 5000,
            paid: i < paidPerInstallment.length ? paidPerInstallment[i] : 0,
            due: dues[i],
          ),
      ]));
    }

    test('2. ay odenmezse 3. ayda odenmesi gereken 10.000 olur', () {
      final rows = buildInstallmentRows(plan([5000]));
      expect(rows[2].carryIn, 5000);
      expect(rows[2].expected, 10000);
      expect(rows[2].outstanding, 10000);
    });

    test('3. ayda 7.500 odenirse kalan 2.500 nisana devreder', () {
      // Sunucu vade sirasiyla dagitir: 12.500 -> i1 5.000, i2 5.000, i3 2.500.
      final rows = buildInstallmentRows(plan([5000, 5000, 2500]));
      expect(rows[2].item.remaining, 2500);
      expect(rows[3].carryIn, 2500);
      expect(rows[3].expected, 7500);
    });

    test('devir birikir: iki ay ust uste odenmezse ucuncu ay uc taksit ister', () {
      final rows = buildInstallmentRows(plan([5000]));
      expect(rows[3].carryIn, 10000);
      expect(rows[3].expected, 15000);
    });

    test('iptal edilen taksit devre girmez', () {
      final list = parseInstallments(account([
        inst(id: 'i1', no: 1, amount: 5000, paid: 5000, due: '2026-01-10'),
        inst(id: 'i2', no: 2, amount: 5000, due: '2026-02-10', status: 'cancelled'),
        inst(id: 'i3', no: 3, amount: 5000, due: '2026-03-10'),
      ]));
      final rows = buildInstallmentRows(list);
      expect(rows.length, 2);
      expect(rows[1].carryIn, 0);
    });
  });
}
