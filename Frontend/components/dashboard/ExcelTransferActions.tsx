'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Boxes,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  Filter,
  Hash,
  Layers,
  Loader2,
  Settings2,
  Sparkles,
  Tag,
  Upload,
  UploadCloud,
  X,
  type LucideIcon,
} from 'lucide-react'
import {
  exportToExcel,
  importFromExcel,
  type ExcelCellValue,
  type ExcelColumn,
  type ExcelSheetSpec,
  type ImportResult,
} from '@/lib/excel'
import type { FeatureKey } from '@/lib/types'
import { useFeatureContext } from '@/components/dashboard/FeatureContext'

/**
 * Dışa aktarma için seçilebilir bir veri seti. Birden fazla verilirse export
 * modalında "Veri seti" açılır menüsü çıkar (örn. Hizmetler / Paketler) ve
 * kullanıcı hangisini seçtiyse o veri o kolonlarla indirilir.
 */
export interface ExcelExportDataset {
  key: string
  label: string
  rows: unknown[]
  columns: ExcelColumn<unknown>[]
  subtitle?: string
  sheetName?: string
  totals?: Partial<Record<string, ExcelCellValue>>
}

/**
 * İçeri aktarma hedefi. Birden fazla verilirse import modalında "Ne aktarılsın?"
 * seçici çıkar (örn. Hizmetler / Paketler) ve seçilen hedefin handler'ı çağrılır.
 */
export interface ExcelImportTarget {
  key: string
  label: string
  onImport: (rows: ImportResult[]) => Promise<void> | void
  /** Beklenen kolon başlıkları — kullanıcıya ipucu olarak gösterilir. */
  templateHeaders?: string[]
}

export interface ExcelTransferActionsProps<TRow> {
  moduleName: string
  /** Legacy tek veri seti. `exportDatasets` verilirse yok sayılır. */
  rows?: TRow[]
  /** Legacy tek veri seti kolonları. `exportDatasets` verilirse yok sayılır. */
  sheet?: Omit<ExcelSheetSpec<TRow>, 'rows' | 'name'>
  context?: string
  sheetName?: string
  onImport?: (rows: ImportResult[]) => Promise<void> | void
  triggerClassName?: string
  extraSheets?: ExcelSheetSpec<unknown>[]
  /**
   * Seçilebilir veri setleri. Verilirse `rows`/`sheet` yerine bunlar kullanılır;
   * modalda veri seti seçici gösterilir. Her veri seti kendi kolon setiyle gelir.
   */
  exportDatasets?: ExcelExportDataset[]
  /**
   * Seçilebilir içeri aktarma hedefleri. Verilirse `onImport` yerine bunlar kullanılır;
   * import modalında hedef seçici gösterilir.
   */
  importTargets?: ExcelImportTarget[]
  /**
   * Feature flag: tenant'ın paketinde bu key yoksa Excel butonları render edilmez.
   * Belirtilmezse her zaman gösterilir (geriye dönük uyumluluk).
   */
  featureKey?: FeatureKey
}

const ghostBtn =
  'group relative inline-flex min-h-10 items-center justify-center gap-2 overflow-hidden border border-[#ead8df]/[0.70] px-3 py-2 text-[10px] font-mono uppercase tracking-widest text-[#352432]/[0.72] transition-colors hover:border-[#efbfd0]/[0.75] hover:text-[#352432] disabled:opacity-60'

const goldBtn =
  'group relative inline-flex min-h-10 items-center justify-center gap-2 overflow-hidden border border-[#efbfd0]/[0.75] px-3 py-2 text-[10px] font-mono uppercase tracking-widest text-[#c85776] transition-colors hover:bg-[#f0aac2]/[0.10] hover:text-[#352432] disabled:opacity-60'

