'use client'

import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Topbar from '@/components/dashboard/Topbar'
import ApiStateNotice from '@/components/dashboard/ApiStateNotice'
import PackageSaleDialog from '@/components/dashboard/PackageSaleDialog'
import { ServiceIcon, suggestIcon } from '@/components/dashboard/ServiceIcons'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useFeature } from '@/components/dashboard/FeatureContext'
import { adminApi } from '@/lib/apiClient'
import { apiItems, formatTL, normalizeCustomServiceCategory, normalizePackage, normalizeService } from '@/lib/apiMappers'
import { Clock3, FolderPlus, Layers3, Package, Plus, Sparkles, Tag, Trash2, X } from 'lucide-react'
import type { ApiCustomServiceCategory, ApiService, ApiServicePackage } from '@/lib/types'

const UNCATEGORIZED = 'Kategorisiz'

/**
 * Genel kategori görünümü — sektör standardı katalog deseni (Zenoti/Mangomint tarzı):
 * tüm hizmet + paketler ortak kategorilere göre gruplanır. Kategoriye tıklayınca o kategorinin
 * alt kategorileri (varsa) + hizmet ve paketleri listelenir; alt kategori seçilince liste süzülür.
 * Kuruma özel üst kategorilere alt kategori eklenip kaldırılabilir (ParentId ağacı).
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
  const [selectedCat, setSelectedCat] = useState<string | null>(null)
  const [selectedSub, setSelectedSub] = useState<string>('') // '' = tüm alt kategoriler
  const [newCatName, setNewCatName] = useState('')
  const [adding, setAdding] = useState(false)
  const [newSubName, setNewSubName] = useState('')
  const [addingSub, setAddingSub] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

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

  const services = useMemo(() => (data?.services || []).map((s, i) => normalizeService(s, i)), [data])
  const packages = useMemo(() => (data?.packages || []).map((p, i) => normalizePackage(p, i)), [data])
  const customCats = useMemo(() => (data?.cats || []).map((c, i) => normalizeCustomServiceCategory(c, i)), [data])
  // Üst-seviye özel kategoriler (alt kategori kayıtları haritadan hariç).
  const topCustomCats = useMemo(() => customCats.filter((c) => !c.parentId), [customCats])

  // Üst kategori havuzu: üst-seviye özel kategoriler + hizmet/paketlerde geçen kategori adları + Kategorisiz
  const categories = useMemo(() => {
    const map = new Map<string, { name: string; isCustom: boolean; customId?: string; serviceCount: number; packageCount: number }>()
    const touch = (name: string) => {
      const key = name || UNCATEGORIZED
      if (!map.has(key)) map.set(key, { name: key, isCustom: false, serviceCount: 0, packageCount: 0 })
      return map.get(key)!
    }
    for (const c of topCustomCats) {
      const e = touch(c.name)
      e.isCustom = true
      e.customId = c.id
    }
    for (const s of services) touch(s.group || UNCATEGORIZED).serviceCount++
    for (const p of packages) touch(p.category || UNCATEGORIZED).packageCount++
    return [...map.values()].sort((a, b) => (b.serviceCount + b.packageCount) - (a.serviceCount + a.packageCount) || a.name.localeCompare(b.name, 'tr'))
  }, [topCustomCats, services, packages])

  const activeCat = selectedCat && categories.some((c) => c.name === selectedCat) ? selectedCat : categories[0]?.name || null
  const activeCatInfo = categories.find((c) => c.name === activeCat)
  const activeCatCustomId = activeCatInfo?.customId

  // Aktif kategorinin alt kategorileri: özel alt kayıtlar (ParentId eşleşen) + hizmet/paketlerde geçen alt kategoriler.
  const subCategories = useMemo(() => {
    const map = new Map<string, { name: string; customId?: string; serviceCount: number; packageCount: number }>()
    const touch = (name: string) => {
      if (!map.has(name)) map.set(name, { name, serviceCount: 0, packageCount: 0 })
      return map.get(name)!
    }
    if (activeCatCustomId) {
      for (const c of customCats) if (c.parentId === activeCatCustomId) { touch(c.name).customId = c.id }
    }
    for (const s of services) if ((s.group || UNCATEGORIZED) === activeCat && s.subGroup) touch(s.subGroup).serviceCount++
    for (const p of packages) if ((p.category || UNCATEGORIZED) === activeCat && p.subCategory) touch(p.subCategory).packageCount++
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'tr'))
  }, [customCats, services, packages, activeCat, activeCatCustomId])

  const catServices = useMemo(
    () => services.filter((s) => (s.group || UNCATEGORIZED) === activeCat && (!selectedSub || s.subGroup === selectedSub)),
    [services, activeCat, selectedSub],
  )
  const catPackages = useMemo(
    () => packages.filter((p) => (p.category || UNCATEGORIZED) === activeCat && (!selectedSub || p.subCategory === selectedSub)),
    [packages, activeCat, selectedSub],
  )

  const selectCategory = (name: string) => { setSelectedCat(name); setSelectedSub(''); setAddingSub(false); setNewSubName('') }
  // Ana kategoriye tıklayıp doğrudan alt kategori eklemeye başla: kategoriyi seç + ekleme kutusunu aç.
  const startAddSub = (name: string) => { setSelectedCat(name); setSelectedSub(''); setNewSubName(''); setError(''); setAddingSub(true) }

  const createCat = async () => {
    const name = newCatName.trim()
    if (!name) return
    setBusy(true)
    setError('')
    try {
      await adminApi.createServiceCategory({ name, isActive: true }, tenantId)
      setNewCatName('')
      setAdding(false)
      setSelectedCat(name)
      setSelectedSub('')
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kategori eklenemedi')
    } finally {
      setBusy(false)
    }
  }

  const createSubCat = async () => {
    const name = newSubName.trim()
    if (!name || !activeCat || activeCat === UNCATEGORIZED) return
    setBusy(true)
    setError('')
    try {
      // Türetilmiş (özel olmayan) üst kategoriye de alt kategori eklenebilsin:
      // önce üst kategoriyi kuruma özel kategori olarak oluştur, sonra alt kategoriyi ona bağla.
      let parentId = activeCatCustomId
      if (!parentId) {
        const created = await adminApi.createServiceCategory<ApiCustomServiceCategory>({ name: activeCat, isActive: true }, tenantId)
        parentId = created?.id
      }
      if (!parentId) throw new Error('Üst kategori oluşturulamadı')
      await adminApi.createServiceCategory({ name, isActive: true, parentId }, tenantId)
      setNewSubName('')
      setAddingSub(false)
      setSelectedSub(name)
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Alt kategori eklenemedi')
    } finally {
      setBusy(false)
    }
  }

  const deleteCat = async (id: string) => {
    setBusy(true)
    setError('')
    try {
      await adminApi.deleteServiceCategory(id, tenantId)
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kategori silinemedi')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Topbar
        title="Kategoriler"
        subtitle={`${institutionName || 'Kurum'} · ${branchLabel || 'Merkez'} · Genel Kategori Görünümü`}
        breadcrumbs={['Admin', 'İşletme', 'Paket & Hizmet', 'Kategoriler']}
        actions={
          canCustomCat ? (
            <div className="flex items-center gap-2">
              {adding ? (
                <div className="flex items-center gap-1.5 rounded-[12px] border border-[#ead8df] bg-white p-1">
                  <input
                    autoFocus
                    value={newCatName}
                    onChange={(e) => setNewCatName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void createCat(); if (e.key === 'Escape') setAdding(false) }}
                    placeholder="Kategori adı…"
                    className="w-40 rounded-[8px] px-2.5 py-1.5 text-[12px] outline-none"
                  />
                  <button type="button" disabled={busy} onClick={createCat}
                    className="rounded-[8px] bg-[#c85776] px-3 py-1.5 text-[11px] font-medium text-white hover:opacity-90 disabled:opacity-50">Ekle</button>
                  <button type="button" onClick={() => setAdding(false)} className="grid h-7 w-7 place-items-center rounded-[8px] text-[#352432]/45 hover:bg-[#fff4f8]"><X className="h-3.5 w-3.5" /></button>
                </div>
              ) : (
                <button type="button" onClick={() => setAdding(true)}
                  className="inline-flex items-center gap-1.5 rounded-[10px] bg-[#c85776] px-3.5 py-2 text-[11px] font-medium text-white transition-opacity hover:opacity-90">
                  <FolderPlus className="h-3.5 w-3.5" /> Yeni Kategori
                </button>
              )}
            </div>
          ) : undefined
        }
      />

      <div className="relative space-y-5 p-4 sm:p-6 lg:p-8">
        <ApiStateNotice loading={loading} error={apiError} />
        {error && <div className="rounded-[12px] border border-rose-300/30 bg-rose-50 px-4 py-2.5 text-[12px] text-rose-700">{error}</div>}

        {/* KATEGORİ KARTLARI */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {categories.map((c) => (
            <motion.button
              key={c.name}
              type="button"
              whileHover={{ y: -3 }}
              onClick={() => selectCategory(c.name)}
              className={`group relative overflow-hidden rounded-[18px] border p-4 text-left shadow-[0_18px_42px_-34px_rgba(150,78,104,0.42)] transition-colors ${
                activeCat === c.name ? 'border-[#c85776]/60 bg-[#fff1f6]/60' : 'border-[#ead8df]/70 bg-white/90 hover:border-[#efbfd0]'
              }`}
            >
              <div className="flex items-start justify-between">
                <span className="grid h-10 w-10 place-items-center rounded-[12px] border border-[#efbfd0]/60 bg-[#fff1f6] text-[#c85776]">
                  <ServiceIcon iconKey={suggestIcon(c.name)} className="h-5 w-5" />
                </span>
                <div className="flex items-center gap-1">
                  {c.name !== UNCATEGORIZED && canCustomCat && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); startAddSub(c.name) }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); startAddSub(c.name) } }}
                      title="Alt kategori ekle"
                      className="inline-flex items-center gap-0.5 rounded-md border border-[#efbfd0]/60 bg-[#fff1f6]/70 px-1.5 py-1 text-[9px] font-mono uppercase tracking-wide text-[#b14d6c] opacity-0 transition-opacity hover:bg-[#ffe6ef] group-hover:opacity-100"
                    >
                      <Plus className="h-3 w-3" /> alt
                    </span>
                  )}
                  {c.isCustom && c.customId && canCustomCat && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); void deleteCat(c.customId!) }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); void deleteCat(c.customId!) } }}
                      title="Özel kategoriyi sil"
                      className="grid h-7 w-7 place-items-center rounded-md text-[#352432]/25 opacity-0 transition-opacity hover:text-rose-600 group-hover:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </span>
                  )}
                </div>
              </div>
              <div className="mt-3 truncate font-display text-xl tracking-tight text-[#352432]">{c.name}</div>
              <div className="mt-1.5 flex items-center gap-1.5">
                <span className="rounded-md border border-[#e7c7d4]/70 bg-[#fff1f6]/60 px-1.5 py-0.5 text-[9px] font-mono uppercase text-[#b14d6c]">{c.serviceCount} hizmet</span>
                <span className="rounded-md border border-violet-200/70 bg-violet-50 px-1.5 py-0.5 text-[9px] font-mono uppercase text-violet-600">{c.packageCount} paket</span>
                {c.isCustom && <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[9px] font-mono uppercase text-amber-700">özel</span>}
              </div>
              {activeCat === c.name && <span className="absolute inset-x-4 bottom-0 h-0.5 rounded-full bg-[#c85776]" />}
            </motion.button>
          ))}
          {categories.length === 0 && !loading && (
            <div className="col-span-full rounded-[18px] border border-dashed border-[#ead8df] bg-[#fffafb] px-5 py-12 text-center text-sm text-[#352432]/45">
              Henüz kategori yok. Üstten &quot;Yeni Kategori&quot; ile başlayın; hizmet ve paketlere kategori atandıkça burada gruplanır.
            </div>
          )}
        </div>

        {/* SEÇİLİ KATEGORİ İÇERİĞİ */}
        <AnimatePresence mode="wait">
          {activeCat && (
            <motion.div
              key={activeCat}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="space-y-4"
            >
              {/* ALT KATEGORİ ŞERİDİ */}
              <div className="flex flex-wrap items-center gap-1.5 rounded-[16px] border border-[#ead8df]/70 bg-white/80 px-4 py-3">
                <span className="mr-1 inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-[#c85776]/70">
                  <Layers3 className="h-3.5 w-3.5" /> {activeCat} · alt kategoriler
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedSub('')}
                  className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${!selectedSub ? 'bg-[#c85776] text-white' : 'border border-[#ead8df] bg-white text-[#352432]/60 hover:border-[#efbfd0] hover:text-[#c85776]'}`}
                >
                  Tümü
                </button>
                {subCategories.map((s) => (
                  <span key={s.name} className="group/sub inline-flex items-center">
                    <button
                      type="button"
                      onClick={() => setSelectedSub(selectedSub === s.name ? '' : s.name)}
                      className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${selectedSub === s.name ? 'bg-[#c85776] text-white' : 'border border-[#ead8df] bg-white text-[#352432]/60 hover:border-[#efbfd0] hover:text-[#c85776]'}`}
                    >
                      {s.name}
                      <span className={`ml-1 tabular-nums ${selectedSub === s.name ? 'text-white/70' : 'text-[#352432]/35'}`}>{s.serviceCount + s.packageCount}</span>
                    </button>
                    {s.customId && canCustomCat && (
                      <button
                        type="button"
                        onClick={() => void deleteCat(s.customId!)}
                        title="Alt kategoriyi sil"
                        className="ml-0.5 grid h-5 w-5 place-items-center rounded-full text-[#352432]/25 opacity-0 transition-opacity hover:text-rose-600 group-hover/sub:opacity-100"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </span>
                ))}
                {subCategories.length === 0 && (
                  <span className="text-[11px] text-[#352432]/40">Bu kategoride alt kategori yok.</span>
                )}

                {/* Alt kategori ekle — her kategoride (türetilmişse ilk alt eklemede otomatik özel kategoriye çevrilir) */}
                {canCustomCat && activeCat !== UNCATEGORIZED && (
                  addingSub ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-[#efbfd0] bg-white p-0.5 pl-2.5">
                      <input
                        autoFocus
                        value={newSubName}
                        onChange={(e) => setNewSubName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') void createSubCat(); if (e.key === 'Escape') setAddingSub(false) }}
                        placeholder="Alt kategori adı…"
                        className="w-32 bg-transparent text-[11px] outline-none"
                      />
                      <button type="button" disabled={busy} onClick={createSubCat} className="rounded-full bg-[#c85776] px-2.5 py-1 text-[10px] font-medium text-white hover:opacity-90 disabled:opacity-50">Ekle</button>
                      <button type="button" onClick={() => setAddingSub(false)} className="grid h-6 w-6 place-items-center rounded-full text-[#352432]/45 hover:bg-[#fff4f8]"><X className="h-3 w-3" /></button>
                    </span>
                  ) : (
                    <button type="button" onClick={() => setAddingSub(true)}
                      className="inline-flex items-center gap-1 rounded-full border border-dashed border-[#efbfd0] bg-[#fff1f6]/50 px-3 py-1 text-[11px] font-medium text-[#c85776] transition-colors hover:bg-[#fff1f6]">
                      <Plus className="h-3 w-3" /> Alt kategori
                    </button>
                  )
                )}
                {canCustomCat && activeCat === UNCATEGORIZED && (
                  <span className="text-[10px] text-[#352432]/35">· &quot;Kategorisiz&quot; altına alt kategori eklenemez.</span>
                )}
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                {/* HİZMETLER */}
                <div className="overflow-hidden rounded-[18px] border border-[#ead8df]/70 bg-white/90">
                  <div className="flex items-center justify-between border-b border-[#ead8df]/70 px-5 py-4">
                    <div>
                      <div className="text-[10px] font-mono uppercase tracking-widest text-[#c85776]/75">{activeCat}{selectedSub ? ` · ${selectedSub}` : ''} · Hizmetler</div>
                      <div className="font-display text-2xl tracking-tight">{catServices.length} hizmet</div>
                    </div>
                    <span className="grid h-10 w-10 place-items-center rounded-[12px] bg-[#fff1f6] text-[#c85776]"><Sparkles className="h-5 w-5" /></span>
                  </div>
                  <div className="divide-y divide-[#f1e5ea]">
                    {catServices.map((s) => (
                      <div key={s.id} className="flex items-center gap-3 px-5 py-3">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-[#efbfd0]/60 bg-[#fff1f6] text-[#c85776]">
                          <ServiceIcon iconKey={s.iconKey || suggestIcon(s.name || s.group)} className="h-5 w-5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-medium text-[#352432]">{s.name}</div>
                          <div className="flex items-center gap-2 text-[10px] text-[#352432]/45">
                            <span className="flex items-center gap-1"><Clock3 className="h-3 w-3" /> {s.duration} dk</span>
                            {s.subGroup && <span className="rounded bg-[#f4ecf9] px-1 py-0.5 text-violet-600">{s.subGroup}</span>}
                            <span className={`rounded px-1 py-0.5 text-[8px] font-mono uppercase ${s.status === 'Active' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-50 text-slate-500'}`}>{s.status === 'Active' ? 'Aktif' : 'Pasif'}</span>
                          </div>
                        </div>
                        <div className="font-display text-[15px] tabular-nums text-[#352432]">{formatTL(s.price)}</div>
                        <PackageSaleDialog
                          tenantId={tenantId}
                          presetService={{ id: s.id, name: s.name, price: s.price }}
                          triggerLabel="Sat"
                          triggerClassName="inline-flex items-center gap-1 rounded-md border border-[#c85776]/40 bg-[#fff1f6] px-2 py-1.5 text-[9px] font-mono uppercase tracking-widest text-[#b14d6c] transition-colors hover:bg-[#ffe6ef]"
                        />
                      </div>
                    ))}
                    {catServices.length === 0 && <div className="px-5 py-10 text-center text-[12px] text-[#352432]/45">Bu {selectedSub ? 'alt kategoride' : 'kategoride'} hizmet yok.</div>}
                  </div>
                </div>

                {/* PAKETLER */}
                <div className="overflow-hidden rounded-[18px] border border-[#ead8df]/70 bg-white/90">
                  <div className="flex items-center justify-between border-b border-[#ead8df]/70 px-5 py-4">
                    <div>
                      <div className="text-[10px] font-mono uppercase tracking-widest text-violet-500/80">{activeCat}{selectedSub ? ` · ${selectedSub}` : ''} · Paketler</div>
                      <div className="font-display text-2xl tracking-tight">{catPackages.length} paket</div>
                    </div>
                    <span className="grid h-10 w-10 place-items-center rounded-[12px] bg-violet-50 text-violet-600"><Package className="h-5 w-5" /></span>
                  </div>
                  <div className="divide-y divide-[#f1e5ea]">
                    {catPackages.map((p) => (
                      <div key={p.id} className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-violet-200/70 bg-violet-50 text-violet-600">
                            <ServiceIcon iconKey={p.iconKey || suggestIcon(p.name || p.category)} className="h-5 w-5" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[13px] font-medium text-[#352432]">{p.name}</div>
                            <div className="flex items-center gap-2 text-[10px] text-[#352432]/45">
                              <span className="flex items-center gap-1"><Layers3 className="h-3 w-3" /> {p.totalSessions} seans</span>
                              {p.subCategory && <span className="rounded bg-[#f4ecf9] px-1 py-0.5 text-violet-600">{p.subCategory}</span>}
                              <span className={`rounded px-1 py-0.5 text-[8px] font-mono uppercase ${p.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-50 text-slate-500'}`}>{p.isActive ? 'Aktif' : 'Pasif'}</span>
                            </div>
                          </div>
                          <div className="font-display text-[15px] tabular-nums text-[#352432]">{formatTL(p.totalPrice)}</div>
                          <PackageSaleDialog
                            tenantId={tenantId}
                            presetPackageId={p.id}
                            triggerLabel="Sat"
                            triggerClassName="inline-flex items-center gap-1 rounded-md border border-violet-300/60 bg-violet-50 px-2 py-1.5 text-[9px] font-mono uppercase tracking-widest text-violet-700 transition-colors hover:bg-violet-100"
                          />
                        </div>
                        {p.items.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1 pl-12">
                            {p.items.slice(0, 4).map((it) => (
                              <span key={it.serviceDefinitionId} className="rounded-md border border-[#e7c7d4]/70 bg-[#fff1f6]/60 px-1.5 py-0.5 text-[9px] text-[#b14d6c]">
                                {it.serviceName} ×{it.sessionCount}
                              </span>
                            ))}
                            {p.items.length > 4 && <span className="text-[10px] text-[#352432]/40">+{p.items.length - 4}</span>}
                          </div>
                        )}
                      </div>
                    ))}
                    {catPackages.length === 0 && <div className="px-5 py-10 text-center text-[12px] text-[#352432]/45">Bu {selectedSub ? 'alt kategoride' : 'kategoride'} paket yok.</div>}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-center gap-2 rounded-[12px] border border-[#efbfd0]/60 bg-[#fff1f6]/60 px-4 py-2.5 text-[11px] text-[#b14d6c]">
          <Tag className="h-4 w-4" /> Kategoriler hizmet ve paketlerde ortaktır — hizmet/paket formlarında bu kategorilerden ve alt kategorilerden seçim yapılır. <Plus className="h-3 w-3" /> ile yeni kategori/alt kategori herkese açılır.
        </div>
      </div>
    </>
  )
}
