'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowDownLeft, ArrowUpRight, Barcode as BarcodeIcon, Boxes, Cake, FileText, Hash,
  Loader2, MapPin, Package, Repeat, Ruler, Tag, X,
} from 'lucide-react'
import {
  CatalogModal, Fact, ModalSection, ModalTabs,
  catalogFieldCls, catalogGhostBtn, catalogPrimaryBtn,
} from '@/components/dashboard/CatalogKit'
import { adminApi } from '@/lib/apiClient'
import { formatTL, normalizeStockMovement } from '@/lib/apiMappers'
import { useApiQuery } from '@/hooks/useApiQuery'
import type { ApiStockMovement, Product, ProductStatusKey } from '@/lib/types'

/**
 * Ürün detay modali — hizmet ve paket kartlarındaki modalin ürün karşılığı.
 *
 * NEDEN MODAL: ürün künyesi sayfanın sağındaki sabit panelde duruyordu. Panel listeyle yeri
 * paylaştığı için tablo daralıyor, künye de dar sütunda alt alta sıkışıyordu; üstelik "seçili
 * ürün" kavramı listeyle panel arasında sessizce kayıyordu (süzgeç değişince başka bir ürünün
 * künyesi açık kalıyordu). Artık satıra tıklanınca kayıt tam genişlikte açılır.
 *
 * DURUM ETİKETİ KATALOĞUNKİ DEĞİLDİR: ürünün durumu stok seviyesinden türer
 * (yeterli / kritik / tükendi); Aktif-Pasif-Taslak-Arşiv ölçeğine bağlanmaz. Bu yüzden
 * `StatusPill` yerine buradaki yerel rozet kullanılır.
 *
 * SATIŞ SEKMESİ YOKTUR: satış paneli kataloğu `serviceDefinitionId` / `servicePackageId` ile
 * süzer, ürün kimliğiyle süzen bir uç yok. Uydurma bir sekme açmak yerine ürünün gerçek
 * hareket defteri (giriş / çıkış / satış / fire) gösterilir.
 */

const STATUS_LABEL: Record<ProductStatusKey, string> = {
  sufficient: 'Stok yeterli',
  critical: 'Kritik stok',
  out: 'Tükendi',
}
const STATUS_TONE: Record<ProductStatusKey, string> = {
  sufficient: 'border-[#8ED6B4] bg-[#DFF3EA] text-[#15694A]',
  critical: 'border-[#EFC98B] bg-[#FDF3E2] text-[#8A5A11]',
  out: 'border-[#F0AFBF] bg-[#FCE7EC] text-[#A32347]',
}
const STATUS_BAR: Record<ProductStatusKey, string> = {
  sufficient: 'bg-[linear-gradient(90deg,#7fc7ad,#2c7d63)]',
  critical: 'bg-[linear-gradient(90deg,#f0c179,#c98b21)]',
  out: 'bg-[linear-gradient(90deg,#e78ba8,#c05277)]',
}

const MOVE_LABEL: Record<string, string> = {
  Inbound: 'Stok Girişi', Outbound: 'Stok Çıkışı', Sale: 'Satış', Adjustment: 'Sayım', Damage: 'Fire',
}
const MOVE_TONE: Record<string, string> = {
  Inbound: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  Outbound: 'border-rose-200 bg-rose-50 text-rose-700',
  Sale: 'border-violet-200 bg-violet-50 text-violet-700',
  Adjustment: 'border-amber-200 bg-amber-50 text-amber-700',
  Damage: 'border-rose-200 bg-rose-50 text-rose-700',
}

/** Stok hareketi taslağı — durum ProductLibrary'de, form burada çizilir. */
export interface MoveDraft {
  type: 'Inbound' | 'Outbound'
  qty: number
  unitCost: number
  notes: string
  date: string
}

type TabKey = 'ozet' | 'hareket'

