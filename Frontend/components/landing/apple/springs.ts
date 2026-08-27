import type { Transition } from 'framer-motion'

/**
 * HAREKET TEMELİ — Apple'ın iki parametreli yay dili.
 *
 * Apple, fizik üçlüsünü (kütle/sertlik/sönüm) tasarımcı için iki değere indirger:
 *   · DAMPING (sönüm oranı) — 1.0 kritik sönüm, aşma YOK. 1'in altı zıplar.
 *   · RESPONSE — hedefe varış hızı (saniye). Süre DEĞİLDİR; yayın oturması buradan doğar.
 *
 * Framer Motion'daki `{ bounce, duration }` yay biçimi bu ikiliyle birebir örtüşür:
 * `bounce = 1 - damping`, `duration ≈ response`.
 *
 * KURAL: varsayılan KRİTİK SÖNÜMDÜR. Zıplama yalnız hareketin kendisi momentum
 * taşıyorsa (fırlatma, sürükleyip bırakma) eklenir — kendiliğinden beliren bir menünün
 * aşması yanlış, fırlatılan bir kartın aşması doğru hissettirir.
 */

/** Yer değiştirme / konumlanma — damping 1.0, response 0.4. */
export const SPRING_MOVE: Transition = { type: 'spring', bounce: 0, duration: 0.4 }

/** Anlık dokunma geri bildirimi — daha da kısa, aşmasız. */
export const SPRING_PRESS: Transition = { type: 'spring', bounce: 0, duration: 0.22 }

/** Çekmece / sayfa katmanı — damping 0.8, response 0.3. */
export const SPRING_SHEET: Transition = { type: 'spring', bounce: 0.2, duration: 0.3 }

/** Momentumlu bırakma (fırlatma) — damping ~0.8, response 0.4. */
export const SPRING_THROW: Transition = { type: 'spring', bounce: 0.2, duration: 0.4 }

/** Sahneye giriş — uzun mesafe, aşmasız; dikkat çalmaz. */
export const SPRING_ENTER: Transition = { type: 'spring', bounce: 0, duration: 0.55 }

/**
 * Momentum İZDÜŞÜMÜ — parmağın gittiği yeri hesaplar.
 *
 * Bırakma noktasına değil, hızın TAŞIYACAĞI noktaya gidilir; kaydırma yavaşlamasının
 * kullandığı üstel sönüm biçimi budur (ders kitabındaki v²/2a DEĞİL).
 *
 * @param velocity px/sn cinsinden bırakma hızı
 * @param decelerationRate 0.998 normal kaydırma hissi, 0.99 daha çabuk duran
 */
export function projectMomentum(velocity: number, decelerationRate = 0.998): number {
  return (velocity / 1000) * decelerationRate / (1 - decelerationRate)
}
