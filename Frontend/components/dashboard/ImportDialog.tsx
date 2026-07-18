'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  Package,
  Scissors,
  Upload,
  Users,
  X,
} from 'lucide-react'
import { importFromExcel, type ImportResult } from '@/lib/excel'
import {
  analyzeSheet,
  ENTITY_LABELS,
  FIELD_LABELS,
  type AnalyzedSheet,
  type ImportEntityType,
} from '@/lib/importAnalyzer'
import { adminApi } from '@/lib/apiClient'
import { useBranch } from './BranchContext'

interface ImportDialogProps {
  open: boolean
  onClose: () => void
}

interface ImportTotals {
  customersCreated: number
  customersSkipped: number
  servicesCreated: number
  servicesSkipped: number
  packagesCreated: number
  packagesSkipped: number
  failed: number
  errors: string[]
}

type Step = 'pick' | 'preview' | 'importing' | 'done'

const CHUNK_SIZE = 400

const ENTITY_ICONS: Record<ImportEntityType, typeof Users> = {
  customer: Users,
  service: Scissors,
  package: Package,
}

export default function ImportDialog({ open, onClose }: ImportDialogProps) {
  const { selectedBranchId } = useBranch()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [step, setStep] = useState<Step>('pick')
  const [fileName, setFileName] = useState('')
  const [rawSheets, setRawSheets] = useState<ImportResult[]>([])
  const [analyzed, setAnalyzed] = useState<AnalyzedSheet | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [totals, setTotals] = useState<ImportTotals | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const reset = useCallback((): void => {
    setStep('pick')
    setFileName('')
    setRawSheets([])
    setAnalyzed(null)
    setError(null)
    setProgress(0)
    setTotals(null)
  }, [])

  const close = (): void => {
    if (step === 'importing') return // aktarım ortasında kapatma
    reset()
    onClose()
  }

  const handleFile = async (file: File): Promise<void> => {
    setError(null)
    if (!/\.(xlsx|xlsm|xls)$/i.test(file.name)) {
      setError('Lütfen bir Excel dosyası (.xlsx) seçin.')
      return
    }
    try {
      setFileName(file.name)
      const sheets = await importFromExcel(file)
      const withRows = sheets.filter((s) => s.rows.length > 0)
      if (!withRows.length) {
        setError('Dosyada veri satırı bulunamadı.')
        return
      }
      // En çok satırı olan sayfa esas alınır
      const main = withRows.reduce((a, b) => (b.rows.length > a.rows.length ? b : a))
      setRawSheets(withRows)
      setAnalyzed(analyzeSheet(main))
      setStep('preview')
    } catch {
      setError('Dosya okunamadı. Geçerli bir Excel dosyası olduğundan emin olun.')
    }
  }

  const changeType = (type: ImportEntityType): void => {
    if (!analyzed) return
    const sheet = rawSheets.find((s) => s.sheetName === analyzed.sheetName)
    if (sheet) setAnalyzed(analyzeSheet(sheet, type))
  }

  const runImport = async (): Promise<void> => {
    if (!analyzed || !selectedBranchId) {
      setError(selectedBranchId ? 'Aktarılacak veri yok.' : 'Önce bir şube seçmelisiniz.')
      return
    }
    setStep('importing')
    setProgress(0)
    const acc: ImportTotals = {
      customersCreated: 0,
      customersSkipped: 0,
      servicesCreated: 0,
      servicesSkipped: 0,
      packagesCreated: 0,
      packagesSkipped: 0,
      failed: 0,
      errors: [],
    }

    const rows =
      analyzed.entityType === 'customer'
        ? analyzed.customers.filter((c) => c.phone)
        : analyzed.entityType === 'service'
          ? analyzed.services
          : analyzed.packages
    const phoneless = analyzed.entityType === 'customer' ? analyzed.customers.length - rows.length : 0
    acc.failed += phoneless
    if (phoneless > 0) acc.errors.push(`${phoneless} satır geçerli telefon olmadığı için aktarılmadı.`)

    const chunks: unknown[][] = []
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) chunks.push(rows.slice(i, i + CHUNK_SIZE))

    try {
      for (let i = 0; i < chunks.length; i++) {
        const body: Record<string, unknown> = { branchId: selectedBranchId }
        if (analyzed.entityType === 'customer') body.customers = chunks[i]
        else if (analyzed.entityType === 'service') body.services = chunks[i]
        else body.packages = chunks[i]

        const result = await adminApi.bulkImport<{
          customersCreated: number
          customersSkipped: number
          servicesCreated: number
          servicesSkipped: number
          packagesCreated: number
          packagesSkipped: number
          failed: number
          errors: string[]
        }>(body)

        acc.customersCreated += result.customersCreated ?? 0
        acc.customersSkipped += result.customersSkipped ?? 0
        acc.servicesCreated += result.servicesCreated ?? 0
        acc.servicesSkipped += result.servicesSkipped ?? 0
        acc.packagesCreated += result.packagesCreated ?? 0
        acc.packagesSkipped += result.packagesSkipped ?? 0
        acc.failed += result.failed ?? 0
        if (result.errors?.length && acc.errors.length < 20) acc.errors.push(...result.errors.slice(0, 20 - acc.errors.length))
        setProgress(Math.round(((i + 1) / chunks.length) * 100))
      }
      setTotals(acc)
      setStep('done')
    } catch (e) {
      setTotals(acc)
      setError(e instanceof Error ? e.message : 'Aktarım sırasında hata oluştu.')
      setStep('done')
    }
  }

  const previewRows = useMemo(() => {
    if (!analyzed) return []
    if (analyzed.entityType === 'customer')
      return analyzed.customers.slice(0, 6).map((c) => [c.fullName, c.phone || '—', c.email || '—', c.birthDate || '—'])
    if (analyzed.entityType === 'service')
      return analyzed.services.slice(0, 6).map((s) => [s.name, s.category || '—', s.durationMinutes != null ? `${s.durationMinutes} dk` : '—', s.price != null ? `₺${s.price}` : '—'])
    return analyzed.packages.slice(0, 6).map((p) => [p.name, p.category || '—', p.sessionCount != null ? `${p.sessionCount} seans` : '—', p.totalPrice != null ? `₺${p.totalPrice}` : '—'])
  }, [analyzed])

  const previewHeaders =
    analyzed?.entityType === 'customer'
      ? ['Ad Soyad', 'Telefon', 'E-posta', 'Doğum Tarihi']
      : analyzed?.entityType === 'service'
        ? ['Hizmet', 'Kategori', 'Süre', 'Fiyat']
        : ['Paket', 'Kategori', 'Seans', 'Toplam Fiyat']

  const totalCreated = (totals?.customersCreated ?? 0) + (totals?.servicesCreated ?? 0) + (totals?.packagesCreated ?? 0)
  const totalSkipped = (totals?.customersSkipped ?? 0) + (totals?.servicesSkipped ?? 0) + (totals?.packagesSkipped ?? 0)

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="import-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[210] flex items-start justify-center overflow-y-auto bg-[#4a2335]/22 px-4 py-[8vh] backdrop-blur-md"
          onClick={close}
        >
          <motion.div
            initial={{ opacity: 0, y: -16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.97 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-2xl overflow-hidden rounded-[24px] border border-[#ead8df]/85 bg-white/97 shadow-[0_36px_110px_rgba(150,78,104,0.24)]"
          >
            {/* başlık */}
            <div className="flex items-center justify-between border-b border-[#ead8df]/75 px-6 py-4">
              <div className="flex items-center gap-2.5">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#fff1f6] text-[#c85776]">
                  <FileSpreadsheet className="h-4.5 w-4.5" strokeWidth={1.7} />
                </span>
                <div>
                  <div className="text-[14px] font-semibold text-[#352432]">Excel İçeri Aktar</div>
                  <div className="text-[11px] text-[#7c6170]">
                    Müşteri, hizmet veya paket listesi — kolon yapısı otomatik tanınır
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={close}
                disabled={step === 'importing'}
                aria-label="Kapat"
                className="grid h-8 w-8 place-items-center rounded-lg text-[#9d7386] transition-colors hover:bg-[#fff1f6] hover:text-[#c85776] disabled:opacity-40"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-6 py-5">
              {error && (
                <div className="mb-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-[12px] text-rose-700">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {error}
                </div>
              )}

              {/* 1 — DOSYA SEÇ */}
              {step === 'pick' && (
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
                  className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors ${
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
                  <span className="grid h-14 w-14 place-items-center rounded-2xl bg-[#fff1f6] text-[#c85776]">
                    <Upload className="h-6 w-6" strokeWidth={1.6} />
                  </span>
                  <div className="text-[13px] font-semibold text-[#352432]">
                    Excel dosyasını sürükleyin ya da seçmek için tıklayın
                  </div>
                  <div className="max-w-sm text-[11px] leading-relaxed text-[#7c6170]">
                    Başka bir programdan dışa aktarılmış listeler de desteklenir; kolon adları farklı olsa bile
                    veriler otomatik tanınıp doğru alanlara eşlenir.
                  </div>
                </div>
              )}

              {/* 2 — ÖNİZLEME */}
              {step === 'preview' && analyzed && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#ead8df]/80 bg-[#fffafc] px-3.5 py-2.5">
                    <div className="flex items-center gap-2 text-[12px] text-[#352432]">
                      <FileSpreadsheet className="h-4 w-4 text-[#c85776]" />
                      <span className="max-w-[240px] truncate font-semibold">{fileName}</span>
                      <span className="text-[#7c6170]">· {analyzed.totalRows.toLocaleString('tr-TR')} satır</span>
                    </div>
                    <button
                      type="button"
                      onClick={reset}
                      className="text-[11px] font-semibold text-[#c85776] hover:underline"
                    >
                      Farklı dosya seç
                    </button>
                  </div>

                  {/* tip seçimi */}
                  <div>
                    <div className="mb-2 text-[11px] font-semibold text-[#7c6170]">
                      Veri türü {analyzed.autoDetected && <span className="ml-1 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700">otomatik tespit</span>}
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {(Object.keys(ENTITY_LABELS) as ImportEntityType[]).map((type) => {
                        const Icon = ENTITY_ICONS[type]
                        const active = analyzed.entityType === type
                        return (
                          <button
                            key={type}
                            type="button"
                            onClick={() => changeType(type)}
                            className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-[12px] font-semibold transition-colors ${
                              active
                                ? 'border-[#ef6f94] bg-[#fff1f6] text-[#c85776]'
                                : 'border-[#ead8df] bg-white text-[#7c6170] hover:border-[#ef9ab5]'
                            }`}
                          >
                            <Icon className="h-3.5 w-3.5" />
                            {ENTITY_LABELS[type]}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* kolon eşleme */}
                  {Object.keys(analyzed.mapping).length > 0 && (
                    <div>
                      <div className="mb-2 text-[11px] font-semibold text-[#7c6170]">Tanınan kolonlar</div>
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(analyzed.mapping).map(([field, header]) => (
                          <span
                            key={field}
                            className="inline-flex items-center gap-1 rounded-full border border-[#efbfd0]/70 bg-[#fff7fa] px-2 py-1 text-[10px] text-[#7c6170]"
                          >
                            <span className="font-semibold text-[#c85776]">{FIELD_LABELS[field] ?? field}</span>
                            ← {header}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* örnek satırlar */}
                  <div className="overflow-x-auto rounded-xl border border-[#ead8df]/80">
                    <table className="w-full text-left text-[11px]">
                      <thead>
                        <tr className="border-b border-[#ead8df]/70 bg-[#fff7fa] text-[#9d2449]">
                          {previewHeaders.map((h) => (
                            <th key={h} className="px-3 py-2 font-semibold">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((cells, i) => (
                          <tr key={i} className="border-b border-[#f5eaef] last:border-0">
                            {cells.map((c, j) => (
                              <td key={j} className="max-w-[180px] truncate px-3 py-1.5 text-[#4a3a44]">{c}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {analyzed.warnings.map((w) => (
                    <div key={w} className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      {w}
                    </div>
                  ))}

                  <div className="flex items-center justify-between gap-3 pt-1">
                    <div className="text-[11px] text-[#7c6170]">
                      <span className="font-semibold text-[#352432]">{analyzed.validRows.toLocaleString('tr-TR')}</span>{' '}
                      {ENTITY_LABELS[analyzed.entityType].toLocaleLowerCase('tr-TR')} kaydı aktarılacak; mükerrer kayıtlar otomatik atlanır.
                    </div>
                    <button
                      type="button"
                      onClick={() => void runImport()}
                      disabled={analyzed.validRows === 0}
                      className="inline-flex items-center gap-2 rounded-xl bg-[#c85776] px-4 py-2.5 text-[12px] font-semibold text-white shadow-[0_14px_28px_-16px_rgba(200,87,118,0.8)] transition-opacity hover:opacity-92 disabled:opacity-40"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      İçeri Aktar
                    </button>
                  </div>
                </div>
              )}

              {/* 3 — AKTARILIYOR */}
              {step === 'importing' && (
                <div className="flex flex-col items-center gap-4 py-10">
                  <Loader2 className="h-8 w-8 animate-spin text-[#c85776]" />
                  <div className="text-[13px] font-semibold text-[#352432]">Kayıtlar aktarılıyor… %{progress}</div>
                  <div className="h-2 w-64 overflow-hidden rounded-full bg-[#f5e5eb]">
                    <motion.div
                      className="h-full rounded-full bg-gradient-to-r from-[#ef6f94] to-[#c85776]"
                      animate={{ width: `${progress}%` }}
                      transition={{ ease: 'easeOut' }}
                    />
                  </div>
                  <div className="text-[11px] text-[#7c6170]">Büyük listelerde bu işlem bir dakika sürebilir; pencereyi kapatmayın.</div>
                </div>
              )}

              {/* 4 — SONUÇ */}
              {step === 'done' && totals && (
                <div className="space-y-4">
                  <div className="flex flex-col items-center gap-2 py-2 text-center">
                    <span className="grid h-14 w-14 place-items-center rounded-full bg-emerald-50 text-emerald-600">
                      <CheckCircle2 className="h-7 w-7" strokeWidth={1.8} />
                    </span>
                    <div className="text-[15px] font-semibold text-[#352432]">Aktarım tamamlandı</div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 px-3 py-3">
                      <div className="text-[20px] font-bold text-emerald-700">{totalCreated.toLocaleString('tr-TR')}</div>
                      <div className="text-[10px] font-semibold text-emerald-800">Eklendi</div>
                    </div>
                    <div className="rounded-xl border border-amber-100 bg-amber-50/60 px-3 py-3">
                      <div className="text-[20px] font-bold text-amber-700">{totalSkipped.toLocaleString('tr-TR')}</div>
                      <div className="text-[10px] font-semibold text-amber-800">Mükerrer / Atlandı</div>
                    </div>
                    <div className="rounded-xl border border-rose-100 bg-rose-50/60 px-3 py-3">
                      <div className="text-[20px] font-bold text-rose-700">{totals.failed.toLocaleString('tr-TR')}</div>
                      <div className="text-[10px] font-semibold text-rose-800">Hatalı</div>
                    </div>
                  </div>
                  {totals.errors.length > 0 && (
                    <div className="max-h-32 overflow-y-auto rounded-xl border border-[#ead8df]/80 bg-[#fffafc] px-3 py-2 text-[11px] text-[#7c6170]">
                      {totals.errors.map((e, i) => (
                        <div key={i} className="py-0.5">• {e}</div>
                      ))}
                    </div>
                  )}
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={reset}
                      className="rounded-xl border border-[#ead8df] bg-white px-4 py-2.5 text-[12px] font-semibold text-[#7c6170] transition-colors hover:border-[#ef9ab5] hover:text-[#c85776]"
                    >
                      Yeni dosya aktar
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        reset()
                        onClose()
                        // Sayfadaki listeler taze veriyi çeksin
                        window.location.reload()
                      }}
                      className="rounded-xl bg-[#c85776] px-4 py-2.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-92"
                    >
                      Kapat
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
