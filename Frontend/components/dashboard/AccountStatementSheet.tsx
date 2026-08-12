'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CalendarRange, Download, Printer, RotateCcw } from 'lucide-react'
import {
  buildAccountStatement, cariCode, formatAmount, formatDocDate, formatDocDateTime,
  turkishAmountInWords, type StatementRow,
} from '@/lib/accountStatement'
import type { CustomerAccountGroup } from '@/lib/accountGrouping'
import type { CancelledSale } from '@/lib/types'

/**
 * CARİ HESAP EKSTRESİ — ekrandaki BELGE.
 *
 * Tahsilat listesi değil, çift taraflı hesap özetidir: satışın doğurduğu borç (peşinat, taksitler),
 * müşterinin ödediği alacak ve her satırdan sonraki yürüyen bakiye. Basılıp müşteriye verilebilsin
 * diye ekranda da A4 sayfası gibi durur; PDF çıktısı bununla BİREBİR aynı düzeni kullanır
 * (rakamlar tek hesaplayıcıdan gelir: `buildAccountStatement`).
 *
 * NOT — bu bileşen ModalPortal içindeki bir modalde yaşıyor: globals.css'teki okunabilirlik
 * düzeltmesi portala UYGULANMAZ, bu yüzden renkler doğrudan hex ve punto ≥10px yazılır.
 */

export interface StatementInstitution {
  name: string
  phone?: string | null
  email?: string | null
  taxNumber?: string | null
  taxOffice?: string | null
  /** Seçili şube adı — belgenin hangi şubeden düzenlendiğini yazar. */
  branch?: string | null
}

/**
 * HENÜZ CARİYE İŞLENMEMİŞ SATIŞ (açık adisyon).
 *
 * Peşinatsız paket/hizmet satışı cari kartı AÇMAZ: fiş açık kalır ve müşteri ilk randevusunu
 * tamamlayınca otomatik işlenir (bkz. `autoApproveOnFirstAppointment`). O ana kadar ortada bir
 * borç kaydı YOKTUR, dolayısıyla ekstre satırı da olamaz — ama kullanıcı "paketi sattım, neden
 * ekstrede yok" diye haklı olarak sorar. Bu yüzden belgenin ÜSTÜNDE (bakiyeye karışmadan)
 * bir bilgi şeridi olarak gösterilir.
 */
export interface PendingSaleNotice {
  id: string
  /** Fiş tutarı. */
  amount: number
  openedAtUtc: string
}

/** İşlem türüne göre metin rengi: para girişi yeşil, çıkış/iptal kırmızı, borç satırları nötr. */
function typeTone(row: StatementRow): string {
  if (row.kind === 'collection') return '#15694A'
  if (row.kind === 'refund' || row.kind === 'cancelled') return '#9F1239'
  if (row.kind === 'opening') return '#1E4E8C'
  return '#4a3a44'
}

