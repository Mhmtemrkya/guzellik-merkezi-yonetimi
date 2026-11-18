'use client'

import { Suspense, useCallback, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import Topbar from '@/components/dashboard/Topbar'
import ApiStateNotice from '@/components/dashboard/ApiStateNotice'
import ScopeBadge from '@/components/dashboard/ScopeBadge'
import StatCard, { statGridContainer } from '@/components/dashboard/StatCard'
import AnimatedNumber from '@/components/dashboard/AnimatedNumber'
import AutomationStatusPanel from '@/components/dashboard/AutomationStatusPanel'
import TemplateComposerDialog from '@/components/dashboard/notifications/TemplateComposerDialog'
import SendMessageDialog from '@/components/dashboard/notifications/SendMessageDialog'
import { SUGGESTED_TEXTS, formatCredits, usesWhatsAppReminderFlow } from '@/components/dashboard/notifications/messageKit'
import { useBranch } from '@/components/dashboard/BranchContext'
import { useFeature } from '@/components/dashboard/FeatureContext'
import { useApiQuery } from '@/hooks/useApiQuery'
import { adminApi, isPendingApprovalResult } from '@/lib/apiClient'
import {
  apiItems,
  guidOrUndefined,
  normalizeNotificationLog,
  normalizeNotificationSummary,
  normalizeNotificationTemplate,
} from '@/lib/apiMappers'
import { motion, AnimatePresence, type Variants } from 'framer-motion'
import {
  AlertCircle,
  BellRing,
  CheckCircle2,
  Clock,
  Coins,
  Mail,
  MessageCircle,
  PenLine,
  Phone,
  Plus,
  Send,
  Sparkles,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import type {
  ApiMessagingWallet,
  ApiNotificationLog,
  ApiNotificationSummary,
  ApiNotificationTemplate,
  NotificationChannelKey,
  NotificationLogStatusKey,
  NotificationTemplate,
  NotificationTemplateStatusKey,
  NotificationTriggerKey,
  PagedResult,
} from '@/lib/types'

type ScopeKey = 'all' | 'sms' | 'whatsapp' | 'email'

const scopeMeta: Record<ScopeKey, { label: string; description: string; channel?: NotificationChannelKey }> = {
  all: { label: 'Tümü', description: 'Tüm bildirim şablonları ve gönderim logu' },
  sms: { label: 'SMS', description: 'SMS kanalı şablonları', channel: 'Sms' },
  whatsapp: { label: 'WhatsApp', description: 'WhatsApp şablonları', channel: 'WhatsApp' },
  email: { label: 'E-posta', description: 'E-posta şablonları', channel: 'Email' },
}

const channelIcon: Record<NotificationChannelKey, LucideIcon> = {
  Sms: Phone,
  WhatsApp: MessageCircle,
  Email: Mail,
}

const channelTone: Record<NotificationChannelKey, string> = {
  Sms: 'border-sky-300/30 bg-sky-400/12 text-sky-700',
  WhatsApp: 'border-emerald-300/30 bg-emerald-400/12 text-emerald-700',
  Email: 'border-violet-300/30 bg-violet-400/12 text-violet-700',
}

const channelShort: Record<NotificationChannelKey, string> = { Sms: 'SMS', WhatsApp: 'WhatsApp', Email: 'E-posta' }

const templateStatusTone: Record<NotificationTemplateStatusKey, string> = {
  Active: 'border-emerald-300/30 bg-emerald-400/12 text-emerald-700',
  Draft: 'border-[#EAD8DF] bg-[#F7F6F6]/8 text-[#5A4B53]',
  PendingApproval: 'border-amber-300/30 bg-amber-400/12 text-amber-700',
}

const logStatusTone: Record<NotificationLogStatusKey, string> = {
  Sent: 'border-emerald-300/30 bg-emerald-400/12 text-emerald-700',
  Queued: 'border-amber-300/30 bg-amber-400/12 text-amber-700',
  Failed: 'border-rose-300/30 bg-rose-400/12 text-rose-700',
}

const listContainer: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.04, delayChildren: 0.05 } },
}

