'use client'

import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Topbar from '@/components/dashboard/Topbar'
import ApiStateNotice from '@/components/dashboard/ApiStateNotice'
import { PanelPage, PanelStat } from '@/components/dashboard/PanelKit'
import ModalPortal from '@/components/dashboard/ModalPortal'
import PackageSaleDialog from '@/components/dashboard/PackageSaleDialog'
import { ServiceIcon, suggestIcon } from '@/components/dashboard/ServiceIcons'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useFeature } from '@/components/dashboard/FeatureContext'
import { usePermission } from '@/hooks/usePermission'
import { adminApi } from '@/lib/apiClient'
import { apiItems, categoryOrderIndex, formatTL, normalizeCustomServiceCategory, normalizePackage, normalizeService } from '@/lib/apiMappers'
import {
  ArrowDown, ArrowUp, ChevronRight, FolderPlus, Layers3, Package, Pencil,
  Plus, Search, Sparkles, Tag, Trash2, X,
} from 'lucide-react'
import type { ApiCustomServiceCategory, ApiService, ApiServicePackage, Service } from '@/lib/types'

const UNCATEGORIZED = 'Kategorisiz'

interface SubNode { name: string; customId?: string; serviceCount: number; packageCount: number }
interface CatNode { name: string; isCustom: boolean; customId?: string; serviceCount: number; packageCount: number; subCount: number }

/**
 * Silme onayı için hedef. 'custom' = gerçek kategori kaydı; 'derived' = kaydı olmayan,
 * yalnızca hizmet/paket üzerinde metin olarak duran (eskiden serbest yazılmış) ad.
 */
interface PendingDelete {
  kind: 'custom' | 'derived'
  id: string
  name: string
  level: 'category' | 'sub'
  /** Etkilenecek hizmet + paket adedi (derived silmede kullanıcıya gösterilir). */
  usageCount: number
  /** custom silmede birlikte gidecek alt kategori adedi. */
  subCount: number
}

/** Hizmet + gruplamada kullanılan HAM kategori adı (bkz. `services` useMemo). */
type ExplorerService = Service & { rawCategory: string }

type ItemKind = 'service' | 'package'
/** Hizmet ve paketler tek listede gösterilir; tür rozetle ayrışır. */
interface CatalogRow {
  kind: ItemKind
  id: string
  name: string
  iconKey: string
  sub: string
  meta: string
  price: number
  active: boolean
  /** Paket içeriği ("Lazer ×6") — yalnız paketlerde dolu. */
  parts: string[]
}

const TYPE_TABS: { key: 'all' | ItemKind; label: string }[] = [
  { key: 'all', label: 'Tümü' },
  { key: 'service', label: 'Hizmetler' },
  { key: 'package', label: 'Paketler' },
]

/**
 * Kategori yönetimi — ana/alt kategori ağacı (solda) + seçili kategorinin içeriği (sağda).
 *
 * TASARIM KARARLARI (neden böyle):
 *
 * 1. **Gezinme tek yerde: soldaki ağaç.** Önceki hâlde kategoriler ekranın tamamını kaplayan
 *    kart ızgarasıydı; 15 kategoride seçili kategorinin içeriği ekranın çok altında kalıyor,
 *    "neye tıkladım / ne görüyorum" bağı kopuyordu. Ray + içerik yerleşiminde kategori listesi
 *    her zaman görünür, içerik yanında açılır.
 *
 * 2. **İşlemler tek yerde: sağdaki başlık kartı.** Kart ızgarasında her kartın köşesinde
 *    hover'da beliren üç ayrı mini simge (öne al / geri al / "alt" / çöp kutusu) vardı;
 *    dokunmatikte erişilemiyor, anlamları tahmin gerektiriyordu. Artık seçili kategori/alt
 *    kategori için ETİKETLİ butonlar tek satırda durur: Alt kategori ekle · Yeniden adlandır ·
 *    sırala · Sil. Ağaç satırları saf gezinmedir.
 *
 * 3. **Hizmet + paket tek liste.** İki ayrı panel yerine tür süzgeçli tek tablo: aynı kategoride
 *    kaç kayıt olduğu tek yerden okunur, dar ekranda iki panel birbirini ezmez.
 *
 * 4. **Yeniden adlandırma kayıtları da taşır.** Kategori adı hizmet/paket üzerinde METİN olarak
 *    durur; yalnız kategori kaydını yeniden adlandırmak kayıtları eski adla ortada bırakır
 *    (kategori boşalır, eski ad "otomatik" kategori olarak listede kalır). Bu yüzden ad
 *    değişince o adı taşıyan tüm hizmet ve paketler de güncellenir.
 */
