import ExcelJS from 'exceljs'
import { saveAs } from 'file-saver'

// ---------------------------------------------------------------------------
// Tip tanımları
// ---------------------------------------------------------------------------

export type ExcelCellValue = string | number | boolean | Date | null | undefined

export type ExcelColumnType = 'text' | 'number' | 'currency' | 'date' | 'datetime' | 'percent' | 'boolean'

export interface ExcelColumn<T> {
  key: string
  header: string
  width?: number
  type?: ExcelColumnType
  accessor: (row: T) => ExcelCellValue
}

export interface ExcelSheetSpec<T> {
  name: string
  subtitle?: string
  rows: T[]
  columns: ExcelColumn<T>[]
  /** Toplam satır eklemek için */
  totals?: Partial<Record<string, ExcelCellValue>>
  /** Üstteki özet kartları; verilmezse "Toplam Kayıt" kartı otomatik eklenir. */
  cards?: { label: string; value: number | string }[]
}

export interface ExportOptions {
  /** Dosya kök ad (dönem otomatik eklenir): "Musteriler" → "BeautyAsist-Musteriler-2026-05-31.xlsx" */
  filenameBase: string
  /** Sayfa başlığı / kapak için */
  title: string
  /** Alt başlık (kurum + tarih) */
  context?: string
  /**
   * Verilirse dosya adı bu değerle birebir indirilir; "BeautyAsist-" öneki ve tarih eklenmez.
   * Geçersiz dosya karakterleri temizlenir, sonuna .xlsx eklenir.
   */
  exactFilename?: string
}

/** Dosya adından OS için geçersiz karakterleri temizler. */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ---------------------------------------------------------------------------
// Brand renkleri (BeautyAsist)
// ---------------------------------------------------------------------------

const BRAND = {
  burgundy: 'FF2F1724',
  burgundyDark: 'FF160B12',
  roseGold: 'FFD48AA7',
  rose: 'FFF0AAC2',
  cream: 'FFFFF4F8',
  creamSoft: 'FFFFEDF3',
  gold: 'FFE8C896',
  ink: 'FF2F1724',
  inkSoft: 'FF555555',
  emerald: 'FF065F46',
  rosePink: 'FFB91C5C',
} as const

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

function todayIso(): string {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function trDate(value: Date | string | null | undefined): string {
  if (!value) return ''
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d)
}

function trDateTime(value: Date | string | null | undefined): string {
  if (!value) return ''
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}

function applyTypeFormat(cell: ExcelJS.Cell, type: ExcelColumnType | undefined, value: ExcelCellValue): void {
  switch (type) {
    case 'currency':
      cell.value = typeof value === 'number' ? value : Number(value || 0)
      cell.numFmt = '"₺ "#,##0.00;[Red]"₺ -"#,##0.00'
      cell.alignment = { vertical: 'middle', horizontal: 'right' }
      break
    case 'number':
      cell.value = typeof value === 'number' ? value : Number(value || 0)
      cell.numFmt = '#,##0'
      cell.alignment = { vertical: 'middle', horizontal: 'right' }
      break
    case 'percent':
      cell.value = typeof value === 'number' ? value / 100 : Number(value || 0) / 100
      cell.numFmt = '%0.0'
      cell.alignment = { vertical: 'middle', horizontal: 'right' }
      break
    case 'date':
      cell.value = value ? trDate(value as Date | string) : ''
      cell.alignment = { vertical: 'middle', horizontal: 'center' }
      break
    case 'datetime':
      cell.value = value ? trDateTime(value as Date | string) : ''
      cell.alignment = { vertical: 'middle', horizontal: 'center' }
      break
    case 'boolean':
      cell.value = value === true || value === 'true' || value === 1 ? 'Evet' : 'Hayır'
      cell.alignment = { vertical: 'middle', horizontal: 'center' }
      break
    default:
      cell.value = (value ?? '') as string
      cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: false }
  }
}

// ---------------------------------------------------------------------------
// EXPORT
// ---------------------------------------------------------------------------

