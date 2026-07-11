'use client'

import { Suspense, useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Topbar from '@/components/dashboard/Topbar'
import ApiStateNotice from '@/components/dashboard/ApiStateNotice'
import ScopeBadge from '@/components/dashboard/ScopeBadge'
import StatCard, { statGridContainer } from '@/components/dashboard/StatCard'
import AnimatedNumber from '@/components/dashboard/AnimatedNumber'
import AdminEditDialog from '@/components/dashboard/AdminEditDialog'
import AutomationStatusPanel from '@/components/dashboard/AutomationStatusPanel'
import { useBranch } from '@/components/dashboard/BranchContext'
import { useFeature } from '@/components/dashboard/FeatureContext'
import { useApiQuery } from '@/hooks/useApiQuery'
import { adminApi } from '@/lib/apiClient'
import {
  apiItems,
  guidOrUndefined,
  normalizeNotificationLog,
  normalizeNotificationSummary,
  normalizeNotificationTemplate,
  notificationChannelLabels,
  notificationLogStatusLabels,
  notificationTemplateStatusLabels,
  notificationTriggerLabels,
} from '@/lib/apiMappers'
import { motion, AnimatePresence, type Variants } from 'framer-motion'
import {
  AlertCircle,
  BellRing,
  CheckCircle2,
  Clock,
  FileSignature,
  Mail,
  MessageCircle,
  MessageSquare,
  PenLine,
  Phone,
  Radio,
  Send,
  Sparkles,
  Tag,
  Target,
  ToggleRight,
  Trash2,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import type {
  ApiNotificationLog,
  ApiNotificationSummary,
  ApiNotificationTemplate,
  NotificationChannelKey,
  NotificationLogStatusKey,
  NotificationTemplate,
  NotificationTemplateStatusKey,
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

const templateStatusTone: Record<NotificationTemplateStatusKey, string> = {
  Active: 'border-emerald-300/30 bg-emerald-400/12 text-emerald-700',
  Draft: 'border-[#ead8df]/70 bg-[#fff4f8]/8 text-[#352432]/70',
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

function BildirimlerPageInner() {
  const search = useSearchParams()
  const scopeParam = search?.get('scope') as ScopeKey | null
  const scope: ScopeKey = scopeParam && scopeParam in scopeMeta ? scopeParam : 'all'
  const scopeInfo = scopeMeta[scope]

  const { selectedInstitutionId, selectedBranch, selectedInstitution } = useBranch()
  const tenantId = guidOrUndefined(selectedInstitutionId)
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

  return (
    <>
      <Topbar
        title="Bildirimler"
        subtitle={`${selectedInstitution?.name || 'Kurum'} · ${selectedBranch?.name || 'Tüm şubeler'} · ${scopeInfo.label}`}
        breadcrumbs={['Admin', 'Yönetim', 'Bildirimler', scopeInfo.label]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canTemplates && allowedChannels.length > 0 && (
              <TemplateCreateButton tenantId={tenantId} allowedChannels={allowedChannels} onSuccess={(msg) => { setActionMessage(msg); refresh() }} />
            )}
            {canBulk && (
              <BulkSendButton tenantId={tenantId} templates={templates} onResult={(msg) => { setActionMessage(msg); refresh() }} />
            )}
          </div>
        }
      />

      <div className="relative space-y-6 p-4 sm:p-6 lg:p-8">
        <div className="flex flex-wrap items-center gap-3">
          <ScopeBadge label={scopeInfo.label} description={scopeInfo.description} />
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
            delta={summary.todayFailed > 0 ? 'tekrar gönderim önerilir' : 'sorun yok'} icon={AlertCircle} accent="gold" />
        </motion.section>

        <AutomationStatusPanel templates={templates} />

        {canAutomation && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-[#ead8df]/70 bg-white/80 px-4 py-3">
            <div className="flex items-start gap-2 text-[12px] text-[#352432]/70">
              <BellRing className="mt-0.5 h-4 w-4 shrink-0 text-[#c85776]" />
              <span>Vadesi gelen/geçen, <b>ödenmemiş</b> taksiti olan müşterilere aktif “Ödeme hatırlatma” şablonunu şimdi gönder (15 dk'lık otomatik taramayı beklemeden).</span>
            </div>
            <button
              type="button"
              disabled={busyId === 'payment-reminders'}
              onClick={handleRunReminders}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-[12px] bg-gradient-to-r from-[#f47699] to-[#ef6088] px-3.5 py-2 text-[12px] font-semibold text-white shadow-[0_12px_24px_-16px_rgba(214,95,131,0.95)] transition-transform hover:-translate-y-0.5 disabled:opacity-60"
            >
              <Send className="h-3.5 w-3.5" /> {busyId === 'payment-reminders' ? 'Gönderiliyor…' : 'Vadesi geçen taksit hatırlatması gönder'}
            </button>
          </div>
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
            <div className="relative border-b border-[#ead8df]/70 px-5 py-4">
              <div className="text-[10px] font-mono uppercase tracking-widest text-[#c85776]/75">
                {scopeInfo.label} · şablonlar
              </div>
              <div className="font-display text-2xl tracking-tight">
                <AnimatedNumber value={filteredTemplates.length} className="beautyassist-text-gradient" /> kayıt
                {scope !== 'all' && (
                  <span className="ml-2 text-[12px] font-mono uppercase tracking-widest text-[#352432]/45">
                    / {templates.length} toplam
                  </span>
                )}
              </div>
            </div>
            <motion.div variants={listContainer} initial="hidden" animate="visible" className="relative divide-y divide-[#fff4f8]/8">
              {filteredTemplates.map((t) => {
                const Icon = channelIcon[t.channel]
                return (
                  <motion.div key={t.id} variants={listRow} whileHover={{ x: 4 }}
                    className="grid gap-3 px-5 py-4 transition-colors hover:bg-[#fff4f8]/[0.035] md:grid-cols-12 md:items-center">
                    <div className="md:col-span-1">
                      <span className={`grid h-9 w-9 place-items-center border ${channelTone[t.channel]}`}>
                        <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
                      </span>
                    </div>
                    <div className="md:col-span-6 min-w-0">
                      <div className="truncate font-medium">{t.name}</div>
                      <div className="mt-1 text-[10px] font-mono uppercase tracking-widest text-[#c85776]/55">
                        {t.channelLabel} · {t.triggerLabel}
                      </div>
                      <div className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-[#352432]/55">{t.body}</div>
                      {t.totalSentCount > 0 && (
                        <div className="mt-1 text-[10px] font-mono text-[#352432]/40">
                          {t.totalSentCount} gönderim · son: {t.lastSentAtFormatted || '—'}
                        </div>
                      )}
                    </div>
                    <div className="md:col-span-2">
                      <span className={`inline-flex border px-2 py-1 text-[9px] font-mono uppercase tracking-widest ${templateStatusTone[t.status]}`}>
                        {t.statusLabel}
                      </span>
                    </div>
                    <div className="md:col-span-3 flex justify-end gap-2">
                      <TemplateEditButton template={t} tenantId={tenantId}
                        onSuccess={(msg) => { setActionMessage(msg); refresh() }} />
                      <button type="button" disabled={busyId === t.id} onClick={() => handleDelete(t)}
                        className="inline-flex items-center gap-1 border border-rose-300/30 bg-rose-400/10 px-2 py-1.5 text-[9px] font-mono uppercase tracking-widest text-rose-700 transition-colors hover:bg-rose-400/20 disabled:opacity-50">
                        <Trash2 className="h-3 w-3" /> Sil
                      </button>
                    </div>
                  </motion.div>
                )
              })}
              {!filteredTemplates.length && !loading && (
                <div className="px-5 py-12 text-center text-[12px] text-[#352432]/45">
                  <BellRing className="mx-auto mb-3 h-8 w-8 text-[#c85776]/40" strokeWidth={1.4} />
                  Bu kanalda henüz şablon yok. Sağ üstten "Şablon ekle" ile başlayabilirsin.
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
            <div className="relative border-b border-[#ead8df]/70 px-5 py-4">
              <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-[#c85776]/75">
                <Send className="h-3.5 w-3.5" /> Son gönderimler
              </div>
              <div className="mt-1 font-display text-2xl tracking-tight">
                <AnimatedNumber value={filteredLogs.length} className="beautyassist-text-gradient" /> kayıt
              </div>
            </div>
            <motion.div variants={listContainer} initial="hidden" animate="visible" className="relative max-h-[640px] overflow-y-auto divide-y divide-[#fff4f8]/8">
              {filteredLogs.map((l) => {
                const Icon = channelIcon[l.channel]
                return (
                  <motion.div key={l.id} variants={listRow}
                    className="flex items-start gap-3 px-5 py-3 transition-colors hover:bg-[#fff4f8]/[0.035]">
                    <span className={`grid h-8 w-8 shrink-0 place-items-center border ${channelTone[l.channel]}`}>
                      <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] font-medium">
                        {l.customerName || l.recipient || 'Alıcı'}
                      </div>
                      <div className="mt-0.5 truncate text-[10px] font-mono text-[#352432]/45">
                        {l.templateName || 'Manuel'} · {l.createdAtFormatted}
                      </div>
                      {l.errorMessage && (
                        <div className="mt-1 line-clamp-1 text-[10px] text-rose-700/85">{l.errorMessage}</div>
                      )}
                    </div>
                    <span className={`shrink-0 inline-flex border px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-widest ${logStatusTone[l.status]}`}>
                      {l.statusLabel}
                    </span>
                  </motion.div>
                )
              })}
              {!filteredLogs.length && !loading && (
                <div className="flex flex-col items-center gap-2 px-5 py-10 text-center text-[11px] text-[#352432]/45">
                  <BellRing className="h-5 w-5" />
                  Henüz gönderim yok
                </div>
              )}
            </motion.div>
          </motion.div>
        </section>
      </div>
    </>
  )
}

// ---------------- Sub-components ----------------

function TemplateCreateButton({
  tenantId,
  allowedChannels,
  onSuccess,
}: {
  tenantId: string | undefined
  allowedChannels: NotificationChannelKey[]
  onSuccess: (msg: string) => void
}) {
  const submit = async (values: Record<string, unknown>) => {
    await adminApi.createNotificationTemplate(
      {
        name: values.name,
        channel: values.channel,
        trigger: values.trigger,
        body: values.body,
        status: values.status,
      },
      tenantId,
    )
    onSuccess('Şablon oluşturuldu.')
  }

  return (
    <AdminEditDialog
      triggerLabel="Şablon ekle"
      titleIcon={FileSignature}
      title="Yeni bildirim şablonu"
      description="Müşteriye SMS / WhatsApp / E-posta gönderilecek hazır mesaj. {{ad}}, {{tarih}}, {{saat}} gibi değişkenler render anında doldurulur."
      submitLabel="Şablon oluştur"
      onSubmit={submit}
      fields={[
        { label: 'Şablon adı', name: 'name', value: '', required: true, icon: Tag, section: 'Tanım',
          helper: 'İçerikteki amacı yansıtsın (örn. "Randevu hatırlatma — 1 gün önce")' },
        { label: 'Kanal', name: 'channel', type: 'select', value: allowedChannels[0] ?? 'Sms', required: true, icon: Radio,
          options: Object.entries(notificationChannelLabels)
            .filter(([value]) => allowedChannels.includes(value as NotificationChannelKey))
            .map(([value, label]) => ({ value, label })),
          helper: 'Yalnızca paketinizdeki kanallar listelenir' },
        { label: 'Tetikleyici', name: 'trigger', type: 'select', value: 'Manual', required: true, icon: Zap,
          options: Object.entries(notificationTriggerLabels).map(([value, label]) => ({ value, label })),
          helper: '"Manuel" toplu gönderim ve elle gönderim için; diğerleri otomasyon planı' },
        { label: 'Mesaj gövdesi', name: 'body', type: 'textarea', value: 'Sayın {{ad}}, ...', required: true,
          icon: MessageSquare, fullWidth: true, section: 'İçerik',
          helper: 'Değişkenler: {{ad}}, {{tarih}}, {{saat}}, {{telefon}}',
          placeholder: 'Sayın {{ad}}, randevunuzu {{tarih}} {{saat}} olarak onaylıyoruz.' },
        { label: 'Durum', name: 'status', type: 'select', value: 'Draft', icon: ToggleRight, section: 'Yayın',
          options: Object.entries(notificationTemplateStatusLabels).map(([value, label]) => ({ value, label })) },
      ]}
    />
  )
}

function TemplateEditButton({
  template,
  tenantId,
  onSuccess,
}: {
  template: NotificationTemplate
  tenantId: string | undefined
  onSuccess: (msg: string) => void
}) {
  const submit = async (values: Record<string, unknown>) => {
    await adminApi.updateNotificationTemplate(
      template.id,
      {
        name: values.name,
        channel: values.channel,
        trigger: values.trigger,
        body: values.body,
        status: values.status,
      },
      tenantId,
    )
    onSuccess('Şablon güncellendi.')
  }
  return (
    <AdminEditDialog
      triggerVariant="ghost"
      triggerLabel="Düzenle"
      triggerClassName="px-2 py-1.5 text-[9px]"
      titleIcon={PenLine}
      title={template.name}
      description="Aktif şablonlarda yapılan değişiklik bir sonraki gönderimden itibaren geçerlidir."
      submitLabel="Şablonu kaydet"
      onSubmit={submit}
      fields={[
        { label: 'Şablon adı', name: 'name', value: template.name, required: true, icon: Tag, section: 'Tanım' },
        { label: 'Kanal', name: 'channel', type: 'select', value: template.channel, icon: Radio,
          options: Object.entries(notificationChannelLabels).map(([value, label]) => ({ value, label })) },
        { label: 'Tetikleyici', name: 'trigger', type: 'select', value: template.trigger, icon: Zap,
          options: Object.entries(notificationTriggerLabels).map(([value, label]) => ({ value, label })) },
        { label: 'Mesaj gövdesi', name: 'body', type: 'textarea', value: template.body, icon: MessageSquare,
          fullWidth: true, section: 'İçerik', helper: 'Değişkenler: {{ad}}, {{tarih}}, {{saat}}, {{telefon}}' },
        { label: 'Durum', name: 'status', type: 'select', value: template.status, icon: ToggleRight, section: 'Yayın',
          options: Object.entries(notificationTemplateStatusLabels).map(([value, label]) => ({ value, label })) },
      ]}
    />
  )
}

function BulkSendButton({
  tenantId,
  templates,
  onResult,
}: {
  tenantId: string | undefined
  templates: NotificationTemplate[]
  onResult: (msg: string) => void
}) {
  const activeTemplates = templates.filter((t) => t.status === 'Active')

  const submit = async (values: Record<string, unknown>) => {
    if (!values.templateId) throw new Error('Şablon seçilmedi.')
    const result = await adminApi.sendNotification<{ sent: number; failed: number; skipped: number }>(
      { templateId: values.templateId, audience: values.audience || 'all' },
      tenantId,
    )
    onResult(`Gönderim tamamlandı — ${result.sent} başarılı, ${result.failed} hata, ${result.skipped} atlanan.`)
  }

  if (activeTemplates.length === 0) {
    return (
      <button type="button" disabled
        className="inline-flex cursor-not-allowed items-center gap-1 border border-[#ead8df]/70 bg-[#fff4f8]/5 px-3 py-2 text-[10px] font-mono uppercase tracking-widest text-[#352432]/40">
        <Send className="h-3 w-3" /> Aktif şablon yok
      </button>
    )
  }

  return (
    <AdminEditDialog
      triggerLabel="Toplu gönderim"
      triggerVariant="ghost"
      titleIcon={Send}
      title="Toplu bildirim gönder"
      description="Seçilen aktif şablonu seçilen kitleye gönderir. KVKK onayı olmayanlar atlanır."
      submitLabel="Gönder"
      onSubmit={submit}
      fields={[
        { label: 'Şablon', name: 'templateId', type: 'select', value: activeTemplates[0]?.id || '', required: true,
          icon: FileSignature, fullWidth: true, section: 'Mesaj',
          options: activeTemplates.map((t) => ({ value: t.id, label: `${t.channelLabel} · ${t.name}` })) },
        { label: 'Hedef kitle', name: 'audience', type: 'select', value: 'all', required: true,
          icon: Target, section: 'Kitle',
          options: [
            { value: 'all', label: 'Tüm müşteriler' },
            { value: 'active90', label: 'Aktif müşteriler (son 90 gün)' },
            { value: 'birthdayWeek', label: 'Bu hafta doğum günü olanlar' },
            { value: 'inactive30', label: 'Son 30 gündür gelmeyenler' },
          ],
          helper: 'Müşteride telefon/e-posta eksikse o kayıt atlanır' },
        { label: 'Hedef sayısı', name: 'estimate', value: '— anlık hesaplanır', icon: Users,
          helper: 'Backend gönderim sırasında uygun alıcıları seçer' },
      ]}
    />
  )
}

export default function BildirimlerPage() {
  return (
    <Suspense fallback={null}>
      <BildirimlerPageInner />
    </Suspense>
  )
}
