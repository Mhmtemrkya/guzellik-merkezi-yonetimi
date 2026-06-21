import type { ApiConsultationForm, SkinTypeValue } from './types'

/** İşlem uygunluğu uyarısı üreten müşteri beyan alanları. */
export type ConsultationFlagKey =
  | 'isPregnant' | 'isBreastfeeding' | 'hasPacemakerOrImplant' | 'hasEpilepsy'
  | 'hasDiabetes' | 'hasCancerHistory' | 'usesBloodThinners' | 'usedIsotretinoin'
  | 'hasKeloidTendency' | 'hasActiveSkinIssue' | 'recentSunExposure'

export const CONSULTATION_FLAGS: { key: ConsultationFlagKey; label: string }[] = [
  { key: 'isPregnant', label: 'Gebelik' },
  { key: 'isBreastfeeding', label: 'Emzirme' },
  { key: 'hasPacemakerOrImplant', label: 'Kalp pili / metal implant' },
  { key: 'hasEpilepsy', label: 'Epilepsi' },
  { key: 'hasDiabetes', label: 'Diyabet' },
  { key: 'hasCancerHistory', label: 'Kanser öyküsü' },
  { key: 'usesBloodThinners', label: 'Kan sulandırıcı kullanımı' },
  { key: 'usedIsotretinoin', label: 'İzotretinoin (Roaccutane, son 6 ay)' },
  { key: 'hasKeloidTendency', label: 'Keloid / kötü iz eğilimi' },
  { key: 'hasActiveSkinIssue', label: 'Aktif cilt enfeksiyonu / uçuk' },
  { key: 'recentSunExposure', label: 'Son dönem güneş / bronzlaşma' },
]

export const SKIN_TYPE_OPTIONS: { value: SkinTypeValue; label: string }[] = [
  { value: 'Unknown', label: 'Belirtilmemiş' },
  { value: 'Type1', label: 'Tip I — Çok açık, her zaman yanar' },
  { value: 'Type2', label: 'Tip II — Açık, kolay yanar' },
  { value: 'Type3', label: 'Tip III — Buğday, bazen yanar' },
  { value: 'Type4', label: 'Tip IV — Zeytin, az yanar' },
  { value: 'Type5', label: 'Tip V — Esmer, nadir yanar' },
  { value: 'Type6', label: 'Tip VI — Koyu, yanmaz' },
]

export interface ConsultationWarning {
  severity: 'high' | 'medium'
  title: string
  detail: string
}

/**
 * Müşteri beyanlarından işlem uygunluğu uyarılarını üretir. Hem düzenleme sırasında (canlı)
 * hem kayıtlı formu görüntülerken aynı motor kullanılır → tek doğruluk kaynağı.
 */
export function deriveConsultationWarnings(f: ApiConsultationForm): ConsultationWarning[] {
  const w: ConsultationWarning[] = []
  const add = (severity: 'high' | 'medium', title: string, detail: string) => w.push({ severity, title, detail })
  if (f.isPregnant) add('high', 'Gebelik', 'Lazer/IPL epilasyon, kimyasal peeling, RF ve iğneli (mezoterapi) işlemler önerilmez.')
  if (f.isBreastfeeding) add('medium', 'Emzirme', 'Kimyasal peeling ve bazı aktif içerikler/mezoterapi önerilmez; hekime danışın.')
  if (f.hasPacemakerOrImplant) add('high', 'Kalp pili / metal implant', 'RF, elektroterapi ve bazı cihazlar uygulanmamalı.')
  if (f.hasEpilepsy) add('medium', 'Epilepsi', 'Yoğun ışık (IPL/lazer) nöbet tetikleyebilir; dikkatli olun.')
  if (f.hasDiabetes) add('medium', 'Diyabet', 'Yara iyileşmesi yavaş; iğneli/ablatif işlemlerde enfeksiyon riski.')
  if (f.hasCancerHistory) add('high', 'Onkoloji öyküsü', 'Hekim onayı olmadan ışık/RF/iğneli işlem yapılmamalı.')
  if (f.usesBloodThinners) add('medium', 'Kan sulandırıcı', 'İğneli işlemlerde morarma/kanama riski.')
  if (f.usedIsotretinoin) add('high', 'İzotretinoin (Roaccutane)', 'Lazer, peeling ve ağda kontrendike; son kullanımdan en az 6 ay sonra.')
  if (f.hasKeloidTendency) add('medium', 'Keloid eğilimi', 'İğneli/ablatif işlemlerde skar/keloid riski.')
  if (f.hasActiveSkinIssue) add('high', 'Aktif cilt enfeksiyonu / uçuk', 'İyileşene dek bölgesel işlemler ertelenmeli.')
  if (f.recentSunExposure) add('medium', 'Son dönem güneş / bronzlaşma', 'Lazer/IPL’de yanık ve leke riski; 2–4 hafta bekleyin.')
  return w
}