export async function exportToExcel<T>(sheets: ExcelSheetSpec<T>[], options: ExportOptions): Promise<void> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'BeautyAsist Güzellik Merkezi Yönetimi'
  wb.created = new Date()
  wb.modified = new Date()
  wb.lastModifiedBy = 'BeautyAsist Panel'
  wb.title = options.title
  wb.subject = options.context || ''
  wb.company = 'BeautyAsist'

  const logo = await fetchLogoBuffer()
  const white = 'FFFFFFFF'
  const zebraSoft = 'FFFDF6F9'
  const headerText = 'FF9D2449'

  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.name.slice(0, 31), {
      properties: { defaultRowHeight: 18, tabColor: { argb: BRAND.roseGold } },
      pageSetup: {
        paperSize: 9, // A4
        orientation: 'landscape',
        margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
        printTitlesRow: '6:6',
      },
      views: [{ state: 'frozen', ySplit: 6, showGridLines: false }],
    })

    // --- ÜST BÖLÜM (1-5. satır) ---
    // Not: Başlık/tarih/kart hücreleri bilerek richText — importFromExcel'in header
    // tespiti bu satırları otomatik atlar (string'e çevrilince hepsi aynı görünür).
    const totalCols = sheet.columns.length
    const lastColLetter = colLetter(Math.max(1, totalCols))

    // 1. satır: logo + marka + başlık
    ws.getRow(1).height = 42
    ws.mergeCells(`A1:${lastColLetter}1`)
    const brandCell = ws.getCell('A1')
    brandCell.value = {
      richText: [
        { text: '        BeautyAsist', font: { name: 'Calibri', size: 18, bold: true, color: { argb: LOG_INK } } },
        { text: `      ${options.title}`, font: { name: 'Calibri', size: 14, bold: true, color: { argb: LOG_INK } } },
      ],
    }
    brandCell.alignment = { vertical: 'middle', horizontal: 'left' }
    brandCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: white } }
    if (logo) {
      const imgId = wb.addImage({ buffer: logo, extension: 'png' })
      ws.addImage(imgId, { tl: { col: 0.15, row: 0.12 }, ext: { width: 40, height: 40 } })
    }

    // 2. satır: dışa aktarım tarihi + bağlam
    ws.getRow(2).height = 20
    ws.mergeCells(`A2:${lastColLetter}2`)
    const dateCell = ws.getCell('A2')
    const exportedAt = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date())
    dateCell.value = {
      richText: [
        { text: '  Dışa Aktarım Tarihi: ', font: { name: 'Calibri', size: 10, color: { argb: BRAND.inkSoft } } },
        { text: exportedAt, font: { name: 'Calibri', size: 10, bold: true, color: { argb: LOG_PINK_TEXT } } },
        ...(options.context ? [{ text: `     ·     ${options.context}`, font: { name: 'Calibri', size: 10, color: { argb: BRAND.inkSoft } } }] : []),
        ...(sheet.subtitle ? [{ text: `     ·     ${sheet.subtitle}`, font: { name: 'Calibri', size: 10, color: { argb: BRAND.inkSoft } } }] : []),
      ],
    }
    dateCell.alignment = { vertical: 'middle', horizontal: 'left' }
    dateCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: white } }

    ws.getRow(3).height = 6

    // 4. satır: özet kartları
    const cardPalette = [
      { color: LOG_PINK_TEXT, fill: 'FFFDF1F5' },
      { color: 'FF7C3AED', fill: 'FFF6F0FE' },
      { color: 'FFC2410C', fill: 'FFFEF3EA' },
      { color: 'FF047857', fill: 'FFEAF8F1' },
    ]
    const cards = sheet.cards?.length ? sheet.cards : [{ label: 'Toplam Kayıt', value: sheet.rows.length }]
    ws.getRow(4).height = 34
    const per = Math.max(1, Math.floor(totalCols / cards.length))
    cards.forEach((card, i) => {
      const startCol = i * per + 1
      if (startCol > totalCols) return
      const endCol = i === cards.length - 1 ? totalCols : Math.min(totalCols, startCol + per - 1)
      if (startCol !== endCol) ws.mergeCells(`${colLetter(startCol)}4:${colLetter(endCol)}4`)
      const palette = cardPalette[i % cardPalette.length]
      const cell = ws.getCell(`${colLetter(startCol)}4`)
      cell.value = {
        richText: [
          { text: `  ${card.label}   `, font: { name: 'Calibri', size: 10, color: { argb: BRAND.inkSoft } } },
          { text: String(card.value), font: { name: 'Calibri', size: 14, bold: true, color: { argb: palette.color } } },
        ],
      }
      cell.alignment = { vertical: 'middle', horizontal: 'left' }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: palette.fill } }
      cell.border = {
        top: { style: 'thin', color: { argb: LOG_LINE_SOFT } },
        bottom: { style: 'thin', color: { argb: LOG_LINE_SOFT } },
        left: { style: 'thin', color: { argb: LOG_LINE_SOFT } },
        right: { style: 'thin', color: { argb: LOG_LINE_SOFT } },
      }
    })

    ws.getRow(5).height = 6

    // --- HEADER (6. satır — açık pembe) ---
    const headerRow = ws.getRow(6)
    headerRow.height = 28
    sheet.columns.forEach((col, idx) => {
      const cell = headerRow.getCell(idx + 1)
      cell.value = col.header
      cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: headerText } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LOG_HEADER_PINK } }
      cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true }
      cell.border = {
        top: { style: 'thin', color: { argb: LOG_HEADER_BORDER } },
        bottom: { style: 'medium', color: { argb: LOG_HEADER_BORDER } },
        left: { style: 'thin', color: { argb: LOG_HEADER_BORDER } },
        right: { style: 'thin', color: { argb: LOG_HEADER_BORDER } },
      }
    })

    // --- DATA ---
    sheet.rows.forEach((row, rowIdx) => {
      const r = ws.getRow(7 + rowIdx)
      r.height = 24
      const zebra = rowIdx % 2 === 1
      sheet.columns.forEach((col, colIdx) => {
        const cell = r.getCell(colIdx + 1)
        const raw = col.accessor(row)
        applyTypeFormat(cell, col.type, raw)
        cell.font = { name: 'Calibri', size: 10.5, color: { argb: LOG_INK } }
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: zebra ? zebraSoft : white },
        }
        cell.border = {
          top: { style: 'thin', color: { argb: LOG_LINE_SOFT } },
          bottom: { style: 'thin', color: { argb: LOG_LINE_SOFT } },
          left: { style: 'thin', color: { argb: LOG_LINE_SOFT } },
          right: { style: 'thin', color: { argb: LOG_LINE_SOFT } },
        }
      })
    })

    // --- TOTAL ROW ---
    if (sheet.totals) {
      const totalRow = ws.getRow(7 + sheet.rows.length)
      totalRow.height = 26
      sheet.columns.forEach((col, idx) => {
        const cell = totalRow.getCell(idx + 1)
        const val = sheet.totals?.[col.key]
        if (val !== undefined && val !== null) {
          applyTypeFormat(cell, col.type, val)
        } else if (idx === 0) {
          cell.value = 'TOPLAM'
          cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
        }
        cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: headerText } }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LOG_HEADER_PINK } }
        cell.border = {
          top: { style: 'medium', color: { argb: LOG_HEADER_BORDER } },
          bottom: { style: 'medium', color: { argb: LOG_HEADER_BORDER } },
          left: { style: 'thin', color: { argb: LOG_HEADER_BORDER } },
          right: { style: 'thin', color: { argb: LOG_HEADER_BORDER } },
        }
      })
    }

    // --- BOŞ DURUM ---
    if (!sheet.rows.length) {
      const emptyRow = ws.getRow(7)
      emptyRow.height = 32
      ws.mergeCells(`A7:${lastColLetter}7`)
      const c = ws.getCell('A7')
      c.value = '  Bu dönemde kayıt bulunmuyor.'
      c.font = { name: 'Calibri', size: 11, italic: true, color: { argb: BRAND.inkSoft } }
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.creamSoft } }
      c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
    }

    // --- COLUMN WIDTH (auto-fit — içerik uzunluğunu ölçer) ---
    sheet.columns.forEach((col, idx) => {
      if (col.width) {
        ws.getColumn(idx + 1).width = col.width
        return
      }

      // Tip bazlı minimum (Türkçe tarih "01.06.2026", ₺ formatı geniş)
      const typeMin = ((): number => {
        switch (col.type) {
          case 'currency':
            return 18
          case 'date':
            return 14
          case 'datetime':
            return 19
          case 'number':
            return 12
          case 'percent':
            return 10
          case 'boolean':
            return 10
          default:
            return 14
        }
      })()

      // İçerikteki en uzun değeri ölç
      let maxContent = col.header.length
      sheet.rows.forEach((row) => {
        const raw = col.accessor(row)
        let text = ''
        switch (col.type) {
          case 'currency':
            text = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 2 }).format(Number(raw || 0))
            break
          case 'number':
            text = new Intl.NumberFormat('tr-TR').format(Number(raw || 0))
            break
          case 'date':
            text = raw ? trDate(raw as Date | string) : ''
            break
          case 'datetime':
            text = raw ? trDateTime(raw as Date | string) : ''
            break
          case 'percent':
            text = `%${Number(raw || 0)}`
            break
          case 'boolean':
            text = raw === true || raw === 'true' || raw === 1 ? 'Evet' : 'Hayır'
            break
          default:
            text = String(raw ?? '')
        }
        if (text.length > maxContent) maxContent = text.length
      })

      // Toplam satırı da hesaba kat
      if (sheet.totals) {
        const t = sheet.totals[col.key]
        if (t !== undefined && t !== null) {
          const tStr =
            col.type === 'currency'
              ? new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 2 }).format(Number(t))
              : String(t)
          if (tStr.length > maxContent) maxContent = tStr.length
        } else if (idx === 0 && 'TOPLAM'.length > maxContent) {
          maxContent = 'TOPLAM'.length
        }
      }

      // Cap (çok uzun açıklama hücrelerine taşmasın)
      const upperCap = 60
      const finalWidth = Math.min(upperCap, Math.max(typeMin, maxContent + 3))
      ws.getColumn(idx + 1).width = finalWidth
    })

    // --- AUTO FILTER (header satırı 6'da) ---
    if (sheet.rows.length > 0) {
      ws.autoFilter = {
        from: { row: 6, column: 1 },
        to: { row: 6, column: totalCols },
      }
    }
  }

  const buffer = await wb.xlsx.writeBuffer()
  const exact = options.exactFilename ? sanitizeFilename(options.exactFilename) : ''
  const baseName = exact || `BeautyAsist-${options.filenameBase}-${todayIso()}`
  const filename = `${baseName.replace(/\.xlsx$/i, '')}.xlsx`
  saveAs(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename)
}