function StatusPill({ status }: { status: ProductStatusKey }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[10px] font-semibold leading-none ${STATUS_TONE[status]}`}>
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      {STATUS_LABEL[status]}
    </span>
  )
}

/** Künye satırı — etiket solda, değer sağda. */
function Line({ icon: Icon, label, value }: { icon: typeof Tag; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[#f4ebee] py-2 last:border-b-0">
      <span className="flex items-center gap-1.5 text-[11.5px] text-[#705a66]">
        <Icon aria-hidden className="h-3.5 w-3.5 shrink-0 text-[#A5556E]" /> {label}
      </span>
      <span className="min-w-0 truncate text-right text-[12.5px] font-medium text-[#2A2027]">{value}</span>
    </div>
  )
}

function Th({ children, align = 'left' }: { children: ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      scope="col"
      className={`whitespace-nowrap border-b border-[#EAD8DF] bg-[#F7F6F6] px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#74616A] ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  )
}

function Td({ children, align = 'left' }: { children: ReactNode; align?: 'left' | 'right' }) {
  return (
    <td className={`border-b border-[#f4ebee] px-2.5 py-2 align-middle text-[11.5px] ${align === 'right' ? 'text-right' : 'text-left'}`}>
      {children}
    </td>
  )
}

export default function ProductDetailModal({
  open,
  onOpenChange,
  product,
  tenantId,
  movementsKey = 0,
  canDelete,
  isStaff,
  error,
  moveDraft,
  moveBusy,
  onMoveDraftChange,
  onSubmitMove,
  today,
  renderEditTrigger,
  renderDeleteTrigger,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  product: Product | null
  tenantId?: string
  /**
   * Yeni hareket kaydedilince artar — liste tazelenir.
   *
   * HAREKETLER BU ÜRÜN İÇİN AYRI ÇEKİLİR. Sayfanın genel listesi `limit: 300` ile TÜM ürünlerin
   * son hareketlerini getirir; oradan süzmek, hareketleri o pencerenin dışında kalan üründe
   * "hareket kaydı yok" YALANINI yazdırıyordu. Uç `productId` süzgecini destekliyor.
   */
  movementsKey?: number
  canDelete: boolean
  isStaff: boolean
  error?: string
  /** Dolu ise stok giriş/çıkış formu açıktır. */
  moveDraft: MoveDraft | null
  moveBusy: boolean
  onMoveDraftChange: (next: MoveDraft | null) => void
  onSubmitMove: () => void
  /** Bugünün yerel tarihi (`YYYY-MM-DD`) — ileri tarihli hareket engellenir. */
  today: string
  renderEditTrigger: () => ReactNode
  renderDeleteTrigger: () => ReactNode
}) {
  const [tab, setTab] = useState<TabKey>('ozet')
  const productId = product?.id

  // Modal her açılışta künyeden başlar; hareket formu da kapanır (bir önceki üründen kalmasın).
  useEffect(() => {
    if (open) setTab('ozet')
  }, [open, productId])

  /**
   * Bu ürünün HAREKET DEFTERİ — sunucuda `productId` ile süzülür.
   * Hata YUTULMAZ: boş liste "hareket yok" demektir, oysa gerçek "okunamadı" olabilir; ikisi
   * ekranda ayrı yazılır (bkz. `movementsError`).
   */
  const { data: rawMovements, error: movementsError, loading: movementsLoading } = useApiQuery<ApiStockMovement[]>(
    async () => {
      if (!open || !productId) return []
      const res = await adminApi.stockMovements<ApiStockMovement>({ ...(tenantId ? { tenantId } : {}), productId, limit: 200 })
      return Array.isArray(res) ? res : []
    },
    [open, productId, tenantId, movementsKey],
    { initialData: [] },
  )
  const movements = useMemo(() => (rawMovements || []).map((m, i) => normalizeStockMovement(m, i)), [rawMovements])

  if (!product) return null

  // Stok doluluk çubuğu: asgari seviye REFERANS noktasıdır, tavan değil — asgarinin iki katı
  // "dolu" sayılır ki kritik eşiği çubuğun ortasında dursun ve göz eşiği bulabilsin.
  const scale = Math.max(product.minStockLevel * 2, product.currentStock, 1)
  const fillPct = Math.min(100, Math.round((product.currentStock / scale) * 100))
  const minPct = Math.min(100, Math.round((product.minStockLevel / scale) * 100))

  return (
    <CatalogModal
      open={open}
      onOpenChange={onOpenChange}
      icon={Package}
      eyebrow="Ürün detayı"
      title={product.name}
      subtitle={`${product.categoryLabel} · ${product.currentStock} ${product.unit} · ${formatTL(product.salePrice)}`}
      badge={<StatusPill status={product.status} />}
      width={1080}
      height={880}
      tabs={
        <ModalTabs
          idPrefix="product-detail"
          value={tab}
          onChange={setTab}
          options={[
            { key: 'ozet', label: 'Künye', icon: FileText },
            { key: 'hareket', label: 'Stok Hareketleri', icon: Repeat, count: movements.length },
          ]}
        />
      }
      footer={
        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="rounded-[11px] border border-[#F0AFBF] bg-[#FCE7EC] px-3 py-2 text-[12px] font-medium text-[#A32347]"
              >
                {error}
              </motion.div>
            )}
          </AnimatePresence>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onMoveDraftChange({ type: 'Inbound', qty: 1, unitCost: product.cost, notes: '', date: today })}
                className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-[11px] border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-[12px] font-semibold text-emerald-700 transition-all hover:-translate-y-0.5 hover:bg-emerald-100"
              >
                <ArrowDownLeft className="h-3.5 w-3.5" /> Stok Girişi
              </button>
              <button
                type="button"
                onClick={() => onMoveDraftChange({ type: 'Outbound', qty: 1, unitCost: 0, notes: '', date: today })}
                className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-[11px] border border-sky-200 bg-sky-50 px-3.5 py-2 text-[12px] font-semibold text-sky-700 transition-all hover:-translate-y-0.5 hover:bg-sky-100"
              >
                <ArrowUpRight className="h-3.5 w-3.5" /> Stok Çıkışı
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canDelete && renderDeleteTrigger()}
              {renderEditTrigger()}
            </div>
          </div>
        </div>
      }
    >
      {/* STOK HAREKET FORMU — hangi sekmede olursa olsun en üstte açılır. */}
      <AnimatePresence initial={false}>
        {moveDraft && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="m-4 mb-0 rounded-[18px] border border-[#BE7690] bg-white p-4 shadow-[0_18px_44px_-34px_rgba(150,78,104,0.6)] sm:mx-5">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={`grid h-8 w-8 place-items-center rounded-[11px] ${moveDraft.type === 'Inbound' ? 'bg-emerald-50 text-emerald-700' : 'bg-sky-50 text-sky-700'}`}>
                    {moveDraft.type === 'Inbound' ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                  </span>
                  <span className="text-[13px] font-semibold text-[#2A2027]">{MOVE_LABEL[moveDraft.type]} · {product.name}</span>
                </div>
                <button
                  type="button"
                  onClick={() => onMoveDraftChange(null)}
                  aria-label="Formu kapat"
                  className="grid h-8 w-8 place-items-center rounded-full text-[#74616A] transition-colors hover:bg-[#F7F6F6] hover:text-[#A5556E]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-[#74616A]">
                  Miktar
                  <input
                    type="number"
                    min={1}
                    value={moveDraft.qty}
                    onChange={(e) => onMoveDraftChange({ ...moveDraft, qty: Number(e.target.value) })}
                    className={`mt-1 w-full ${catalogFieldCls}`}
                  />
                </label>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-[#74616A]">
                  Birim maliyet (₺)
                  <input
                    type="number"
                    min={0}
                    value={moveDraft.unitCost || ''}
                    onChange={(e) => onMoveDraftChange({ ...moveDraft, unitCost: Number(e.target.value) })}
                    className={`mt-1 w-full ${catalogFieldCls}`}
                  />
                </label>
                {/* HAREKET TARİHİ: mal dün girdiyse stok raporu o güne yazsın. İleri tarih yok. */}
                <label className="text-[10px] font-semibold uppercase tracking-wider text-[#74616A]">
                  Hareket tarihi
                  <input
                    type="date"
                    value={moveDraft.date}
                    max={today}
                    onChange={(e) => onMoveDraftChange({ ...moveDraft, date: e.target.value })}
                    className={`mt-1 w-full ${catalogFieldCls}`}
                  />
                </label>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-[#74616A]">
                  Not
                  <input
                    value={moveDraft.notes}
                    onChange={(e) => onMoveDraftChange({ ...moveDraft, notes: e.target.value })}
                    placeholder="İsteğe bağlı"
                    className={`mt-1 w-full ${catalogFieldCls}`}
                  />
                </label>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                <button type="button" onClick={() => onMoveDraftChange(null)} className={catalogGhostBtn}>Vazgeç</button>
                <button type="button" disabled={moveBusy} onClick={onSubmitMove} className={catalogPrimaryBtn}>
                  {moveBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Repeat className="h-3.5 w-3.5" />}
                  {isStaff ? 'Onaya gönder' : 'Hareketi kaydet'}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {tab === 'ozet' ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className="space-y-3 p-4 sm:p-5"
        >
          <div className="flex items-center gap-3 rounded-[18px] border border-[#EAD8DF] bg-white p-4">
            {product.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={product.imageUrl} alt="" className="h-16 w-16 shrink-0 rounded-[18px] border border-[#EAD8DF] object-cover" />
            ) : (
              <span className="grid h-16 w-16 shrink-0 place-items-center rounded-[18px] bg-[#A5556E] text-white">
                <Package className="h-8 w-8" strokeWidth={1.8} />
              </span>
            )}
            <div className="min-w-0">
              <div className="truncate font-display text-[22px] font-bold leading-tight tracking-tight text-[#2A2027]">{product.name}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] font-medium text-[#705a66]">
                <span>{product.categoryLabel}</span>
                <span className="text-[#c9b3bd]">·</span>
                <span className="inline-flex items-center gap-1"><BarcodeIcon className="h-3.5 w-3.5" /> {product.barcode || 'barkodsuz'}</span>
                {!product.isActive && (
                  <span className="rounded-full border border-[#CBC1C6] bg-[#F7F6F6] px-2 py-0.5 text-[10px] font-semibold text-[#4a3a44]">Pasif</span>
                )}
              </div>
            </div>
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            <Fact
              label="Mevcut stok"
              value={`${product.currentStock} ${product.unit}`}
              tone={product.status === 'out' ? 'text-[#A32347]' : product.status === 'critical' ? 'text-[#8A5A11]' : 'text-[#15694A]'}
            />
            <Fact label="Asgari stok" value={`${product.minStockLevel} ${product.unit}`} />
            <Fact label="Maliyet" value={formatTL(product.cost)} />
            <Fact label="Satış fiyatı" value={formatTL(product.salePrice)} />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <ModalSection
              title="Stok seviyesi"
              hint="Çubuktaki çizgi asgari stok eşiğidir; altına inince ürün kritik sayılır."
            >
              <div className="relative h-3 overflow-hidden rounded-full bg-[#f4e7ec]">
                <motion.span
                  className={`block h-full rounded-full ${STATUS_BAR[product.status]}`}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.max(2, fillPct)}%` }}
                  transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                />
                {product.minStockLevel > 0 && (
                  <span
                    aria-hidden
                    title={`Asgari stok: ${product.minStockLevel} ${product.unit}`}
                    className="absolute inset-y-0 w-[2px] bg-[#2A2027]/55"
                    style={{ left: `${minPct}%` }}
                  />
                )}
              </div>
              <div className="mt-2.5 grid grid-cols-2 gap-2.5">
                <div className="rounded-[13px] border border-[#EAD8DF] bg-[#F7F6F6] px-3 py-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-[#74616A]">Stok değeri (maliyet)</div>
                  <div className="mt-0.5 truncate text-[15px] font-semibold tabular-nums text-[#2A2027]">{formatTL(product.stockValueCost)}</div>
                </div>
                <div className="rounded-[13px] border border-[#EAD8DF] bg-[#F7F6F6] px-3 py-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-[#74616A]">Perakende değeri</div>
                  <div className="mt-0.5 truncate text-[15px] font-semibold tabular-nums text-[#2A2027]">{formatTL(product.stockValueSale)}</div>
                </div>
              </div>
              {/* Kâr marjı ÖLÇÜLÜ aritmetiktir: (satış − maliyet) / satış. Tahmin değil. */}
              <div className="mt-2.5 flex items-center justify-between gap-3 rounded-[13px] border border-[#EAD8DF] bg-white px-3 py-2">
                <span className="text-[11.5px] text-[#705a66]">Birim kâr / marj</span>
                <span className="text-[12.5px] font-semibold tabular-nums text-[#15694A]">
                  {product.salePrice > 0 ? `${formatTL(product.margin)} · %${String(product.marginPct).replace('.', ',')}` : '—'}
                </span>
              </div>
            </ModalSection>

            <ModalSection title="Ürün künyesi" hint="Kaydın kendi alanları — hesaplanan bir şey yok.">
              <div className="rounded-[13px] border border-[#EAD8DF] bg-[#F7F6F6] px-3 py-1">
                <Line icon={Tag} label="Marka" value={product.brand || '—'} />
                <Line icon={MapPin} label="Raf / dolap" value={product.location || '—'} />
                <Line icon={Ruler} label="Birim" value={product.unit || '—'} />
                <Line icon={Hash} label="Lot numarası" value={product.lotNumber || '—'} />
                <Line
                  icon={Cake}
                  label="Son kullanma"
                  value={product.expiryDate ? product.expiryDate.split('-').reverse().join('.') : '—'}
                />
                <Line icon={Boxes} label="Son güncelleme" value={product.updatedAt || '—'} />
              </div>
            </ModalSection>
          </div>
        </motion.div>
      ) : (
        <div className="p-4 sm:p-5">
          <ModalSection
            title="Stok hareketleri"
            hint="Bu ürünün giriş, çıkış, satış ve fire kayıtları — en yeniden eskiye."
            action={
              <span className="rounded-full border border-[#EAD8DF] bg-[#F7F6F6] px-2.5 py-0.5 text-[11px] font-semibold tabular-nums text-[#5A4B53]">
                {movements.length}
              </span>
            }
          >
            {movementsError ? (
              // "Okunamadı" ile "yok" AYNI ŞEY DEĞİL: sessiz boş liste, hareketi olan bir ürün
              // için gerçek dışı bir cümle yazıyordu.
              <p className="rounded-[11px] border border-[#F0AFBF] bg-[#FCE7EC] px-3 py-3 text-center text-[11.5px] font-medium text-[#A32347]">
                Hareket listesi okunamadı — bu ürünün geçmişi eksik görünüyor olabilir.
              </p>
            ) : movementsLoading && movements.length === 0 ? (
              <p className="rounded-[11px] border border-dashed border-[#EAD8DF] bg-[#F7F6F6] px-3 py-5 text-center text-[11.5px] text-[#705a66]">
                Hareketler yükleniyor…
              </p>
            ) : movements.length === 0 ? (
              <p className="rounded-[11px] border border-dashed border-[#EAD8DF] bg-[#F7F6F6] px-3 py-5 text-center text-[11.5px] text-[#705a66]">
                Bu ürün için hareket kaydı yok.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] border-separate border-spacing-0 text-left">
                  <thead>
                    <tr>
                      <Th>Tarih</Th>
                      <Th>İşlem</Th>
                      <Th align="right">Miktar</Th>
                      <Th align="right">Birim maliyet</Th>
                      <Th>Kullanıcı</Th>
                      <Th>Not</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.map((m, i) => {
                      const inbound = m.type === 'Inbound' || m.type === 'Adjustment'
                      return (
                        <motion.tr
                          key={m.id}
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1], delay: Math.min(i * 0.024, 0.2) }}
                          className="bg-white"
                        >
                          <Td>
                            <span className="whitespace-nowrap tabular-nums text-[#3E343A]">
                              {m.date.split('-').reverse().join('.')} <span className="text-[#74616A]">{m.time}</span>
                            </span>
                          </Td>
                          <Td>
                            <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold ${MOVE_TONE[m.type] || 'border-[#EAD8DF] bg-[#F7F6F6] text-[#5A4B53]'}`}>
                              {MOVE_LABEL[m.type] || m.type}
                            </span>
                          </Td>
                          <Td align="right">
                            <span className={`font-semibold tabular-nums ${inbound ? 'text-[#15694A]' : 'text-[#A32347]'}`}>
                              {inbound ? '+' : '−'}{m.quantity}
                            </span>
                          </Td>
                          <Td align="right"><span className="tabular-nums text-[#3E343A]">{m.unitCost > 0 ? formatTL(m.unitCost) : '—'}</span></Td>
                          <Td><span className="block max-w-[160px] truncate text-[#5A4B53]">{m.staffName || '—'}</span></Td>
                          <Td><span className="block max-w-[220px] truncate text-[#5A4B53]" title={m.notes || undefined}>{m.notes || '—'}</span></Td>
                        </motion.tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </ModalSection>
        </div>
      )}
    </CatalogModal>
  )
}
