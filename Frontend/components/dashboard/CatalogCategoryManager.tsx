'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, FolderPlus, Trash2, X } from 'lucide-react'
import { ServiceIcon, suggestIcon } from '@/components/dashboard/ServiceIcons'

export interface CatalogCategoryItem {
  name: string
  count: number
  customId?: string
}

export default function CatalogCategoryManager({
  title,
  description,
  itemLabel,
  categories,
  selectedCategory,
  canManage,
  onSelect,
  onCreate,
  onDelete,
  onReorder,
}: {
  title: string
  description: string
  itemLabel: string
  categories: CatalogCategoryItem[]
  selectedCategory: string
  canManage: boolean
  onSelect: (name: string) => void
  /**
   * Kategori EKLEME yalnızca Kategoriler sayfasında yapılır (tek kaynak). Bu yüzden opsiyoneldir;
   * verilmezse ekleme arayüzü hiç çıkmaz, yerine Kategoriler sayfasına yönlendiren not gösterilir.
   */
  onCreate?: (name: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
  /** Verilen id sırasına göre kalıcı sıra (SortOrder) yaz. Verilmezse elle sıralama gizlenir. */
  onReorder?: (orderedCustomIds: string[]) => Promise<void> | void
}) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const create = async () => {
    const value = name.trim()
    if (!value || !onCreate) return
    setBusy(true)
    setError('')
    try {
      await onCreate(value)
      setName('')
      setAdding(false)
      onSelect(value)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kategori eklenemedi.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string, categoryName: string) => {
    if (!window.confirm(`"${categoryName}" kategorisi silinsin mi?`)) return
    setBusy(true)
    setError('')
    try {
      await onDelete(id)
      if (selectedCategory === categoryName) onSelect('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kategori silinemedi.')
    } finally {
      setBusy(false)
    }
  }

  // Elle sıralama: yalnızca kuruma özel (customId'li) kategoriler taşınabilir.
  const customIds = categories.filter((c) => c.customId).map((c) => c.customId!)
  const move = (customId: string, dir: -1 | 1) => {
    const i = customIds.indexOf(customId)
    const j = i + dir
    if (i < 0 || j < 0 || j >= customIds.length) return
    const next = [...customIds]
    ;[next[i], next[j]] = [next[j], next[i]]
    void onReorder?.(next)
  }

  return (
    <div className="rounded-[18px] border border-[#EAD8DF] bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-display text-lg tracking-tight">{title}</div>
          <div className="mt-0.5 text-[11px] text-[#74616A]">{description}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[#74616A]">{categories.length} kategori</span>
          {/* Ekleme yalnızca Kategoriler sayfasında; burada onCreate verilmez → yönlendirme notu. */}
          {canManage && !onCreate && (
            <Link href="/panel/paketler?scope=categories"
              className="inline-flex items-center gap-1.5 rounded-[9px] border border-[#EAD8DF] bg-white px-3 py-1.5 text-[10px] font-medium text-[#74616A] hover:bg-[#F7F6F6]">
              <FolderPlus className="h-3.5 w-3.5" /> Kategori eklemek için Kategoriler sayfası
            </Link>
          )}
          {canManage && onCreate && (
            adding ? (
              <div className="flex items-center gap-1 rounded-[10px] border border-[#EAD8DF] bg-white p-1">
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void create()
                    if (e.key === 'Escape') setAdding(false)
                  }}
                  placeholder="Kategori adı…"
                  className="w-36 rounded-[7px] px-2 py-1 text-[11px] outline-none"
                />
                <button type="button" disabled={busy || !name.trim()} onClick={create}
                  className="rounded-[7px] bg-[#A5556E] px-2.5 py-1 text-[10px] font-medium text-white disabled:opacity-50">
                  Ekle
                </button>
                <button type="button" onClick={() => { setAdding(false); setName(''); setError('') }}
                  className="grid h-6 w-6 place-items-center rounded-[7px] text-[#74616A] hover:bg-[#F7F6F6]">
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setAdding(true)}
                className="inline-flex items-center gap-1.5 rounded-[9px] border border-[#BE7690]/75 bg-[#F6DFE6] px-3 py-1.5 text-[10px] font-medium text-[#8C4460] hover:bg-[#F6DFE6]">
                <FolderPlus className="h-3.5 w-3.5" /> Yeni kategori
              </button>
            )
          )}
        </div>
      </div>

      {error && <div className="mt-3 rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">{error}</div>}

      <div className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {categories.map((category) => (
          <button
            key={category.name}
            type="button"
            onClick={() => onSelect(selectedCategory === category.name ? '' : category.name)}
            className={`group relative rounded-[14px] border p-3 text-left transition-colors ${
              selectedCategory === category.name
                ? 'border-[#8C4460] bg-[#F6DFE6]'
                : 'border-[#EAD8DF] bg-white hover:border-[#BE7690]'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-[#A5556E] text-white">
                <ServiceIcon iconKey={suggestIcon(category.name)} className="h-5 w-5" />
              </span>
              {canManage && category.customId && (
                <div className="flex items-center gap-0.5">
                  {onReorder && customIds.length > 1 && (
                    <>
                      <span role="button" tabIndex={0} title="Öne al"
                        onClick={(e) => { e.stopPropagation(); move(category.customId!, -1) }}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); move(category.customId!, -1) } }}
                        className={`grid h-6 w-6 place-items-center rounded-md text-[#2A2027]/25 opacity-0 transition-opacity hover:bg-[#F6DFE6] hover:text-[#A5556E] group-hover:opacity-100 ${customIds.indexOf(category.customId!) === 0 ? 'pointer-events-none !opacity-20' : ''}`}>
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </span>
                      <span role="button" tabIndex={0} title="Geri al"
                        onClick={(e) => { e.stopPropagation(); move(category.customId!, 1) }}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); move(category.customId!, 1) } }}
                        className={`grid h-6 w-6 place-items-center rounded-md text-[#2A2027]/25 opacity-0 transition-opacity hover:bg-[#F6DFE6] hover:text-[#A5556E] group-hover:opacity-100 ${customIds.indexOf(category.customId!) === customIds.length - 1 ? 'pointer-events-none !opacity-20' : ''}`}>
                        <ChevronRight className="h-3.5 w-3.5" />
                      </span>
                    </>
                  )}
                  <span
                    role="button"
                    tabIndex={0}
                    title="Kategoriyi sil"
                    onClick={(e) => { e.stopPropagation(); void remove(category.customId!, category.name) }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.stopPropagation()
                        void remove(category.customId!, category.name)
                      }
                    }}
                    className="grid h-7 w-7 place-items-center rounded-md text-[#2A2027]/25 opacity-0 transition-opacity hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </span>
                </div>
              )}
            </div>
            <div className="mt-2 truncate text-[13px] font-medium text-[#2A2027]">{category.name}</div>
            <div className="text-[10px] text-[#74616A]">{category.count} {itemLabel}</div>
          </button>
        ))}
        {categories.length === 0 && (
          <div className="col-span-full rounded-[14px] border border-dashed border-[#EAD8DF] bg-[#F7F6F6] px-4 py-8 text-center text-[11px] text-[#74616A]">
            Henüz kategori yok. “Yeni kategori” ile ilk kategoriyi oluşturabilirsiniz.
          </div>
        )}
      </div>
    </div>
  )
}