// ---------------------------------------------------------------------------
// ONAY TALEPLERİ — özel tasarımlı dışa aktarım (logo + özet kartları + durum rozetleri)
// ---------------------------------------------------------------------------

export type ApprovalStatusKey = 'Pending' | 'Approved' | 'Rejected' | 'Cancelled'

export interface ApprovalExportRow {
  type: string
  customer: string
  phone: string
  staff: string
  branch: string
  createdAt: string
  status: ApprovalStatusKey
  statusLabel: string
}

interface StatusStyle {
  font: string
  fill: string
}

const APPROVAL_STATUS_STYLE: Record<ApprovalStatusKey, StatusStyle> = {
  Pending: { font: 'FFB45309', fill: 'FFFEF3C7' }, // amber
  Approved: { font: 'FF047857', fill: 'FFD1FAE5' }, // emerald
  Rejected: { font: 'FFB91C1C', fill: 'FFFEE2E2' }, // rose
  Cancelled: { font: 'FF6B7280', fill: 'FFF3F4F6' }, // gri
}

const APPROVAL_HEADERS = ['Talep Türü', 'Müşteri', 'Telefon', 'Personel', 'Şube', 'Oluşturulma', 'Durum'] as const

/** Tarayıcıdan /logo.png'yi alır; başarısızsa null (logo olmadan devam edilir). */
async function fetchLogoBuffer(): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch('/logo.png')
    if (!res.ok) return null
    return await res.arrayBuffer()
  } catch {
    return null
  }
}

