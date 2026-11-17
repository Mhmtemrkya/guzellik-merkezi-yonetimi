'use client'

import { Smartphone, ShieldCheck, Radio, Clock3 } from 'lucide-react'
import { useApiQuery } from '@/hooks/useApiQuery'
import { adminApi } from '@/lib/apiClient'
import type { ApiSmsConnection } from '@/lib/types'
import { SmsStatusBadge } from '@/components/dashboard/SmsConnectionForm'

/**
 * SMS GÖNDERİCİ HESABI — kurumun gördüğü SALT-OKUNUR durum (Ayarlar'da WhatsApp kartının altında).
 *
 * Bağlantıyı BeautyAsist (platform) kurar: kurum sahibinin API parolası, IP izni, başlık onayı gibi
 * teknik işlerle uğraşmaması için (WhatsApp bağlantısıyla aynı model). Kurum burada yalnız SMS'lerin
 * kendi başlığıyla mı yoksa BeautyAsist altyapısından mı gittiğini görür.
 */
export default function SmsConnectionCard({ tenantId }: { tenantId?: string }) {
  const { data, loading } = useApiQuery<ApiSmsConnection>(
    () => adminApi.smsConnection<ApiSmsConnection>(tenantId),
    [tenantId],
  )

  const active = Boolean(data?.active)
  // Kayıt var ama henüz doğrulanmadı/kapalı: BeautyAsist kurulumu sürdürüyor.
  const settingUp = Boolean(data && !active && data.status !== 'NotConnected' && data.status !== 'Disabled')

  return (
    <div className="rounded-[20px] border border-[#EAD8DF] bg-white/85 p-5 shadow-[0_18px_50px_-40px_rgba(142,63,91,0.5)]">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-700"><Smartphone className="h-4.5 w-4.5" /></span>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-[#2A2027]">SMS Gönderici Hesabı</div>
            <div className="text-[10.5px] text-[#74616A]">Müşterilerinize giden SMS&apos;lerin başlığı</div>
          </div>
        </div>
        {/* Kuruma teknik ara durumlar (test bekliyor / başarısız) gösterilmez: kurulum BeautyAsist'te. */}
        <SmsStatusBadge status={active ? 'Connected' : 'NotConnected'} />
      </div>

      {loading && !data ? (
        <div className="py-4 text-center text-[11px] text-[#74616A]">Yükleniyor…</div>
      ) : (
        <div className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 ${active ? 'border-emerald-200 bg-emerald-50/60' : 'border-[#cfe0ea] bg-[#f2f8fc]'}`}>
          <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${active ? 'bg-emerald-100 text-emerald-600' : 'bg-[#e0eef7] text-[#4a80a6]'}`}>
            {active ? <ShieldCheck className="h-3.5 w-3.5" /> : settingUp ? <Clock3 className="h-3.5 w-3.5" /> : <Radio className="h-3.5 w-3.5" />}
          </span>
          <div className="min-w-0 text-[11px] leading-relaxed text-[#39525f]">
            {active ? (
              <>
                <b className="text-emerald-700">SMS&apos;leriniz kendi başlığınızla gidiyor:</b>{' '}
                <span className="font-mono font-semibold">{data?.sender}</span> ({data?.provider}).
                {' '}Paket kotanız ve mesaj krediniz düşmez; ücreti SMS sağlayıcınız keser.
                Bağlantı ve teknik kurulum <b>BeautyAsist</b> tarafından yönetilir.
              </>
            ) : settingUp ? (
              <>
                <b>SMS hesabınız BeautyAsist tarafından bağlanıyor.</b> Kurulum tamamlanana kadar SMS&apos;ler
                BeautyAsist altyapısından gider (önce paket kotası, sonra mesaj kredisi).
              </>
            ) : (
              <>
                SMS&apos;ler <b>BeautyAsist altyapısından</b> gider (önce paket kotası, sonra mesaj kredisi).
                Müşterilerinize <b>kendi başlığınızla</b> (ör. salonunuzun adıyla) SMS göndermek isterseniz
                <b> BeautyAsist destek ekibiyle</b> iletişime geçin — hesabınızı biz bağlıyoruz.
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
