// Giriş bilgileri belgesini ÜRETİR ve indirir (tarayıcı tarafı).
//
// Yerleşim `credentialsPdfDoc.ts`'te; burada yalnız marka görsellerinin yüklenmesi ve pdfmake
// çalışma zamanı var. Ayrım bilerek: yerleşim tarayıcısız da render edilebilsin (görsel doğrulama).
import pdfMakeOrig from 'pdfmake/build/pdfmake'
import pdfFonts from 'pdfmake/build/vfs_fonts'
import type { TDocumentDefinitions } from 'pdfmake/interfaces'
import { buildCredentialsDoc, credentialsFilename, type CredentialsPdfData } from './credentialsPdfDoc'
import { loginUrl as defaultLoginUrl } from './publicWebUrl'

export type { CredentialsPdfData } from './credentialsPdfDoc'

type VfsShape = { pdfMake?: { vfs?: Record<string, string> }; vfs?: Record<string, string> }
const vfsCandidate = pdfFonts as unknown as VfsShape
const vfs = vfsCandidate.pdfMake?.vfs || vfsCandidate.vfs || {}
interface PdfMakeRuntime {
  vfs: Record<string, string>
  createPdf: (def: TDocumentDefinitions) => { download: (filename: string) => void }
}
const pdfMake = pdfMakeOrig as unknown as PdfMakeRuntime
pdfMake.vfs = vfs

/**
 * Marka görsellerini data-URL'e çevirir (pdfmake tarayıcıda yalnız data-URL kabul eder).
 *
 * HATA BELGEYİ DURDURMAZ: görsel inmezse `null` döner ve belge o iz olmadan üretilir —
 * kullanıcının elinde giriş bilgisi olmaması, logosuz bir sayfadan çok daha kötüdür.
 */
const assetCache = new Map<string, Promise<string | null>>()

function loadAsset(path: string): Promise<string | null> {
  const cached = assetCache.get(path)
  if (cached) return cached
  const task = (async (): Promise<string | null> => {
    try {
      const res = await fetch(path)
      if (!res.ok) return null
      const blob = await res.blob()
      return await new Promise<string | null>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
        reader.onerror = () => resolve(null)
        reader.readAsDataURL(blob)
      })
    } catch {
      return null
    }
  })()
  assetCache.set(path, task)
  return task
}

export async function generateCredentialsPdf(data: CredentialsPdfData): Promise<void> {
  // Belge ZEMİNİ tasarımın kendisidir; iki varyantın şablonu da yüklenir (önbellekli).
  const [templateOwner, templateStaff] = await Promise.all([
    loadAsset('/credentials/form-yonetici.png'),
    loadAsset('/credentials/form-personel.png'),
  ])

  const doc = buildCredentialsDoc(data, { templateOwner, templateStaff }, defaultLoginUrl())
  pdfMake.createPdf(doc).download(credentialsFilename(data))
}
