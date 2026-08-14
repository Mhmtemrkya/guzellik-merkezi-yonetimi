'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import {
  Archive,
  CheckCircle2,
  ClipboardSignature,
  Clock3,
  FileText,
  Layers3,
  PauseCircle,
  Sparkles,
  Trash2,
  Users,
  Wallet,
} from 'lucide-react'
import {
  CatalogModal,
  Fact,
  ModalSection,
  ModalTabs,
  StatusPill,
  catalogDangerBtn,
  catalogGhostBtn,
  catalogPrimaryBtn,
} from '@/components/dashboard/CatalogKit'
import { ServiceIcon, suggestIcon } from '@/components/dashboard/ServiceIcons'
import { formatTL, staffCanPerform } from '@/lib/apiMappers'
import type { CatalogStatusKey, ServicePackage, Staff } from '@/lib/types'

/**
 * Hizmet detay modali.
 *
 * Eskiden bu bilgiler sayfanın sağındaki sabit panelde duruyordu ve panelin yarısı
 * UYDURMA rakamlarla doluydu: "kâr marjı" fiyat/enbüyük-fiyat oranından, "hazırlık
 * süresi" süre/6'dan, "müşteri memnuniyeti" iptal oranından türetiliyordu; "toplam
 * rezervasyon" ise yalnızca ilk 500 randevunun sayımıydı. Hiçbiri ölçülmüş veri
 * değildi, hepsi kaldırıldı.
 *
 * Burada YALNIZCA kaydın kendi alanları ve gerçekten ölçülebilen bağlar gösterilir:
 * hizmeti içeren paketler, bağlı onam formları, uzmanlık tanımına göre bu hizmeti
 * verebilen personel (randevu ekranındaki `staffCanPerform` kuralının aynısı) ve
 * sunucudan bu hizmete göre süzülen gerçek satış listesi.
 */

type TabKey = 'ozet' | 'satis'

export interface ServiceDetailItem {
  id: string
  name: string
  /** HAM kategori adı — normalizeService'in uydurduğu "Genel Hizmet" değil. */
  rawCategory: string
  subGroup: string
  duration: number
  price: number
  session: number
  loyaltyPointCost: number
  status: CatalogStatusKey
  iconKey: string
}

function initials(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function StaffChip({ member }: { member: Staff }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[#EAD8DF] bg-white py-1 pl-1 pr-2.5 text-[11.5px] font-medium text-[#2A2027]">
      {member.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={member.photoUrl} alt="" className="h-6 w-6 rounded-full border border-[#EAD8DF] object-cover" />
      ) : (
        <span className="grid h-6 w-6 place-items-center rounded-full bg-[#A5556E] text-[10px] font-semibold text-white">
          {initials(member.name)}
        </span>
      )}
      {member.name}
    </span>
  )
}

