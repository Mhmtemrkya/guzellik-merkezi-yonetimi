import { activeInstallments, type CustomerAccountGroup } from '@/lib/accountGrouping'
import { paymentMethodLabel } from '@/lib/apiMappers'
import type { CancelledSale, CustomerAccount } from '@/lib/types'

/**
 * CARİ HESAP EKSTRESİ — müşterinin bütün satışlarını TEK ÇİFT TARAFLI deftere çevirir.
 *
 * Eski "Tahsilat Ekstresi" yalnız TAHSİLATLARI listeliyordu: müşteri "ne kadar borçlandım,
 * hangi taksit ne zaman doğdu" sorusunun cevabını göremiyordu. Gerçek ekstre BORÇ (bizim
 * alacağımız) ile ALACAK (müşterinin ödediği) satırlarını tarih sırasına dizer ve her satırın
 * ardından YÜRÜYEN BAKİYE yazar.
 *
 * <b>BORÇ TARAFININ AYRIŞIMI (backend ile birebir):</b> `CustomerAccount.RemainingAmount`
 * = `max(0, TotalAmount − PaidAmount)`; `DepositAmount` bir PLAN alanıdır ve toplamın İÇİNDEDİR
 * (`financed = Total − Deposit`, taksitler bu tutarı böler). Bu yüzden bir satışın borç satırları:
 *   peşinat + aktif taksitler + (kalırsa) plan dışı bakiye  =  TotalAmount
 * Böylece kapanış bakiyesi `Σ(total − paid)` ile BİREBİR tutar — belge kendi içinde mutabık olur.
 *
 * <b>İPTAL EDİLEN SATIŞ SIFIRA KAPANIR:</b> iptalde cari satır arşive taşınır ve borç silinir
 * (`RemainingAmount` iptalde 0'dır). Ama para hareketleri gerçektir: tahsilatlar alacak, iadeler
 * borç yazılır, aradaki fark ("kurumda kalan") tek bir borç satırıyla kapatılır. Net etki sıfır —
 * iptal edilmiş bir satış müşteriyi ne borçlu ne alacaklı bırakır.
 *
 * <b>TARİH ANLAMI:</b> tahsilat/iade bir ANDIR → YEREL güne çevrilir (UTC günü kullanılırsa
 * gece yarısı civarındaki ödeme bir gün geriye kayar ve yürüyen bakiyede satır sırası bozulur).
 * Taksit vadesi ise TAKVİM TARİHİDİR → olduğu gibi kesilir (takvim sekmesiyle aynı kural).
 */

/** Hareket türü — etiketler tek yerden okunur (bkz. STATEMENT_TYPE_LABEL). */
export type StatementKind =
  /** Önceki dönemden devreden bakiye (tarih süzgeci varsa üretilir). */
  | 'opening'
  /** Kayıt peşinatı — satış günü doğan borç. */
  | 'deposit'
  /** Peşin satış ya da plan dışı bakiye — satış günü doğan borç. */
  | 'sale'
  /** Vadesi GELMİŞ taksit. */
  | 'installment'
  /** Vadesi GELMEMİŞ taksit (ileri tarihli). */
  | 'installmentFuture'
  /** Müşteriden alınan para. */
  | 'collection'
  /** Müşteriye geri ödenen para. */
  | 'refund'
  /** İptal edilen satıştan kurumda kalan tutar (hizmet bedeli). */
  | 'cancelled'

/**
 * İşlem türü sütununun yazımı. TEK KAYNAK: örnek ekstredeki "Fatura" yerine sektöre uygun
 * "Taksit" kullanılıyor; kullanıcı birebir aynı sözcüğü isterse burada tek satır değişir.
 */
export const STATEMENT_TYPE_LABEL: Record<StatementKind, string> = {
  opening: 'Devir',
  deposit: 'Peşinat',
  sale: 'Satış',
  installment: 'Taksit',
  installmentFuture: 'Taksit (Vade)',
  collection: 'Tahsilat',
  refund: 'İade',
  cancelled: 'Satış (İptal)',
}

