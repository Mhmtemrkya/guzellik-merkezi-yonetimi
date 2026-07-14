'use client'
import { Star } from 'lucide-react'

/** Sarı yıldız satırı — value ondalıklı olabilir (4.6 → 4 dolu + yarım görünüm yerine yuvarlama). */
export function Stars({ value, size = 14 }: { value: number | null | undefined; size?: number }) {
  const rounded = Math.round(value ?? 0)
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={value ? `${value.toFixed(1)} / 5` : 'Henüz puanlanmadı'}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          style={{ width: size, height: size }}
          className={i <= rounded ? 'fill-amber-400 text-amber-400' : 'fill-[#eadfe4] text-[#eadfe4]'}
          strokeWidth={0}
        />
      ))}
    </span>
  )
}

/** Tıklanabilir yıldız seçici (manuel puanlama). */
export function StarPicker({
  value,
  onChange,
  size = 26,
  disabled = false,
}: {
  value: number
  onChange: (v: number) => void
  size?: number
  disabled?: boolean
}) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          disabled={disabled}
          onClick={() => onChange(i)}
          aria-label={`${i} yıldız`}
          className="transition-transform hover:scale-110 disabled:opacity-50"
        >
          <Star
            style={{ width: size, height: size }}
            className={i <= value ? 'fill-amber-400 text-amber-400' : 'fill-[#eadfe4] text-[#eadfe4]'}
            strokeWidth={0}
          />
        </button>
      ))}
    </div>
  )
}