const listRow: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] } },
}

interface BildirimlerData {
  templates: PagedResult<ApiNotificationTemplate>
  logs: PagedResult<ApiNotificationLog>
  summary: ApiNotificationSummary
}

interface ComposerState {
  open: boolean
  template: NotificationTemplate | null
  trigger?: NotificationTriggerKey
  channel?: NotificationChannelKey
}

function BildirimlerPageInner() {
  const search = useSearchParams()
  const scopeParam = search?.get('scope') as ScopeKey | null
  const scope: ScopeKey = scopeParam && scopeParam in scopeMeta ? scopeParam : 'all'
  const scopeInfo = scopeMeta[scope]

  const { selectedInstitutionId, selectedBranch, selectedInstitution } = useBranch()
  const tenantId = guidOrUndefined(selectedInstitutionId)
  const salonName = selectedBranch?.name || selectedInstitution?.name || 'Salonunuz'
  // Paket özellik kapıları (kanal/toplu/şablon)
  const canSms = useFeature('notifications.sms')
  const canWhatsApp = useFeature('notifications.whatsapp')
  const canEmail = useFeature('notifications.email')
  const canBulk = useFeature('notifications.bulk')
  const canTemplates = useFeature('notifications.templates')
  const canAutomation = useFeature('notifications.automation')
  const allowedChannels = useMemo<NotificationChannelKey[]>(() => {
    const c: NotificationChannelKey[] = []
    if (canSms) c.push('Sms')
    if (canWhatsApp) c.push('WhatsApp')
    if (canEmail) c.push('Email')
    return c
  }, [canSms, canWhatsApp, canEmail])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [composer, setComposer] = useState<ComposerState>({ open: false, template: null })
  const [send, setSend] = useState<{ open: boolean; templateId: string | null }>({ open: false, templateId: null })

  const { data, loading, error } = useApiQuery<BildirimlerData>(
    async () => {
      const [templates, logs, summary] = await Promise.all([
        adminApi.notificationTemplates<ApiNotificationTemplate>({ tenantId, page: 1, pageSize: 100 }),
        adminApi.notificationLogs<ApiNotificationLog>({ tenantId, page: 1, pageSize: 50 }),
        adminApi.notificationSummary<ApiNotificationSummary>(tenantId),
      ])
      return { templates, logs, summary }
    },
    [tenantId, refreshKey],
    { initialData: null },
  )
  // Mesaj kredisi: şablon oluşturucudaki SMS maliyet sayacı + üstteki bakiye şeridi için.
  // Yüklenemezse sayfa çalışmaya devam eder (yalnız maliyet bilgisi gizlenir).
  const { data: wallet } = useApiQuery<ApiMessagingWallet | null>(
    () => adminApi.whatsappWallet<ApiMessagingWallet>(tenantId).catch(() => null),
    [tenantId, refreshKey],
    { initialData: null },
  )

  const templates = useMemo(
    () => apiItems(data?.templates).map((t, i) => normalizeNotificationTemplate(t, i)),
    [data],
  )
  const logs = useMemo(
    () => apiItems(data?.logs).map((l, i) => normalizeNotificationLog(l, i)),
    [data],
  )
  const summary = normalizeNotificationSummary(data?.summary)

  const handleRunReminders = async () => {
    setBusyId('payment-reminders'); setActionError(null); setActionMessage(null)
    try {
      const sent = await adminApi.runPaymentReminders<number>(tenantId)
      setActionMessage(`Vadesi geçen taksit hatırlatması çalıştı — ${sent ?? 0} mesaj gönderildi.`)
      setRefreshKey((k) => k + 1)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Hatırlatma gönderilemedi.')
    } finally {
      setBusyId(null)
    }
  }

  const filteredTemplates = useMemo(() => {
    if (!scopeInfo.channel) return templates
    return templates.filter((t) => t.channel === scopeInfo.channel)
  }, [templates, scopeInfo.channel])

  const filteredLogs = useMemo(() => {
    if (!scopeInfo.channel) return logs
    return logs.filter((l) => l.channel === scopeInfo.channel)
  }, [logs, scopeInfo.channel])

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), [])
  const done = useCallback((msg: string) => { setActionError(null); setActionMessage(msg); refresh() }, [refresh])

  const handleDelete = useCallback(async (t: NotificationTemplate) => {
    if (!confirm(`"${t.name}" şablonunu silmek istediğine emin misin?`)) return
    setBusyId(t.id); setActionError(null); setActionMessage(null)
    try {
      await adminApi.deleteNotificationTemplate(t.id, tenantId)
      setActionMessage('Şablon silindi.')
      refresh()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Silme başarısız.')
    } finally {
      setBusyId(null)
    }
  }, [tenantId, refresh])

  const openComposer = (state: Omit<ComposerState, 'open'> = { template: null }) => setComposer({ open: true, ...state })

  return (
    <>
      <Topbar
        title="Bildirimler"
        subtitle={`${selectedInstitution?.name || 'Kurum'} · ${selectedBranch?.name || 'Tüm şubeler'} · ${scopeInfo.label}`}
        breadcrumbs={['Admin', 'Yönetim', 'Bildirimler', scopeInfo.label]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canTemplates && allowedChannels.length > 0 && (
              <button type="button" onClick={() => openComposer()}
                className="inline-flex items-center gap-1.5 rounded-[12px] border border-[#BE7690] bg-white px-3.5 py-2 text-[12px] font-semibold text-[#A5556E] transition-colors hover:bg-[#F7F6F6]">
                <Plus className="h-3.5 w-3.5" /> Şablon oluştur
              </button>
            )}
            {allowedChannels.length > 0 && (
              <button type="button" onClick={() => setSend({ open: true, templateId: null })}
                className="inline-flex items-center gap-1.5 rounded-[12px] bg-gradient-to-r from-[#A5556E] to-[#8C4460] px-3.5 py-2 text-[12px] font-semibold text-white shadow-[0_12px_24px_-16px_rgba(214,95,131,0.95)] transition-transform hover:-translate-y-0.5">
                <Send className="h-3.5 w-3.5" /> Mesaj gönder
              </button>
            )}
          </div>
        }
      />

      <div className="relative mx-auto w-full max-w-[1600px] space-y-6 p-4 sm:p-6 xl:px-8">
        <div className="flex flex-wrap items-center gap-3">
          <ScopeBadge label={scopeInfo.label} description={scopeInfo.description} />
          {wallet && (
            <Link href="/panel/ayarlar"
              className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-[12px] border border-[#EAD8DF] bg-white px-3 py-1.5 text-[11.5px] text-[#5A4B53] transition-colors hover:border-[#BE7690]">
              <Coins className="h-3.5 w-3.5 text-[#A5556E]" />
              {/* SMS ve WhatsApp kredisi ayrı bakiyeler (18 Kas 2026). */}
              <span>WhatsApp kredisi <b className="text-[#8e3f5b]">{formatCredits(wallet.availableCredits)}</b></span>
              <span className="text-[#9d7386]">·</span>
              <span>SMS kredisi <b className="text-[#8e3f5b]">{formatCredits(wallet.smsAvailableCredits ?? 0)}</b></span>
              <span className="text-[#9d7386]">·</span>
              <span>SMS kotası {wallet.smsUsed.toLocaleString('tr-TR')}{wallet.smsLimit < 0 ? ' (sınırsız)' : ` / ${wallet.smsLimit.toLocaleString('tr-TR')}`}</span>
              <span className="text-[#9d7386]">·</span>
              <span>WhatsApp {wallet.utilityUsed.toLocaleString('tr-TR')}{wallet.utilityLimit < 0 ? '' : ` / ${wallet.utilityLimit.toLocaleString('tr-TR')}`}</span>
              <span className="font-semibold text-[#8C4460]">Kredi yükle ›</span>
            </Link>
          )}
        </div>

        <ApiStateNotice loading={loading} error={error} />

        <AnimatePresence>
          {actionMessage && (
            <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="border border-emerald-300/30 bg-emerald-400/10 px-4 py-2.5 text-[12px] text-emerald-700">
              <CheckCircle2 className="mr-2 inline h-3.5 w-3.5" />{actionMessage}
            </motion.div>
          )}
          {actionError && (
            <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="border border-rose-300/30 bg-rose-400/10 px-4 py-2.5 text-[12px] text-rose-700">
              <AlertCircle className="mr-2 inline h-3.5 w-3.5" />{actionError}
            </motion.div>
          )}
        </AnimatePresence>

        {/* STAT CARDS */}
        <motion.section
          variants={statGridContainer}
          initial="hidden"
          animate="visible"
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        >
          <StatCard index={0} label="Aktif şablon" value={<AnimatedNumber value={summary.activeTemplates} />}
            delta={`${summary.totalTemplates} toplam`} icon={Sparkles} accent="gold" />
          <StatCard index={1} label="Bugün gönderilen" value={<AnimatedNumber value={summary.todaySent} />}
            icon={CheckCircle2} accent="rose" />
          <StatCard index={2} label="Kuyrukta" value={<AnimatedNumber value={summary.todayQueued} />}
            icon={Clock} accent="copper" />
          <StatCard index={3} label="Başarısız" value={<AnimatedNumber value={summary.todayFailed} />}
            delta={summary.todayFailed > 0 ? 'sebebi gönderim geçmişinde' : 'sorun yok'} icon={AlertCircle} accent="gold" />
        </motion.section>

        <AutomationStatusPanel templates={templates} />

        {canAutomation && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-[#EAD8DF] bg-white/80 px-4 py-3">
            <div className="flex items-start gap-2 text-[12px] text-[#5A4B53]">
              <BellRing className="mt-0.5 h-4 w-4 shrink-0 text-[#A5556E]" />
              <span>Vadesi gelen/geçen, <b>ödenmemiş</b> taksiti olan müşterilere aktif “Ödeme hatırlatma” şablonunu şimdi gönder (15 dk'lık otomatik taramayı beklemeden).</span>
            </div>
            <button
              type="button"
              disabled={busyId === 'payment-reminders'}
              onClick={handleRunReminders}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-[12px] bg-gradient-to-r from-[#A5556E] to-[#8C4460] px-3.5 py-2 text-[12px] font-semibold text-white shadow-[0_12px_24px_-16px_rgba(214,95,131,0.95)] transition-transform hover:-translate-y-0.5 disabled:opacity-60"
            >
              <Send className="h-3.5 w-3.5" /> {busyId === 'payment-reminders' ? 'Gönderiliyor…' : 'Vadesi geçen taksit hatırlatması gönder'}
            </button>
          </div>
        )}

        {/* HAZIR OTOMASYONLAR — tek tıkla kur ya da düzenleyerek ekle */}
        {canTemplates && (
          <TemplatePresetGallery
            tenantId={tenantId}
            allowedChannels={allowedChannels}
            templates={templates}
            onSuccess={done}
            onCustomize={(trigger, channel) => openComposer({ template: null, trigger, channel })}
          />
        )}

        <section className="grid gap-3 xl:grid-cols-[1fr_.85fr]">
          {/* TEMPLATES LIST */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.16, ease: [0.22, 1, 0.36, 1] }}
            className="relative overflow-hidden armo-card armo-card-luxury"
          >
            <span aria-hidden className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full bg-[#f0aac2]/14 blur-3xl" />
            <div className="relative border-b border-[#EAD8DF] px-5 py-4">
              <div className="text-[10px] font-mono uppercase tracking-widest text-[#A5556E]/75">
                {scopeInfo.label} · şablonlar
              </div>
              <div className="font-display text-2xl tracking-tight">
                <AnimatedNumber value={filteredTemplates.length} className="beautyasist-text-gradient" /> kayıt
                {scope !== 'all' && (
                  <span className="ml-2 text-[12px] font-mono uppercase tracking-widest text-[#74616A]">
                    / {templates.length} toplam
                  </span>
                )}
              </div>
            </div>
            <motion.div variants={listContainer} initial="hidden" animate="visible" className="relative divide-y divide-[#fff4f8]/8">
              {filteredTemplates.map((t) => {
                const Icon = channelIcon[t.channel]
                return (
                  <motion.div key={t.id} variants={listRow}
                    className="grid gap-3 px-5 py-4 transition-colors hover:bg-[#F7F6F6]/[0.035] md:grid-cols-12 md:items-center">
                    <div className="md:col-span-1">
                      <span className={`grid h-9 w-9 place-items-center border ${channelTone[t.channel]}`}>
                        <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
                      </span>
                    </div>
                    <div className="md:col-span-6 min-w-0">
                      <div className="truncate font-medium">{t.name}</div>
                      <div className="mt-1 text-[10px] font-mono uppercase tracking-widest text-[#A5556E]/55">
                        {t.channelLabel} · {t.triggerLabel}
                      </div>
                      <div className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-[#5A4B53]">
                        {usesWhatsAppReminderFlow(t.channel, t.trigger)
                          ? 'İki yönlü WhatsApp hatırlatması — metin WhatsApp ayarlarındaki hatırlatma şablonundan gelir.'
                          : t.body}
                      </div>
                      {t.totalSentCount > 0 && (
                        <div className="mt-1 text-[10px] font-mono text-[#74616A]">
                          {t.totalSentCount} gönderim · son: {t.lastSentAtFormatted || '—'}
                        </div>
                      )}
                    </div>
                    <div className="md:col-span-2">
                      <span className={`inline-flex border px-2 py-1 text-[9px] font-mono uppercase tracking-widest ${templateStatusTone[t.status]}`}>
                        {t.statusLabel}
                      </span>
                    </div>
                    <div className="md:col-span-3 flex flex-wrap justify-end gap-2">
                      {t.status === 'Active' && (
                        <button type="button" onClick={() => setSend({ open: true, templateId: t.id })}
                          className="inline-flex items-center gap-1 border border-[#BE7690]/50 bg-[#fdf1f5] px-2 py-1.5 text-[9px] font-mono uppercase tracking-widest text-[#8C4460] transition-colors hover:bg-[#F6DFE6]">
                          <Send className="h-3 w-3" /> Gönder
                        </button>
                      )}
                      {canTemplates && (
                        <button type="button" onClick={() => openComposer({ template: t })}
                          className="inline-flex items-center gap-1 border border-[#EAD8DF] bg-white px-2 py-1.5 text-[9px] font-mono uppercase tracking-widest text-[#5A4B53] transition-colors hover:bg-[#F7F6F6]">
                          <PenLine className="h-3 w-3" /> Düzenle
                        </button>
                      )}
                      <button type="button" disabled={busyId === t.id} onClick={() => handleDelete(t)}
                        className="inline-flex items-center gap-1 border border-rose-300/30 bg-rose-400/10 px-2 py-1.5 text-[9px] font-mono uppercase tracking-widest text-rose-700 transition-colors hover:bg-rose-400/20 disabled:opacity-50">
                        <Trash2 className="h-3 w-3" /> Sil
                      </button>
                    </div>
                  </motion.div>
                )
              })}
              {!filteredTemplates.length && !loading && (
                <div className="px-5 py-12 text-center text-[12px] text-[#74616A]">
                  <BellRing className="mx-auto mb-3 h-8 w-8 text-[#A5556E]/40" strokeWidth={1.4} />
                  Bu kanalda henüz şablon yok.
                  {canTemplates && allowedChannels.length > 0 && (
                    <button type="button" onClick={() => openComposer()} className="mt-2 block w-full font-semibold text-[#8C4460] hover:underline">
                      Şablon oluştur
                    </button>
                  )}
                </div>
              )}
            </motion.div>
          </motion.div>

          {/* RECENT LOGS */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.24, ease: [0.22, 1, 0.36, 1] }}
            className="relative overflow-hidden armo-card armo-card-luxury"
          >
            <span aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-[#ffd3df]/18 blur-3xl" />
            <div className="relative border-b border-[#EAD8DF] px-5 py-4">
              <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-[#A5556E]/75">
                <Send className="h-3.5 w-3.5" /> Son gönderimler
              </div>
              <div className="mt-1 font-display text-2xl tracking-tight">
                <AnimatedNumber value={filteredLogs.length} className="beautyasist-text-gradient" /> kayıt
              </div>
            </div>
            <motion.div variants={listContainer} initial="hidden" animate="visible" className="relative max-h-[640px] overflow-y-auto divide-y divide-[#fff4f8]/8">
              {filteredLogs.map((l) => {
                const Icon = channelIcon[l.channel]
                return (
                  <motion.div key={l.id} variants={listRow}
                    className="flex items-start gap-3 px-5 py-3 transition-colors hover:bg-[#F7F6F6]/[0.035]">
                    <span className={`grid h-8 w-8 shrink-0 place-items-center border ${channelTone[l.channel]}`}>
                      <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] font-medium">
                        {l.customerName || l.recipient || 'Alıcı'}
                      </div>
                      <div className="mt-0.5 truncate text-[10px] font-mono text-[#74616A]">
                        {l.templateName || l.purposeLabel || 'Manuel'} · {l.createdAtFormatted}
                      </div>
                      {(l.smsParts > 0 || l.billingSource === 'Quota' || l.billingSource === 'OwnAccount' || (l.billingSource === 'Wallet' && l.chargedCredits > 0)) && (
                        <div className="mt-1 flex flex-wrap gap-1 text-[9.5px] font-semibold">
                          {l.smsParts > 0 && <span className="rounded bg-sky-50 px-1.5 py-0.5 text-sky-700">{l.smsParts} parça</span>}
                          {l.billingSource === 'Quota' && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">paket kotası</span>}
                          {l.billingSource === 'OwnAccount' && <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-700">kendi SMS hesabı</span>}
                          {l.billingSource === 'Wallet' && l.chargedCredits > 0 && (
                            <span className="rounded bg-[#fdf1f5] px-1.5 py-0.5 text-[#8e3f5b]">{formatCredits(l.chargedCredits)} kredi</span>
                          )}
                        </div>
                      )}
                      {l.errorMessage && (
                        <div className="mt-1 line-clamp-2 text-[10px] text-rose-700/85" title={l.errorMessage}>{l.errorMessage}</div>
                      )}
                    </div>
                    <span className={`shrink-0 inline-flex border px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-widest ${logStatusTone[l.status]}`}>
                      {l.statusLabel}
                    </span>
                  </motion.div>
                )
              })}
              {!filteredLogs.length && !loading && (
                <div className="flex flex-col items-center gap-2 px-5 py-10 text-center text-[11px] text-[#74616A]">
                  <BellRing className="h-5 w-5" />
                  Henüz gönderim yok
                </div>
              )}
            </motion.div>
          </motion.div>
        </section>
      </div>

      <TemplateComposerDialog
        open={composer.open}
        onClose={() => setComposer((c) => ({ ...c, open: false }))}
        tenantId={tenantId}
        allowedChannels={allowedChannels}
        salonName={salonName}
        smsCreditsPerPart={wallet?.smsCreditsPerPart}
        template={composer.template}
        initialTrigger={composer.trigger}
        initialChannel={composer.channel}
        onSaved={done}
      />

      <SendMessageDialog
        open={send.open}
        onClose={() => setSend({ open: false, templateId: null })}
        tenantId={tenantId}
        templates={templates}
        initialTemplateId={send.templateId}
        salonName={salonName}
        allowBulk={canBulk}
        onSent={(msg, ok) => {
          if (ok) { done(msg); return }
          // Hiç mesaj gitmediyse yeşil "başarılı" bandı yanıltıcı olurdu.
          setActionMessage(null)
          setActionError(msg)
          refresh()
        }}
        onCreateTemplate={() => { setSend({ open: false, templateId: null }); openComposer() }}
      />
    </>
  )
}

// ---------------- Sub-components ----------------

/** Hazır yaşam döngüsü otomasyonları — metin kısa ve emojisizdir (SMS parça başına ücretlenir). */
const AUTOMATION_PRESETS: Array<{ key: string; title: string; trigger: NotificationTriggerKey; hint: string }> = [
  { key: 'reminder', title: 'Randevu Hatırlatma', trigger: 'AppointmentReminder', hint: 'Randevudan 24 saat önce otomatik' },
  { key: 'birthday', title: 'Doğum Günü Kutlaması', trigger: 'BirthdayGreeting', hint: 'Doğum gününde otomatik (yılda 1)' },
  { key: 'payment', title: 'Ödeme Hatırlatma', trigger: 'PaymentDue', hint: 'Vadesi gelen taksiti olana (günde en çok 1)' },
  { key: 'winback', title: 'Sizi Özledik', trigger: 'WinBack', hint: 'Uzun süredir gelmeyene (ayda en çok 1)' },
  { key: 'renewal', title: 'Paket Yenileme', trigger: 'SessionRenewal', hint: 'Paketi bitmek üzere olana (ayda en çok 1)' },
]

function TemplatePresetGallery({
  tenantId,
  allowedChannels,
  templates,
  onSuccess,
  onCustomize,
}: {
  tenantId: string | undefined
  allowedChannels: NotificationChannelKey[]
  templates: NotificationTemplate[]
  onSuccess: (msg: string) => void
  onCustomize: (trigger: NotificationTriggerKey, channel: NotificationChannelKey) => void
}) {
  // SMS öncelikli: WhatsApp'ta serbest metin yalnız son 24 saatte yazan müşteriye iletilir;
  // otomatik doğum günü / geri kazanım mesajı çoğu müşteriye WhatsApp'tan ULAŞMAZ.
  const phoneChannels = allowedChannels.filter((c) => c !== 'Email')
  const [channel, setChannel] = useState<NotificationChannelKey | undefined>(undefined)
  const active = channel && allowedChannels.includes(channel) ? channel : (phoneChannels.includes('Sms') ? 'Sms' : allowedChannels[0])
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  if (!active) return null

  const addPreset = async (preset: (typeof AUTOMATION_PRESETS)[number]): Promise<void> => {
    setBusyKey(preset.key)
    setError('')
    try {
      const res = await adminApi.createNotificationTemplate(
        { name: `${preset.title} · ${channelShort[active]}`, channel: active, trigger: preset.trigger, body: SUGGESTED_TEXTS[preset.trigger]?.[0] ?? '', status: 'Active' },
        tenantId,
      )
      onSuccess(isPendingApprovalResult(res)
        ? `"${preset.title}" şablonu onaya gönderildi.`
        : `"${preset.title}" (${channelShort[active]}) eklendi ve aktifleştirildi — otomatik gönderim devrede.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Şablon eklenemedi.')
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-[16px] border border-[#EAD8DF] bg-white/80 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={() => setCollapsed((c) => !c)} className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-[#A5556E]/75">
          <Sparkles className="h-3.5 w-3.5" /> Hazır otomasyonlar
          <span className="normal-case tracking-normal text-[#74616A]">· tek tıkla ekle, otomatik gönderim hemen başlasın</span>
        </button>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 rounded-[10px] border border-[#EAD8DF] bg-[#F7F6F6] p-0.5">
            {allowedChannels.map((c) => (
              <button key={c} type="button" onClick={() => setChannel(c)}
                className={`rounded-[8px] px-2.5 py-1 text-[10.5px] font-semibold transition ${active === c ? 'bg-[#8e3f5b] text-white' : 'text-[#5A4B53] hover:text-[#8e3f5b]'}`}>
                {channelShort[c]}
              </button>
            ))}
          </span>
          <button type="button" onClick={() => setCollapsed((c) => !c)} className="text-[10px] font-mono uppercase tracking-widest text-[#9d7386]">
            {collapsed ? 'Göster' : 'Gizle'}
          </button>
        </div>
      </div>
      {!collapsed && (
        <>
          {active === 'WhatsApp' && (
            <p className="mt-2 rounded-[10px] border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[10.5px] leading-snug text-amber-800">
              WhatsApp&apos;ta serbest metin yalnız son 24 saatte size yazmış müşteriye iletilir (Meta kuralı). Randevu hatırlatması dışındaki
              otomatik mesajlar için <b>SMS</b> önerilir.
            </p>
          )}
          {error && <p className="mt-2 text-[11px] text-rose-700">{error}</p>}
          <div className="mt-3 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-5">
            {AUTOMATION_PRESETS.map((p) => {
              const added = templates.some((t) => t.trigger === p.trigger && t.channel === active)
              const reminderFlow = usesWhatsAppReminderFlow(active, p.trigger)
              return (
                <div key={p.key} className={`flex flex-col rounded-[14px] border p-3 ${added ? 'border-emerald-200/70 bg-emerald-50/40' : 'border-[#EAD8DF] bg-[#F7F6F6]'}`}>
                  <div className="text-[12.5px] font-semibold text-[#241923]">{p.title}</div>
                  <div className="mt-0.5 text-[10px] text-[#9d7386]">{p.hint}</div>
                  <div className="mt-2 line-clamp-3 flex-1 text-[10.5px] leading-relaxed text-[#5A4B53]">
                    {reminderFlow ? 'İki yönlü onaylı WhatsApp hatırlatması (Evet / Hayır / Ertele).' : SUGGESTED_TEXTS[p.trigger]?.[0]}
                  </div>
                  <div className="mt-2.5 flex gap-1.5">
                    <button
                      type="button"
                      disabled={busyKey === p.key || added}
                      onClick={() => void addPreset(p)}
                      className={`inline-flex flex-1 items-center justify-center gap-1 rounded-[10px] px-2 py-1.5 text-[11px] font-semibold transition-colors disabled:opacity-60 ${
                        added ? 'border border-emerald-300/60 bg-white text-emerald-700' : 'border border-[#BE7690] bg-white text-[#A5556E] hover:bg-[#F7F6F6]'
                      }`}
                    >
                      {added ? <><CheckCircle2 className="h-3.5 w-3.5" /> Eklendi</> : busyKey === p.key ? 'Ekleniyor…' : <><Plus className="h-3.5 w-3.5" /> Ekle</>}
                    </button>
                    {!added && (
                      <button type="button" onClick={() => onCustomize(p.trigger, active)} title="Metni düzenleyerek ekle"
                        className="inline-flex items-center justify-center rounded-[10px] border border-[#EAD8DF] bg-white px-2 text-[#5A4B53] transition-colors hover:bg-[#F7F6F6]">
                        <PenLine className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </motion.section>
  )
}

export default function BildirimlerPage() {
  return (
    <Suspense fallback={null}>
      <BildirimlerPageInner />
    </Suspense>
  )
}