/**
 * AYNI GÜN İÇİ SIRA. Satış günü hem peşinat borcu hem onun tahsilatı düşer; borç önce yazılmazsa
 * bakiye sütunu önce eksiye düşüp sonra sıfırlanır (örnek ekstredeki sıra: Peşinat → Tahsilat).
 */
const KIND_RANK: Record<StatementKind, number> = {
  opening: -1,
  deposit: 0,
  sale: 0,
  cancelled: 0,
  installment: 1,
  installmentFuture: 1,
  collection: 2,
  refund: 3,
}

export interface StatementRow {
  /** `YYYY-MM-DD` — yerel gün (tahsilat) ya da takvim vadesi (taksit). */
  date: string
  kind: StatementKind
  /** İşlem türü sütunu (STATEMENT_TYPE_LABEL). */
  type: string
  /** Açıklama sütunu: taksit no / satış adı / ödeme yöntemi / belge no. */
  description: string
  debit: number
  credit: number
  /** Bu satırdan SONRAKİ yürüyen bakiye (borç pozitif). */
  balance: number
  /** Satırın bağlı olduğu cari (satış) — arşiv satırlarında boş. */
  accountId: string
  /** Taksit numarası (varsa) — aynı gün içi kararlı sıra için. */
  installmentNo: number | null
}

export interface AccountStatement {
  /** Gösterilen dönemin satırları (varsa Devir satırı başta). */
  rows: StatementRow[]
  /** Dönem başı devir bakiyesi (süzgeç yoksa 0). */
  opening: number
  /** Gösterilen satırların borç toplamı (devir hariç). */
  totalDebit: number
  /** Gösterilen satırların alacak toplamı. */
  totalCredit: number
  /** Kapanış bakiyesi: `opening + totalDebit − totalCredit`. Pozitif = müşteri borçlu. */
  closing: number
  /** SÜZGEÇSİZ net bakiye — mutabakat kontrolü bunu kullanır. */
  netAll: number
  /** Tüm hareketlerin ilk/son tarihi (belge başlığındaki "Tarih Aralığı"). */
  firstDate: string | null
  lastDate: string | null
  /** Süzgeçten önceki toplam hareket adedi. */
  totalCount: number
  /**
   * Sunucunun cari BAŞINA sıfırla sınırladığı kalan borç (`group.remainingAmount`) ile belgenin
   * net bakiyesi arasındaki fark. Bir satışta fazla ödeme (kredi bakiyesi) varsa oluşur:
   * belge NET yazar (yürüyen bakiye toplanabilir olmalı), KPI ise cari başına sıfırlar.
   */
  clampDifference: number
}

export interface StatementOptions {
  group: CustomerAccountGroup
  cancelledSales?: CancelledSale[]
  /** `YYYY-MM-DD` yerel bugün — vadesi gelmiş/gelmemiş taksit ayrımı bunu kullanır. */
  todayIso: string
  /** Dönem başlangıcı (dahil). Öncesi "Devir" satırında toplanır. */
  from?: string | null
  /** Dönem sonu (dahil). Sonrası belgeye girmez. */
  to?: string | null
}

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100
}

/**
 * Bir ANI yerel güne çevirir (`YYYY-MM-DD`). Düz tarih ("2026-09-01") olduğu gibi döner —
 * `new Date('2026-09-01')` UTC gece yarısı sayılır ve negatif ofsetli makinede bir gün geri kayar.
 */
