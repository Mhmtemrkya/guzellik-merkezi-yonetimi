import pdfMakeOrig from 'pdfmake/build/pdfmake'
import pdfFonts from 'pdfmake/build/vfs_fonts'
import type { TDocumentDefinitions } from 'pdfmake/interfaces'

/**
 * pdfmake çalışma zamanı — TEK KURULUM.
 *
 * Gömülü Roboto fontu Türkçe karakterleri (ı, ş, ç, ğ, ü, ö, İ, Ş, Ç, Ğ, Ü, Ö) tam destekler;
 * jsPDF'in Latin-1 kodlaması bunları bozuyordu, o yüzden bu kütüphaneye geçildi.
 *
 * vfs bağlama iki ayrı PDF üreticisinde kopyalanmıştı; sürüm farkında (`{pdfMake:{vfs}}` ↔ `{vfs}`)
 * yalnız birini düzeltmek diğer belgeyi FONTSUZ bırakırdı. Tek kaynak burasıdır.
 */

type VfsShape = { pdfMake?: { vfs?: Record<string, string> }; vfs?: Record<string, string> }

/** `createPdf` çıktısı — indirme, yazıcıya gönderme ve yeni sekmede açma. */
export interface PdfDocumentHandle {
  download: (filename: string) => void
  print: () => void
  open: () => void
}

interface PdfMakeRuntime {
  vfs: Record<string, string>
  createPdf: (definition: TDocumentDefinitions) => PdfDocumentHandle
}

const vfsCandidate = pdfFonts as unknown as VfsShape
const runtime = pdfMakeOrig as unknown as PdfMakeRuntime
runtime.vfs = vfsCandidate.pdfMake?.vfs || vfsCandidate.vfs || {}

export function createPdf(definition: TDocumentDefinitions): PdfDocumentHandle {
  return runtime.createPdf(definition)
}
