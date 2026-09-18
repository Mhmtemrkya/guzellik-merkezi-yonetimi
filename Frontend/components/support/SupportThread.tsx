'use client'

import type { ReactNode } from 'react'
import { Bot, Building2, Headset, UserRound } from 'lucide-react'
import {
  supportCategoryLabel, supportPriorityLabel, supportStatusLabel, supportStatusTone,
  type SupportMessage, type SupportPriority, type SupportStatus, type SupportTicketDetail,
} from '@/lib/supportApi'

/**
 * YAZIŞMA GÖRÜNÜMÜ — destek talebindeki mesaj akışı.
 *
 * <p>
 * Üç yerde birden kullanılır: ziyaretçinin takip ekranı, kurum panelindeki talep ayrıntısı ve
 * platform kuyruğundaki ayrıntı. Tek bileşen olmasının sebebi görsel tutarlılık değil ANLAM
 * tutarlılığıdır: "kim yazdı" ve "ne zaman" aynı kurala göre okunmalı; üç kopya, üçünde farklı
 * yorumlanan bir yazışma demekti.
 * </p>
 *
 * <p>
 * <b>TARAF, ROLDEN OKUNMAZ.</b> Sunucu her mesajda <c>side</c> gönderir (talep sahibi /
 * platform / sistem). Kullanıcı kurumdan ayrılmış, hesabı kapanmış ya da talep hiç oturum
 * açmamış bir ziyaretçiden gelmiş olabilir; mesajın hangi taraftan geldiği bunların hiçbirine
 * bağlı olmamalıdır.
 * </p>
 *
 * <p>
 * <b>SİSTEM NOTU BALON DEĞİLDİR.</b> Durum/öncelik değişiklikleri ortada, sessiz bir satır
 * olarak görünür: onları konuşma balonu yapmak, kimsenin yazmadığı bir cümleyi birinin
 * söylediği izlenimi verirdi.
 * </p>
 */

/** Durum rozeti renkleri — tek yerde; rozet üç ekranda da aynı anlamı taşır. */
const TONES: Record<string, string> = {
  amber: 'border-amber-200 bg-amber-50 text-amber-800',
  sky: 'border-sky-200 bg-sky-50 text-sky-800',
  violet: 'border-violet-200 bg-violet-50 text-violet-800',
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  slate: 'border-slate-200 bg-slate-100 text-slate-700',
}

export function SupportStatusBadge({ status }: { status: SupportStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${TONES[supportStatusTone[status]]}`}>
      {supportStatusLabel[status]}
    </span>
  )
}

export function SupportPriorityBadge({ priority }: { priority: SupportPriority }) {
  // Yalnız NORMAL ÜSTÜ öncelikler rozet alır: her satıra "Normal" yazmak, gözün gerçekten
  // acil olanı ayırt etmesini zorlaştırırdı.
  if (priority < 2) return null
  const cls = priority === 3
    ? 'border-rose-300 bg-rose-50 text-rose-700'
    : 'border-orange-200 bg-orange-50 text-orange-700'
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${cls}`}>
      {supportPriorityLabel[priority]}
    </span>
  )
}

/** Talep başlığı — kod, konu, rozetler ve künye satırı. */
export function SupportTicketHeader({
  ticket,
  extra,
}: {
  ticket: SupportTicketDetail
  /** Sağ tarafa eklenen işlem düğmeleri (platform panelinde durum/öncelik seçicileri). */
  extra?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#EEDCE4] pb-5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[12px] font-bold tracking-[0.04em] text-[#C85776]">{ticket.code}</span>
          <SupportStatusBadge status={ticket.status} />
          <SupportPriorityBadge priority={ticket.priority} />
          <span className="inline-flex items-center rounded-full border border-[#EEDCE4] bg-white px-2.5 py-1 text-[11px] font-medium text-[#7B6470]">
            {supportCategoryLabel[ticket.category]}
          </span>
        </div>
        <h2 className="mt-2.5 text-[19px] font-semibold tracking-[-0.02em] text-[#352432]">{ticket.subject}</h2>
        <p className="mt-1.5 text-[12.5px] text-[#7B6470]">
          {ticket.requesterName}
          {ticket.tenantName && (
            <>
              {' · '}
              <span className="inline-flex items-center gap-1">
                <Building2 className="h-3 w-3" /> {ticket.tenantName}
              </span>
            </>
          )}
          {' · '}
          {formatDateTime(ticket.createdAtUtc)} tarihinde açıldı
        </p>
      </div>
      {extra && <div className="shrink-0">{extra}</div>}
    </div>
  )
}

/** Mesaj akışı — eskiden yeniye. */
export function SupportThread({ messages }: { messages: SupportMessage[] }) {
  return (
    <ol className="space-y-4">
      {messages.map((m) => (
        <li key={m.id}>{m.side === 2 ? <SystemNote message={m} /> : <Bubble message={m} />}</li>
      ))}
    </ol>
  )
}

function Bubble({ message }: { message: SupportMessage }) {
  const fromPlatform = message.side === 1
  return (
    <div className={`flex gap-3 ${fromPlatform ? '' : 'flex-row-reverse'}`}>
      <span
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border text-[13px] ${
          fromPlatform ? 'border-[#EFBFD0] bg-[#FFF0F5] text-[#C85776]' : 'border-[#E4E4E7] bg-white text-[#6B5661]'
        }`}
      >
        {fromPlatform ? <Headset className="h-4 w-4" strokeWidth={1.8} /> : <UserRound className="h-4 w-4" strokeWidth={1.8} />}
      </span>
      <div className={`min-w-0 max-w-[85%] ${fromPlatform ? '' : 'text-right'}`}>
        <div className="text-[11.5px] font-semibold text-[#7B6470]">
          {fromPlatform ? message.authorName || 'BeautyAsist Destek' : message.authorName || 'Siz'}
          <span className="ml-2 font-normal text-[#A9919E]">{formatDateTime(message.sentAtUtc)}</span>
        </div>
        {/* whitespace-pre-wrap: kullanıcı satır atlamalarıyla yazıyor ve o biçim korunmalı.
            İçerik METİN olarak basılır (dangerouslySetInnerHTML YOK) — mesaj gövdesi kullanıcı
            girdisidir ve HTML olarak yorumlanması XSS demekti. */}
        <div
          className={`mt-1.5 inline-block whitespace-pre-wrap rounded-2xl px-4 py-3 text-left text-[13.5px] leading-relaxed ${
            fromPlatform
              ? 'border border-[#EFBFD0]/70 bg-[#FFF7FA] text-[#352432]'
              : 'border border-[#E8E8EC] bg-white text-[#352432]'
          }`}
        >
          {message.body}
        </div>
      </div>
    </div>
  )
}

function SystemNote({ message }: { message: SupportMessage }) {
  return (
    <div className="flex items-center gap-2 py-1 text-[11.5px] text-[#9A8593]">
      <span aria-hidden className="h-px flex-1 bg-[#F0E3E9]" />
      <Bot className="h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
      <span className="shrink-0">
        {message.body}
        <span className="ml-1.5 opacity-70">{formatDateTime(message.sentAtUtc)}</span>
      </span>
      <span aria-hidden className="h-px flex-1 bg-[#F0E3E9]" />
    </div>
  )
}

/** Sunucudan UTC gelir; kullanıcıya YEREL saat gösterilir. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
