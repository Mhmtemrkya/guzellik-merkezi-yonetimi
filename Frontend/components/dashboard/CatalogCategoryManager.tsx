'use client'

import { useState } from 'react'
import { FolderPlus, Trash2, X } from 'lucide-react'
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
}: {
  title: string
  description: string
  itemLabel: string
  categories: CatalogCategoryItem[]
  selectedCategory: string
  canManage: boolean
  onSelect: (name: string) => void
  onCreate: (name: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const create = async () => {
    const value = name.trim()
    if (!value) return
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

  return (
    <div className="rounded-[18px] border border-[#ead8df]/70 bg-white/86 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-display text-lg tracking-tight">{title}</div>
          <div className="mt-0.5 text-[11px] text-[#352432]/45">{description}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[#352432]/45">{categories.length} kategori</span>
          {canManage && (
            adding ? (
              <div className="flex items-center gap-1 rounded-[10px] border border-[#ead8df] bg-white p-1">
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
                  className="rounded-[7px] bg-[#c85776] px-2.5 py-1 text-[10px] font-medium text-white disabled:opacity-50">
                  Ekle
                </button>
                <button type="button" onClick={() => { setAdding(false); setName(''); setError('') }}
                  className="grid h-6 w-6 place-items-center rounded-[7px] text-[#352432]/45 hover:bg-[#fff4f8]">
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setAdding(true)}
                className="inline-flex items-center gap-1.5 rounded-[9px] border border-[#efbfd0]/75 bg-[#fff1f6] px-3 py-1.5 text-[10px] font-medium text-[#b14d6c] hover:bg-[#ffe6ef]">
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
                ? 'border-[#c85776] bg-[#fff1f6]'
                : 'border-[#ead8df]/70 bg-white hover:border-[#efbfd0]'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-[#fff1f6] text-[#c85776]">
                <ServiceIcon iconKey={suggestIcon(category.name)} className="h-5 w-5" />
              </span>
              {canManage && category.customId && (
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
                  className="grid h-7 w-7 place-items-center rounded-md text-[#352432]/25 opacity-0 transition-opacity hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </span>
              )}
            </div>
            <div className="mt-2 truncate text-[13px] font-medium text-[#352432]">{category.name}</div>
            <div className="text-[10px] text-[#352432]/45">{category.count} {itemLabel}</div>
          </button>
        ))}
        {categories.length === 0 && (
          <div className="col-span-full rounded-[14px] border border-dashed border-[#ead8df] bg-[#fffafb] px-4 py-8 text-center text-[11px] text-[#352432]/45">
            Henüz kategori yok. “Yeni kategori” ile ilk kategoriyi oluşturabilirsiniz.
          </div>
        )}
      </div>
    </div>
  )
}
