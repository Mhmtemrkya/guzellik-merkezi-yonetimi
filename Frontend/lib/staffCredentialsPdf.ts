// Personel "kimlik kartı" PDF'i. Artık generic credentialsPdf'e delege eder.
// Geriye dönük uyumluluk için bu dosya ve imzası korunuyor.
import { generateCredentialsPdf } from './credentialsPdf'

export interface StaffCredentialsPdfData {
  staffName: string
  email: string
  initialPassword: string
  tenantName: string
  branchName?: string | null
  title?: string
  permissions?: Array<{ key: string; label: string }>
}

export function generateStaffCredentialsPdf(data: StaffCredentialsPdfData): void {
  generateCredentialsPdf({
    heading: 'PERSONEL GİRİŞ BİLGİLERİ',
    subjectLabel: 'PERSONEL',
    personName: data.staffName,
    email: data.email,
    initialPassword: data.initialPassword,
    tenantName: data.tenantName,
    branchName: data.branchName,
    roleLineLabel: 'GÖREV',
    roleLine: data.title,
    permissions: data.permissions,
    filenameBase: data.staffName,
  })
}