export function localDay(value: string | null | undefined): string {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  const ms = Date.parse(raw)
  if (Number.isNaN(ms)) return raw.slice(0, 10)
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Taksit vadesi TAKVİM tarihidir — saat dilimi uygulanmaz (takvim sekmesiyle aynı kural). */
function planDay(value: string | null | undefined): string {
  return String(value || '').slice(0, 10)
}

type Draft = Omit<StatementRow, 'balance' | 'type'> & { seq: number }

/** Tutarın işaretine göre borç/alacak sütununa yazar (veri bozukluğunda ters kayıt üretmesin). */
function signedRow(base: Omit<Draft, 'debit' | 'credit'>, amount: number): Draft {
  const v = round2(amount)
  return { ...base, debit: v > 0 ? v : 0, credit: v < 0 ? -v : 0 }
}

/** Tahsilat satırının açıklaması: hangi satış · hangi yöntem · belge no. */
function collectionText(label: string, method: string, reference: string | null | undefined): string {
  const parts = [label, paymentMethodLabel(method)]
  const ref = String(reference || '').trim()
  if (ref) parts.push(`Belge: ${ref}`)
  return parts.join(' • ')
}

/**
 * Tek bir müşterinin BÜTÜN hareketlerini üretir (süzgeçsiz, kronolojik).
 *
 * Dışa açıktır ki test hem ham satırları hem süzülmüş belgeyi ayrı ayrı sabitleyebilsin.
 */
export function buildStatementRows(
  group: CustomerAccountGroup,
  cancelledSales: CancelledSale[],
  todayIso: string,
): Omit<StatementRow, 'balance'>[] {
  const drafts: Draft[] = []
  const today = todayIso.slice(0, 10)
  let seq = 0

  for (const account of group.accounts) {
    const label = account.servicePackageName || account.name || 'Satış'
    const soldDay = localDay(account.soldAtUtc || account.createdAtUtc)
    const accountId = account.id

    // --- BORÇ: peşinat + taksitler + plan dışı bakiye = TotalAmount ---
    const deposit = round2(account.depositAmount)
    if (deposit > 0.005) {
      drafts.push({
        seq: seq++, date: soldDay, kind: 'deposit', accountId, installmentNo: null,
        description: `Kayıt peşinatı • ${label}`, debit: deposit, credit: 0,
      })
    }

    const insts = activeInstallments(account)
      .slice()
      .sort((a, b) => planDay(a.dueDate).localeCompare(planDay(b.dueDate)) || a.no - b.no)

    let planned = deposit
    for (const inst of insts) {
      const due = planDay(inst.dueDate)
      planned = round2(planned + inst.amount)
      drafts.push({
        seq: seq++,
        date: due,
        // Vadesi gelen taksit tahakkuk etmiş borçtur; gelmemiş olan plan satırıdır. Ayrım
        // örnek ekstredeki "Fatura ↔ Taksit (Vade)" ayrımının sektöre uyarlanmış hâlidir.
        kind: due !== '' && due <= today ? 'installment' : 'installmentFuture',
        accountId,
        installmentNo: inst.no,
        description: `${inst.no}. Taksit • ${label}`,
        debit: round2(inst.amount),
        credit: 0,
      })
    }

    // PLAN DIŞI BAKİYE: peşin satışta taksit yoktur (tamamı buraya düşer); taksitli satışta ise
    // İPTAL EDİLMİŞ taksit varsa plan toplamı satış tutarının altında kalır. Sunucu borcu yine
    // `Total − Paid` sayar, bu yüzden fark satırı YAZILMALI — yoksa belge sunucudan az borç yazar.
    const residual = round2(account.totalAmount - planned)
    if (Math.abs(residual) > 0.005) {
      drafts.push(signedRow({
        seq: seq++, date: soldDay, kind: 'sale', accountId, installmentNo: null,
        description: insts.length > 0 ? `${label} • plan dışı bakiye` : label,
      }, residual))
    }

    // --- ALACAK: tahsilatlar ---
    let paymentSum = 0
    let lastPaymentDay = ''
    for (const payment of account.payments || []) {
      const day = localDay(payment.occurredAtUtc)
      paymentSum = round2(paymentSum + payment.amount)
      if (day > lastPaymentDay) lastPaymentDay = day
      drafts.push({
        seq: seq++, date: day, kind: 'collection', accountId, installmentNo: null,
        description: collectionText(label, payment.method, payment.reference),
        debit: 0, credit: round2(payment.amount),
      })
    }

    /**
     * SAPMA SATIRI. Sunucuda `PaidAmount = Σödeme − RefundedAmount`, ama canlı cari DTO'su
     * `RefundedAmount` alanını TAŞIMAZ (yalnız iptal arşivi taşır). İptali geri alınan bir satışta
     * korunan iade cariye işlenir; o satışta ödeme satırlarının toplamı `paidAmount`'tan büyük olur.
     * Fark yazılmazsa belge tahsilatı fazla, borcu eksik gösterir. Tarihi bilinmediği için son
     * ödeme gününe yazılır — tutar doğru olsun, gün en yakın gerçeğe otursun.
     */
    const drift = round2(paymentSum - account.paidAmount)
    if (Math.abs(drift) > 0.005) {
      drafts.push(signedRow({
        seq: seq++,
        date: lastPaymentDay || soldDay,
        kind: drift > 0 ? 'refund' : 'collection',
        accountId,
        installmentNo: null,
        description: drift > 0 ? `${label} • iade edilen tutar` : `${label} • ${paymentMethodLabel('')}`,
      }, drift))
    }
  }

  // --- İPTAL ARŞİVİ: para gerçek, borç sıfır ---
  for (const sale of cancelledSales) {
    const label = sale.name || 'Satış'
    const soldDay = localDay(sale.soldAtUtc || sale.cancelledAtUtc)
    const cancelDay = localDay(sale.cancelledAtUtc || sale.soldAtUtc)

    let collected = 0
    if (sale.payments.length > 0) {
      for (const payment of sale.payments) {
        collected = round2(collected + payment.amount)
        drafts.push({
          seq: seq++, date: localDay(payment.occurredAtUtc), kind: 'collection', accountId: '',
          installmentNo: null,
          description: collectionText(`${label} · İPTAL`, payment.method, payment.reference),
          debit: 0, credit: round2(payment.amount),
        })
      }
    } else if (sale.collectedAmount > 0.005) {
      // Eski arşiv kaydı: tahsilat kopyası yok, yöntem GERÇEKTEN bilinmiyor — uydurulmaz.
      collected = round2(sale.collectedAmount)
      drafts.push({
        seq: seq++, date: soldDay || cancelDay, kind: 'collection', accountId: '',
        installmentNo: null,
        description: collectionText(`${label} · İPTAL`, '', null),
        debit: 0, credit: collected,
      })
    }

    let refunded = 0
    if (sale.refunds.length > 0) {
      for (const refund of sale.refunds) {
        refunded = round2(refunded + refund.amount)
        drafts.push({
          seq: seq++, date: localDay(refund.refundedAtUtc), kind: 'refund', accountId: '',
          installmentNo: null,
          description: collectionText(`${label} · İADE`, refund.method, refund.reference),
          debit: round2(refund.amount), credit: 0,
        })
      }
    } else if (sale.refundedAmount > 0.005) {
      refunded = round2(sale.refundedAmount)
      drafts.push({
        seq: seq++, date: cancelDay, kind: 'refund', accountId: '', installmentNo: null,
        description: collectionText(`${label} · İADE`, '', null),
        debit: refunded, credit: 0,
      })
    }

    /**
     * KAPATMA SATIRI — iptal edilen satış bakiyeye ETKİ ETMEZ. "Kurumda kalan" arşiv skalerinden
     * (`retainedAmount`) değil, YAZILAN SATIRLARDAN türetilir: arşiv toplamı ile satır kopyaları
     * ayrışırsa (eski kayıtlar) belge kendi içinde çelişir, yürüyen bakiye sıfıra kapanmazdı.
     */
    const retained = round2(collected - refunded)
    if (Math.abs(retained) > 0.005) {
      // Satış gününe yazılır; aynı gün düşen tahsilatlardan ÖNCE gelmesini KIND_RANK sağlar.
      drafts.push(signedRow({
        seq: seq++, date: soldDay || cancelDay, kind: 'cancelled', accountId: '', installmentNo: null,
        description: `${label} • iptal edildi, kurumda kalan tutar`,
      }, retained))
    }
  }

  drafts.sort((a, b) =>
    // Tarihsiz satır EN BAŞA (bkz. buildGlobalDueQueue): gizlenen satır, görülmeyen borç demek.
    a.date.localeCompare(b.date)
    || KIND_RANK[a.kind] - KIND_RANK[b.kind]
    || (a.installmentNo ?? 0) - (b.installmentNo ?? 0)
    || a.seq - b.seq)

  return drafts.map((row) => ({
    date: row.date,
    kind: row.kind,
    type: STATEMENT_TYPE_LABEL[row.kind],
    description: row.description,
    debit: row.debit,
    credit: row.credit,
    accountId: row.accountId,
    installmentNo: row.installmentNo,
  }))
}

/**
 * Belgeyi kurar: süzgeç uygular, devir satırını üretir, yürüyen bakiyeyi yazar.
 *
 * Mutabakat: süzgeçsiz `netAll`, canlı satışların `Σ(totalAmount − paidAmount)` toplamına eşittir
 * (iptaller sıfıra kapanır). Test bunu sabitler.
 */
export function buildAccountStatement(options: StatementOptions): AccountStatement {
  const { group, cancelledSales = [], todayIso } = options
  const from = (options.from || '').slice(0, 10)
  const to = (options.to || '').slice(0, 10)
  const all = buildStatementRows(group, cancelledSales, todayIso)

  let netAll = 0
  for (const row of all) netAll = round2(netAll + row.debit - row.credit)

  // Dönem başı devir: süzgeçten ÖNCEKİ satırların neti. Devirsiz süzülmüş ekstre, bakiye
  // sütununda YANLIŞ rakam yazar — belge basılıp müşteriye verildiği için kabul edilemez.
  let opening = 0
  const visible: Omit<StatementRow, 'balance'>[] = []
  for (const row of all) {
    if (from && row.date !== '' && row.date < from) {
      opening = round2(opening + row.debit - row.credit)
      continue
    }
    if (to && row.date !== '' && row.date > to) continue
    visible.push(row)
  }

  const rows: StatementRow[] = []
  let balance = opening
  if (from && Math.abs(opening) > 0.005) {
    rows.push({
      date: from,
      kind: 'opening',
      type: STATEMENT_TYPE_LABEL.opening,
      description: 'Önceki dönemden devreden bakiye',
      debit: opening > 0 ? opening : 0,
      credit: opening < 0 ? -opening : 0,
      balance: opening,
      accountId: '',
      installmentNo: null,
    })
  }

  let totalDebit = 0
  let totalCredit = 0
  for (const row of visible) {
    balance = round2(balance + row.debit - row.credit)
    totalDebit = round2(totalDebit + row.debit)
    totalCredit = round2(totalCredit + row.credit)
    rows.push({ ...row, balance })
  }

  const dated = all.map((r) => r.date).filter((d) => d !== '').sort()

  return {
    rows,
    opening,
    totalDebit,
    totalCredit,
    closing: balance,
    netAll,
    firstDate: dated[0] ?? null,
    lastDate: dated[dated.length - 1] ?? null,
    totalCount: all.length,
    clampDifference: round2(group.remainingAmount - netAll),
  }
}

// ---------------------------------------------------------------------------
// TUTARIN YAZIYLA OKUNUŞU
// ---------------------------------------------------------------------------

const ONES = ['', 'Bir', 'İki', 'Üç', 'Dört', 'Beş', 'Altı', 'Yedi', 'Sekiz', 'Dokuz']
const TENS = ['', 'On', 'Yirmi', 'Otuz', 'Kırk', 'Elli', 'Altmış', 'Yetmiş', 'Seksen', 'Doksan']
const SCALES = ['', 'Bin', 'Milyon', 'Milyar', 'Trilyon']

function tripletToWords(value: number): string {
  const hundreds = Math.floor(value / 100)
  const tens = Math.floor((value % 100) / 10)
  const ones = value % 10
  let out = ''
  // "BirYüz" denmez: 100 → "Yüz", 200 → "İkiYüz".
  if (hundreds > 0) out += (hundreds === 1 ? '' : ONES[hundreds]) + 'Yüz'
  if (tens > 0) out += TENS[tens]
  if (ones > 0) out += ONES[ones]
  return out
}

/** Tam sayının Türkçe okunuşu ("430000" → "DörtYüzOtuzBin"). Ekstre alt satırı bunu kullanır. */
export function turkishNumberToWords(value: number): string {
  const n = Math.floor(Math.abs(Number(value) || 0))
  if (n === 0) return 'Sıfır'
  if (!Number.isFinite(n) || n >= 1e15) return ''

  const groups: number[] = []
  let rest = n
  while (rest > 0) {
    groups.push(rest % 1000)
    rest = Math.floor(rest / 1000)
  }

  let out = ''
  for (let i = groups.length - 1; i >= 0; i -= 1) {
    const g = groups[i]
    if (g === 0) continue
    // "BirBin" denmez: 1000 → "Bin", 2000 → "İkiBin". Milyon/milyar için istisna YOKTUR.
    if (i === 1 && g === 1) out += 'Bin'
    else out += tripletToWords(g) + SCALES[i]
  }
  return out
}

/** "Yalnız …" satırı: 430000 → "DörtYüzOtuzBin TL", 12,45 → "Onİki TL KırkBeş Kr". */
export function turkishAmountInWords(amount: number): string {
  const value = round2(amount)
  const abs = Math.abs(value)
  const lira = Math.floor(abs + 1e-9)
  const kurus = Math.round((abs - lira) * 100)
  const words = turkishNumberToWords(lira)
  if (!words) return ''
  let out = `${words} TL`
  if (kurus > 0) out += ` ${turkishNumberToWords(kurus)} Kr`
  return value < 0 ? `Eksi ${out}` : out
}

// ---------------------------------------------------------------------------
// BELGE KİMLİĞİ / BİÇİMLENDİRME
// ---------------------------------------------------------------------------

/**
 * Cari kodu — belgede müşteriyi kimliklendiren kısa kod. Veritabanında böyle bir alan YOK, bu
 * yüzden müşterinin kendi kimliğinden TÜRETİLİR: aynı müşteri her belgede aynı kodu alır,
 * iki müşteri aynı kodu almaz. Uydurma bir sayaç kullanılsaydı belgeler arası tutarsız olurdu.
 */
export function cariCode(customerId: string | null | undefined): string {
  const hex = String(customerId || '').replace(/[^0-9a-fA-F]/g, '')
  if (!hex) return 'CR-000000'
  return `CR-${hex.slice(0, 6).toUpperCase()}`
}

/** Ekstre tablosunun sayı biçimi: "150.000,00" — para birimi sütun başlığında yazar. */
export function formatAmount(value: number | null | undefined): string {
  return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(Number(value) || 0)
}

/** "2026-06-18" → "18.06.2026" (belge tarih biçimi). */
export function formatDocDate(iso: string | null | undefined): string {
  const [y, m, d] = String(iso || '').slice(0, 10).split('-')
  return y && m && d ? `${d}.${m}.${y}` : '—'
}

/** "11.08.2026 17:30" — düzenleme tarihi. */
export function formatDocDateTime(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(date.getDate())}.${p(date.getMonth() + 1)}.${date.getFullYear()} ${p(date.getHours())}:${p(date.getMinutes())}`
}
