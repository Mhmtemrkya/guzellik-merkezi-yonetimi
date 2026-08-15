'use client'

import { motion } from 'framer-motion'
import { AlertTriangle, Loader2, ServerOff, type LucideIcon } from 'lucide-react'

interface ApiStateNoticeProps {
  loading?: boolean
  error?: string | null
  empty?: boolean
  emptyMessage?: string
  missingModule?: string | null
  className?: string
}

export default function ApiStateNotice({
  loading,
  error,
  empty,
  emptyMessage = 'Bu panel için backend kaydı bulunamadı.',
  missingModule,
  className = '',
}: ApiStateNoticeProps) {
  if (!loading && !error && !empty && !missingModule) return null

  const Icon: LucideIcon = loading ? Loader2 : error ? ServerOff : AlertTriangle
  const tone = loading ? 'loading' : error ? 'error' : missingModule ? 'pending' : 'empty'
  const toneClasses: Record<string, string> = {
    loading: 'border-[#BE7690] bg-[#F6DFE6]/82 text-[#4a3542]',
    error: 'border-rose-200 bg-rose-50/88 text-rose-900',
    pending: 'border-amber-200 bg-amber-50/88 text-amber-900',
    empty: 'border-[#EAD8DF] bg-white/78 text-[#4a3542]',
  }
  const iconTone: Record<string, string> = {
    loading: 'border-[#BE7690] bg-white text-[#A5556E]',
    error: 'border-rose-200 bg-white text-rose-600',
    pending: 'border-amber-200 bg-white text-amber-600',
    empty: 'border-[#EAD8DF] bg-white text-[#9d7386]',
  }
  const orbColor: Record<string, string> = {
    loading: 'bg-[#ffdce8]/80',
    error: 'bg-rose-100/70',
    pending: 'bg-amber-100/70',
    empty: 'bg-[#F6DFE6]/90',
  }
  const title = loading
    ? 'Veri yükleniyor'
    : error
      ? 'Backend bağlantısı / yetkisi gerekli'
      : missingModule
        ? 'Backend modülü bekleniyor'
        : 'Kayıt yok'
  /*
   * YÜKLENİRKEN İKİNCİ SATIR YOK. Burada API yolu ("/api/proxy üzerinden gerçek API çağrısı
   * yapılıyor") yazıyordu: kullanıcıya hiçbir şey söylemeyen, geliştirici günlüğüne ait bir
   * cümleydi ve her sayfanın tepesinde görünüyordu. Başlık zaten durumu söylüyor.
   */
  const message = loading
    ? null
    : error
      ? error
      : missingModule || emptyMessage

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className={`relative overflow-hidden rounded-[22px] border ${toneClasses[tone]} p-4 text-sm shadow-[0_18px_44px_-38px_rgba(150,78,104,0.5)] backdrop-blur-sm ${className}`}
    >
      <motion.span
        aria-hidden
        animate={{ opacity: [0.45, 0.82, 0.45] }}
        transition={{ duration: 3.6, repeat: Infinity, ease: 'easeInOut' }}
        className={`pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full ${orbColor[tone]} blur-3xl`}
      />
      {/* Tek satır kalınca hizalama ortaya alınır: `items-start` ile yazı simgenin üstünde kalıyordu. */}
      <div className={`relative flex gap-3 ${message ? 'items-start' : 'items-center'}`}>
        <motion.span
          animate={loading ? { rotate: 360 } : { opacity: [0.72, 1, 0.72] }}
          transition={
            loading
              ? { duration: 1.2, repeat: Infinity, ease: 'linear' }
              : { duration: 2.6, repeat: Infinity, ease: 'easeInOut' }
          }
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border ${iconTone[tone]}`}
        >
          <Icon className="h-4 w-4" strokeWidth={1.7} />
        </motion.span>
        <div className={`min-w-0 ${message ? 'pt-0.5' : ''}`}>
          <div className="text-[11px] font-semibold tracking-tight text-[#A5556E]">{title}</div>
          {message && <div className="mt-1 text-[12px] leading-5 text-[#6a4f5c]">{message}</div>}
        </div>
      </div>
    </motion.div>
  )
}