export async function exportApprovalsToExcel(rows: ApprovalExportRow[], options: { context?: string } = {}): Promise<void> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'BeautyAsist Güzellik Merkezi Yönetimi'
  wb.created = new Date()
  wb.title = 'Onay Bekleyenler Dışa Aktarım'
  wb.company = 'BeautyAsist'

  const ws = wb.addWorksheet('Onay Bekleyenler', {
    properties: { defaultRowHeight: 18, tabColor: { argb: BRAND.roseGold } },
    pageSetup: {
      paperSize: 9,
      orientation: 'landscape',
      margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
      printTitlesRow: '6:6',
    },
    views: [{ state: 'frozen', ySplit: 6, showGridLines: false }],
  })

  const totalCols = APPROVAL_HEADERS.length // 7 → A..G
  const white = 'FFFFFFFF'
  const ink = 'FF1F1620'
  const pinkText = 'FFE0617F'
  const headerPink = 'FFFBE2EB'
  const lineSoft = 'FFF0E3E9'

  // --- 1. satır: logo + başlık ---
  ws.getRow(1).height = 42
  ws.mergeCells('A1:B1')
  const brandCell = ws.getCell('A1')
  brandCell.value = '        BeautyAsist'
  brandCell.font = { name: 'Calibri', size: 18, bold: true, color: { argb: ink } }
  brandCell.alignment = { vertical: 'middle', horizontal: 'left' }
  brandCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: white } }
  ws.mergeCells(`C1:${'G'}1`)
  const titleCell = ws.getCell('C1')
  titleCell.value = 'Onay Bekleyenler Dışa Aktarım'
  titleCell.font = { name: 'Calibri', size: 16, bold: true, color: { argb: ink } }
  titleCell.alignment = { vertical: 'middle', horizontal: 'left' }
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: white } }

  const logo = await fetchLogoBuffer()
  if (logo) {
    const imgId = wb.addImage({ buffer: logo, extension: 'png' })
    ws.addImage(imgId, { tl: { col: 0.15, row: 0.12 }, ext: { width: 40, height: 40 } })
  }

  // --- 2. satır: dışa aktarım tarihi ---
  ws.getRow(2).height = 20
  ws.mergeCells('A2:G2')
  const dateCell = ws.getCell('A2')
  const exportedAt = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date())
  dateCell.value = {
    richText: [
      { text: '  Dışa Aktarım Tarihi: ', font: { name: 'Calibri', size: 10, color: { argb: BRAND.inkSoft } } },
      { text: exportedAt, font: { name: 'Calibri', size: 10, bold: true, color: { argb: pinkText } } },
      ...(options.context ? [{ text: `     ·     ${options.context}`, font: { name: 'Calibri', size: 10, color: { argb: BRAND.inkSoft } } }] : []),
    ],
  }
  dateCell.alignment = { vertical: 'middle', horizontal: 'left' }
  dateCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: white } }

  ws.getRow(3).height = 6

  // --- 4. satır: özet kartları ---
  const counts = {
    total: rows.length,
    pending: rows.filter((r) => r.status === 'Pending').length,
    approved: rows.filter((r) => r.status === 'Approved').length,
    rejected: rows.filter((r) => r.status === 'Rejected').length,
  }
  ws.getRow(4).height = 34
  const cards: Array<{ range: string; label: string; value: number; labelColor: string; fill: string }> = [
    { range: 'A4:B4', label: 'Toplam Kayıt', value: counts.total, labelColor: ink, fill: 'FFFDF1F5' },
    { range: 'C4:D4', label: 'Bekleyen', value: counts.pending, labelColor: 'FFB45309', fill: 'FFFEF7E6' },
    { range: 'E4:F4', label: 'Onaylanan', value: counts.approved, labelColor: 'FF047857', fill: 'FFEAF8F1' },
    { range: 'G4:G4', label: 'Reddedilen', value: counts.rejected, labelColor: 'FFB91C1C', fill: 'FFFDEDED' },
  ]
  for (const card of cards) {
    if (card.range.split(':')[0] !== card.range.split(':')[1]) ws.mergeCells(card.range)
    const cell = ws.getCell(card.range.split(':')[0])
    cell.value = {
      richText: [
        { text: `  ${card.label}   `, font: { name: 'Calibri', size: 10, color: { argb: BRAND.inkSoft } } },
        { text: String(card.value), font: { name: 'Calibri', size: 14, bold: true, color: { argb: card.labelColor } } },
      ],
    }
    cell.alignment = { vertical: 'middle', horizontal: 'left' }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: card.fill } }
    cell.border = {
      top: { style: 'thin', color: { argb: lineSoft } },
      bottom: { style: 'thin', color: { argb: lineSoft } },
      left: { style: 'thin', color: { argb: lineSoft } },
      right: { style: 'thin', color: { argb: lineSoft } },
    }
  }

  ws.getRow(5).height = 6

  // --- 6. satır: tablo başlığı (açık pembe) ---
  const headerRow = ws.getRow(6)
  headerRow.height = 28
  APPROVAL_HEADERS.forEach((header, idx) => {
    const cell = headerRow.getCell(idx + 1)
    cell.value = header
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: ink } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: headerPink } }
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFF3CBDA' } },
      bottom: { style: 'medium', color: { argb: 'FFF3CBDA' } },
      left: { style: 'thin', color: { argb: 'FFF3CBDA' } },
      right: { style: 'thin', color: { argb: 'FFF3CBDA' } },
    }
  })

  // --- veri satırları ---
  rows.forEach((row, rowIdx) => {
    const r = ws.getRow(7 + rowIdx)
    r.height = 24
    const values = [row.type, row.customer, row.phone, row.staff, row.branch, row.createdAt, row.statusLabel]
    values.forEach((value, colIdx) => {
      const cell = r.getCell(colIdx + 1)
      cell.value = value
      cell.font = { name: 'Calibri', size: 10.5, color: { argb: ink } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: white } }
      cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
      cell.border = {
        top: { style: 'thin', color: { argb: lineSoft } },
        bottom: { style: 'thin', color: { argb: lineSoft } },
        left: { style: 'thin', color: { argb: lineSoft } },
        right: { style: 'thin', color: { argb: lineSoft } },
      }
    })
    // Durum hücresi — rozet görünümü (renkli zemin + renkli kalın metin)
    const statusCell = r.getCell(totalCols)
    const style = APPROVAL_STATUS_STYLE[row.status] ?? APPROVAL_STATUS_STYLE.Pending
    statusCell.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: style.font } }
    statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: style.fill } }
  })

  if (!rows.length) {
    ws.mergeCells('A7:G7')
    const c = ws.getCell('A7')
    c.value = '  Bu görünümde kayıt bulunmuyor.'
    c.font = { name: 'Calibri', size: 11, italic: true, color: { argb: BRAND.inkSoft } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.creamSoft } }
    c.alignment = { vertical: 'middle', horizontal: 'left' }
  }

  // --- kolon genişlikleri ---
  const widths = [20, 22, 20, 20, 18, 19, 16]
  widths.forEach((w, idx) => { ws.getColumn(idx + 1).width = w })

  if (rows.length > 0) {
    ws.autoFilter = { from: { row: 6, column: 1 }, to: { row: 6, column: totalCols } }
  }

  const buffer = await wb.xlsx.writeBuffer()
  saveAs(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `BeautyAsist-Onay-Bekleyenler-${todayIso()}.xlsx`,
  )
}

