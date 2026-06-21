'use client'

import { useFeature } from '@/components/dashboard/FeatureContext'
import type { NotificationTemplate, NotificationTriggerKey } from '@/lib/types'
import { BellRing, CalendarClock, Cake, CreditCard, Power, PowerOff, Zap } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

const AUTO_TRIGGERS: { key: NotificationTriggerKey; label: string; desc: string; icon: LucideIcon }[] = [
  { key: 'AppointmentReminder', label: 'Randevu hatırlatma', desc: 'Randevudan 24 saat önce', icon: CalendarClock },
  { key: 'BirthdayGreeting', label: 'Doğum günü', desc: 'Müşterinin doğum gününde', icon: Cake },
  { key: 'PaymentDue', label: 'Ödeme hatırlatma', desc: 'Vadesi geçen taksitlerde', icon: CreditCard },
]

/**
 * Otomatik bildirim durumu (2A). Arka plan servisi (~15 dk) aktif şablonları tetikleyiciye göre
 * otomatik gönderir. Bir tetikleyicinin "açık" olması = o tetikleyiciye ait en az bir AKTİF şablon
 * olması. marketing/notifications.automation paketinde değilse gizlenir.
 */
export default function AutomationStatusPanel({ templates }: { templates: NotificationTemplate[] }) {
  const canAutomation = useFeature('notifications.automation')
  if (!canAutomation) return null

  return (
    <div className="rounded-[20px] border border-[#ead8df]/70 bg-white/86 p-5 shadow-[0_18px_42px_-34px_rgba(150,78,104,0.42)]">
      <div className="mb-1 flex items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-[#c85776]/80">
        <Zap className="h-4 w-4" /> Otomatik gönderim
      </div>
      <p className="mb-4 text-[12px] leading-relaxed text-[#352432]/55">
        İlgili tetikleyiciye <b>Aktif</b> bir şablon eklediğinde, sistem arka planda (~15 dk'da bir tarar)
        uygun müşterilere otomatik gönderir. Aynı kişiye gün içinde tekrar gönderilmez.
      </p>

      <div className="grid gap-2.5 sm:grid-cols-3">
        {AUTO_TRIGGERS.map((trigger) => {
          const active = templates.filter((t) => t.trigger === trigger.key && t.status === 'Active')
          const isOn = active.length > 0
          const Icon = trigger.icon
          const channels = Array.from(new Set(active.map((t) => t.channelLabel))).join(', ')
          return (
            <div
              key={trigger.key}
              className={`rounded-[16px] border p-3.5 transition-colors ${
                isOn ? 'border-emerald-300/45 bg-emerald-50/60' : 'border-[#ead8df]/70 bg-[#fffafc]'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`grid h-9 w-9 place-items-center rounded-[10px] ${isOn ? 'bg-emerald-100 text-emerald-700' : 'bg-[#fff1f6] text-[#c85776]'}`}>
                  <Icon className="h-4 w-4" />
                </span>
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-mono uppercase tracking-wide ${
                  isOn ? 'bg-emerald-100 text-emerald-700' : 'bg-[#f0e0e6] text-[#352432]/45'
                }`}>
                  {isOn ? <Power className="h-3 w-3" /> : <PowerOff className="h-3 w-3" />}
                  {isOn ? 'Açık' : 'Kapalı'}
                </span>
              </div>
              <div className="mt-2.5 text-[13px] font-medium text-[#352432]">{trigger.label}</div>
              <div className="text-[10px] text-[#352432]/45">{trigger.desc}</div>
              <div className="mt-2 flex items-center gap-1 text-[10px] font-mono text-[#352432]/50">
                <BellRing className="h-3 w-3" />
                {isOn ? `${active.length} aktif şablon · ${channels}` : 'Aktif şablon yok'}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
