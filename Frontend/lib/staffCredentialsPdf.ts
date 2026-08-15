// Personel giriş bilgileri belgesi. Kurum yöneticisi belgesiyle AYNI tasarımı kullanır —
// tek fark başlık, kişi etiketi ve yetki kartıdır (bkz. credentialsPdf.ts).
import { generateCredentialsPdf } from './credentialsPdf'

export interface StaffCredentialsPdfData {
  staffName: string
  email: string
  initialPassword: string
  tenantName: string
  branchName?: string | null
  title?: string
  permissions?: Array<{ key: string; label: string }>
  /** Kurum logosu (data-URL) — belgenin üst bandındaki beyaz kutuya basılır. */
  logoDataUrl?: string | null
}

export function generateStaffCredentialsPdf(data: StaffCredentialsPdfData): Promise<void> {
  return generateCredentialsPdf({
    heading: 'PERSONEL GİRİŞ BİLGİLERİ',
    subjectLabel: 'PERSONEL',
    personName: data.staffName,
    email: data.email,
    initialPassword: data.initialPassword,
    tenantName: data.tenantName,
    branchName: data.branchName,
    roleLine: data.title,
    permissions: data.permissions,
    logoDataUrl: data.logoDataUrl,
    filenameBase: data.staffName,
  })
}