// ---------------------------------------------------------------------------
// LOG KAYITLARI — özel tasarımlı dışa aktarım (logo + özet kartları + eylem/modül
// rozetleri) + haftalık ve aylık özet sayfaları
// ---------------------------------------------------------------------------

export interface AuditLogExportRow {
  /** ISO tarih — haftalık/aylık gruplama için */
  createdAt: string
  createdAtFormatted: string
  user: string
  role: string
  action: string
  module: string
  summary: string
  ip: string
}

const LOG_INK = 'FF1F1620'
const LOG_HEADER_PINK = 'FFFBE2EB'
const LOG_HEADER_BORDER = 'FFF3CBDA'
const LOG_LINE_SOFT = 'FFF0E3E9'
const LOG_PINK_TEXT = 'FFE0617F'

/** Modül rozetleri için pastel palet — modül adına göre deterministik seçilir. */
const MODULE_PILL_PALETTE: StatusStyle[] = [
  { font: 'FF7C3AED', fill: 'FFF1E9FD' }, // mor
  { font: 'FFB45309', fill: 'FFFEF3C7' }, // amber
  { font: 'FF047857', fill: 'FFD1FAE5' }, // yeşil
  { font: 'FF0E7490', fill: 'FFE0F4F8' }, // camgöbeği
  { font: 'FFB91C5C', fill: 'FFFCE4EE' }, // pembe
  { font: 'FF4338CA', fill: 'FFE7E9FB' }, // çivit
  { font: 'FFC2410C', fill: 'FFFEE9DE' }, // turuncu
]

function modulePillStyle(module: string): StatusStyle {
  let h = 0
  for (let i = 0; i < module.length; i++) h = (h * 31 + module.charCodeAt(i)) >>> 0
  return MODULE_PILL_PALETTE[h % MODULE_PILL_PALETTE.length]
}

interface SummaryCard {
  label: string
  value: number
  color: string
  fill: string
}

