'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Topbar from '@/components/dashboard/Topbar'
import ApiStateNotice from '@/components/dashboard/ApiStateNotice'
import { useApiQuery } from '@/hooks/useApiQuery'
import { platformApi } from '@/lib/apiClient'
import {
  MessageCircle, PhoneCall, ShieldCheck, Clock3, Check, X, Loader2, Plus, PenLine, Trash2,
  Wallet, Tag, Package, Settings2, Send, AlertTriangle, RefreshCw, Smartphone, FileCheck2, Info, Search,
} from 'lucide-react'
import type {
  ApiWhatsAppConnection, ApiCreditPurchase, ApiWhatsAppPricingRule, ApiCreditPackage,
  ApiWhatsAppBillingSettings, WhatsAppMessageCategory, ApiPlatformSmsConnection, ApiSmsConnection,
  ApiSmsConnectionTestResult,
} from '@/lib/types'
import SmsConnectionForm, { SmsStatusBadge } from '@/components/dashboard/SmsConnectionForm'

const money = (n?: number) => `₺${(n ?? 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
/** Mesaj kredisi: tam sayıysa ondalıksız (1.000), kesirliyse iki hane. */
const credits = (n?: number) => {
  const v = n ?? 0
  return Number.isInteger(v) ? v.toLocaleString('tr-TR') : v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
const CATEGORY_LABEL: Record<string, string> = { Utility: 'Hatırlatma (Utility)', Marketing: 'Pazarlama (Marketing)', Authentication: 'Doğrulama', Service: 'Servis (ücretsiz)' }
const STATUS_LABEL: Record<string, string> = { Connected: 'Bağlı', Pending: 'Doğrulama bekliyor', Disabled: 'Devre dışı', NotConnected: 'Bağlı değil' }

type Tab = 'connections' | 'sms' | 'purchases' | 'pricing' | 'packages'
const TABS: { key: Tab; label: string; icon: typeof MessageCircle }[] = [
  { key: 'connections', label: 'WhatsApp Bağlantıları', icon: PhoneCall },
  { key: 'sms', label: 'SMS Bağlantıları', icon: Smartphone },
  { key: 'purchases', label: 'Kredi Talepleri', icon: Wallet },
  { key: 'pricing', label: 'Kredi Maliyeti & Ayar', icon: Tag },
  { key: 'packages', label: 'Kredi Paketleri', icon: Package },
]

export default function PlatformWhatsAppPage() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  )
}

function Inner() {
  const params = useSearchParams()
  const initialTab = (params.get('tab') as Tab) || 'connections'
  const [tab, setTab] = useState<Tab>(TABS.some((t) => t.key === initialTab) ? initialTab : 'connections')
  useEffect(() => { const t = params.get('tab') as Tab; if (t && TABS.some((x) => x.key === t)) setTab(t) }, [params])

  return (
    <>
      <Topbar
        title="WhatsApp, SMS & Mesaj Kredisi"
        subtitle="Kurumların WhatsApp ve SMS bağlantıları, mesaj kredisi maliyetleri ve satın alma onayları — merkezi kontrol"
        breadcrumbs={['Platform', 'Sistem', 'WhatsApp']}
      />
      <div className="space-y-6 p-4 sm:p-6 lg:p-8">
        <div className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-2 rounded-[12px] border px-3.5 py-2 text-[12px] font-semibold transition ${
                tab === t.key ? 'border-[#ef6088] bg-[#fff1f6] text-[#c2436a]' : 'border-[#ecd9e1] bg-white text-[#6c5661] hover:border-[#f3bccd]'}`}>
              <t.icon className="h-4 w-4" /> {t.label}
            </button>
          ))}
        </div>

        {tab === 'connections' && <ConnectionsTab />}
        {tab === 'sms' && <SmsConnectionsTab />}
        {tab === 'purchases' && <PurchasesTab />}
        {tab === 'pricing' && <PricingTab />}
        {tab === 'packages' && <PackagesTab />}
      </div>
    </>
  )
}