export default function AccountStatementSheet({
  group,
  cancelledSales,
  institution,
  todayIso,
  pendingSales = [],
}: {
  group: CustomerAccountGroup
  cancelledSales: CancelledSale[]
  institution: StatementInstitution
  todayIso: string
  /** Cariye henüz işlenmemiş açık fişler — belgeye girmez, üstte uyarı olarak görünür. */
  pendingSales?: PendingSaleNotice[]
}) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState<'print' | 'download' | null>(null)

  // Müşteri değişince dönem süzgeci sıfırlanır: bir öncekinin aralığı yeni müşteride
  // "hareket yok" gibi görünmesine yol açardı.
  useEffect(() => { setFrom(''); setTo('') }, [group.customerId])

  const doc = useMemo(
    () => buildAccountStatement({ group, cancelledSales, todayIso, from, to }),
    [group, cancelledSales, todayIso, from, to],
  )

  const code = cariCode(group.customerId)
  const filtered = Boolean(from || to)
  const periodLabel = filtered
    ? `${formatDocDate(from || doc.firstDate)} - ${formatDocDate(to || doc.lastDate)}`
    : doc.firstDate
      ? `${formatDocDate(doc.firstDate)} - ${formatDocDate(doc.lastDate)}`
      : '—'
  const issuedAt = formatDocDateTime(new Date())
  const closingDebt = doc.closing >= 0

  async function exportPdf(action: 'print' | 'download') {
    setBusy(action)
    try {
      // pdfmake ~1 MB: modal açılışını yavaşlatmasın diye yalnız tıklamada yüklenir.
      const { generateAccountStatementPdf } = await import('@/lib/statementPdf')
      generateAccountStatementPdf({
        institution: {
          name: institution.name,
          phone: institution.phone,
          email: institution.email,
          taxNumber: institution.taxNumber,
          taxOffice: institution.taxOffice,
          branch: institution.branch,
        },
        customer: {
          code,
          name: group.customerName,
          phone: group.customerPhone,
          saleCount: group.saleCount,
        },
        periodLabel,
        issuedAt,
        rows: doc.rows,
        totalDebit: doc.totalDebit,
        totalCredit: doc.totalCredit,
        closing: doc.closing,
      }, action)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-3">
      {/* ---------------- ARAÇ ÇUBUĞU (belgenin parçası değil) ---------------- */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-[14px] border border-[#EAD8DF] bg-white px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-[#A5556E]">
            <CalendarRange className="h-3.5 w-3.5" /> Dönem
          </span>
          <input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="Dönem başlangıcı"
            className="h-8 rounded-[9px] border border-[#EAD8DF] bg-white px-2 text-[11.5px] text-[#2A2027] outline-none focus:border-[#BE7690]"
          />
          <span className="text-[11.5px] text-[#74616A]">—</span>
          <input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
            aria-label="Dönem bitişi"
            className="h-8 rounded-[9px] border border-[#EAD8DF] bg-white px-2 text-[11.5px] text-[#2A2027] outline-none focus:border-[#BE7690]"
          />
          {filtered && (
            <button
              type="button"
              onClick={() => { setFrom(''); setTo('') }}
              className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[9px] border border-[#EAD8DF] bg-white px-2.5 text-[11.5px] font-semibold text-[#3E343A] transition-colors hover:border-[#BE7690]"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Tümü
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => exportPdf('print')}
            disabled={busy !== null}
            className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[9px] border border-[#EAD8DF] bg-white px-3 text-[11.5px] font-semibold text-[#3E343A] transition-colors hover:border-[#BE7690] disabled:cursor-wait disabled:opacity-70"
          >
            <Printer className="h-3.5 w-3.5" /> {busy === 'print' ? 'Hazırlanıyor…' : 'Yazdır'}
          </button>
          <button
            type="button"
            onClick={() => exportPdf('download')}
            disabled={busy !== null}
            className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[9px] bg-gradient-to-r from-[#A5556E] to-[#8C4460] px-3 text-[11.5px] font-semibold text-white transition-transform hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-70"
          >
            <Download className="h-3.5 w-3.5" /> {busy === 'download' ? 'Hazırlanıyor…' : 'PDF İndir'}
          </button>
        </div>
      </div>

      {/* BEKLEYEN SATIŞ: peşinatsız satış cari kartı açmaz, ilk randevu tamamlanınca işlenir.
          Belgeye satır olarak GİRMEZ (ortada henüz borç kaydı yok, yürüyen bakiye bozulurdu);
          ama "sattım, neden ekstrede yok" sorusu burada yanıtlanır. */}
      {pendingSales.length > 0 && (
        <div className="flex items-start gap-2 rounded-[12px] border border-[#bcd6f2] bg-[#f2f7fd] px-3 py-2 text-[11.5px] text-[#1E4E8C]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            <b>{pendingSales.length} satış cariye henüz işlenmedi</b> (toplam{' '}
            {formatAmount(pendingSales.reduce((s, p) => s + p.amount, 0))} TL). Peşinat alınmadığı
            için fiş açık: müşteri ilk randevusunu tamamlayınca peşinat ve taksitler bu ekstreye
            otomatik düşer. Hemen işlemek için Adisyon sekmesinden fişi onaylayın.
          </span>
        </div>
      )}

      {/* KREDİ BAKİYESİ UYARISI: belge NET bakiye yazar (yürüyen sütun toplanabilir olmalı),
          üstteki "Kalan Borç" KPI'ı ise cari BAŞINA sıfırlanır. İkisi ayrışıyorsa nedeni budur. */}
      {Math.abs(doc.clampDifference) > 0.5 && (
        <div className="flex items-start gap-2 rounded-[12px] border border-[#f6d9a8] bg-[#fff8ec] px-3 py-2 text-[11.5px] text-[#7a4a12]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Bir satışta <b>fazla ödeme</b> var: ekstre net bakiyeyi ({formatAmount(doc.closing)} TL) yazar,
            üstteki “Kalan Borç” kartı ise her satışı ayrı sayar (fark {formatAmount(Math.abs(doc.clampDifference))} TL).
          </span>
        </div>
      )}

      {/* ---------------- BELGE ---------------- */}
      {/* GENİŞLİK SINIRI YOK: belge, açıldığı kabın tamamını kullanır.
          Eskiden 940px ile ortalanıyordu ve geniş defter modalinde iki yanında büyük boşluk
          kalıyor, tablo gereksiz yere dar sıkışıyordu. Baskı/PDF bu HTML'den ÜRETİLMEZ
          (pdfmake kendi belgesini kurar, bkz. exportPdf) — dolayısıyla sınırın kaldırılması
          çıktı sadakatini etkilemez, yalnız ekranda okunabilir alanı büyütür. */}
      <article className="w-full rounded-[16px] border border-[#E7DCE2] bg-white p-4 shadow-[0_18px_48px_-38px_rgba(90,40,60,0.55)] sm:p-7">
        {/* Kurum başlığı */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-display text-[19px] leading-tight tracking-tight text-[#241C21]">
              {institution.name || 'Kurum'}
            </div>
            {institution.branch && (
              <div className="mt-0.5 text-[11px] text-[#7A6873]">{institution.branch}</div>
            )}
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[11.5px] font-bold uppercase tracking-wide text-[#241C21]">
              {(institution.name || 'Kurum').toLocaleUpperCase('tr')}
            </div>
            {institution.phone && <div className="mt-0.5 text-[10.5px] text-[#7A6873]">Tel: {institution.phone}</div>}
            {institution.email && <div className="text-[10.5px] text-[#7A6873]">{institution.email}</div>}
            {institution.taxNumber && (
              <div className="text-[10.5px] text-[#7A6873]">
                VKN: {institution.taxNumber}{institution.taxOffice ? ` · ${institution.taxOffice}` : ''}
              </div>
            )}
          </div>
        </div>
        <div className="mt-2.5 h-[1.6px] w-full rounded-full bg-[#A5556E]" />

        {/* Belge başlığı */}
        <h3 className="mt-5 text-center font-display text-[19px] tracking-[0.04em] text-[#241C21]">
          CARİ HESAP EKSTRESİ
        </h3>

        {/* Cari bilgileri */}
        <div className="mt-4 grid gap-x-8 gap-y-1 sm:grid-cols-2">
          <InfoRow label="Cari Kodu" value={code} />
          <InfoRow label="Tarih Aralığı" value={periodLabel} />
          <InfoRow label="Adı Soyadı" value={group.customerName} />
          <InfoRow label="Düzenleme Tarihi" value={issuedAt} />
          <InfoRow label="Telefon" value={group.customerPhone || '—'} />
          <InfoRow label="Para Birimi" value="TL" />
          <InfoRow label="Kayıtlı Satış" value={`${group.saleCount} satış`} />
        </div>

        {/* Hareketler */}
        <div className="mt-5 overflow-x-auto">
          {/* BEŞ SÜTUN: "İşlem Türü" ile "Açıklama" tek sütunda birleşti — detay parantez içinde
              yazılır ("Tahsilat (Nakit · 9-D)"). Metin `row.label`den gelir; iki sütunu burada
              yan yana basmak, ekran ile PDF'in ayrışmasına açık kapı bırakırdı. */}
          <table className="w-full min-w-[620px] border-collapse text-[12px]">
            <thead>
              <tr className="bg-[#F4EFF1] text-left text-[10.5px] font-bold uppercase tracking-[0.06em] text-[#241C21]">
                <th className="border-b-[1.6px] border-[#A5556E] px-2.5 py-2 font-bold">Tarih</th>
                <th className="border-b-[1.6px] border-[#A5556E] px-2.5 py-2 font-bold">İşlem Türü</th>
                <th className="border-b-[1.6px] border-[#A5556E] px-2.5 py-2 text-right font-bold">Borç (TL)</th>
                <th className="border-b-[1.6px] border-[#A5556E] px-2.5 py-2 text-right font-bold">Alacak (TL)</th>
                <th className="border-b-[1.6px] border-[#A5556E] px-2.5 py-2 text-right font-bold">Bakiye (TL)</th>
              </tr>
            </thead>
            <tbody>
              {doc.rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-2.5 py-10 text-center text-[12px] text-[#74616A]">
                    {filtered
                      ? 'Seçilen dönemde hareket bulunmuyor.'
                      : pendingSales.length > 0
                        ? 'Cariye işlenmiş hareket yok — yukarıdaki bekleyen satış onaylanınca satış borcu buraya düşer.'
                        : 'Bu müşteride henüz cari hareket yok. Satış yapıldığında borç, tahsilat aldıkça alacak satırı buraya düşer.'}
                  </td>
                </tr>
              )}
              {doc.rows.map((row, i) => (
                <tr key={`${row.date}-${row.kind}-${i}`} className={i % 2 === 1 ? 'bg-[#FBF8F9]' : undefined}>
                  <td className="whitespace-nowrap border-b border-[#EFE7EB] px-2.5 py-2 tabular-nums text-[#4a3a44]">
                    {formatDocDate(row.date)}
                  </td>
                  <td className="border-b border-[#EFE7EB] px-2.5 py-2 font-semibold" style={{ color: typeTone(row) }}>
                    {row.label}
                  </td>
                  <td className="whitespace-nowrap border-b border-[#EFE7EB] px-2.5 py-2 text-right tabular-nums text-[#241C21]">
                    {formatAmount(row.debit)}
                  </td>
                  <td className="whitespace-nowrap border-b border-[#EFE7EB] px-2.5 py-2 text-right tabular-nums text-[#241C21]">
                    {formatAmount(row.credit)}
                  </td>
                  <td className="whitespace-nowrap border-b border-[#EFE7EB] px-2.5 py-2 text-right font-semibold tabular-nums text-[#241C21]">
                    {formatAmount(row.balance)}
                  </td>
                </tr>
              ))}
            </tbody>
            {doc.rows.length > 0 && (
              <tfoot>
                <tr className="bg-[#F7F6F6] text-[12px] font-bold text-[#241C21]">
                  <td className="px-2.5 py-2.5" />
                  <td className="px-2.5 py-2.5 text-right">Toplam</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums">{formatAmount(doc.totalDebit)}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums">{formatAmount(doc.totalCredit)}</td>
                  <td className="px-2.5 py-2.5" />
                </tr>
                <tr className="bg-[#F7F6F6] text-[12px] font-bold text-[#241C21]">
                  <td className="px-2.5 pb-2.5" colSpan={3} />
                  <td className="px-2.5 pb-2.5 text-right">Bakiye</td>
                  <td
                    className="whitespace-nowrap px-2.5 pb-2.5 text-right font-display text-[15px] tabular-nums"
                    style={{ color: closingDebt ? '#9F1239' : '#15694A' }}
                  >
                    {formatAmount(Math.abs(doc.closing))} TL
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {/* Yazıyla + not */}
        <div className="mt-4 text-[12px] text-[#241C21]">
          <span className="text-[#7A6873]">Yalnız </span>
          <b>{turkishAmountInWords(Math.abs(doc.closing)) || '—'}</b>
          {!closingDebt && <span className="text-[#7A6873]"> (müşteri alacaklı)</span>}
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-[#EFE7EB] pt-2.5 text-[10.5px] text-[#7A6873]">
          <span>Not: Bu belge bilgilendirme amaçlıdır.</span>
          <span>
            {doc.rows.length} hareket
            {filtered && doc.totalCount !== doc.rows.length ? ` · toplam ${doc.totalCount} hareket içinden` : ''}
          </span>
        </div>
      </article>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2 text-[12px]">
      <span className="w-[104px] shrink-0 text-[#7A6873]">{label}</span>
      <span className="text-[#7A6873]">:</span>
      <span className="min-w-0 flex-1 truncate font-semibold text-[#241C21]">{value}</span>
    </div>
  )
}