/** Logo + başlık + tarih + özet kartlarından oluşan markalı üst bölümü (1-5. satır) kurar. */
function addLogBrandHeader(
  wb: ExcelJS.Workbook,
  ws: ExcelJS.Worksheet,
  logo: ArrayBuffer | null,
  title: string,
  context: string | undefined,
  lastColLetter: string,
  cards: SummaryCard[],
): void {
  const white = 'FFFFFFFF'

  ws.getRow(1).height = 42
  ws.mergeCells('A1:B1')
  const brandCell = ws.getCell('A1')
  brandCell.value = '        BeautyAsist'
  brandCell.font = { name: 'Calibri', size: 18, bold: true, color: { argb: LOG_INK } }
  brandCell.alignment = { vertical: 'middle', horizontal: 'left' }
  brandCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: white } }
  ws.mergeCells(`C1:${lastColLetter}1`)
  const titleCell = ws.getCell('C1')
  titleCell.value = title
  titleCell.font = { name: 'Calibri', size: 16, bold: true, color: { argb: LOG_INK } }
  titleCell.alignment = { vertical: 'middle', horizontal: 'left' }
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: white } }

  if (logo) {
    const imgId = wb.addImage({ buffer: logo, extension: 'png' })
    ws.addImage(imgId, { tl: { col: 0.15, row: 0.12 }, ext: { width: 40, height: 40 } })
  }

  ws.getRow(2).height = 20
  ws.mergeCells(`A2:${lastColLetter}2`)
  const dateCell = ws.getCell('A2')
  const exportedAt = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date())
  dateCell.value = {
    richText: [
      { text: '  Dışa Aktarım Tarihi: ', font: { name: 'Calibri', size: 10, color: { argb: BRAND.inkSoft } } },
      { text: exportedAt, font: { name: 'Calibri', size: 10, bold: true, color: { argb: LOG_PINK_TEXT } } },
      ...(context ? [{ text: `     ·     ${context}`, font: { name: 'Calibri', size: 10, color: { argb: BRAND.inkSoft } } }] : []),
    ],
  }
  dateCell.alignment = { vertical: 'middle', horizontal: 'left' }
  dateCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: white } }

  ws.getRow(3).height = 6

  // Özet kartları — sütunları 4 eşit gruba böl
  ws.getRow(4).height = 34
  const totalCols = ws.columnCount || cards.length
  const colCount = Math.max(cards.length, 1)
  const per = Math.max(1, Math.floor(totalCols / colCount))
  cards.forEach((card, i) => {
    const startCol = i * per + 1
    const endCol = i === cards.length - 1 ? totalCols : Math.min(totalCols, startCol + per - 1)
    const startLetter = colLetter(startCol)
    const endLetter = colLetter(endCol)
    if (startCol !== endCol) ws.mergeCells(`${startLetter}4:${endLetter}4`)
    const cell = ws.getCell(`${startLetter}4`)
    cell.value = {
      richText: [
        { text: `  ${card.label}   `, font: { name: 'Calibri', size: 10, color: { argb: BRAND.inkSoft } } },
        { text: String(card.value), font: { name: 'Calibri', size: 14, bold: true, color: { argb: card.color } } },
      ],
    }
    cell.alignment = { vertical: 'middle', horizontal: 'left' }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: card.fill } }
    cell.border = {
      top: { style: 'thin', color: { argb: LOG_LINE_SOFT } },
      bottom: { style: 'thin', color: { argb: LOG_LINE_SOFT } },
      left: { style: 'thin', color: { argb: LOG_LINE_SOFT } },
      right: { style: 'thin', color: { argb: LOG_LINE_SOFT } },
    }
  })

  ws.getRow(5).height = 6
}

function colLetter(n: number): string {
  let s = ''
  let num = n
  while (num > 0) {
    const rem = (num - 1) % 26
    s = String.fromCharCode(65 + rem) + s
    num = Math.floor((num - 1) / 26)
  }
  return s || 'A'
}

function styleLogTableHeader(ws: ExcelJS.Worksheet, rowIdx: number, headers: readonly string[]): void {
  const headerRow = ws.getRow(rowIdx)
  headerRow.height = 28
  headers.forEach((header, idx) => {
    const cell = headerRow.getCell(idx + 1)
    cell.value = header
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF9D2449' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LOG_HEADER_PINK } }
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
    cell.border = {
      top: { style: 'thin', color: { argb: LOG_HEADER_BORDER } },
      bottom: { style: 'medium', color: { argb: LOG_HEADER_BORDER } },
      left: { style: 'thin', color: { argb: LOG_HEADER_BORDER } },
      right: { style: 'thin', color: { argb: LOG_HEADER_BORDER } },
    }
  })
}

function styleLogDataCell(cell: ExcelJS.Cell, value: ExcelCellValue): void {
  cell.value = (value ?? '') as string | number
  cell.font = { name: 'Calibri', size: 10.5, color: { argb: LOG_INK } }
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } }
  cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
  cell.border = {
    top: { style: 'thin', color: { argb: LOG_LINE_SOFT } },
    bottom: { style: 'thin', color: { argb: LOG_LINE_SOFT } },
    left: { style: 'thin', color: { argb: LOG_LINE_SOFT } },
    right: { style: 'thin', color: { argb: LOG_LINE_SOFT } },
  }
}

/** Pazartesi başlangıçlı hafta etiketi: "09.06.2026 – 15.06.2026" */
function weekLabel(date: Date): { key: string; label: string } {
  const d = new Date(date)
  const day = (d.getDay() + 6) % 7 // Pzt=0
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - day)
  const end = new Date(d)
  end.setDate(end.getDate() + 6)
  const fmt = (x: Date) => new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(x)
  return { key: d.toISOString().slice(0, 10), label: `${fmt(d)} – ${fmt(end)}` }
}

