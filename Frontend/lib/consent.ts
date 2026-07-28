import type { ApiConsentForm, ApiConsentRequirement, ApiConsentStatus, ConsentFormStatusKey } from '@/lib/types'

/**
 * Onam formu durumu API'den bazen string ("Signed") bazen enum sayısı (2) gelebilir.
 * Tek bir anahtar tipine indirger — UI hiçbir yerde ham değere bakmaz.
 */
export function consentStatusKey(value: ConsentFormStatusKey | number | null | undefined): ConsentFormStatusKey | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') {
    return (['Draft', 'AwaitingSignature', 'Signed', 'Cancelled'][value] as ConsentFormStatusKey) ?? null
  }
  const known: ConsentFormStatusKey[] = ['Draft', 'AwaitingSignature', 'Signed', 'Cancelled']
  return known.includes(value) ? value : null
}

export const CONSENT_STATUS_LABEL: Record<ConsentFormStatusKey, string> = {
  Draft: 'Hazırlanıyor',
  AwaitingSignature: 'İmza bekleniyor',
  Signed: 'İmzalandı',
  Cancelled: 'İptal',
}

export const CONSENT_STATUS_TONE: Record<ConsentFormStatusKey, string> = {
  Draft: 'border-[#ead8df] bg-[#fffafc] text-[#705a66]',
  AwaitingSignature: 'border-amber-200 bg-amber-50 text-amber-800',
  Signed: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  Cancelled: 'border-rose-200 bg-rose-50 text-rose-600',
}

export function isSigned(form: { status?: ConsentFormStatusKey | number | null } | null | undefined): boolean {
  return consentStatusKey(form?.status) === 'Signed'
}

/** Eksik (imzalanmamış) gereksinimler — backend "missing" alanını göndermezse burada türetilir. */
export function missingRequirements(status: ApiConsentStatus | null | undefined): ApiConsentRequirement[] {
  if (!status) return []
  if (Array.isArray(status.missing) && status.missing.length > 0) return status.missing
  return (status.requirements || []).filter((r) => consentStatusKey(r.status) !== 'Signed')
}

/** Kayıt listesinden bir şablonun en güncel kaydını bulur (imzalı olan önceliklidir). */
export function latestFormFor(forms: ApiConsentForm[], templateId?: string | null): ApiConsentForm | null {
  if (!templateId) return null
  const mine = forms.filter((f) => f.templateId === templateId)
  if (mine.length === 0) return null
  const signed = mine.filter((f) => isSigned(f))
  const pool = signed.length > 0 ? signed : mine
  return [...pool].sort((a, b) => (b.signedAtUtc || b.createdAtUtc || '').localeCompare(a.signedAtUtc || a.createdAtUtc || ''))[0] ?? null
}
