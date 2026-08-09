/**
 * MÜŞTERİ KARTI PARA MUTABAKATI — üç KPI'ın birbirini tutması.
 *
 * <p>
 * Kartlar "Toplam Harcama − Tahsil Edilen ≈ Açık Borç" okumasını vaat ediyor. İPTAL + İADE
 * senaryosunda bu okuma sessizce bozuluyordu: 1.000 ₺ tahsil edilip satış iptal edilince 400 ₺
 * iade edildiğinde kartlar Harcama 1.000 · Tahsil 600 · Borç 0 gösteriyor ve aradaki 400 ₺
 * HİÇBİR YERDE yazmıyordu. Rakamların her biri tek başına doğruydu; birlikte okununca
 * açıklanamıyorlardı — muhasebe ekranında en kötü durum budur.
 * </p>
 *
 * <p>
 * Kapanan kimlik: <b>Harcama = Tahsil edilen + İade edilen + Açık borç</b>.
 * İade, "gelmiş sonra geri gitmiş para"dır; ne tahsilattır ne borç. Görünür olmadıkça fark
 * açıklanamaz kalır.
 * </p>
 */
export interface CustomerMoneyInput {
  /** Canlı satışların toplam tutarı. */
  liveTotal: number
  /** Canlı satışlardan tahsil edilen. */
  livePaid: number
  /** Canlı satışlardaki açık borç (cari BAŞINA sıfırla sınırlanmış). */
  liveDebt: number
  /** İptal edilmiş satışların toplam tutarı (arşiv). */
  cancelledTotal: number
  /** İptalden sonra kurumda KALAN para (tahsil − iade). */
  cancelledRetained: number
  /** Müşteriye GERİ ÖDENEN tutar. */
  cancelledRefunded: number
}

export interface CustomerMoneySummary {
  /** "Toplam Harcama" — iptaller dahil satışların tutarı. */
  total: number
  /** "Tahsil Edilen" — kurumda kalan NET para (iade düşülmüş). */
  collected: number
  /** "İade Edilen" — müşteriye geri ödenen. Sıfırsa kart/alt satır gösterilmez. */
  refunded: number
  /** "Açık Borç" — yalnız canlı satışlardan. */
  debt: number
  /**
   * Kimlik kapanıyor mu? `total − collected − refunded − debt ≈ 0`.
   *
   * Kapanmıyorsa sebep BİLİNEN ve İSTENEN tek durumdur: fazla ödeme, cari başına sıfırla
   * sınırlandığı için borcu eksiye çekmez. Ekran bu durumda "≈" işaretini korur.
   */
  balances: boolean
  /** Kapanmayan kısım (fazla ödeme). Pozitifse müşterinin alacağı vardır. */
  unexplained: number
}

/** Kuruş yuvarlamalarından doğan mikro farkları göz ardı eden eşik. */
const EPSILON = 0.01

export function reconcileCustomerMoney(input: CustomerMoneyInput): CustomerMoneySummary {
  const total = input.liveTotal + input.cancelledTotal
  // İptalde kurumda kalan tutar zaten iade düşülmüş hâldedir; iade AYRI kalemdir.
  const collected = input.livePaid + input.cancelledRetained
  const refunded = input.cancelledRefunded
  const debt = input.liveDebt

  const unexplained = round2(total - collected - refunded - debt)
  return {
    total: round2(total),
    collected: round2(collected),
    refunded: round2(refunded),
    debt: round2(debt),
    balances: Math.abs(unexplained) < EPSILON,
    unexplained,
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}