function monthLabel(date: Date): { key: string; label: string } {
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  const label = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(date)
  return { key, label: label.charAt(0).toLocaleUpperCase('tr-TR') + label.slice(1) }
}

interface PeriodAggregate {
  key: string
  label: string
  total: number
  users: Set<string>
  modules: Map<string, number>
  actions: Map<string, number>
}

function aggregateByPeriod(rows: AuditLogExportRow[], periodOf: (d: Date) => { key: string; label: string }): PeriodAggregate[] {
  const map = new Map<string, PeriodAggregate>()
  for (const row of rows) {
    const d = new Date(row.createdAt)
    if (Number.isNaN(d.getTime())) continue
    const { key, label } = periodOf(d)
    let agg = map.get(key)
    if (!agg) {
      agg = { key, label, total: 0, users: new Set(), modules: new Map(), actions: new Map() }
      map.set(key, agg)
    }
    agg.total++
    agg.users.add(row.user)
    agg.modules.set(row.module, (agg.modules.get(row.module) ?? 0) + 1)
    agg.actions.set(row.action, (agg.actions.get(row.action) ?? 0) + 1)
  }
  return Array.from(map.values()).sort((a, b) => b.key.localeCompare(a.key))
}

function topOf(map: Map<string, number>): string {
  let top = '—'
  let count = 0
  for (const [k, c] of map) if (c > count) { top = k; count = c }
  return count > 0 ? `${top} (${count})` : top
}

function addPeriodSheet(
  wb: ExcelJS.Workbook,
  logo: ArrayBuffer | null,
  sheetName: string,
  title: string,
  context: string | undefined,
  periodHeader: string,
  aggregates: PeriodAggregate[],
): void {
  const headers = [periodHeader, 'Toplam Log', 'Kullanıcı Sayısı', 'Modül Sayısı', 'En Aktif Modül', 'En Sık Eylem'] as const
  const ws = wb.addWorksheet(sheetName, {
    properties: { defaultRowHeight: 18, tabColor: { argb: BRAND.roseGold } },
    views: [{ state: 'frozen', ySplit: 6, showGridLines: false }],
  })
  const widths = [26, 14, 18, 16, 30, 28]
  widths.forEach((w, idx) => { ws.getColumn(idx + 1).width = w })

  const totalUsers = new Set(aggregates.flatMap((a) => Array.from(a.users))).size
  const totalModules = new Set(aggregates.flatMap((a) => Array.from(a.modules.keys()))).size
  const totalLogs = aggregates.reduce((s, a) => s + a.total, 0)
  addLogBrandHeader(wb, ws, logo, title, context, colLetter(headers.length), [
    { label: 'Toplam Log', value: totalLogs, color: LOG_PINK_TEXT, fill: 'FFFDF1F5' },
    { label: 'Kullanıcı', value: totalUsers, color: 'FF7C3AED', fill: 'FFF6F0FE' },
    { label: 'Modül', value: totalModules, color: 'FFC2410C', fill: 'FFFEF3EA' },
    { label: periodHeader, value: aggregates.length, color: 'FF047857', fill: 'FFEAF8F1' },
  ])

  styleLogTableHeader(ws, 6, headers)

  aggregates.forEach((agg, rowIdx) => {
    const r = ws.getRow(7 + rowIdx)
    r.height = 24
    const values: ExcelCellValue[] = [agg.label, agg.total, agg.users.size, agg.modules.size, topOf(agg.modules), topOf(agg.actions)]
    values.forEach((value, colIdx) => styleLogDataCell(r.getCell(colIdx + 1), value))
    const totalCell = r.getCell(2)
    totalCell.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: LOG_PINK_TEXT } }
  })

  if (!aggregates.length) {
    ws.mergeCells(`A7:${colLetter(headers.length)}7`)
    const c = ws.getCell('A7')
    c.value = '  Bu dönemde kayıt bulunmuyor.'
    c.font = { name: 'Calibri', size: 11, italic: true, color: { argb: BRAND.inkSoft } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.creamSoft } }
    c.alignment = { vertical: 'middle', horizontal: 'left' }
  }
}