export default function ServiceDetailModal({
  open,
  onOpenChange,
  service,
  staff,
  packages,
  consentTitles,
  busy,
  canManage,
  canDelete,
  onStatus,
  onDelete,
  renderEditTrigger,
  renderSellTrigger,
  renderSales,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  service: ServiceDetailItem | null
  staff: Staff[]
  /** Kataloğun tamamı — hangi paketlerin bu hizmeti içerdiği buradan çıkarılır. */
  packages: ServicePackage[]
  /** Bu hizmete bağlı onam formu başlıkları. */
  consentTitles: string[]
  busy: boolean
  canManage: boolean
  canDelete: boolean
  onStatus: (status: CatalogStatusKey) => void
  onDelete: () => void
  renderEditTrigger: () => ReactNode
  renderSellTrigger: () => ReactNode
  /** Satış paneli yalnız sekmesi açıkken kurulur (kendi isteğini o an atar). */
  renderSales: () => ReactNode
}) {
  const [tab, setTab] = useState<TabKey>('ozet')

  const inPackages = useMemo(
    () => (service ? packages.filter((pkg) => pkg.items.some((item) => item.serviceDefinitionId === service.id)) : []),
    [packages, service],
  )

  /** Uzmanlığı bu hizmete AÇIKÇA uyan aktif personel (randevu ekranıyla aynı kural). */
  const matchedStaff = useMemo(
    () =>
      service
        ? staff.filter(
            (member) =>
              member.active &&
              (member.specialties || '').trim() !== '' &&
              staffCanPerform(member.specialties, service.rawCategory, service.name),
          )
        : [],
    [staff, service],
  )
  /** Uzmanlık alanı hiç tanımlı olmayan personelde kısıt uygulanmaz — sayısı belirtilir. */
  const unrestrictedCount = useMemo(
    () => staff.filter((member) => member.active && (member.specialties || '').trim() === '').length,
    [staff],
  )

  if (!service) return null

  const iconKey = service.iconKey || suggestIcon(service.name || service.rawCategory)

  return (
    <CatalogModal
      open={open}
      onOpenChange={onOpenChange}
      icon={Sparkles}
      eyebrow="Hizmet detayı"
      title={service.name}
      subtitle={`${service.rawCategory || 'Kategorisiz'}${service.subGroup ? ` › ${service.subGroup}` : ''} · ${service.duration} dk · ${formatTL(service.price)}`}
      badge={<StatusPill status={service.status} />}
      width={1080}
      height={880}
      tabs={
        <ModalTabs
          idPrefix="service-detail"
          value={tab}
          onChange={setTab}
          options={[
            { key: 'ozet', label: 'Künye', icon: FileText },
            { key: 'satis', label: 'Satışlar', icon: Wallet },
          ]}
        />
      }
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {canManage && service.status !== 'Active' && (
              <button type="button" disabled={busy} onClick={() => onStatus('Active')} className={catalogPrimaryBtn}>
                <CheckCircle2 className="h-3.5 w-3.5" /> Yayına al
              </button>
            )}
            {canManage && service.status === 'Active' && (
              <button type="button" disabled={busy} onClick={() => onStatus('Passive')} className={catalogGhostBtn}>
                <PauseCircle className="h-3.5 w-3.5" /> Pasife al
              </button>
            )}
            {canManage && service.status !== 'Draft' && (
              <button type="button" disabled={busy} onClick={() => onStatus('Draft')} className={catalogGhostBtn}>
                <FileText className="h-3.5 w-3.5" /> Taslağa al
              </button>
            )}
            {canManage && service.status !== 'Archived' && (
              <button type="button" disabled={busy} onClick={() => onStatus('Archived')} className={catalogGhostBtn}>
                <Archive className="h-3.5 w-3.5" /> Arşivle
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canDelete && (
              <button type="button" disabled={busy} onClick={onDelete} className={catalogDangerBtn}>
                <Trash2 className="h-3.5 w-3.5" /> Sil
              </button>
            )}
            {renderSellTrigger()}
            {canManage && renderEditTrigger()}
          </div>
        </div>
      }
    >
      {tab === 'ozet' ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className="space-y-3 p-4 sm:p-5"
        >
          <div className="flex items-center gap-3 rounded-[18px] border border-[#EAD8DF] bg-white p-4">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-[18px] bg-[#A5556E] text-white">
              <ServiceIcon iconKey={iconKey} className="h-7 w-7" />
            </span>
            <div className="min-w-0">
              <div className="truncate font-display text-[22px] font-bold leading-tight tracking-tight text-[#2A2027]">
                {service.name}
              </div>
              <div className="mt-0.5 text-[12px] font-medium text-[#705a66]">
                {service.rawCategory || 'Kategorisiz'}
                {service.subGroup ? ` › ${service.subGroup}` : ''}
              </div>
            </div>
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            <Fact label="Süre" value={`${service.duration} dk`} />
            <Fact label="Fiyat" value={formatTL(service.price)} />
            <Fact label="Varsayılan seans" value={service.session === 1 ? 'Tek seans' : `${service.session} seans`} />
            <Fact
              label="Sadakat puanı"
              value={service.loyaltyPointCost > 0 ? `${service.loyaltyPointCost} P` : 'Hediye edilemez'}
              tone={service.loyaltyPointCost > 0 ? 'text-[#8A5A11]' : 'text-[#5A4B53]'}
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <ModalSection
              title="Bu hizmeti verebilen personel"
              hint="Personel kartındaki uzmanlık alanına göre — randevu ekranının kullandığı kuralın aynısı."
            >
              {matchedStaff.length === 0 && unrestrictedCount === 0 ? (
                <p className="text-[12px] text-[#705a66]">Aktif personel kaydı yok.</p>
              ) : (
                <div className="space-y-2.5">
                  {matchedStaff.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {matchedStaff.map((member) => (
                        <StaffChip key={member.id} member={member} />
                      ))}
                    </div>
                  ) : (
                    <p className="text-[12px] text-[#705a66]">
                      Uzmanlık alanı bu kategoriye ayarlı personel yok.
                    </p>
                  )}
                  {unrestrictedCount > 0 && (
                    <p className="flex items-start gap-1.5 rounded-[11px] border border-[#EAD8DF] bg-[#F7F6F6] px-3 py-2 text-[11.5px] leading-snug text-[#4a3a44]">
                      <Users aria-hidden className="mt-px h-3.5 w-3.5 shrink-0 text-[#74616A]" />
                      {unrestrictedCount} personelin uzmanlık alanı tanımlı değil; onlara kısıt uygulanmaz, bu hizmete de
                      atanabilirler.
                    </p>
                  )}
                </div>
              )}
            </ModalSection>

            <ModalSection
              title="Geçtiği paketler"
              hint="Bu hizmeti içeren paket tanımları."
              action={
                <span className="rounded-full border border-[#EAD8DF] bg-[#F7F6F6] px-2.5 py-0.5 text-[11px] font-semibold tabular-nums text-[#5A4B53]">
                  {inPackages.length}
                </span>
              }
            >
              {inPackages.length === 0 ? (
                <p className="text-[12px] text-[#705a66]">Bu hizmet hiçbir pakete eklenmemiş.</p>
              ) : (
                <ul className="space-y-1.5">
                  {inPackages.map((pkg) => {
                    const line = pkg.items.find((item) => item.serviceDefinitionId === service.id)
                    return (
                      <li
                        key={pkg.id}
                        className="flex items-center justify-between gap-3 rounded-[12px] border border-[#EAD8DF] bg-[#F7F6F6] px-3 py-2"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <Layers3 aria-hidden className="h-3.5 w-3.5 shrink-0 text-[#A5556E]" />
                          <span className="truncate text-[12.5px] font-medium text-[#2A2027]">{pkg.name}</span>
                        </span>
                        <span className="shrink-0 text-[11.5px] font-semibold tabular-nums text-[#5A4B53]">
                          {line ? `${line.sessionCount} seans` : '—'}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </ModalSection>
          </div>

          <ModalSection
            title="Onam formu"
            hint="Bu hizmet için imzalanması istenen formlar. Ayarlar › Onam Formları'ndan tanımlanır."
          >
            {consentTitles.length === 0 ? (
              <p className="text-[12px] text-[#705a66]">Bu hizmete bağlı onam formu yok.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {consentTitles.map((title) => (
                  <span
                    key={title}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[#EAD8DF] bg-[#F7F6F6] px-2.5 py-1 text-[11.5px] font-medium text-[#2A2027]"
                  >
                    <ClipboardSignature aria-hidden className="h-3.5 w-3.5 text-[#A5556E]" />
                    {title}
                  </span>
                ))}
              </div>
            )}
          </ModalSection>

          <p className="flex items-start gap-2 rounded-[14px] border border-[#EAD8DF] bg-white px-3.5 py-2.5 text-[11.5px] leading-snug text-[#4a3a44]">
            <Clock3 aria-hidden className="mt-px h-3.5 w-3.5 shrink-0 text-[#74616A]" />
            Bu ekranda tahmini rakam gösterilmez. Bu hizmetin gerçek satış geçmişi, tahsilatı ve kim tarafından
            satıldığı <strong className="font-semibold text-[#2A2027]">Satışlar</strong> sekmesindedir.
          </p>
        </motion.div>
      ) : (
        <div className="p-4 sm:p-5">{renderSales()}</div>
      )}
    </CatalogModal>
  )
}