/* ===================== BAĞLANTILAR ===================== */
function ConnectionsTab() {
  const [refreshKey, setRefreshKey] = useState(0)
  const { data, loading, error } = useApiQuery<ApiWhatsAppConnection[]>(
    () => platformApi.waConnections<ApiWhatsAppConnection>(), [refreshKey], { initialData: [] })
  const [editing, setEditing] = useState<ApiWhatsAppConnection | null>(null)

  return (
    <div className="space-y-4">
      <ApiStateNotice loading={loading} error={error} />
      <div className="overflow-hidden rounded-[16px] border border-[#ecd9e1] bg-white">
        <table className="w-full text-left text-[12px]">
          <thead className="bg-[#fbf1f5] text-[11px] uppercase tracking-wide text-[#9a7d88]">
            <tr>
              <th className="px-4 py-2.5">Kurum</th>
              <th className="px-4 py-2.5">Numara</th>
              <th className="px-4 py-2.5">phone_number_id</th>
              <th className="px-4 py-2.5">Durum</th>
              <th className="px-4 py-2.5 text-right">İşlem</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((c) => (
              <tr key={c.tenantId} className="border-t border-[#f3e6ec]">
                <td className="px-4 py-2.5">
                  <div className="font-semibold text-[#3f2d36]">{c.tenantName}</div>
                  {c.planName && <div className="text-[10.5px] text-[#9a7d88]">{c.planName}</div>}
                </td>
                <td className="px-4 py-2.5 font-mono text-[11px] text-[#6c5661]">{c.displayPhoneNumber || '—'}</td>
                <td className="px-4 py-2.5 font-mono text-[11px] text-[#9a7d88]">{c.phoneNumberId || '—'}</td>
                <td className="px-4 py-2.5"><StatusBadge status={c.connectionStatus} /></td>
                <td className="px-4 py-2.5 text-right">
                  <button type="button" onClick={() => setEditing(c)}
                    className="inline-flex items-center gap-1 rounded-lg border border-[#ecd9e1] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#c2436a] hover:bg-[#fff1f6]">
                    <PenLine className="h-3.5 w-3.5" /> Bağla
                  </button>
                </td>
              </tr>
            ))}
            {!loading && (data ?? []).length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-[12px] text-[#9a7d88]">Kurum bulunamadı.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {editing && <BindModal conn={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setRefreshKey((k) => k + 1) }} />}
    </div>
  )
}

function BindModal({ conn, onClose, onSaved }: { conn: ApiWhatsAppConnection; onClose: () => void; onSaved: () => void }) {
  const [phoneNumberId, setPhoneNumberId] = useState(conn.phoneNumberId ?? '')
  const [businessAccountId, setBusinessAccountId] = useState(conn.businessAccountId ?? '')
  const [displayPhoneNumber, setDisplayPhoneNumber] = useState(conn.displayPhoneNumber ?? '')
  const [connectionStatus, setConnectionStatus] = useState(conn.connectionStatus || 'Connected')
  const [verifyToken, setVerifyToken] = useState('')
  const [accessTokenOverride, setAccessTokenOverride] = useState('')
  // Meta onaylı şablon adları — kurum değil platform yönetir (Meta Business Manager platformun).
  const [kvkkTemplateName, setKvkkTemplateName] = useState(conn.kvkkTemplateName ?? '')
  const [reminderTemplateName, setReminderTemplateName] = useState(conn.reminderTemplateName ?? '')
  const [waitlistOfferTemplateName, setWaitlistOfferTemplateName] = useState(conn.waitlistOfferTemplateName ?? '')
  const [waitlistActivatedTemplateName, setWaitlistActivatedTemplateName] = useState(conn.waitlistActivatedTemplateName ?? '')
  const [ratingTemplateName, setRatingTemplateName] = useState(conn.ratingTemplateName ?? '')
  const [templateLanguage, setTemplateLanguage] = useState(conn.templateLanguageCode || 'tr')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [testPhone, setTestPhone] = useState('')
  const [testResult, setTestResult] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)

  const save = async () => {
    setBusy(true); setErr(null)
    try {
      await platformApi.bindWaConnection(conn.tenantId, {
        phoneNumberId: phoneNumberId.trim() || null,
        businessAccountId: businessAccountId.trim() || null,
        displayPhoneNumber: displayPhoneNumber.trim() || null,
        connectionStatus,
        verifyToken: verifyToken.trim() || null,
        accessTokenOverride: accessTokenOverride.trim() || null,
        // Şablon adları HER ZAMAN gönderilir: boş metin = temizle (null gönderilseydi sunucu korurdu).
        kvkkTemplateName: kvkkTemplateName.trim(),
        reminderTemplateName: reminderTemplateName.trim(),
        waitlistOfferTemplateName: waitlistOfferTemplateName.trim(),
        waitlistActivatedTemplateName: waitlistActivatedTemplateName.trim(),
        ratingTemplateName: ratingTemplateName.trim(),
        templateLanguageCode: templateLanguage.trim() || 'tr',
      })
      onSaved()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Kaydedilemedi.') } finally { setBusy(false) }
  }

  const test = async () => {
    setTesting(true); setTestResult(null)
    try {
      const res = await platformApi.testWaConnection<{ sent?: boolean; error?: string | null }>(conn.tenantId, { toPhone: testPhone.trim(), text: null })
      setTestResult(res.sent ? '✅ Test mesajı gönderildi.' : `⚠️ ${res.error ?? 'Gönderilemedi.'}`)
    } catch (e) { setTestResult(`⚠️ ${e instanceof Error ? e.message : 'Hata'}`) } finally { setTesting(false) }
  }

  return (
    <Modal title={`${conn.tenantName} — WhatsApp bağla`} onClose={onClose} wide>
      <div className="space-y-3">
        <p className="rounded-lg border border-[#cfe0ea] bg-[#f2f8fc] px-3 py-2 text-[11px] text-[#39525f]">
          Tek Business Manager altındaki numarayı bu kuruma bağlar. Sistem token'ı platform genelindedir (Sistem Ayarları → Mesajlaşma). Kuruma özel token yalnızca istisnai durumda gerekir.
        </p>
        <Field label="phone_number_id (Meta)" value={phoneNumberId} onChange={setPhoneNumberId} placeholder="örn. 123456789012345" mono />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Görünen numara" value={displayPhoneNumber} onChange={setDisplayPhoneNumber} placeholder="+90 555 000 00 00" />
          <Field label="WABA id" value={businessAccountId} onChange={setBusinessAccountId} placeholder="opsiyonel" mono />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-mono uppercase tracking-widest text-[#9a7d88]">Durum</label>
          <select value={connectionStatus} onChange={(e) => setConnectionStatus(e.target.value as ApiWhatsAppConnection['connectionStatus'])}
            className="w-full rounded-lg border border-[#ecd9e1] bg-white px-2.5 py-1.5 text-[12px] text-[#3f2d36] outline-none focus:border-[#ef6088]">
            {(['Connected', 'Pending', 'Disabled', 'NotConnected'] as const).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Verify token (webhook)" value={verifyToken} onChange={setVerifyToken} placeholder="opsiyonel" />
          <Field label="Token override" value={accessTokenOverride} onChange={setAccessTokenOverride} placeholder="genelde boş" type="password" />
        </div>

        {/* Meta onaylı şablonlar — 24 saat penceresi kapalıyken zorunlu; kurum değil platform oluşturur. */}
        <div className="space-y-2 rounded-lg border border-[#ecd9e1] bg-[#fbf7f9] p-2.5">
          <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-[#9a7d88]">
            <FileCheck2 className="h-3.5 w-3.5 text-[#c2436a]" /> Meta onaylı şablonlar
          </div>
          <div className="flex items-start gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-[10.5px] leading-relaxed text-sky-900">
            <Info className="mt-0.5 h-3 w-3 shrink-0" />
            <span>
              Müşteri son <b>24 saat</b> içinde yazmadıysa serbest metin iletilmez; sistem bu adlardaki şablonla gönderir.
              Boş bırakılırsa serbest metin denenir. Hatırlatma ve bekleme şablonlarının gövdesi aynı 5 değişkeni bu sırayla kullanmalı:
              <span className="block font-mono text-[10px]">&#123;&#123;1&#125;&#125; ad · &#123;&#123;2&#125;&#125; tarih · &#123;&#123;3&#125;&#125; saat · &#123;&#123;4&#125;&#125; hizmet · &#123;&#123;5&#125;&#125; kurum</span>
              KVKK (Utility, belge başlıklı): &#123;&#123;1&#125;&#125; ad · &#123;&#123;2&#125;&#125; kurum · &#123;&#123;3&#125;&#125; metin linki.
              Değerlendirme: &#123;&#123;1&#125;&#125; ad · &#123;&#123;2&#125;&#125; kurum · &#123;&#123;3&#125;&#125; link. Hızlı yanıt düğmesi kullanmayın.
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="KVKK onay isteği" value={kvkkTemplateName} onChange={setKvkkTemplateName} placeholder="kvkk_acik_riza" mono />
            <Field label="Randevu hatırlatma" value={reminderTemplateName} onChange={setReminderTemplateName} placeholder="randevu_hatirlatma" mono />
            <Field label="Bekleme teklifi" value={waitlistOfferTemplateName} onChange={setWaitlistOfferTemplateName} placeholder="bekleme_teklif" mono />
            <Field label="Bekleme onayı" value={waitlistActivatedTemplateName} onChange={setWaitlistActivatedTemplateName} placeholder="bekleme_onay" mono />
            <Field label="Değerlendirme linki" value={ratingTemplateName} onChange={setRatingTemplateName} placeholder="degerlendirme" mono />
            <Field label="Dil kodu" value={templateLanguage} onChange={setTemplateLanguage} placeholder="tr" mono />
          </div>
        </div>

        <div className="rounded-lg border border-[#ecd9e1] bg-[#fbf7f9] p-2.5">
          <div className="mb-1.5 text-[10px] font-mono uppercase tracking-widest text-[#9a7d88]">Bağlantı testi</div>
          <div className="flex items-center gap-2">
            <input value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="Test numarası (905...)"
              className="min-w-0 flex-1 rounded-lg border border-[#ecd9e1] bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-[#ef6088]" />
            <button type="button" disabled={testing || !testPhone.trim()} onClick={test}
              className="inline-flex items-center gap-1 rounded-lg border border-[#ecd9e1] bg-white px-3 py-1.5 text-[11px] font-semibold text-[#c2436a] disabled:opacity-50">
              {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Test
            </button>
          </div>
          {testResult && <div className="mt-1.5 text-[11px] text-[#6c5661]">{testResult}</div>}
        </div>

        {err && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">{err}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-lg border border-[#ecd9e1] bg-white px-3.5 py-1.5 text-[12px] font-semibold text-[#6c5661]">Vazgeç</button>
          <button type="button" disabled={busy} onClick={save} className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#f47699] to-[#ef6088] px-4 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Kaydet
          </button>
        </div>
      </div>
    </Modal>
  )
}

/* ===================== SMS BAĞLANTILARI ===================== */
/**
 * Kurumların KENDİ SMS hesapları (Verimor / Netgsm). Bağlantıyı BeautyAsist kurar; kurum yalnız durumu
 * görür. Doğrulanmış bağlantıda kurumun müşteri SMS'leri kendi başlığıyla gider (kota/kredi düşmez).
 */
function SmsConnectionsTab() {
  const [refreshKey, setRefreshKey] = useState(0)
  const { data, loading, error, setData } = useApiQuery<ApiPlatformSmsConnection[]>(
    () => platformApi.smsConnections<ApiPlatformSmsConnection>(), [refreshKey], { initialData: [] })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const rows = (data ?? []).filter((r) => !query.trim() || r.tenantName.toLocaleLowerCase('tr-TR').includes(query.trim().toLocaleLowerCase('tr-TR')))
  const editing = (data ?? []).find((r) => r.tenantId === editingId) ?? null

  // Pencere kaydettikçe satır yerinde güncellenir (liste yeniden çekilmeden).
  const updateRow = (tenantId: string, connection: ApiSmsConnection) =>
    setData((data ?? []).map((r) => (r.tenantId === tenantId ? { ...r, connection } : r)))

  return (
    <div className="space-y-4">
      <ApiStateNotice loading={loading} error={error} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-[11.5px] leading-relaxed text-[#6c5661]">
          Kurumun Verimor / Netgsm hesabını bağlayın ve bir test SMS&apos;iyle doğrulayın. Doğrulanınca kurumun müşteri SMS&apos;leri
          kendi başlığıyla gider; BeautyAsist kotası ve mesaj kredisi düşmez. Kurum bu bağlantıyı yalnız görür, değiştiremez.
        </p>
        <label className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#9a7d88]" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Kurum ara"
            className="w-56 rounded-lg border border-[#ecd9e1] bg-white py-1.5 pl-8 pr-2.5 text-[12px] outline-none focus:border-[#ef6088]" />
        </label>
      </div>
      <div className="overflow-x-auto rounded-[16px] border border-[#ecd9e1] bg-white">
        <table className="w-full min-w-[640px] text-left text-[12px]">
          <thead className="bg-[#fbf1f5] text-[11px] uppercase tracking-wide text-[#9a7d88]">
            <tr>
              <th className="px-4 py-2.5">Kurum</th>
              <th className="px-4 py-2.5">Sağlayıcı</th>
              <th className="px-4 py-2.5">Başlık</th>
              <th className="px-4 py-2.5">Durum</th>
              <th className="px-4 py-2.5 text-right">İşlem</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.tenantId} className="border-t border-[#f3e6ec]">
                <td className="px-4 py-2.5">
                  <div className="font-semibold text-[#3f2d36]">{r.tenantName}</div>
                  <div className="flex flex-wrap items-center gap-1.5 text-[10.5px] text-[#9a7d88]">
                    {r.planName || 'Paket yok'}
                    {r.connection.smsFeatureAllowed === false && <span className="rounded bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-700">pakette SMS yok</span>}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-[11.5px] text-[#6c5661]">{r.connection.provider || '—'}</td>
                <td className="px-4 py-2.5 font-mono text-[11px] text-[#6c5661]">{r.connection.sender || '—'}</td>
                <td className="px-4 py-2.5"><SmsStatusBadge status={r.connection.status} /></td>
                <td className="px-4 py-2.5 text-right">
                  <button type="button" onClick={() => setEditingId(r.tenantId)}
                    className="inline-flex items-center gap-1 rounded-lg border border-[#ecd9e1] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#c2436a] hover:bg-[#fff1f6]">
                    <PenLine className="h-3.5 w-3.5" /> {r.connection.status === 'NotConnected' ? 'Bağla' : 'Yönet'}
                  </button>
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-[12px] text-[#9a7d88]">Kurum bulunamadı.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {editing && (
        <Modal title={`${editing.tenantName} — SMS hesabı`} onClose={() => { setEditingId(null); setRefreshKey((k) => k + 1) }} wide>
          <div className="mb-3 flex items-center justify-between gap-2 text-[11px] text-[#6c5661]">
            <span>{editing.planName || 'Paket yok'}</span>
            <SmsStatusBadge status={editing.connection.status} />
          </div>
          <SmsConnectionForm
            connection={editing.connection}
            onChange={(next) => updateRow(editing.tenantId, next)}
            api={{
              save: (body) => platformApi.saveSmsConnection<ApiSmsConnection>(editing.tenantId, body),
              test: (phone) => platformApi.testSmsConnection<ApiSmsConnectionTestResult>(editing.tenantId, phone),
              remove: () => platformApi.deleteSmsConnection<ApiSmsConnection>(editing.tenantId),
            }}
          />
        </Modal>
      )}
    </div>
  )
}

/* ===================== KREDİ TALEPLERİ ===================== */
function PurchasesTab() {
  const [refreshKey, setRefreshKey] = useState(0)
  const { data, loading, error } = useApiQuery<ApiCreditPurchase[]>(
    () => platformApi.waPurchases<ApiCreditPurchase>(false), [refreshKey], { initialData: [] })
  const [busyId, setBusyId] = useState<string | null>(null)

  const [actionMsg, setActionMsg] = useState('')

  const act = async (id: string, approve: boolean) => {
    setBusyId(id)
    setActionMsg('')
    try {
      if (approve) await platformApi.approveWaPurchase(id)
      else await platformApi.rejectWaPurchase(id, 'Reddedildi')
      setRefreshKey((k) => k + 1)
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : 'İşlem tamamlanamadı.')
    } finally { setBusyId(null) }
  }

  /** Takılan kartlı talebi sağlayıcıya sorar — kör onay değil. */
  const reconcile = async (id: string) => {
    setBusyId(id)
    setActionMsg('')
    try {
      const res = await platformApi.reconcileWaPurchase<{ succeeded?: boolean; message?: string }>(id)
      setActionMsg(res?.message ?? 'Sağlayıcıya soruldu.')
      setRefreshKey((k) => k + 1)
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : 'Sorgulanamadı.')
    } finally { setBusyId(null) }
  }

  const rows = data ?? []
  // KARTLI TALEP ELLE ONAYLANAMAZ. Backend 409 döndürüyor; düğmeyi göstermek kullanıcıyı
  // tıklayıp hata yemeye davet ederdi. Kartlı bekleyenler AYRI listede, tek eylemleri
  // "Sağlayıcıya sor". (Ayrım: provider dolu = kart akışı.)
  const pending = rows.filter((r) => r.status === 'Pending' && !r.provider)
  const cardPending = rows.filter((r) => r.status === 'Pending' && !!r.provider)
  const others = rows.filter((r) => r.status !== 'Pending')

  return (
    <div className="space-y-4">
      <ApiStateNotice loading={loading} error={error} />
      {actionMsg && (
        <div className="rounded-[12px] border border-[#ecd9e1] bg-white px-4 py-2.5 text-[11.5px] text-[#3f2d36]">{actionMsg}</div>
      )}

      {/* KARTLA ÖDEME BEKLEYENLER — elle onay YOK, yalnız sağlayıcıya sorma. */}
      {cardPending.length > 0 && (
        <div>
          <div className="mb-2 text-[12px] font-semibold text-[#3f2d36]">
            Kartla ödeme bekleyenler
            <span className="ml-1 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] text-sky-700">{cardPending.length}</span>
          </div>
          <div className="space-y-2">
            {cardPending.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-sky-200 bg-sky-50/50 px-4 py-3">
                <div>
                  <div className="text-[12.5px] font-semibold text-[#3f2d36]">{p.tenantName ?? 'Kurum'}</div>
                  <div className="text-[11px] text-[#6c5661]">{p.packageName} · {credits(p.grantsCredits)} kredi · {money(p.priceTry)} · {p.provider}</div>
                  <div className="text-[10px] text-[#9a7d88]">
                    {new Date(p.createdAtUtc).toLocaleString('tr-TR')}
                    {p.note && <> · {p.note}</>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10.5px] text-[#6c5661]">Elle onaylanamaz — sonucu sağlayıcı belirler.</span>
                  <button type="button" disabled={busyId === p.id} onClick={() => reconcile(p.id)}
                    className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-3.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50">
                    {busyId === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Sağlayıcıya sor
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="mb-2 text-[12px] font-semibold text-[#3f2d36]">Onay bekleyenler (havale) {pending.length > 0 && <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-700">{pending.length}</span>}</div>
        {pending.length === 0 ? (
          <div className="rounded-[14px] border border-[#ecd9e1] bg-white px-4 py-6 text-center text-[12px] text-[#9a7d88]">Bekleyen kredi talebi yok.</div>
        ) : (
          <div className="space-y-2">
            {pending.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-amber-200 bg-amber-50/50 px-4 py-3">
                <div>
                  <div className="text-[12.5px] font-semibold text-[#3f2d36]">{p.tenantName ?? 'Kurum'}</div>
                  <div className="text-[11px] text-[#6c5661]">{p.packageName} · ödenecek {money(p.priceTry)} · yüklenecek <b>{credits(p.grantsCredits)} kredi</b></div>
                  <div className="text-[10px] text-[#9a7d88]">{new Date(p.createdAtUtc).toLocaleString('tr-TR')}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" disabled={busyId === p.id} onClick={() => act(p.id, false)}
                    className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-rose-600 disabled:opacity-50">
                    <X className="h-3.5 w-3.5" /> Reddet
                  </button>
                  <button type="button" disabled={busyId === p.id} onClick={() => act(p.id, true)}
                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50">
                    {busyId === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Onayla & yükle
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {others.length > 0 && (
        <div>
          <div className="mb-2 text-[12px] font-semibold text-[#3f2d36]">Geçmiş</div>
          <div className="overflow-hidden rounded-[14px] border border-[#ecd9e1] bg-white">
            <table className="w-full text-left text-[12px]">
              <tbody>
                {others.map((p) => (
                  <tr key={p.id} className="border-t border-[#f3e6ec] first:border-t-0">
                    <td className="px-4 py-2.5">{p.tenantName ?? 'Kurum'}</td>
                    <td className="px-4 py-2.5 text-[#6c5661]">{p.packageName} · {credits(p.grantsCredits)} kredi · {money(p.priceTry)}</td>
                    <td className="px-4 py-2.5"><PurchaseBadge status={p.status} /></td>
                    <td className="px-4 py-2.5 text-right text-[10.5px] text-[#9a7d88]">{new Date(p.createdAtUtc).toLocaleDateString('tr-TR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

/* ===================== FİYAT & AYAR ===================== */
function PricingTab() {
  const [refreshKey, setRefreshKey] = useState(0)
  const { data: settings } = useApiQuery<ApiWhatsAppBillingSettings | null>(
    () => platformApi.waBillingSettings<ApiWhatsAppBillingSettings>(), [refreshKey], { initialData: null })
  const { data: rules, loading, error } = useApiQuery<ApiWhatsAppPricingRule[]>(
    () => platformApi.waPricing<ApiWhatsAppPricingRule>(), [refreshKey], { initialData: [] })
  const [editing, setEditing] = useState<ApiWhatsAppPricingRule | 'new' | null>(null)

  return (
    <div className="space-y-5">
      <ApiStateNotice loading={loading} error={error} />
      {settings && <BillingSettingsCard settings={settings} onSaved={() => setRefreshKey((k) => k + 1)} />}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[12px] font-semibold text-[#3f2d36]">WhatsApp kategori kredi maliyetleri <span className="font-normal text-[#9a7d88]">· 1 kredi = 1 hatırlatma</span></div>
          <button type="button" onClick={() => setEditing('new')}
            className="inline-flex items-center gap-1 rounded-lg bg-gradient-to-r from-[#f47699] to-[#ef6088] px-3 py-1.5 text-[11px] font-semibold text-white">
            <Plus className="h-3.5 w-3.5" /> Maliyet kuralı
          </button>
        </div>
        <div className="overflow-hidden rounded-[14px] border border-[#ecd9e1] bg-white">
          <table className="w-full text-left text-[12px]">
            <thead className="bg-[#fbf1f5] text-[11px] uppercase tracking-wide text-[#9a7d88]">
              <tr>
                <th className="px-4 py-2.5">Kategori</th>
                <th className="px-4 py-2.5">Meta (USD)</th>
                <th className="px-4 py-2.5">≈ Meta (₺)</th>
                <th className="px-4 py-2.5">Kredi / mesaj</th>
                <th className="px-4 py-2.5">Yürürlük</th>
                <th className="px-4 py-2.5 text-right">İşlem</th>
              </tr>
            </thead>
            <tbody>
              {(rules ?? []).map((r) => (
                <tr key={r.id} className="border-t border-[#f3e6ec]">
                  <td className="px-4 py-2.5 font-medium text-[#3f2d36]">{CATEGORY_LABEL[r.category] ?? r.category}</td>
                  <td className="px-4 py-2.5 text-[#6c5661]">${r.metaUsdPrice.toFixed(4)}</td>
                  <td className="px-4 py-2.5 text-[#9a7d88]">{money(r.estimatedMetaTry)}</td>
                  <td className="px-4 py-2.5 font-semibold text-[#c2436a]">{credits(r.creditCost)} kredi</td>
                  <td className="px-4 py-2.5 text-[10.5px] text-[#9a7d88]">{new Date(r.effectiveFromUtc).toLocaleDateString('tr-TR')}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button type="button" onClick={() => setEditing(r)} className="mr-1 inline-flex items-center rounded-lg border border-[#ecd9e1] bg-white p-1.5 text-[#c2436a] hover:bg-[#fff1f6]"><PenLine className="h-3.5 w-3.5" /></button>
                    <DeleteBtn onDelete={async () => { await platformApi.deleteWaPricing(r.id); setRefreshKey((k) => k + 1) }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {editing && <PricingModal rule={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setRefreshKey((k) => k + 1) }} />}
    </div>
  )
}

function BillingSettingsCard({ settings, onSaved }: { settings: ApiWhatsAppBillingSettings; onSaved: () => void }) {
  const [billingEnabled, setBillingEnabled] = useState(settings.billingEnabled)
  const [autoApprove, setAutoApprove] = useState(settings.autoApproveTopUps)
  const [rate, setRate] = useState(String(settings.usdTryRate))
  const [lowBalance, setLowBalance] = useState(String(settings.lowBalanceThresholdCredits))
  const [cap, setCap] = useState(settings.defaultMonthlySpendCapCredits != null ? String(settings.defaultMonthlySpendCapCredits) : '')
  const [smsPerPart, setSmsPerPart] = useState(String(settings.smsCreditsPerPart))
  const [unitPrice, setUnitPrice] = useState(String(settings.creditUnitPriceTry))
  // SMS kredisinin birim fiyatı (18 Kas 2026: SMS ve WhatsApp kredisi ayrı, fiyatları farklı olabilir).
  const [smsUnitPrice, setSmsUnitPrice] = useState(String(settings.smsCreditUnitPriceTry ?? settings.creditUnitPriceTry))
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const save = async () => {
    setBusy(true); setErr(null)
    try {
      await platformApi.saveWaBillingSettings({
        billingEnabled, chargeSimulated: settings.chargeSimulated,
        usdTryRate: Number(rate) || 0,
        lowBalanceThresholdCredits: Number(lowBalance) || 0,
        defaultMonthlySpendCapCredits: cap.trim() === '' ? null : Number(cap),
        autoApproveTopUps: autoApprove,
        smsCreditsPerPart: Number(smsPerPart) || 0,
        creditUnitPriceTry: Number(unitPrice) || 0,
        smsCreditUnitPriceTry: Number(smsUnitPrice) || 0,
      })
      setSaved(true); onSaved(); setTimeout(() => setSaved(false), 2000)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Kaydedilemedi.') } finally { setBusy(false) }
  }

  return (
    <div className="rounded-[16px] border border-[#ecd9e1] bg-white p-4">
      <div className="mb-3 flex items-center gap-2 text-[12px] font-semibold text-[#3f2d36]"><Settings2 className="h-4 w-4 text-[#c2436a]" /> Mesaj kredisi ayarları <span className="font-normal text-[#9a7d88]">· WhatsApp ve SMS kredisi ayrı bakiyeler</span></div>
      <div className="grid gap-3 sm:grid-cols-3">
        <NumField label="SMS kredi / parça" value={smsPerPart} onChange={setSmsPerPart} />
        <NumField label="1 WhatsApp kredisi (₺) — paket dışı" value={unitPrice} onChange={setUnitPrice} />
        <NumField label="1 SMS kredisi (₺) — paket dışı" value={smsUnitPrice} onChange={setSmsUnitPrice} />
        <NumField label="USD/₺ kuru (Meta maliyeti)" value={rate} onChange={setRate} />
        <NumField label="Düşük bakiye eşiği (kredi)" value={lowBalance} onChange={setLowBalance} />
        <NumField label="Varsayılan aylık tavan (kredi)" value={cap} onChange={setCap} placeholder="boş = sınırsız" />
      </div>
      <p className="mt-2 text-[10.5px] leading-relaxed text-[#9a7d88]">
        SMS Unicode gider: 70 karaktere kadar 1 parça, daha uzunu 67&apos;lik parçalara bölünür; mesajın SMS kredisi = parça × SMS kredi / parça.
        WhatsApp ve SMS kredisi ayrı bakiyelerdir; biri diğerinde harcanmaz. Paket fiyatları paketlerin kendisindedir; birim fiyatlar
        yalnız kurumun serbest miktarda aldığı kredi içindir. Aylık tavan her kanala ayrı uygulanır.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <MiniToggle label="Faturalama açık" on={billingEnabled} toggle={() => setBillingEnabled((v) => !v)} />
        <MiniToggle label="Kredi taleplerini otomatik onayla" on={autoApprove} toggle={() => setAutoApprove((v) => !v)} />
      </div>
      {!billingEnabled && (
        <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[10.5px] text-amber-800">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> Faturalama kapalıyken mesajlar krediden düşülmeden yalnız plan kotasıyla gönderilir (pilot dönemi).
        </div>
      )}
      {err && <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">{err}</div>}
      <div className="mt-3 flex justify-end">
        <button type="button" disabled={busy} onClick={save} className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#f47699] to-[#ef6088] px-4 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : null} {saved ? 'Kaydedildi' : 'Kaydet'}
        </button>
      </div>
    </div>
  )
}

function PricingModal({ rule, onClose, onSaved }: { rule: ApiWhatsAppPricingRule | null; onClose: () => void; onSaved: () => void }) {
  const [category, setCategory] = useState<WhatsAppMessageCategory>(rule?.category ?? 'Utility')
  const [metaUsd, setMetaUsd] = useState(String(rule?.metaUsdPrice ?? 0.0009))
  const [cost, setCost] = useState(String(rule?.creditCost ?? 1))
  const [effective, setEffective] = useState((rule?.effectiveFromUtc ?? new Date().toISOString()).slice(0, 10))
  const [note, setNote] = useState(rule?.note ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const save = async () => {
    setBusy(true); setErr(null)
    try {
      const body = { category, metaUsdPrice: Number(metaUsd) || 0, creditCost: Number(cost) || 0, effectiveFromUtc: new Date(effective).toISOString(), note: note.trim() || null }
      if (rule) await platformApi.updateWaPricing(rule.id, body)
      else await platformApi.createWaPricing(body)
      onSaved()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Kaydedilemedi.') } finally { setBusy(false) }
  }

  return (
    <Modal title={rule ? 'Maliyet kuralını düzenle' : 'Yeni maliyet kuralı'} onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-[10px] font-mono uppercase tracking-widest text-[#9a7d88]">Kategori</label>
          <select value={category} onChange={(e) => setCategory(e.target.value as WhatsAppMessageCategory)} disabled={!!rule}
            className="w-full rounded-lg border border-[#ecd9e1] bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-[#ef6088] disabled:opacity-60">
            {(['Utility', 'Marketing', 'Authentication', 'Service'] as const).map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <NumField label="Meta fiyatı (USD)" value={metaUsd} onChange={setMetaUsd} />
          <NumField label="Kurumdan düşen kredi" value={cost} onChange={setCost} />
        </div>
        <p className="text-[10px] text-[#9a7d88]">1 kredi = 1 hatırlatma. 0 girilen ücretli kategori gönderilmez (tanımsız sayılır); ücretsiz yalnız Servis kategorisidir.</p>
        <div>
          <label className="mb-1 block text-[10px] font-mono uppercase tracking-widest text-[#9a7d88]">Yürürlük tarihi</label>
          <input type="date" value={effective} onChange={(e) => setEffective(e.target.value)}
            className="w-full rounded-lg border border-[#ecd9e1] bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-[#ef6088]" />
          <p className="mt-1 text-[10px] text-[#9a7d88]">İleri tarih girerek (ör. 1 Eki 2026) fiyat değişikliğini önceden planlayabilirsiniz.</p>
        </div>
        <Field label="Not" value={note} onChange={setNote} placeholder="opsiyonel" />
        {err && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">{err}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-lg border border-[#ecd9e1] bg-white px-3.5 py-1.5 text-[12px] font-semibold text-[#6c5661]">Vazgeç</button>
          <button type="button" disabled={busy} onClick={save} className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#f47699] to-[#ef6088] px-4 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Kaydet
          </button>
        </div>
      </div>
    </Modal>
  )
}

/* ===================== KREDİ PAKETLERİ ===================== */
function PackagesTab() {
  const [refreshKey, setRefreshKey] = useState(0)
  const { data, loading, error } = useApiQuery<ApiCreditPackage[]>(
    () => platformApi.waCreditPackages<ApiCreditPackage>(true), [refreshKey], { initialData: [] })
  const [editing, setEditing] = useState<ApiCreditPackage | 'new' | null>(null)

  return (
    <div className="space-y-4">
      <ApiStateNotice loading={loading} error={error} />
      <div className="flex justify-end">
        <button type="button" onClick={() => setEditing('new')}
          className="inline-flex items-center gap-1 rounded-lg bg-gradient-to-r from-[#f47699] to-[#ef6088] px-3 py-1.5 text-[11px] font-semibold text-white">
          <Plus className="h-3.5 w-3.5" /> Paket ekle
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(data ?? []).map((p) => (
          <div key={p.id} className={`rounded-[16px] border bg-white p-4 ${p.isActive ? 'border-[#ecd9e1]' : 'border-dashed border-[#e6d3db] opacity-70'}`}>
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[13px] font-semibold text-[#3f2d36]">{p.name}</div>
                {p.description && <div className="text-[10.5px] text-[#9a7d88]">{p.description}</div>}
              </div>
              <div className="flex gap-1">
                <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${p.channel === 'Sms' ? 'bg-[#1E4E8C] text-white' : 'bg-[#1E8C60] text-white'}`}>{p.channel === 'Sms' ? 'SMS' : 'WhatsApp'}</span>
                {!p.isActive && <span className="rounded bg-[#f3e6ec] px-1.5 py-0.5 text-[9px] font-semibold text-[#9a7d88]">Pasif</span>}
              </div>
            </div>
            <div className="mt-2 text-[22px] font-bold text-[#c2436a]">{credits(p.grantsCredits)} kredi</div>
            <div className="text-[11px] text-[#6c5661]">Fiyat: <b>{money(p.priceTry)}</b>{p.grantsCredits > 0 && <span className="text-[#9a7d88]"> · kredi başı {money(p.priceTry / p.grantsCredits)}</span>}</div>
            <div className="text-[10.5px] text-[#9a7d88]">≈ {p.estimatedUtilityMessages.toLocaleString('tr-TR')} mesaj</div>
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => setEditing(p)} className="inline-flex items-center gap-1 rounded-lg border border-[#ecd9e1] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#c2436a] hover:bg-[#fff1f6]"><PenLine className="h-3.5 w-3.5" /> Düzenle</button>
              <DeleteBtn onDelete={async () => { await platformApi.deleteWaCreditPackage(p.id); setRefreshKey((k) => k + 1) }} />
            </div>
          </div>
        ))}
      </div>
      {editing && <PackageModal pkg={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setRefreshKey((k) => k + 1) }} />}
    </div>
  )
}

function PackageModal({ pkg, onClose, onSaved }: { pkg: ApiCreditPackage | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(pkg?.name ?? '')
  const [description, setDescription] = useState(pkg?.description ?? '')
  const [price, setPrice] = useState(String(pkg?.priceTry ?? 150))
  const [grants, setGrants] = useState(String(pkg?.grantsCredits ?? 1000))
  const [order, setOrder] = useState(String(pkg?.displayOrder ?? 0))
  const [active, setActive] = useState(pkg?.isActive ?? true)
  const [channel, setChannel] = useState<'WhatsApp' | 'Sms'>(pkg?.channel ?? 'WhatsApp')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const save = async () => {
    setBusy(true); setErr(null)
    try {
      const body = { name: name.trim(), description: description.trim() || null, priceTry: Number(price) || 0, grantsCredits: Number(grants) || 0, displayOrder: Number(order) || 0, isActive: active, channel }
      if (pkg) await platformApi.updateWaCreditPackage(pkg.id, body)
      else await platformApi.createWaCreditPackage(body)
      onSaved()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Kaydedilemedi.') } finally { setBusy(false) }
  }

  return (
    <Modal title={pkg ? 'Paketi düzenle' : 'Yeni kredi paketi'} onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-[10px] font-mono uppercase tracking-widest text-[#9a7d88]">Kredi türü</label>
          <div className="flex gap-1 rounded-lg border border-[#ecd9e1] bg-[#F7F6F6] p-1">
            {(['WhatsApp', 'Sms'] as const).map((c) => (
              <button key={c} type="button" onClick={() => setChannel(c)}
                className={`flex-1 rounded-md px-2.5 py-1.5 text-[11.5px] font-semibold transition ${channel === c ? 'bg-[#8e3f5b] text-white' : 'text-[#6c5661]'}`}>
                {c === 'Sms' ? 'SMS kredisi' : 'WhatsApp kredisi'}
              </button>
            ))}
          </div>
        </div>
        <Field label="Paket adı" value={name} onChange={setName} placeholder="örn. Başlangıç Kredi" />
        <Field label="Açıklama" value={description} onChange={setDescription} placeholder="≈1.000 WhatsApp hatırlatma ya da 500 SMS" />
        <div className="grid grid-cols-3 gap-3">
          <NumField label="Fiyat (₺)" value={price} onChange={setPrice} />
          <NumField label="Yüklenen kredi" value={grants} onChange={setGrants} />
          <NumField label="Sıra" value={order} onChange={setOrder} />
        </div>
        {Number(grants) > 0 && Number(price) > 0 && (
          <p className="text-[10.5px] text-[#9a7d88]">Kredi başı {money(Number(price) / Number(grants))}</p>
        )}
        <MiniToggle label="Aktif (satışta)" on={active} toggle={() => setActive((v) => !v)} />
        {err && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">{err}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-lg border border-[#ecd9e1] bg-white px-3.5 py-1.5 text-[12px] font-semibold text-[#6c5661]">Vazgeç</button>
          <button type="button" disabled={busy || !name.trim()} onClick={save} className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#f47699] to-[#ef6088] px-4 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Kaydet
          </button>
        </div>
      </div>
    </Modal>
  )
}

/* ===================== ORTAK ===================== */
function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className={`max-h-[90vh] w-full ${wide ? 'max-w-xl' : 'max-w-md'} overflow-y-auto rounded-[18px] border border-[#ecd9e1] bg-white p-5 shadow-2xl`} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-[14px] font-semibold text-[#3f2d36]">{title}</h3>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-[#9a7d88] hover:bg-[#f7eef2]"><X className="h-4 w-4" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder, type = 'text', mono }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; mono?: boolean }) {
  return (
    <div>
      <label className="mb-1 block text-[10px] font-mono uppercase tracking-widest text-[#9a7d88]">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className={`w-full rounded-lg border border-[#ecd9e1] bg-white px-2.5 py-1.5 text-[12px] text-[#3f2d36] outline-none focus:border-[#ef6088] ${mono ? 'font-mono text-[11px]' : ''}`} />
    </div>
  )
}

function NumField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="mb-1 block text-[10px] font-mono uppercase tracking-widest text-[#9a7d88]">{label}</label>
      <input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ''))} placeholder={placeholder}
        className="w-full rounded-lg border border-[#ecd9e1] bg-white px-2.5 py-1.5 text-[12px] text-[#3f2d36] outline-none focus:border-[#ef6088]" />
    </div>
  )
}

function MiniToggle({ label, on, toggle }: { label: string; on: boolean; toggle: () => void }) {
  return (
    <button type="button" onClick={toggle} className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[11.5px] font-medium transition ${on ? 'border-[#ef6088] bg-[#fff1f6] text-[#c2436a]' : 'border-[#ecd9e1] bg-white text-[#6c5661]'}`}>
      <span className={`relative h-4 w-8 rounded-full transition ${on ? 'bg-[#ef6088]' : 'bg-[#d8c4cc]'}`}>
        <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
      {label}
    </button>
  )
}

function DeleteBtn({ onDelete }: { onDelete: () => Promise<void> }) {
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  if (confirm) {
    return (
      <span className="inline-flex items-center gap-1">
        <button type="button" disabled={busy} onClick={async () => { setBusy(true); try { await onDelete() } finally { setBusy(false) } }}
          className="inline-flex items-center rounded-lg bg-rose-600 px-2 py-1.5 text-[10px] font-semibold text-white">{busy ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Sil'}</button>
        <button type="button" onClick={() => setConfirm(false)} className="rounded-lg border border-[#ecd9e1] px-2 py-1.5 text-[10px] text-[#6c5661]">Vazgeç</button>
      </span>
    )
  }
  return <button type="button" onClick={() => setConfirm(true)} className="inline-flex items-center rounded-lg border border-[#ecd9e1] bg-white p-1.5 text-rose-500 hover:bg-rose-50"><Trash2 className="h-3.5 w-3.5" /></button>
}

function StatusBadge({ status }: { status: string }) {
  const cls = status === 'Connected' ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : status === 'Pending' ? 'border-amber-200 bg-amber-50 text-amber-700'
    : status === 'Disabled' ? 'border-rose-200 bg-rose-50 text-rose-700'
    : 'border-[#ecd9e1] bg-[#fbf1f5] text-[#9a7d88]'
  const Icon = status === 'Connected' ? ShieldCheck : status === 'Pending' ? Clock3 : PhoneCall
  return <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold ${cls}`}><Icon className="h-3 w-3" /> {STATUS_LABEL[status] ?? status}</span>
}

function PurchaseBadge({ status }: { status: string }) {
  const cls = status === 'Approved' ? 'bg-emerald-50 text-emerald-700' : status === 'Rejected' ? 'bg-rose-50 text-rose-600' : status === 'Cancelled' ? 'bg-[#f3e6ec] text-[#9a7d88]' : 'bg-amber-50 text-amber-700'
  const label = status === 'Approved' ? 'Onaylandı' : status === 'Rejected' ? 'Reddedildi' : status === 'Cancelled' ? 'İptal' : 'Bekliyor'
  return <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${cls}`}>{label}</span>
}