export async function exportAuditLogsToExcel(rows: AuditLogExportRow[], options: { context?: string } = {}): Promise<void> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'BeautyAsist Güzellik Merkezi Yönetimi'
  wb.created = new Date()
  wb.title = 'Log Kayıtları Dışa Aktarım'
  wb.company = 'BeautyAsist'

  const logo = await fetchLogoBuffer()
  const headers = ['Tarih', 'Kullanıcı', 'Rol', 'Eylem', 'Modül', 'Özet', 'IP'] as const

  const ws = wb.addWorksheet('Log Kayıtları', {
    properties: { defaultRowHeight: 18, tabColor: { argb: BRAND.roseGold } },
    pageSetup: {
      paperSize: 9,
      orientation: 'landscape',
      margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
      printTitlesRow: '6:6',
    },
    views: [{ state: 'frozen', ySplit: 6, showGridLines: false }],
  })
  const widths = [17, 26, 18, 14, 16, 70, 12]
  widths.forEach((w, idx) => { ws.getColumn(idx + 1).width = w })

  const uniqueUsers = new Set(rows.map((r) => r.user)).size
  const uniqueModules = new Set(rows.map((r) => r.module)).size
  addLogBrandHeader(wb, ws, logo, 'Log Kayıtları Dışa Aktarım', options.context, colLetter(headers.length), [
    { label: 'Toplam Log', value: rows.length, color: LOG_PINK_TEXT, fill: 'FFFDF1F5' },
    { label: 'Kullanıcı', value: uniqueUsers, color: 'FF7C3AED', fill: 'FFF6F0FE' },
    { label: 'Modül', value: uniqueModules, color: 'FFC2410C', fill: 'FFFEF3EA' },
    { label: 'Aktivite', value: rows.length, color: 'FF047857', fill: 'FFEAF8F1' },
  ])

  styleLogTableHeader(ws, 6, headers)

  rows.forEach((row, rowIdx) => {
    const r = ws.getRow(7 + rowIdx)
    r.height = 24
    const values = [row.createdAtFormatted, row.user, row.role, row.action, row.module, row.summary, row.ip]
    values.forEach((value, colIdx) => styleLogDataCell(r.getCell(colIdx + 1), value))

    // Eylem rozeti (pembe) + Modül rozeti (modüle göre pastel renk)
    const actionCell = r.getCell(4)
    actionCell.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: 'FFB91C5C' } }
    actionCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4EE' } }
    actionCell.alignment = { vertical: 'middle', horizontal: 'center' }
    const moduleCell = r.getCell(5)
    const pill = modulePillStyle(row.module)
    moduleCell.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: pill.font } }
    moduleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: pill.fill } }
    moduleCell.alignment = { vertical: 'middle', horizontal: 'center' }
  })

  if (!rows.length) {
    ws.mergeCells(`A7:${colLetter(headers.length)}7`)
    const c = ws.getCell('A7')
    c.value = '  Bu görünümde kayıt bulunmuyor.'
    c.font = { name: 'Calibri', size: 11, italic: true, color: { argb: BRAND.inkSoft } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.creamSoft } }
    c.alignment = { vertical: 'middle', horizontal: 'left' }
  } else {
    ws.autoFilter = { from: { row: 6, column: 1 }, to: { row: 6, column: headers.length } }
  }

  // Haftalık ve aylık özet sayfaları
  addPeriodSheet(wb, logo, 'Haftalık Özet', 'Log Kayıtları · Haftalık Özet', options.context, 'Hafta', aggregateByPeriod(rows, weekLabel))
  addPeriodSheet(wb, logo, 'Aylık Özet', 'Log Kayıtları · Aylık Özet', options.context, 'Ay', aggregateByPeriod(rows, (d) => monthLabel(d)))

  const buffer = await wb.xlsx.writeBuffer()
  saveAs(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `BeautyAsist-Log-Kayitlari-${todayIso()}.xlsx`,
  )
}

// ---------------------------------------------------------------------------
// IMPORT
// ---------------------------------------------------------------------------

export interface ImportedRow {
  [key: string]: string | number | boolean | null
}

export interface ImportResult {
  sheetName: string
  rows: ImportedRow[]
  headers: string[]
}

export async function importFromExcel(file: File): Promise<ImportResult[]> {
  const buffer = await file.arrayBuffer()
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  const results: ImportResult[] = []
  wb.eachSheet((ws) => {
    // Header satırını bul: en az 2 FARKLI dolu hücre içeren ilk satır.
    // (Marka kuşağı / alt başlık satırları birleştirilmiş hücre olduğundan aynı
    //  değeri tekrarlar; "farklı değer" şartı bunları atlar.)
    let headerRowIdx = 1
    for (let r = 1; r <= Math.min(12, ws.rowCount); r++) {
      const row = ws.getRow(r)
      const values = ((row.values as ExcelJS.CellValue[]) || [])
        .filter((v) => v !== undefined && v !== null && String(v).trim() !== '')
        .map((v) => String(v).trim())
      const distinct = new Set(values)
      if (values.length >= 2 && distinct.size >= 2) {
        headerRowIdx = r
        break
      }
    }
    const headerRow = ws.getRow(headerRowIdx)
    const headers: string[] = []
    headerRow.eachCell({ includeEmpty: false }, (cell) => {
      headers.push(String(cell.value ?? '').trim())
    })

    const firstHeader = headers[0] ?? ''
    const rows: ImportedRow[] = []
    for (let r = headerRowIdx + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r)
      const obj: ImportedRow = {}
      let hasValue = false
      headers.forEach((h, i) => {
        const cell = row.getCell(i + 1)
        const v = cell.value
        if (v !== null && v !== undefined && String(v).trim() !== '') hasValue = true
        if (v instanceof Date) obj[h] = v.toISOString()
        else if (typeof v === 'object' && v && 'text' in (v as { text?: string })) obj[h] = String((v as { text?: string }).text ?? '')
        else obj[h] = v as string | number | boolean | null
      })
      // Dışa aktarımdaki "TOPLAM" özet satırı veri olarak alınmaz.
      const firstValue = String(obj[firstHeader] ?? '').trim().toLocaleUpperCase('tr-TR')
      if (firstValue === 'TOPLAM') continue
      if (hasValue) rows.push(obj)
    }
    results.push({ sheetName: ws.name, rows, headers })
  })
  return results
}