const fieldStyle =
  'min-h-11 w-full rounded-[14px] border border-[#ead8df]/[0.80] bg-white/[0.88] px-3 py-2 text-sm text-[#352432] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] transition-colors placeholder:text-[#8f7784]/[0.45] hover:border-[#efbfd0]/[0.85] focus:border-[#f0aac2]/[0.85] focus:bg-white focus:outline-none'

const labelStyle =
  'flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.22em] text-[#c85776]/[0.70]'

const helperStyle = 'mt-1 text-[10px] leading-relaxed text-[#352432]/[0.40]'

function slugify(input: string): string {
  return input
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

interface ModalShellProps {
  open: boolean
  onOpenChange: (next: boolean) => void
  trigger: ReactNode
  eyebrow: string
  title: string
  description: string
  icon: LucideIcon
  children: ReactNode
  footer: ReactNode
}

function ModalShell({ open, onOpenChange, trigger, eyebrow, title, description, icon: Icon, children, footer }: ModalShellProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        className="flex h-[94dvh] flex-col overflow-hidden rounded-[28px] border border-[#ead8df]/[0.90] bg-white/[0.96] p-0 text-[#352432] shadow-[0_34px_120px_-58px_rgba(120,71,88,0.72)] backdrop-blur-2xl sm:!max-w-none [&>button:last-child]:hidden"
        style={{ width: 'min(92vw, 980px)', maxWidth: 'min(92vw, 980px)', height: '94dvh', maxHeight: '94dvh' }}
      >
        <div className="relative flex h-full flex-col overflow-hidden bg-gradient-to-br from-white via-[#fff7fa] to-[#fff0f5]">
          <motion.span
            aria-hidden
            animate={{ opacity: [0.55, 0.85, 0.55] }}
            transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
            className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[#f0aac2]/[0.22] blur-3xl"
          />
          <span aria-hidden className="pointer-events-none absolute inset-0 bg-grid opacity-[0.04]" />

          {/* HEADER */}
          <header className="relative shrink-0 border-b border-[#ead8df]/[0.70] p-5 pr-12 sm:p-6 sm:pr-14">
            <div className="flex items-start gap-4">
              <motion.span
                initial={{ scale: 0.85, rotate: -8 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ duration: 0.4 }}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[#efbfd0]/[0.80] bg-white text-[#c85776] shadow-[0_14px_34px_-24px_rgba(200,87,118,0.8)]"
              >
                <Icon className="h-4 w-4 text-[#c85776]" strokeWidth={1.6} />
              </motion.span>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-mono uppercase tracking-[0.28em] text-[#c85776]/[0.80]">{eyebrow}</div>
                <DialogTitle className="mt-1 font-display text-2xl tracking-tight">{title}</DialogTitle>
                <DialogDescription className="mt-2 text-[12px] leading-relaxed text-[#352432]/[0.60]">
                  {description}
                </DialogDescription>
              </div>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#ead8df]/[0.80] bg-white/[0.82] text-[#7e5f6e] shadow-[0_10px_28px_-20px_rgba(120,71,88,0.55)] transition-colors hover:border-[#efbfd0]/[0.90] hover:text-[#352432]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </header>

          {/* BODY */}
          <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6 sm:px-7 sm:py-7">
            {children}
          </div>

          {/* FOOTER */}
          <footer className="relative shrink-0 border-t border-[#ead8df]/[0.70] px-5 py-4 sm:px-7 sm:py-5">{footer}</footer>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function defaultFilename(label: string): string {
  return `Armonessa-${slugify(label)}-${new Date().toISOString().slice(0, 10)}`
}

export default function ExcelTransferActions<TRow>({
  moduleName,
  rows = [],
  sheet,
  context,
  sheetName,
  onImport,
  triggerClassName = '',
  extraSheets = [],
  exportDatasets,
  importTargets,
  featureKey,
}: ExcelTransferActionsProps<TRow>) {
  const featureCtx = useFeatureContext()
  const isFeatureAllowed = featureKey ? featureCtx.has(featureKey) : true

  // Aksiyon anı kesin kontrol: korumalı işlem çalışmadan önce sunucudan taze doğrulama.
  // UI bayat olsa bile (ör. yeni düşürülmüş plan) işlem reddedilir.
  const ensureFeatureAllowed = async (): Promise<boolean> => {
    if (!featureKey) return true
    return featureCtx.revalidateHas(featureKey)
  }
  const featureDeniedMessage = 'Bu özellik mevcut paketinizde bulunmuyor. Kullanmak için paketinizi yükseltin.'

  const hasDatasets = Boolean(exportDatasets && exportDatasets.length > 0)
  const hasImportTargets = Boolean(importTargets && importTargets.length > 0)

  // EXPORT modal state
  const [exportOpen, setExportOpen] = useState(false)
  const [exportBusy, setExportBusy] = useState(false)
  const [exportDone, setExportDone] = useState(false)
  const [exportError, setExportError] = useState('')

  // Aktif veri seti (yalnızca exportDatasets verildiğinde anlamlı)
  const [activeDatasetKey, setActiveDatasetKey] = useState<string>(() => exportDatasets?.[0]?.key ?? '')

  // Seçilen veri setine (yoksa legacy sheet'e) göre aktif export kaynağı
  const activeSource = useMemo(() => {
    if (hasDatasets) {
      const ds = exportDatasets!.find((d) => d.key === activeDatasetKey) ?? exportDatasets![0]
      return {
        label: ds.label,
        rows: ds.rows,
        columns: ds.columns,
        subtitle: ds.subtitle,
        sheetName: ds.sheetName ?? ds.label,
        totals: ds.totals,
      }
    }
    return {
      label: moduleName,
      rows: rows as unknown[],
      columns: (sheet?.columns ?? []) as unknown as ExcelColumn<unknown>[],
      subtitle: sheet?.subtitle,
      sheetName: sheetName ?? moduleName,
      totals: sheet?.totals,
    }
  }, [hasDatasets, exportDatasets, activeDatasetKey, moduleName, rows, sheet, sheetName])

  const slugBase = useMemo(() => slugify(moduleName), [moduleName])
  const [exportFilename, setExportFilename] = useState(() => defaultFilename(hasDatasets ? (exportDatasets![0].label) : moduleName))
  const [selectedKeys, setSelectedKeys] = useState<string[]>(() => activeSource.columns.map((c) => c.key))
  const [includeTotals, setIncludeTotals] = useState(true)
  const [includeExtras, setIncludeExtras] = useState(true)
  const [scopeFilter, setScopeFilter] = useState<'all' | 'filtered'>('filtered')

  // Veri seti değişince kolon seçimi + dosya adı varsayılanı o sete göre sıfırlanır
  useEffect(() => {
    if (!hasDatasets) return
    const ds = exportDatasets!.find((d) => d.key === activeDatasetKey) ?? exportDatasets![0]
    setSelectedKeys(ds.columns.map((c) => c.key))
    setExportFilename(defaultFilename(ds.label))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDatasetKey])

  // IMPORT modal state
  const [importOpen, setImportOpen] = useState(false)
  const [importBusy, setImportBusy] = useState(false)
  const [importDone, setImportDone] = useState(false)
  const [importError, setImportError] = useState('')
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importPreview, setImportPreview] = useState<ImportResult[] | null>(null)
  const [importMode, setImportMode] = useState<'insert' | 'merge'>('merge')
  const [activeImportKey, setActiveImportKey] = useState<string>(() => importTargets?.[0]?.key ?? '')
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Aktif import hedefi + handler (yoksa legacy onImport)
  const activeImportTarget = hasImportTargets
    ? (importTargets!.find((t) => t.key === activeImportKey) ?? importTargets![0])
    : null
  const activeImportHandler = activeImportTarget?.onImport ?? onImport
  const canImport = Boolean(activeImportHandler)

  const toggleColumn = (key: string): void => {
    setSelectedKeys((current) => (current.includes(key) ? current.filter((k) => k !== key) : [...current, key]))
  }

  const handleExport = async (): Promise<void> => {
    setExportBusy(true)
    setExportDone(false)
    setExportError('')
    try {
      // Aksiyon anı entitlement kontrolü — sunucu kesin karar verir.
      if (!(await ensureFeatureAllowed())) {
        setExportError(featureDeniedMessage)
        return
      }
      // Kolon sırasını seçim değil tanım sırası belirler; seçili olanları süzeriz.
      const chosenColumns = activeSource.columns.filter((c) => selectedKeys.includes(c.key))
      if (!chosenColumns.length) {
        setExportError('En az bir kolon seçmelisin.')
        return
      }
      const primary: ExcelSheetSpec<unknown> = {
        name: activeSource.sheetName,
        subtitle: activeSource.subtitle,
        rows: activeSource.rows,
        columns: chosenColumns,
        totals: includeTotals ? activeSource.totals : undefined,
      }
      // Ek sayfalar yalnızca legacy (veri seti seçici olmayan) modda eklenir.
      const extra = !hasDatasets && includeExtras ? (extraSheets as ExcelSheetSpec<unknown>[]) : []
      await exportToExcel<unknown>([primary, ...extra], {
        filenameBase: slugBase,
        exactFilename: exportFilename.trim(),
        title: activeSource.label,
        context: context || '',
      })
      setExportDone(true)
      setTimeout(() => {
        setExportDone(false)
        setExportOpen(false)
      }, 900)
    } catch (e: unknown) {
      setExportError(e instanceof Error ? e.message : 'Excel oluşturulamadı.')
    } finally {
      setExportBusy(false)
    }
  }

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    if (!file) return
    setImportFile(file)
    setImportError('')
    try {
      const result = await importFromExcel(file)
      setImportPreview(result)
    } catch (err: unknown) {
      setImportError(err instanceof Error ? err.message : 'Excel okunamadı.')
    }
  }

  const handleImportSubmit = async (): Promise<void> => {
    if (!importPreview || !activeImportHandler) return
    setImportBusy(true)
    setImportError('')
    setImportDone(false)
    try {
      // Aksiyon anı entitlement kontrolü — sunucu kesin karar verir.
      if (!(await ensureFeatureAllowed())) {
        setImportError(featureDeniedMessage)
        return
      }
      await activeImportHandler(importPreview)
      setImportDone(true)
      setTimeout(() => {
        setImportDone(false)
        setImportOpen(false)
        setImportFile(null)
        setImportPreview(null)
        if (fileInputRef.current) fileInputRef.current.value = ''
      }, 1000)
    } catch (err: unknown) {
      setImportError(err instanceof Error ? err.message : 'Aktarım tamamlanamadı.')
    } finally {
      setImportBusy(false)
    }
  }

  const previewCount = importPreview?.reduce((s, r) => s + r.rows.length, 0) || 0

  // Feature flag kapalıysa Excel butonlarını gizle — paket bu özelliği içermiyor.
  if (!isFeatureAllowed) return null

  return (
    <div className="grid w-full grid-cols-1 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
      {/* IMPORT MODAL */}
      <ModalShell
        open={importOpen}
        onOpenChange={(next) => {
          setImportOpen(next)
          if (next) {
            // Açılışta taze doğrula — plan düşürüldüyse buton/komponent anında kaybolur.
            if (featureKey) void featureCtx.revalidate()
          } else {
            setImportFile(null)
            setImportPreview(null)
            setImportError('')
            if (fileInputRef.current) fileInputRef.current.value = ''
          }
        }}
        eyebrow="Excel · Import"
        title={hasImportTargets ? 'Excel’den içeri aktar' : `${moduleName} içeri aktar`}
        description="Excel şablonundan toplu kayıt ekle. Önce ne aktaracağını seç, dosyayı yükle, satırları gözden geçir, sonra onayla."
        icon={UploadCloud}
        trigger={
          <button
            type="button"
            disabled={!canImport}
            title={canImport ? 'Excel\'den içeri al' : 'Bu modülde içeri aktarım henüz desteklenmiyor'}
            className={`${ghostBtn} ${triggerClassName}`}
          >
            <Upload className="h-3.5 w-3.5" strokeWidth={1.6} />
            <span>Excel&apos;e içeriden al</span>
          </button>
        }
        footer={
          <div className="flex items-center justify-between gap-3">
            <div className="text-[10px] font-mono uppercase tracking-widest text-[#352432]/[0.40]">
              {importPreview ? `${previewCount} satır algılandı` : 'Dosya seçilmedi'}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setImportOpen(false)}
                disabled={importBusy}
                className="rounded-full border border-[#ead8df]/[0.80] bg-white/[0.72] px-4 py-2 text-[10px] font-mono uppercase tracking-widest text-[#352432]/[0.65] transition-colors hover:border-[#efbfd0]/[0.75] hover:text-[#352432] disabled:opacity-50"
              >
                Vazgeç
              </button>
              <motion.button
                type="button"
                onClick={handleImportSubmit}
                disabled={importBusy || importDone || !importPreview}
                whileTap={{ scale: 0.96 }}
                className="inline-flex items-center gap-2 rounded-full border border-[#efbfd0]/[0.80] bg-gradient-to-r from-[#fff7fa] via-[#ffdbe7] to-[#f4a9c4] px-5 py-2 text-[10px] font-mono uppercase tracking-widest text-[#2f1724] disabled:opacity-70"
              >
                {importBusy && <Loader2 className="h-3 w-3 animate-spin" />}
                {importDone && <CheckCircle2 className="h-3 w-3" />}
                {!importBusy && !importDone && <Upload className="h-3 w-3" />}
                {importDone ? 'İçeri aktarıldı' : importBusy ? 'Aktarılıyor…' : `${previewCount} satırı aktar`}
              </motion.button>
            </div>
          </div>
        }
      >
        <div className="space-y-5">
          {/* Hedef seçici — yalnızca birden fazla import hedefi verildiğinde */}
          {hasImportTargets && (
            <div>
              <label className={labelStyle}>
                <Boxes className="h-3 w-3" /> Ne aktarılsın?
              </label>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {importTargets!.map((t) => {
                  const active = t.key === activeImportKey
                  return (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => {
                        setActiveImportKey(t.key)
                        // Hedef değişince önceki dosya/önizleme temizlenir.
                        setImportFile(null)
                        setImportPreview(null)
                        setImportError('')
                        if (fileInputRef.current) fileInputRef.current.value = ''
                      }}
                      className={`flex items-center justify-between gap-2 border px-3 py-2.5 text-left transition-colors ${
                        active
                          ? 'border-[#efbfd0]/[0.75] bg-[#f0aac2]/[0.10] text-[#352432]'
                          : 'border-[#ead8df]/[0.70] bg-white/[0.72] text-[#352432]/[0.60] hover:border-[#efbfd0]/[0.75]'
                      }`}
                    >
                      <span className="truncate text-[12px] font-medium">{t.label}</span>
                      {active && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#c85776]" />}
                    </button>
                  )
                })}
              </div>
              {activeImportTarget?.templateHeaders?.length ? (
                <div className={helperStyle}>
                  Beklenen kolonlar: {activeImportTarget.templateHeaders.join(' · ')}
                </div>
              ) : (
                <div className={helperStyle}>Seçtiğin hedefe uygun kolon başlıklarıyla bir Excel yükle.</div>
              )}
            </div>
          )}

          {/* Dosya seç */}
          <div>
            <label className={labelStyle}>
              <FileSpreadsheet className="h-3 w-3" /> Excel dosyası
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFile}
              className={`mt-2 ${fieldStyle} cursor-pointer`}
            />
            <div className={helperStyle}>
              Şablon olarak önce &quot;Excel&apos;e dışarı aktar&quot; ile bir örnek indir; aynı kolon başlıklarıyla doldur.
            </div>
          </div>

          {/* Mod seç */}
          <div>
            <label className={labelStyle}>
              <Settings2 className="h-3 w-3" /> Aktarım modu
            </label>
            <select className={`mt-2 ${fieldStyle}`} value={importMode} onChange={(e) => setImportMode(e.target.value as 'insert' | 'merge')}>
              <option value="insert">Sadece yeni kayıt ekle</option>
              <option value="merge">Yeni ekle + mevcutları güncelle</option>
            </select>
            <div className={helperStyle}>Şu an handler her satırı yeni kayıt olarak ekliyor; eşleşme tablosu sonradan eklenecek.</div>
          </div>

          {/* Önizleme */}
          {importPreview && (
            <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
              <label className={labelStyle}>
                <Sparkles className="h-3 w-3" /> Önizleme
              </label>
              <div className="mt-2 border border-[#ead8df]/[0.70] bg-white/[0.82]">
                {importPreview.map((res, sheetIdx) => (
                  <div key={`${res.sheetName}-${sheetIdx}`} className="border-b border-[#ead8df]/[0.70] last:border-b-0">
                    <div className="flex items-center justify-between px-3 py-2 text-[10px] font-mono uppercase tracking-widest text-[#c85776]/[0.60]">
                      <span>📄 {res.sheetName}</span>
                      <span>{res.rows.length} satır</span>
                    </div>
                    <div className="grid grid-cols-3 gap-px bg-[#fff4f8]/[0.10] text-[10px] sm:grid-cols-4">
                      {res.headers.slice(0, 8).map((h, headerIdx) => (
                        <div key={`${headerIdx}-${h}`} className="bg-white px-2 py-1.5 font-mono text-[#352432]/[0.70]">
                          {h}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {importError && (
            <div className="border border-rose-300/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-700">{importError}</div>
          )}
        </div>
      </ModalShell>

      {/* EXPORT MODAL */}
      <ModalShell
        open={exportOpen}
        onOpenChange={(next) => {
          setExportOpen(next)
          // Açılışta taze doğrula — plan düşürüldüyse buton/komponent anında kaybolur.
          if (next && featureKey) void featureCtx.revalidate()
        }}
        eyebrow="Excel · Export"
        title={hasDatasets ? 'Excel’e dışarı aktar' : `${moduleName} dışarı aktar`}
        description="Marka renklerinde Excel raporu indir. İndirilen dosya yazıcıya hazır, kolonları otomatik genişler, başlık çubuğu sabit kalır."
        icon={Download}
        trigger={
          <button type="button" className={`${goldBtn} ${triggerClassName}`}>
            <Download className="h-3.5 w-3.5" strokeWidth={1.6} />
            <span>Excel&apos;e dışarı aktar</span>
            <FileSpreadsheet className="h-3 w-3 opacity-65" strokeWidth={1.6} />
          </button>
        }
        footer={
          <div className="flex items-center justify-between gap-3">
            <div className="text-[10px] font-mono uppercase tracking-widest text-[#352432]/[0.40]">
              {hasDatasets && <span className="text-[#c85776]/[0.70]">{activeSource.label} · </span>}
              {activeSource.rows.length} satır · {selectedKeys.length}/{activeSource.columns.length} kolon
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setExportOpen(false)}
                disabled={exportBusy}
                className="rounded-full border border-[#ead8df]/[0.80] bg-white/[0.72] px-4 py-2 text-[10px] font-mono uppercase tracking-widest text-[#352432]/[0.65] transition-colors hover:border-[#efbfd0]/[0.75] hover:text-[#352432] disabled:opacity-50"
              >
                Vazgeç
              </button>
              <motion.button
                type="button"
                onClick={handleExport}
                disabled={exportBusy || exportDone}
                whileTap={{ scale: 0.96 }}
                className="inline-flex items-center gap-2 rounded-full border border-[#efbfd0]/[0.80] bg-gradient-to-r from-[#fff7fa] via-[#ffdbe7] to-[#f4a9c4] px-5 py-2 text-[10px] font-mono uppercase tracking-widest text-[#2f1724] disabled:opacity-70"
              >
                {exportBusy && <Loader2 className="h-3 w-3 animate-spin" />}
                {exportDone && <CheckCircle2 className="h-3 w-3" />}
                {!exportBusy && !exportDone && <Download className="h-3 w-3" />}
                {exportDone ? 'İndirildi' : exportBusy ? 'Hazırlanıyor…' : 'Excel\'i indir'}
              </motion.button>
            </div>
          </div>
        }
      >
        <div className="grid gap-5 sm:grid-cols-2">
          {/* Veri seti seçici — yalnızca birden fazla veri seti verildiğinde */}
          {hasDatasets && (
            <div className="sm:col-span-2">
              <label className={labelStyle}>
                <Boxes className="h-3 w-3" /> Ne aktarılsın?
              </label>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {exportDatasets!.map((ds) => {
                  const active = ds.key === activeDatasetKey
                  return (
                    <button
                      key={ds.key}
                      type="button"
                      onClick={() => setActiveDatasetKey(ds.key)}
                      className={`group flex items-center justify-between gap-2 border px-3 py-2.5 text-left transition-colors ${
                        active
                          ? 'border-[#efbfd0]/[0.75] bg-[#f0aac2]/[0.10] text-[#352432]'
                          : 'border-[#ead8df]/[0.70] bg-white/[0.72] text-[#352432]/[0.60] hover:border-[#efbfd0]/[0.75]'
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[12px] font-medium">{ds.label}</span>
                        <span className="block text-[9px] font-mono uppercase tracking-widest text-[#352432]/[0.40]">
                          {ds.rows.length} satır · {ds.columns.length} kolon
                        </span>
                      </span>
                      {active && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#c85776]" />}
                    </button>
                  )
                })}
              </div>
              <div className={helperStyle}>Seçtiğin veri seti, aşağıdaki kolonlarla ve dosya adıyla indirilir.</div>
            </div>
          )}

          {/* Dosya adı */}
          <div className="sm:col-span-2">
            <label className={labelStyle}>
              <Tag className="h-3 w-3" /> Dosya adı
            </label>
            <input
              type="text"
              className={`mt-2 ${fieldStyle}`}
              value={exportFilename}
              onChange={(e) => setExportFilename(e.target.value)}
              placeholder={defaultFilename(activeSource.label)}
            />
            <div className={helperStyle}>Yazdığın ad birebir kullanılır; sonuna .xlsx otomatik eklenir.</div>
          </div>

          {/* Scope */}
          <div>
            <label className={labelStyle}>
              <Filter className="h-3 w-3" /> Veri kapsamı
            </label>
            <select className={`mt-2 ${fieldStyle}`} value={scopeFilter} onChange={(e) => setScopeFilter(e.target.value as 'all' | 'filtered')}>
              <option value="filtered">Şu anki filtreli liste ({activeSource.rows.length} satır)</option>
              <option value="all">Tüm liste (filtre yok sayılır)</option>
            </select>
            <div className={helperStyle}>Şu an iki seçenek de aynı veriyi gönderir; filtre handler\&apos;ı sayfaya göre değişebilir.</div>
          </div>

          {/* Totals + Extras */}
          <div>
            <label className={labelStyle}>
              <Hash className="h-3 w-3" /> Ekstra satır/sayfa
            </label>
            <div className="mt-2 space-y-2">
              <label className="flex cursor-pointer items-center gap-2 border border-[#ead8df]/[0.70] bg-white/[0.82] px-3 py-2 text-[11px] text-[#352432]/[0.75] transition-colors hover:border-[#efbfd0]/[0.75]">
                <input type="checkbox" checked={includeTotals} onChange={(e) => setIncludeTotals(e.target.checked)} className="h-3.5 w-3.5" />
                Toplam satırı ekle
              </label>
              {!hasDatasets && extraSheets && extraSheets.length > 0 && (
                <label className="flex cursor-pointer items-center gap-2 border border-[#ead8df]/[0.70] bg-white/[0.82] px-3 py-2 text-[11px] text-[#352432]/[0.75] transition-colors hover:border-[#efbfd0]/[0.75]">
                  <input type="checkbox" checked={includeExtras} onChange={(e) => setIncludeExtras(e.target.checked)} className="h-3.5 w-3.5" />
                  Ek sayfaları ekle ({extraSheets.length})
                </label>
              )}
            </div>
          </div>

          {/* Kolon seçimi */}
          <div className="sm:col-span-2">
            <div className="flex items-center justify-between">
              <label className={labelStyle}>
                <Layers className="h-3 w-3" /> Kolonlar
              </label>
              <div className="flex gap-1.5 text-[9px] font-mono uppercase tracking-widest">
                <button type="button" onClick={() => setSelectedKeys(activeSource.columns.map((c) => c.key))} className="border border-[#ead8df]/[0.70] px-2 py-0.5 text-[#352432]/[0.65] hover:border-[#efbfd0]/[0.75] hover:text-[#352432]">
                  Tümü
                </button>
                <button type="button" onClick={() => setSelectedKeys([])} className="border border-[#ead8df]/[0.70] px-2 py-0.5 text-[#352432]/[0.65] hover:border-[#efbfd0]/[0.75] hover:text-[#352432]">
                  Hiçbiri
                </button>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {activeSource.columns.map((col) => {
                const active = selectedKeys.includes(col.key)
                return (
                  <button
                    key={col.key}
                    type="button"
                    onClick={() => toggleColumn(col.key)}
                    className={`border px-2 py-1.5 text-left text-[11px] transition-colors ${
                      active
                        ? 'border-[#efbfd0]/[0.75] bg-[#f0aac2]/[0.08] text-[#352432]'
                        : 'border-[#ead8df]/[0.70] bg-white/[0.72] text-[#352432]/[0.55] hover:border-[#efbfd0]/[0.75]'
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      {active && <CheckCircle2 className="h-2.5 w-2.5 text-[#c85776]" />}
                      <span className="truncate">{col.header}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Preview */}
          <div className="sm:col-span-2 border border-[#ead8df]/[0.70] bg-white/[0.35] p-3">
            <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-[#c85776]/[0.65]">
              <FileText className="h-3 w-3" /> Çıktı önizleme
            </div>
            <div className="mt-2 text-[11px] text-[#352432]/[0.65]">
              <strong className="text-[#c85776]">✦ ARMONESSA — {activeSource.label.toUpperCase()}</strong>
              <div className="mt-1 text-[10px] text-[#352432]/[0.40]">
                {context || 'Kurum · Şube · Dönem'} · {selectedKeys.length} kolon · {activeSource.rows.length} satır
                {includeTotals && ' · Toplam satırı'}
                {!hasDatasets && includeExtras && extraSheets?.length ? ` · ${extraSheets.length} ek sayfa` : ''}
              </div>
              <div className="mt-1.5 text-[10px] font-mono text-[#c85776]/[0.55]">
                📄 {(exportFilename.trim() || defaultFilename(activeSource.label)).replace(/\.xlsx$/i, '')}.xlsx
              </div>
            </div>
          </div>

          {exportError && (
            <div className="sm:col-span-2 border border-rose-300/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-700">
              {exportError}
            </div>
          )}
        </div>
      </ModalShell>

      <AnimatePresence>
        {exportDone && (
          <motion.div
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            className="inline-flex items-center gap-1 border border-emerald-300/30 bg-emerald-400/10 px-2 py-1 text-[10px] font-mono text-emerald-700"
          >
            <CheckCircle2 className="h-3 w-3" /> İndirildi
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
