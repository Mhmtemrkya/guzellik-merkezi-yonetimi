'use client'

import { useMemo, useRef, useState } from 'react'
import Topbar from '@/components/dashboard/Topbar'
import { motion } from 'framer-motion'
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronDown,
  FileSpreadsheet,
  Loader2,
  Package,
  Scissors,
  Upload,
  Users,
  X,
} from 'lucide-react'
import { importFromExcel, type ImportResult } from '@/lib/excel'
import { analyzeSheet, ENTITY_LABELS, FIELD_LABELS, type AnalyzedSheet, type ImportEntityType } from '@/lib/importAnalyzer'
import { platformApi, pagedItems } from '@/lib/apiClient'
import { useApiQuery } from '@/hooks/useApiQuery'

interface TenantOption {
  id: string
  name: string
}

interface SheetState {
  raw: ImportResult
  analyzed: AnalyzedSheet
  include: boolean
}

interface ImportTotals {
  created: number
  skipped: number
  failed: number
  errors: string[]
}

const CHUNK_SIZE = 400

const ENTITY_ICONS: Record<ImportEntityType, typeof Users> = {
  customer: Users,
  service: Scissors,
  package: Package,
}

export default function PlatformImportPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [tenantId, setTenantId] = useState('')
  const [fileName, setFileName] = useState('')
  const [sheets, setSheets] = useState<SheetState[]>([])
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [totals, setTotals] = useState<ImportTotals | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const { data: tenantData } = useApiQuery<TenantOption[]>(
    async () => {
      const res = await platformApi.tenants<Record<string, unknown>>({ page: 1, pageSize: 200 })
      return pagedItems(res).map((t) => ({
        id: String(t.id ?? t.tenantId ?? ''),
        name: String(t.name ?? t.institutionName ?? t.title ?? 'Kurum'),
      })).filter((t) => t.id)
    },
    [],
    { initialData: [] },
  )
  const tenants = tenantData ?? []
  const selectedTenant = tenants.find((t) => t.id === tenantId) || null

  const reset = (): void => {
    setFileName('')
    setSheets([])
    setError(null)
    setProgress(0)
    setTotals(null)
  }

  const handleFile = async (file: File): Promise<void> => {
    setError(null)
    setTotals(null)
    if (!/\.(xlsx|xlsm|xls)$/i.test(file.name)) {
      setError('Lütfen bir Excel dosyası (.xlsx) seçin.')
      return
    }
    try {
      setFileName(file.name)
      const parsed = await importFromExcel(file)
      const withRows = parsed.filter((s) => s.rows.length > 0)
      if (!withRows.length) {
        setError('Dosyada veri satırı bulunamadı.')
        return
      }
      setSheets(withRows.map((raw) => ({ raw, analyzed: analyzeSheet(raw), include: true })))
    } catch {
      setError('Dosya okunamadı. Geçerli bir Excel dosyası olduğundan emin olun.')
    }
  }

  const changeType = (index: number, type: ImportEntityType): void => {
    setSheets((prev) => prev.map((s, i) => (i === index ? { ...s, analyzed: analyzeSheet(s.raw, type) } : s)))
  }

  const toggleInclude = (index: number): void => {
    setSheets((prev) => prev.map((s, i) => (i === index ? { ...s, include: !s.include } : s)))
  }

  const totalToImport = useMemo(
    () => sheets.filter((s) => s.include).reduce((sum, s) => sum + s.analyzed.validRows, 0),
    [sheets],
  )

  const runImport = async (): Promise<void> => {
    if (!tenantId) {
      setError('Önce hedef kurumu seçin.')
      return
    }
    const included = sheets.filter((s) => s.include && s.analyzed.validRows > 0)
    if (!included.length) {
      setError('Aktarılacak veri yok.')
      return
    }
    setImporting(true)
    setError(null)
    setProgress(0)
    const acc: ImportTotals = { created: 0, skipped: 0, failed: 0, errors: [] }

    // Sayfalar sırayla, her sayfa 400'lük parçalarla gönderilir.
    const jobs: { key: 'customers' | 'services' | 'packages'; rows: unknown[] }[] = []
    for (const s of included) {
      if (s.analyzed.entityType === 'customer') jobs.push({ key: 'customers', rows: s.analyzed.customers.filter((c) => c.phone) })
      else if (s.analyzed.entityType === 'service') jobs.push({ key: 'services', rows: s.analyzed.services })
      else jobs.push({ key: 'packages', rows: s.analyzed.packages })
    }
    const chunks: { key: string; rows: unknown[] }[] = []
    for (const job of jobs) {
      for (let i = 0; i < job.rows.length; i += CHUNK_SIZE) chunks.push({ key: job.key, rows: job.rows.slice(i, i + CHUNK_SIZE) })
    }

    try {
      for (let i = 0; i < chunks.length; i++) {
        const result = await platformApi.bulkImport<{
          customersCreated: number
          customersSkipped: number
          servicesCreated: number
          servicesSkipped: number
          packagesCreated: number
          packagesSkipped: number
          failed: number
          errors: string[]
        }>(tenantId, { [chunks[i]!.key]: chunks[i]!.rows })
        acc.created += (result.customersCreated ?? 0) + (result.servicesCreated ?? 0) + (result.packagesCreated ?? 0)
        acc.skipped += (result.customersSkipped ?? 0) + (result.servicesSkipped ?? 0) + (result.packagesSkipped ?? 0)
        acc.failed += result.failed ?? 0
        if (result.errors?.length && acc.errors.length < 20) acc.errors.push(...result.errors.slice(0, 20 - acc.errors.length))
        setProgress(Math.round(((i + 1) / chunks.length) * 100))
      }
      setTotals(acc)
    } catch (e) {
      setTotals(acc)
      setError(e instanceof Error ? e.message : 'Aktarım sırasında hata oluştu.')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-1 flex-col">
      <Topbar
        title="Veri Aktarımı"
        subtitle="Kurum seçip Excel'den müşteri, hizmet veya paket verilerini aktar"
        breadcrumbs={['Platform', 'Sistem', 'Veri Aktarımı']}
      />
      <main className="mx-auto w-full max-w-4xl flex-1 space-y-5 px-4 py-6 sm:px-6">
        {/* 1 — KURUM SEÇİMİ */}
        <section className="rounded-[20px] border border-[#ecdce3] bg-white p-5 shadow-[0_18px_44px_-36px_rgba(150,78,104,0.4)]">
          <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-[#352432]">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#fff1f6] text-[#c85776]">
              <Building2 className="h-4 w-4" />
            </span>
            1. Hedef Kurum
          </div>
          <div className="relative max-w-sm">
            <select
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              className="w-full appearance-none rounded-xl border border-[#ecdce3] bg-white px-3.5 py-2.5 pr-9 text-[13px] font-semibold text-[#352432] outline-none focus:border-[#c85776]"
            >
              <option value="">Kurum seçin…</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9d7386]" />
          </div>
          <p className="mt-2 text-[11px] text-[#7c6170]">
            Veriler seçilen kurumun ilk şubesine yazılır; mükerrer kayıtlar (aynı telefon / aynı ad) otomatik atlanır.
          </p>
        </section>

        {/* 2 — DOSYA */}
        <section className="rounded-[20px] border border-[#ecdce3] bg-white p-5 shadow-[0_18px_44px_-36px_rgba(150,78,104,0.4)]">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-[#352432]">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#fff1f6] text-[#c85776]">
                <FileSpreadsheet className="h-4 w-4" />
              </span>
              2. Excel Dosyası
            </div>
            {sheets.length > 0 && (
              <button type="button" onClick={reset} className="text-[11px] font-semibold text-[#c85776] hover:underline">
                Farklı dosya seç
              </button>
            )}
          </div>

          {sheets.length === 0 ? (
            <div
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragOver(false)
                const file = e.dataTransfer.files?.[0]
                if (file) void handleFile(file)
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
                dragOver ? 'border-[#ef6f94] bg-[#fff1f6]' : 'border-[#ead8df] bg-[#fffafc] hover:border-[#ef9ab5] hover:bg-[#fff7fa]'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xlsm,.xls"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void handleFile(file)
                  e.target.value = ''
                }}
              />
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#fff1f6] text-[#c85776]">
                <Upload className="h-5 w-5" strokeWidth={1.6} />
              </span>
              <div className="text-[13px] font-semibold text-[#352432]">Excel dosyasını sürükleyin ya da seçin</div>
              <div className="max-w-md text-[11px] leading-relaxed text-[#7c6170]">
                Kolon adları farklı olsa bile veri türü (müşteri / hizmet / paket) sayfa sayfa otomatik tanınır.
                Çok sayfalı dosyalarda her sayfa ayrı değerlendirilir.
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-[12px] text-[#352432]">
                <FileSpreadsheet className="h-4 w-4 text-[#c85776]" />
                <span className="max-w-[280px] truncate font-semibold">{fileName}</span>
                <span className="text-[#7c6170]">· {sheets.length} sayfa</span>
              </div>

              {sheets.map((s, i) => (
                <motion.div
                  key={s.raw.sheetName}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`rounded-2xl border p-4 transition-colors ${s.include ? 'border-[#ecdce3] bg-[#fffafc]' : 'border-dashed border-[#ead8df] bg-white opacity-60'}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="flex cursor-pointer items-center gap-2 text-[12.5px] font-semibold text-[#352432]">
                      <input type="checkbox" checked={s.include} onChange={() => toggleInclude(i)} className="h-4 w-4 accent-[#c85776]" />
                      {s.raw.sheetName}
                      <span className="text-[11px] font-normal text-[#7c6170]">
                        {s.analyzed.validRows.toLocaleString('tr-TR')} / {s.analyzed.totalRows.toLocaleString('tr-TR')} satır
                      </span>
                    </label>
                    <div className="flex gap-1.5">
                      {(Object.keys(ENTITY_LABELS) as ImportEntityType[]).map((type) => {
                        const Icon = ENTITY_ICONS[type]
                        const active = s.analyzed.entityType === type
                        return (
                          <button
                            key={type}
                            type="button"
                            onClick={() => changeType(i, type)}
                            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
                              active ? 'border-[#ef6f94] bg-[#fff1f6] text-[#c85776]' : 'border-[#ead8df] bg-white text-[#7c6170] hover:border-[#ef9ab5]'
                            }`}
                          >
                            <Icon className="h-3 w-3" />
                            {ENTITY_LABELS[type]}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {Object.keys(s.analyzed.mapping).length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {Object.entries(s.analyzed.mapping).map(([field, header]) => (
                        <span key={field} className="inline-flex items-center gap-1 rounded-full border border-[#efbfd0]/70 bg-white px-2 py-0.5 text-[10px] text-[#7c6170]">
                          <span className="font-semibold text-[#c85776]">{FIELD_LABELS[field] ?? field}</span>← {header}
                        </span>
                      ))}
                    </div>
                  )}
                  {s.analyzed.warnings.map((w) => (
                    <div key={w} className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-700">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {w}
                    </div>
                  ))}
                </motion.div>
              ))}
            </div>
          )}
        </section>

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-[12px] text-rose-700">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {error}
          </div>
        )}

        {/* 3 — AKTAR */}
        {sheets.length > 0 && !totals && (
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-[#ecdce3] bg-white p-5 shadow-[0_18px_44px_-36px_rgba(150,78,104,0.4)]">
            <div className="text-[12px] text-[#7c6170]">
              <span className="font-semibold text-[#352432]">{totalToImport.toLocaleString('tr-TR')} kayıt</span>
              {selectedTenant ? (
                <>
                  {' '}→ <span className="font-semibold text-[#c85776]">{selectedTenant.name}</span> kurumuna aktarılacak
                </>
              ) : (
                ' aktarıma hazır — önce kurum seçin'
              )}
            </div>
            {importing ? (
              <div className="flex items-center gap-3">
                <div className="h-2 w-40 overflow-hidden rounded-full bg-[#f5e5eb]">
                  <motion.div className="h-full rounded-full bg-gradient-to-r from-[#ef6f94] to-[#c85776]" animate={{ width: `${progress}%` }} />
                </div>
                <span className="inline-flex items-center gap-2 text-[12px] font-semibold text-[#c85776]">
                  <Loader2 className="h-4 w-4 animate-spin" /> %{progress}
                </span>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void runImport()}
                disabled={!tenantId || totalToImport === 0}
                className="inline-flex items-center gap-2 rounded-xl bg-[#c85776] px-5 py-2.5 text-[12.5px] font-semibold text-white shadow-[0_14px_28px_-16px_rgba(200,87,118,0.8)] transition-opacity hover:opacity-92 disabled:opacity-40"
              >
                <Upload className="h-3.5 w-3.5" /> Kuruma Aktar
              </button>
            )}
          </section>
        )}

        {/* 4 — SONUÇ */}
        {totals && (
          <section className="space-y-4 rounded-[20px] border border-[#ecdce3] bg-white p-5 shadow-[0_18px_44px_-36px_rgba(150,78,104,0.4)]">
            <div className="flex items-center gap-2 text-[14px] font-semibold text-[#352432]">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" /> Aktarım tamamlandı
              {selectedTenant && <span className="text-[12px] font-normal text-[#7c6170]">· {selectedTenant.name}</span>}
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 px-3 py-3">
                <div className="text-[20px] font-bold text-emerald-700">{totals.created.toLocaleString('tr-TR')}</div>
                <div className="text-[10px] font-semibold text-emerald-800">Eklendi</div>
              </div>
              <div className="rounded-xl border border-amber-100 bg-amber-50/60 px-3 py-3">
                <div className="text-[20px] font-bold text-amber-700">{totals.skipped.toLocaleString('tr-TR')}</div>
                <div className="text-[10px] font-semibold text-amber-800">Mükerrer / Atlandı</div>
              </div>
              <div className="rounded-xl border border-rose-100 bg-rose-50/60 px-3 py-3">
                <div className="text-[20px] font-bold text-rose-700">{totals.failed.toLocaleString('tr-TR')}</div>
                <div className="text-[10px] font-semibold text-rose-800">Hatalı</div>
              </div>
            </div>
            {totals.errors.length > 0 && (
              <div className="max-h-36 overflow-y-auto rounded-xl border border-[#ecdce3] bg-[#fffafc] px-3 py-2 text-[11px] text-[#7c6170]">
                {totals.errors.map((e, i) => (
                  <div key={i} className="py-0.5">• {e}</div>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-2 rounded-xl border border-[#ead8df] bg-white px-4 py-2.5 text-[12px] font-semibold text-[#7c6170] transition-colors hover:border-[#ef9ab5] hover:text-[#c85776]"
            >
              <X className="h-3.5 w-3.5" /> Yeni aktarım
            </button>
          </section>
        )}
      </main>
    </div>
  )
}