export default function CategoryExplorer({
  tenantId,
  institutionName,
  branchLabel,
}: {
  tenantId?: string
  institutionName?: string
  branchLabel?: string
}) {
  const canCustomCat = useFeature('categories.service.custom')
  const { can } = usePermission()
  const canManage = canCustomCat && can('Services.Manage')
  const canDelete = canCustomCat && can('Services.Delete')

  const [selectedCat, setSelectedCat] = useState<string | null>(null)
  const [selectedSub, setSelectedSub] = useState<string>('') // '' = tüm alt kategoriler
  const [catQuery, setCatQuery] = useState('')
  const [itemQuery, setItemQuery] = useState('')
  const [typeTab, setTypeTab] = useState<'all' | ItemKind>('all')
  const [newCatName, setNewCatName] = useState('')
  const [adding, setAdding] = useState(false)
  const [newSubName, setNewSubName] = useState('')
  const [addingSub, setAddingSub] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)

  const { data, loading, error: apiError, reload } = useApiQuery<{
    services: ApiService[]; packages: ApiServicePackage[]; cats: ApiCustomServiceCategory[]
  }>(
    async () => {
      if (!tenantId) return { services: [], packages: [], cats: [] }
      const [services, packages, cats] = await Promise.all([
        adminApi.services<ApiService>({ tenantId, page: 1, pageSize: 300 }).catch(() => ({ items: [] })),
        adminApi.packages<ApiServicePackage>({ tenantId, page: 1, pageSize: 300 }).catch(() => ({ items: [] })),
        adminApi.serviceCategories<ApiCustomServiceCategory>(tenantId).catch(() => []),
      ])
      return { services: apiItems(services), packages: apiItems(packages), cats: Array.isArray(cats) ? cats : [] }
    },
    [tenantId],
    { initialData: { services: [], packages: [], cats: [] } },
  )

  // normalizeService, kategorisi BOŞ hizmete "Genel Hizmet" adını uydurur. Gruplama ve geri
  // yazma bu uydurma adı kullanamaz: kategorisi olmayan bir hizmet güncellenirken ona gerçekten
  // "Genel Hizmet" kategorisi yazılır ve kayıt sessizce yanlış kategoriye taşınırdı.
  const services = useMemo<ExplorerService[]>(
    () => (data?.services || []).map((s, i) => ({ ...normalizeService(s, i), rawCategory: (s?.category || s?.group || '').trim() })),
    [data],
  )
  const packages = useMemo(() => (data?.packages || []).map((p, i) => normalizePackage(p, i)), [data])
  const customCats = useMemo(() => (data?.cats || []).map((c, i) => normalizeCustomServiceCategory(c, i)), [data])
  // Üst-seviye özel kategoriler (alt kategori kayıtları haritadan hariç).
  const topCustomCats = useMemo(() => customCats.filter((c) => !c.parentId), [customCats])
  const catNameById = useMemo(() => new Map(customCats.map((c) => [c.id, c.name])), [customCats])

  /**
   * Tüm alt kategoriler tek geçişte üst kategori adına göre gruplanır: hem ağaçtaki
   * "N alt kategori" sayacı hem de ray aramasının alt kategori adıyla eşleşmesi buna dayanır.
   */
  const subsByCat = useMemo(() => {
    const out = new Map<string, Map<string, SubNode>>()
    const touch = (cat: string, name: string) => {
      if (!out.has(cat)) out.set(cat, new Map())
      const bucket = out.get(cat)!
      if (!bucket.has(name)) bucket.set(name, { name, serviceCount: 0, packageCount: 0 })
      return bucket.get(name)!
    }
    for (const c of customCats) {
      if (!c.parentId) continue
      const parent = catNameById.get(c.parentId)
      if (!parent) continue // üst kategorisi silinmiş öksüz kayıt — listelenmez
      touch(parent, c.name).customId = c.id
    }
    for (const s of services) if (s.subGroup) touch(s.rawCategory || UNCATEGORIZED, s.subGroup).serviceCount++
    for (const p of packages) if (p.subCategory) touch(p.category || UNCATEGORIZED, p.subCategory).packageCount++
    return out
  }, [customCats, catNameById, services, packages])

  // Üst kategori havuzu: üst-seviye özel kategoriler + hizmet/paketlerde geçen kategori adları + Kategorisiz
  const categories = useMemo<CatNode[]>(() => {
    const map = new Map<string, CatNode>()
    const touch = (name: string) => {
      const key = name || UNCATEGORIZED
      if (!map.has(key)) map.set(key, { name: key, isCustom: false, serviceCount: 0, packageCount: 0, subCount: 0 })
      return map.get(key)!
    }
    for (const c of topCustomCats) {
      const e = touch(c.name)
      e.isCustom = true
      e.customId = c.id
    }
    for (const s of services) touch(s.rawCategory || UNCATEGORIZED).serviceCount++
    for (const p of packages) touch(p.category || UNCATEGORIZED).packageCount++
    for (const e of map.values()) e.subCount = subsByCat.get(e.name)?.size ?? 0
    // Manuel sıra (SortOrder) önce; türetilmiş adlar adete/alfabeye göre sona, "Kategorisiz" en sonda.
    const orderOf = categoryOrderIndex(topCustomCats)
    return [...map.values()].sort((a, b) =>
      orderOf(a.name) - orderOf(b.name)
      || (b.serviceCount + b.packageCount) - (a.serviceCount + a.packageCount)
      || a.name.localeCompare(b.name, 'tr'))
  }, [topCustomCats, services, packages, subsByCat])

  const activeCat = selectedCat && categories.some((c) => c.name === selectedCat) ? selectedCat : categories[0]?.name || null
  const activeCatInfo = categories.find((c) => c.name === activeCat)
  const activeCatCustomId = activeCatInfo?.customId
  const isUncategorized = activeCat === UNCATEGORIZED

  // Aktif kategorinin alt kategorileri — kendi SortOrder'ına göre, sonra alfabetik.
  const subCategories = useMemo<SubNode[]>(() => {
    const bucket = subsByCat.get(activeCat || '')
    if (!bucket) return []
    const orderOf = categoryOrderIndex(customCats.filter((c) => c.parentId === activeCatCustomId))
    return [...bucket.values()].sort((a, b) => orderOf(a.name) - orderOf(b.name) || a.name.localeCompare(b.name, 'tr'))
  }, [subsByCat, activeCat, activeCatCustomId, customCats])

  // Ray araması: kategori adı VEYA içindeki bir alt kategori adı eşleşirse kategori görünür.
  const railCats = useMemo(() => {
    const t = catQuery.trim().toLocaleLowerCase('tr')
    if (!t) return categories
    return categories.filter((c) =>
      c.name.toLocaleLowerCase('tr').includes(t)
      || [...(subsByCat.get(c.name)?.keys() ?? [])].some((n) => n.toLocaleLowerCase('tr').includes(t)))
  }, [categories, catQuery, subsByCat])

  const rows = useMemo<CatalogRow[]>(() => {
    const inScope = (cat: string, sub: string) => cat === activeCat && (!selectedSub || sub === selectedSub)
    const out: CatalogRow[] = []
    for (const s of services) {
      if (!inScope(s.rawCategory || UNCATEGORIZED, s.subGroup)) continue
      out.push({
        kind: 'service', id: s.id, name: s.name, iconKey: s.iconKey || suggestIcon(s.name || s.group),
        sub: s.subGroup, meta: `${s.duration} dk`, price: s.price, active: s.status === 'Active', parts: [],
      })
    }
    for (const p of packages) {
      if (!inScope(p.category || UNCATEGORIZED, p.subCategory)) continue
      out.push({
        kind: 'package', id: p.id, name: p.name, iconKey: p.iconKey || suggestIcon(p.name || p.category),
        sub: p.subCategory, meta: `${p.totalSessions} seans`, price: p.totalPrice, active: p.isActive,
        parts: p.items.map((i) => `${i.serviceName} ×${i.sessionCount}`),
      })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, 'tr'))
  }, [services, packages, activeCat, selectedSub])

  const serviceCount = rows.filter((r) => r.kind === 'service').length
  const packageCount = rows.length - serviceCount
  const visibleRows = useMemo(() => {
    let list = typeTab === 'all' ? rows : rows.filter((r) => r.kind === typeTab)
    const t = itemQuery.trim().toLocaleLowerCase('tr')
    if (t) list = list.filter((r) => r.name.toLocaleLowerCase('tr').includes(t) || r.sub.toLocaleLowerCase('tr').includes(t))
    return list
  }, [rows, typeTab, itemQuery])

  // Görüntülenen özne: alt kategori seçiliyse o, değilse kategorinin kendisi.
  const subjectInfo = selectedSub ? subCategories.find((s) => s.name === selectedSub) : undefined
  const subject = selectedSub
    ? { level: 'sub' as const, name: selectedSub, customId: subjectInfo?.customId, usage: (subjectInfo?.serviceCount ?? 0) + (subjectInfo?.packageCount ?? 0) }
    : { level: 'category' as const, name: activeCat || '', customId: activeCatCustomId, usage: (activeCatInfo?.serviceCount ?? 0) + (activeCatInfo?.packageCount ?? 0) }

  // Elle sıralama yalnız kayıtlı (özel) kategorilerde; kardeşler arasında yapılır.
  const topCustomIds = useMemo(() => categories.filter((c) => c.customId).map((c) => c.customId!), [categories])
  const subCustomIds = useMemo(() => subCategories.filter((s) => s.customId).map((s) => s.customId!), [subCategories])
  const siblingIds = subject.level === 'sub' ? subCustomIds : topCustomIds
  const orderIndex = subject.customId ? siblingIds.indexOf(subject.customId) : -1
  const canReorder = canManage && orderIndex >= 0 && siblingIds.length > 1

  const selectCategory = (name: string) => {
    setSelectedCat(name); setSelectedSub(''); setAddingSub(false); setNewSubName('')
    setRenaming(false); setItemQuery(''); setTypeTab('all'); setError('')
  }
  const selectSub = (name: string) => { setSelectedSub(name); setRenaming(false); setItemQuery(''); setError('') }

  const run = async (fn: () => Promise<unknown>, fallback: string) => {
    setBusy(true)
    setError('')
    try {
      await fn()
      await reload()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : fallback)
      return false
    } finally {
      setBusy(false)
    }
  }

  const createCat = async () => {
    const name = newCatName.trim()
    if (!name) return
    const ok = await run(() => adminApi.createServiceCategory({ name, isActive: true }, tenantId), 'Kategori eklenemedi')
    if (ok) { setNewCatName(''); setAdding(false); setSelectedCat(name); setSelectedSub('') }
  }

  const createSubCat = async () => {
    const name = newSubName.trim()
    if (!name || !activeCat || isUncategorized) return
    const ok = await run(async () => {
      // Türetilmiş (kaydı olmayan) üst kategoriye de alt kategori eklenebilsin:
      // önce üst kategori kuruma özel kategori olarak oluşturulur, sonra alt kategori ona bağlanır.
      let parentId = activeCatCustomId
      if (!parentId) {
        const created = await adminApi.createServiceCategory<ApiCustomServiceCategory>({ name: activeCat, isActive: true }, tenantId)
        parentId = created?.id
      }
      if (!parentId) throw new Error('Üst kategori oluşturulamadı')
      await adminApi.createServiceCategory({ name, isActive: true, parentId }, tenantId)
    }, 'Alt kategori eklenemedi')
    if (ok) { setNewSubName(''); setAddingSub(false); setSelectedSub(name) }
  }

  /** Hizmet PUT'u tam gövde ister; yalnızca değişen alanı geçmek için taban yük. */
  const servicePayload = (s: ExplorerService, over: Record<string, unknown>) => ({
    branchId: s.branchId || null, name: s.name, category: s.rawCategory || null, subCategory: s.subGroup || null,
    durationMinutes: s.duration, price: s.price, isActive: s.isActive, iconKey: s.iconKey || null,
    status: s.status, defaultSessionCount: s.session || 1, loyaltyPointCost: s.loyaltyPointCost || null,
    ...over,
  })

  const startRename = () => { setRenameValue(subject.name); setRenaming(true); setError('') }

  /** Kategori/alt kategori adını değiştirir ve adı taşıyan tüm hizmet + paketleri de günceller (bkz. tasarım notu 4). */
  const applyRename = async () => {
    const next = renameValue.trim()
    if (!next || !activeCat) return
    if (next === subject.name) { setRenaming(false); return }
    const ok = await run(async () => {
      if (subject.customId) {
        await adminApi.updateServiceCategory(subject.customId, {
          name: next,
          isActive: true,
          parentId: subject.level === 'sub' ? (activeCatCustomId ?? null) : null,
        }, tenantId)
      }
      if (subject.level === 'category') {
        for (const s of services.filter((x) => (x.rawCategory || UNCATEGORIZED) === subject.name)) {
          await adminApi.updateService(s.id, servicePayload(s, { category: next }), tenantId)
        }
        for (const p of packages.filter((x) => (x.category || UNCATEGORIZED) === subject.name)) {
          await adminApi.updatePackageCategory(p.id, next, p.subCategory || null, tenantId)
        }
      } else {
        for (const s of services.filter((x) => (x.rawCategory || UNCATEGORIZED) === activeCat && x.subGroup === subject.name)) {
          await adminApi.updateService(s.id, servicePayload(s, { subCategory: next }), tenantId)
        }
        for (const p of packages.filter((x) => (x.category || UNCATEGORIZED) === activeCat && x.subCategory === subject.name)) {
          await adminApi.updatePackageCategory(p.id, p.category || null, next, tenantId)
        }
      }
    }, 'Yeniden adlandırılamadı')
    if (ok) {
      setRenaming(false)
      if (subject.level === 'category') setSelectedCat(next); else setSelectedSub(next)
    }
  }

  /**
   * Silme onayı uygulama İÇİ modal ile sorulur (tarayıcı confirm'i değil).
   * İki tür kayıt silinebilir:
   *  • custom  → CustomServiceCategory kaydı; backend alt kategorileri de siler.
   *  • derived → kaydı yok, adı yalnızca hizmet/paket üzerinde metin olarak duruyor.
   *              Silmek = o adı kullanan hizmet/paketlerden temizlemek.
   */
  const askDelete = () => {
    if (!subject.name || isUncategorized) return
    setError('')
    setPendingDelete({
      kind: subject.customId ? 'custom' : 'derived',
      id: subject.customId || subject.name,
      name: subject.name,
      level: subject.level,
      usageCount: subject.usage,
      subCount: subject.level === 'category' ? (activeCatInfo?.subCount ?? 0) : 0,
    })
  }

  const confirmDelete = async () => {
    const target = pendingDelete
    if (!target) return
    const ok = await run(async () => {
      if (target.kind === 'custom') {
        await adminApi.deleteServiceCategory(target.id, tenantId)
        return
      }
      // Kaydı olmayan (türetilmiş) kategori/alt kategori: adı kullanan hizmet ve paketlerden kaldırılır.
      if (target.level === 'sub') {
        for (const s of services.filter((x) => x.subGroup === target.name)) {
          await adminApi.updateService(s.id, servicePayload(s, { subCategory: null }), tenantId)
        }
        for (const p of packages.filter((x) => x.subCategory === target.name)) {
          await adminApi.updatePackageCategory(p.id, p.category || null, null, tenantId)
        }
      } else {
        for (const s of services.filter((x) => (x.rawCategory || UNCATEGORIZED) === target.name)) {
          await adminApi.updateService(s.id, servicePayload(s, { category: null }), tenantId)
        }
        for (const p of packages.filter((x) => (x.category || UNCATEGORIZED) === target.name)) {
          await adminApi.updatePackageCategory(p.id, null, p.subCategory || null, tenantId)
        }
      }
    }, 'Kategori silinemedi')
    if (ok) {
      if (target.level === 'sub') setSelectedSub('')
      else { setSelectedCat(null); setSelectedSub('') }
      setPendingDelete(null)
    }
  }

  /** Seçili kategoriyi/alt kategoriyi kardeşleri arasında bir sıra öne veya geriye taşır. */
  const move = (dir: -1 | 1) => {
    if (!subject.customId) return
    const i = siblingIds.indexOf(subject.customId)
    const j = i + dir
    if (i < 0 || j < 0 || j >= siblingIds.length) return
    const next = [...siblingIds]
    ;[next[i], next[j]] = [next[j], next[i]]
    void run(() => adminApi.reorderServiceCategories(next, tenantId), 'Sıralama kaydedilemedi')
  }

  const totals = useMemo(() => ({
    cats: categories.length,
    subs: [...subsByCat.values()].reduce((a, b) => a + b.size, 0),
    services: services.length,
    packages: packages.length,
  }), [categories, subsByCat, services, packages])

  return (
    <>
      <Topbar
        title="Kategoriler"
        subtitle={`${institutionName || 'Kurum'} · ${branchLabel || 'Merkez'} · Hizmet ve paket kategorileri`}
        breadcrumbs={['Admin', 'İşletme', 'Paket & Hizmet', 'Kategoriler']}
        actions={
          canManage ? (
            <button
              type="button"
              onClick={() => { setAdding(true); setCatQuery('') }}
              className="inline-flex items-center gap-1.5 rounded-[10px] bg-[#A5556E] px-3.5 py-2 text-[12px] font-semibold text-white transition-opacity hover:opacity-90"
            >
              <FolderPlus className="h-4 w-4" /> Yeni Kategori
            </button>
          ) : undefined
        }
      />

      <PanelPage className="space-y-4">
        <ApiStateNotice loading={loading} error={apiError} />
        {error && <div className="rounded-[12px] border border-rose-300/40 bg-rose-50 px-4 py-2.5 text-[12px] font-medium text-rose-700">{error}</div>}

        {/* ÖZET ŞERİDİ — kataloğun büyüklüğü tek bakışta. */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: 'Kategori', value: totals.cats, icon: Layers3, tone: 'bg-[#A5556E] text-white' },
            { label: 'Alt kategori', value: totals.subs, icon: Tag, tone: 'bg-[#fdf1e7] text-[#b9743a]' },
            { label: 'Hizmet', value: totals.services, icon: Sparkles, tone: 'bg-[#A5556E] text-white' },
            { label: 'Paket', value: totals.packages, icon: Package, tone: 'bg-violet-50 text-violet-600' },
          ].map((s) => (
            <div key={s.label} className="flex items-center gap-3 rounded-[16px] border border-[#EAD8DF] bg-white/90 px-4 py-3 shadow-[0_18px_42px_-38px_rgba(150,78,104,0.42)]">
              <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-[12px] ${s.tone}`}><s.icon className="h-5 w-5" /></span>
              <div className="min-w-0">
                <div className="text-[11px] font-medium text-[#74616A]">{s.label}</div>
                <div className="font-display text-2xl leading-tight tabular-nums tracking-tight text-[#2A2027]">{s.value}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="grid items-start gap-4 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[330px_minmax(0,1fr)]">
          {/* ---------------- SOL: KATEGORİ AĞACI ---------------- */}
          <aside className="overflow-hidden rounded-[20px] border border-[#EAD8DF] bg-white shadow-[0_18px_42px_-38px_rgba(150,78,104,0.42)] lg:sticky lg:top-6">
            <div className="border-b border-[#f1e5ea] px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="font-display text-[17px] tracking-tight text-[#2A2027]">Kategoriler</div>
                <span className="rounded-full bg-[#F6DFE6] px-2 py-0.5 text-[11px] font-semibold tabular-nums text-[#8C4460]">{categories.length}</span>
              </div>
              <div className="relative mt-2.5">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#74616A]" />
                <input
                  value={catQuery}
                  onChange={(e) => setCatQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && railCats[0]) selectCategory(railCats[0].name) }}
                  placeholder="Kategori ara…"
                  className="w-full rounded-[10px] border border-[#EAD8DF] bg-white px-8 py-2 text-[12px] text-[#2A2027] outline-none placeholder:text-[#74616A] focus:border-[#A5556E]"
                />
                {catQuery && (
                  <button type="button" onClick={() => setCatQuery('')} title="Aramayı temizle"
                    className="absolute right-2 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-full text-[#74616A] hover:bg-[#F6DFE6] hover:text-[#A5556E]">
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>

            {/* Yeni kategori — listenin ÜSTÜNDE: uzun listede aşağı kaydırmadan erişilir. */}
            {canManage && (
              <div className="border-b border-[#f1e5ea] px-3 py-2.5">
                {adding ? (
                  <div className="flex items-center gap-1.5 rounded-[11px] border border-[#BE7690] bg-white p-1 pl-2.5">
                    <input
                      autoFocus
                      value={newCatName}
                      onChange={(e) => setNewCatName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void createCat(); if (e.key === 'Escape') { setAdding(false); setNewCatName('') } }}
                      placeholder="Kategori adı…"
                      className="min-w-0 flex-1 bg-transparent text-[12px] text-[#2A2027] outline-none placeholder:text-[#74616A]"
                    />
                    <button type="button" disabled={busy || !newCatName.trim()} onClick={createCat}
                      className="rounded-[8px] bg-[#A5556E] px-2.5 py-1.5 text-[11px] font-semibold text-white hover:opacity-90 disabled:opacity-50">Ekle</button>
                    <button type="button" onClick={() => { setAdding(false); setNewCatName('') }} title="Vazgeç"
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] text-[#74616A] hover:bg-[#F7F6F6]"><X className="h-3.5 w-3.5" /></button>
                  </div>
                ) : (
                  <button type="button" onClick={() => setAdding(true)}
                    className="flex w-full items-center justify-center gap-1.5 rounded-[11px] border border-dashed border-[#BE7690] bg-[#F6DFE6]/60 px-3 py-2 text-[12px] font-semibold text-[#A5556E] transition-colors hover:bg-[#F6DFE6]">
                    <Plus className="h-3.5 w-3.5" /> Yeni kategori
                  </button>
                )}
              </div>
            )}

            <div className="max-h-[320px] space-y-0.5 overflow-y-auto p-2 lg:max-h-[calc(100vh-16rem)]">
              {railCats.map((c) => {
                const active = activeCat === c.name
                return (
                  <div key={c.name}>
                    <button
                      type="button"
                      onClick={() => selectCategory(c.name)}
                      className={`group relative flex w-full items-center gap-2.5 rounded-[12px] px-2.5 py-2 text-left transition-colors ${active ? '' : 'hover:bg-[#F7F6F6]'}`}
                    >
                      {active && (
                        <motion.span
                          layoutId="category-rail-active"
                          transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                          className="absolute inset-0 rounded-[12px] border border-[#BE7690] bg-[#F6DFE6]"
                        />
                      )}
                      <span className={`relative grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border transition-colors ${active ? 'border-[#BE7690] bg-white text-[#A5556E]' : 'border-[#f1e5ea] bg-[#F7F6F6] text-[#8C4460]'}`}>
                        <ServiceIcon iconKey={suggestIcon(c.name)} className="h-[18px] w-[18px]" />
                      </span>
                      <span className="relative min-w-0 flex-1">
                        <span className={`block truncate text-[13px] font-semibold ${active ? 'text-[#8C4460]' : 'text-[#2A2027]'}`}>{c.name}</span>
                        <span className="mt-0.5 block truncate text-[11px] text-[#74616A]">
                          {c.serviceCount} hizmet · {c.packageCount} paket{c.subCount > 0 ? ` · ${c.subCount} alt` : ''}
                        </span>
                      </span>
                      <ChevronRight className={`relative h-4 w-4 shrink-0 transition-transform ${active ? 'rotate-90 text-[#A5556E]' : 'text-[#74616A] group-hover:translate-x-0.5'}`} />
                    </button>

                    {/* Alt kategoriler — yalnız seçili kategorinin altında açılır (ağaç). */}
                    <AnimatePresence initial={false}>
                      {active && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                          className="overflow-hidden"
                        >
                          <div className="ml-[22px] mt-1 space-y-0.5 border-l border-[#f0dde5] pl-2.5">
                            <SubRow label="Tümü" count={c.serviceCount + c.packageCount} active={!selectedSub} onClick={() => selectSub('')} />
                            {subCategories.map((s) => (
                              <SubRow
                                key={s.name}
                                label={s.name}
                                count={s.serviceCount + s.packageCount}
                                active={selectedSub === s.name}
                                onClick={() => selectSub(s.name)}
                              />
                            ))}
                            {/* Ekleme KUTUSU tek yerde (sağdaki başlık kartı) durur; buradaki
                                buton yalnızca onu açar. İki ayrı kutu aynı state'i paylaşıp
                                çift odak/çift alan sorunu çıkarırdı. */}
                            {canManage && !isUncategorized && !addingSub && (
                              <button type="button" onClick={() => { setAddingSub(true); setNewSubName('') }}
                                className="flex w-full items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-[12px] font-medium text-[#A5556E] transition-colors hover:bg-[#F6DFE6]">
                                <Plus className="h-3.5 w-3.5" /> Alt kategori ekle
                              </button>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )
              })}

              {railCats.length === 0 && (
                <div className="px-3 py-8 text-center text-[12px] text-[#74616A]">
                  {categories.length === 0 ? 'Henüz kategori yok.' : `“${catQuery}” ile eşleşen kategori yok.`}
                </div>
              )}
            </div>
          </aside>

          {/* ---------------- SAĞ: SEÇİLİ KATEGORİ ---------------- */}
          <section className="space-y-4">
            {activeCat ? (
              <>
                {/* BAŞLIK KARTI — o an bakılan kategori/alt kategori ve ona ait TÜM işlemler. */}
                <div className="rounded-[20px] border border-[#EAD8DF] bg-white p-5 shadow-[0_18px_42px_-38px_rgba(150,78,104,0.42)]">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[14px] border border-[#BE7690]/70 bg-[#A5556E] text-white">
                        <ServiceIcon iconKey={suggestIcon(subject.name)} className="h-6 w-6" />
                      </span>
                      <div className="min-w-0 flex-1">
                        {/* Kırıntı yolu: alt kategori seçiliyken nerede olduğun net kalsın. */}
                        <div className="flex items-center gap-1 text-[11px] font-medium text-[#74616A]">
                          <button type="button" onClick={() => selectSub('')} className={selectedSub ? 'hover:text-[#A5556E]' : ''}>{activeCat}</button>
                          {selectedSub && <><ChevronRight className="h-3 w-3" /><span className="truncate text-[#8C4460]">{selectedSub}</span></>}
                        </div>

                        {renaming ? (
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <input
                              autoFocus
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') void applyRename(); if (e.key === 'Escape') setRenaming(false) }}
                              className="min-w-0 flex-1 rounded-[10px] border border-[#BE7690] bg-white px-3 py-1.5 font-display text-xl tracking-tight text-[#2A2027] outline-none focus:border-[#A5556E]"
                            />
                            <button type="button" disabled={busy || !renameValue.trim()} onClick={applyRename}
                              className="rounded-[10px] bg-[#A5556E] px-3 py-2 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-50">Kaydet</button>
                            <button type="button" onClick={() => setRenaming(false)}
                              className="rounded-[10px] border border-[#EAD8DF] bg-white px-3 py-2 text-[12px] font-medium text-[#4a3a44] hover:bg-[#F7F6F6]">Vazgeç</button>
                          </div>
                        ) : (
                          <div className="mt-0.5 truncate font-display text-[26px] leading-tight tracking-tight text-[#2A2027]">{subject.name}</div>
                        )}

                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <Chip tone="rose">{serviceCount} hizmet</Chip>
                          <Chip tone="violet">{packageCount} paket</Chip>
                          {subject.level === 'category' && (activeCatInfo?.subCount ?? 0) > 0 && <Chip tone="amber">{activeCatInfo?.subCount} alt kategori</Chip>}
                          <Chip tone={subject.customId ? 'plain' : 'muted'}>
                            {subject.customId ? 'Kayıtlı kategori' : 'Otomatik (kayıt üzerinden türedi)'}
                          </Chip>
                        </div>
                        {renaming && (
                          <div className="mt-2 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                            Ad değişince bu adı taşıyan <span className="font-semibold tabular-nums">{subject.usage}</span> hizmet/paket de yeni adla güncellenir.
                          </div>
                        )}
                      </div>
                    </div>

                    {/* İŞLEMLER — etiketli, her zaman görünür (hover'a gizlenmez). */}
                    {!renaming && (canManage || canDelete) && !isUncategorized && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {canManage && subject.level === 'category' && (
                          <button type="button" onClick={() => { setAddingSub(true); setNewSubName('') }}
                            className="inline-flex items-center gap-1.5 rounded-[10px] border border-[#BE7690] bg-[#F6DFE6] px-3 py-2 text-[12px] font-semibold text-[#8C4460] transition-colors hover:bg-[#F6DFE6]">
                            <Plus className="h-3.5 w-3.5" /> Alt kategori
                          </button>
                        )}
                        {canManage && (
                          <button type="button" onClick={startRename}
                            className="inline-flex items-center gap-1.5 rounded-[10px] border border-[#EAD8DF] bg-white px-3 py-2 text-[12px] font-medium text-[#4a3a44] transition-colors hover:border-[#BE7690] hover:text-[#A5556E]">
                            <Pencil className="h-3.5 w-3.5" /> Yeniden adlandır
                          </button>
                        )}
                        {canReorder && (
                          <span className="inline-flex overflow-hidden rounded-[10px] border border-[#EAD8DF] bg-white">
                            <button type="button" disabled={busy || orderIndex === 0} onClick={() => move(-1)} title="Sırada yukarı taşı"
                              className="grid h-[38px] w-9 place-items-center text-[#4a3a44] transition-colors hover:bg-[#F7F6F6] hover:text-[#A5556E] disabled:opacity-30">
                              <ArrowUp className="h-4 w-4" />
                            </button>
                            <span className="w-px bg-[#f1e5ea]" />
                            <button type="button" disabled={busy || orderIndex === siblingIds.length - 1} onClick={() => move(1)} title="Sırada aşağı taşı"
                              className="grid h-[38px] w-9 place-items-center text-[#4a3a44] transition-colors hover:bg-[#F7F6F6] hover:text-[#A5556E] disabled:opacity-30">
                              <ArrowDown className="h-4 w-4" />
                            </button>
                          </span>
                        )}
                        {canDelete && (subject.customId || subject.usage > 0) && (
                          <button type="button" onClick={askDelete}
                            className="inline-flex items-center gap-1.5 rounded-[10px] border border-rose-200 bg-white px-3 py-2 text-[12px] font-semibold text-rose-600 transition-colors hover:bg-rose-50">
                            <Trash2 className="h-3.5 w-3.5" /> Sil
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Alt kategori ekleme kutusu — başlık kartından açıldığında burada belirir. */}
                  <AnimatePresence initial={false}>
                    {addingSub && canManage && !isUncategorized && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-[12px] border border-[#BE7690]/70 bg-[#F7F6F6] p-2 pl-3.5">
                          <span className="text-[12px] font-medium text-[#8C4460]">{activeCat} altına yeni alt kategori:</span>
                          <input
                            autoFocus
                            value={newSubName}
                            onChange={(e) => setNewSubName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') void createSubCat(); if (e.key === 'Escape') setAddingSub(false) }}
                            placeholder="Alt kategori adı…"
                            className="min-w-[160px] flex-1 rounded-[9px] border border-[#BE7690] bg-white px-3 py-2 text-[12px] text-[#2A2027] outline-none placeholder:text-[#74616A] focus:border-[#A5556E]"
                          />
                          <button type="button" disabled={busy || !newSubName.trim()} onClick={createSubCat}
                            className="rounded-[9px] bg-[#A5556E] px-3.5 py-2 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-50">Ekle</button>
                          <button type="button" onClick={() => { setAddingSub(false); setNewSubName('') }}
                            className="rounded-[9px] border border-[#EAD8DF] bg-white px-3 py-2 text-[12px] font-medium text-[#4a3a44] hover:bg-white">Vazgeç</button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {isUncategorized && (
                    <div className="mt-4 rounded-[12px] border border-[#EAD8DF] bg-[#F7F6F6] px-3.5 py-2.5 text-[12px] text-[#4a3a44]">
                      Bu, kategorisi girilmemiş kayıtların toplandığı sistem grubudur — adlandırılamaz, silinemez.
                      Kayıtları bir kategoriye taşımak için hizmet/paket formundan kategori seçin.
                    </div>
                  )}
                </div>

                {/* İÇERİK LİSTESİ */}
                <div className="overflow-hidden rounded-[20px] border border-[#EAD8DF] bg-white shadow-[0_18px_42px_-38px_rgba(150,78,104,0.42)]">
                  <div className="flex flex-wrap items-center gap-2 border-b border-[#f1e5ea] px-4 py-3">
                    <div className="inline-flex items-center gap-1 rounded-[11px] border border-[#EAD8DF] bg-[#F7F6F6]/50 p-1">
                      {TYPE_TABS.map((t) => {
                        const count = t.key === 'all' ? rows.length : t.key === 'service' ? serviceCount : packageCount
                        return (
                          <button
                            key={t.key}
                            type="button"
                            onClick={() => setTypeTab(t.key)}
                            className={`rounded-[8px] px-3 py-1.5 text-[12px] font-medium transition-colors ${typeTab === t.key ? 'bg-[#A5556E] text-white' : 'text-[#4a3a44] hover:bg-white'}`}
                          >
                            {t.label} <span className="tabular-nums opacity-80">{count}</span>
                          </button>
                        )
                      })}
                    </div>
                    <div className="relative ml-auto">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#74616A]" />
                      <input
                        value={itemQuery}
                        onChange={(e) => setItemQuery(e.target.value)}
                        placeholder="Bu kategoride ara…"
                        className="w-44 rounded-[10px] border border-[#EAD8DF] bg-white px-8 py-2 text-[12px] text-[#2A2027] outline-none placeholder:text-[#74616A] focus:border-[#A5556E]"
                      />
                    </div>
                  </div>

                  <div className="hidden grid-cols-[minmax(0,2.3fr)_1fr_0.8fr_0.8fr_0.9fr_64px] gap-3 border-b border-[#f1e5ea] bg-[#F7F6F6] px-4 py-2.5 text-[11px] font-semibold text-[#74616A] lg:grid">
                    <span>Kayıt</span>
                    <span>Alt kategori</span>
                    <span>Kapsam</span>
                    <span>Durum</span>
                    <span className="text-right">Fiyat</span>
                    <span />
                  </div>

                  <div className="divide-y divide-[#F1E7EB]">
                    {visibleRows.map((r) => (
                      <div
                        key={`${r.kind}-${r.id}`}
                        className="grid grid-cols-1 gap-2 px-4 py-3 transition-colors hover:bg-[#F7F6F6] lg:grid-cols-[minmax(0,2.3fr)_1fr_0.8fr_0.8fr_0.9fr_64px] lg:items-center lg:gap-3"
                      >
                        <div className="flex min-w-0 items-start gap-2.5">
                          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border ${r.kind === 'service' ? 'border-[#EAD8DF] bg-[#A5556E] text-white' : 'border-violet-200/70 bg-violet-50 text-violet-600'}`}>
                            <ServiceIcon iconKey={r.iconKey} className="h-[18px] w-[18px]" />
                          </span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-[13px] font-semibold text-[#2A2027]">{r.name}</span>
                              <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${r.kind === 'service' ? 'bg-[#F6DFE6] text-[#8C4460]' : 'bg-violet-50 text-violet-700'}`}>
                                {r.kind === 'service' ? 'Hizmet' : 'Paket'}
                              </span>
                            </div>
                            {r.parts.length > 0 && (
                              <div className="mt-1 flex flex-wrap items-center gap-1">
                                {r.parts.slice(0, 3).map((part) => (
                                  <span key={part} className="rounded-md border border-[#EAD8DF] bg-[#F7F6F6] px-1.5 py-0.5 text-[10px] text-[#8C4460]">{part}</span>
                                ))}
                                {r.parts.length > 3 && <span className="text-[10px] font-medium text-[#74616A]">+{r.parts.length - 3}</span>}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="min-w-0">
                          {r.sub
                            ? <span className="inline-flex max-w-full truncate rounded-md border border-[#EAD8DF] bg-white px-2 py-0.5 text-[11px] font-medium text-[#4a3a44]">{r.sub}</span>
                            : <span className="text-[12px] text-[#74616A]">—</span>}
                        </div>
                        <div className="text-[12px] font-medium text-[#4a3a44]">{r.meta}</div>
                        <div>
                          <span className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-semibold ${r.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                            {r.active ? 'Aktif' : 'Pasif'}
                          </span>
                        </div>
                        <div className="font-display text-[15px] tabular-nums text-[#2A2027] lg:text-right">{formatTL(r.price)}</div>
                        <div className="lg:flex lg:justify-end">
                          <PackageSaleDialog
                            tenantId={tenantId}
                            {...(r.kind === 'service'
                              ? { presetService: { id: r.id, name: r.name, price: r.price } }
                              : { presetPackageId: r.id })}
                            triggerLabel="Sat"
                            triggerClassName={`inline-flex items-center justify-center rounded-[9px] border px-3 py-1.5 text-[12px] font-semibold transition-colors ${r.kind === 'service' ? 'border-[#8C4460]/40 bg-[#F6DFE6] text-[#8C4460] hover:bg-[#F6DFE6]' : 'border-violet-300/60 bg-violet-50 text-violet-700 hover:bg-violet-100'}`}
                          />
                        </div>
                      </div>
                    ))}

                    {visibleRows.length === 0 && (
                      <div className="px-4 py-14 text-center">
                        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#A5556E] text-white"><Layers3 className="h-6 w-6" /></span>
                        <div className="mt-3 text-[13px] font-semibold text-[#2A2027]">
                          {itemQuery ? 'Aramayla eşleşen kayıt yok.' : `Bu ${selectedSub ? 'alt kategoride' : 'kategoride'} kayıt yok.`}
                        </div>
                        <div className="mt-1 text-[12px] text-[#74616A]">
                          {itemQuery ? 'Farklı bir kelime deneyin.' : 'Hizmet veya paket eklerken bu kategoriyi seçtiğinizde burada listelenir.'}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              !loading && (
                <div className="rounded-[18px] border border-dashed border-[#EAD8DF] bg-white/70 px-6 py-16 text-center">
                  <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#A5556E] text-white"><FolderPlus className="h-7 w-7" /></span>
                  <div className="mt-4 font-display text-xl tracking-tight text-[#2A2027]">Henüz kategori yok</div>
                  <div className="mx-auto mt-1.5 max-w-md text-[12px] text-[#74616A]">
                    Soldaki “Yeni kategori” ile başlayın. Hizmet ve paketlere kategori atandıkça bu kategoriler otomatik olarak burada gruplanır.
                  </div>
                </div>
              )
            )}

            <div className="flex items-start gap-2 rounded-[12px] border border-[#EAD8DF] bg-[#F7F6F6] px-4 py-2.5 text-[12px] text-[#8C4460]">
              <Tag className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Kategoriler hizmet ve paketlerde ortaktır: burada oluşturduğunuz kategori ve alt kategoriler, hizmet/paket formlarındaki seçim listesinde çıkar.</span>
            </div>
          </section>
        </div>
      </PanelPage>

      {/* Silme onayı — uygulama içi modal (tarayıcı confirm'i kullanılmaz).
          ModalPortal şart: panel yerleşiminde <main> kendi yığınlama bağlamını açar, portal
          olmadan modal sidebar'ın altında kalır. */}
      <AnimatePresence>
        {pendingDelete && (
          <ModalPortal>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[145] grid place-items-center bg-[#2b1620]/45 p-4 backdrop-blur-sm"
              onClick={() => { if (!busy) setPendingDelete(null) }}
            >
              <motion.div
                initial={{ opacity: 0, y: 12, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12, scale: 0.97 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-[440px] overflow-hidden rounded-[20px] border border-[#f3dde5] bg-white shadow-[0_40px_80px_-40px_rgba(120,71,88,0.6)]"
              >
                <div className="flex items-start gap-3 border-b border-[#f6e8ee] px-5 py-4">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] border border-rose-200 bg-rose-50 text-rose-600">
                    <Trash2 className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <div className="font-display text-[17px] tracking-tight text-[#2A2027]">
                      {pendingDelete.level === 'sub' ? 'Alt kategori silinsin mi?' : 'Kategori silinsin mi?'}
                    </div>
                    <div className="mt-0.5 truncate text-[12px] font-medium text-[#74616A]">{pendingDelete.name}</div>
                  </div>
                </div>

                <div className="space-y-2 px-5 py-4 text-[12px] text-[#4a3a44]">
                  {pendingDelete.kind === 'derived' ? (
                    <p>
                      Bu {pendingDelete.level === 'sub' ? 'alt kategorinin' : 'kategorinin'} ayrı bir kaydı yok; adı{' '}
                      <span className="font-semibold tabular-nums">{pendingDelete.usageCount}</span> hizmet/pakette yazılı.
                      Silince o kayıtlardan kaldırılacak — hizmet ve paketlerin kendisi silinmez.
                    </p>
                  ) : (
                    <>
                      {pendingDelete.subCount > 0 && (
                        <p className="rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                          <span className="font-semibold tabular-nums">{pendingDelete.subCount}</span> alt kategorisi de silinecek.
                        </p>
                      )}
                      <p>Bu kategorideki hizmet ve paketler silinmez; kategori adı üzerlerinde kalır.</p>
                    </>
                  )}
                  <p className="text-[11px] text-[#74616A]">Bu işlem geri alınamaz.</p>
                  {error && <p className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2 font-medium text-rose-700">{error}</p>}
                </div>

                <div className="flex justify-end gap-2 border-t border-[#f6e8ee] bg-[#F7F6F6] px-5 py-3">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setPendingDelete(null)}
                    className="rounded-[11px] border border-[#EAD8DF] bg-white px-4 py-2 text-[12px] font-medium text-[#4a3a44] hover:bg-[#F7F6F6] disabled:opacity-50"
                  >
                    Vazgeç
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void confirmDelete()}
                    className="inline-flex items-center gap-1.5 rounded-[11px] bg-rose-600 px-4 py-2 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> {busy ? 'Siliniyor…' : 'Sil'}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          </ModalPortal>
        )}
      </AnimatePresence>
    </>
  )
}

/** Ağaçtaki alt kategori satırı — saf gezinme (işlem yok, bkz. tasarım notu 2). */
function SubRow({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-left transition-colors ${
        active ? 'bg-[#F6DFE6] text-[#8C4460]' : 'text-[#4a3a44] hover:bg-[#F7F6F6]'
      }`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? 'bg-[#A5556E]' : 'bg-[#D9CBD1]'}`} />
      <span className={`min-w-0 flex-1 truncate text-[12px] ${active ? 'font-semibold' : 'font-medium'}`}>{label}</span>
      <span className={`shrink-0 text-[11px] tabular-nums ${active ? 'text-[#8C4460]' : 'text-[#74616A]'}`}>{count}</span>
    </button>
  )
}

function Chip({ tone, children }: { tone: 'rose' | 'violet' | 'amber' | 'plain' | 'muted'; children: React.ReactNode }) {
  const tones: Record<string, string> = {
    rose: 'border-[#e7c7d4] bg-[#F6DFE6] text-[#8C4460]',
    violet: 'border-violet-200 bg-violet-50 text-violet-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-800',
    plain: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    muted: 'border-[#EAD8DF] bg-[#F7F6F6] text-[#74616A]',
  }
  return <span className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}>{children}</span>
}
