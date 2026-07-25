import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/**
 * Kişi adı kurum standardı: ad(lar) "İlk harf büyük", soyad TAMAMI BÜYÜK.
 * "ayşe nur yilmaz" → "Ayşe Nur YILMAZ". Türkçe locale ile çevrilir (i→İ, I→ı).
 * Backend'deki PersonNameFormatter ile aynı kuralı uygular.
 */
export function formatPersonName(value: string | null | undefined): string {
  const parts = (value ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return ''
  // Tek kelime soyad değil ad kabul edilir.
  if (parts.length === 1) return titleCaseWord(parts[0])
  return [...parts.slice(0, -1).map(titleCaseWord), parts[parts.length - 1].toLocaleUpperCase('tr-TR')].join(' ')
}

function titleCaseWord(word: string): string {
  // Tireli/kesme işaretli adlar parça parça büyütülür: "ayşe-nur" → "Ayşe-Nur".
  let startOfWord = true
  let out = ''
  for (const ch of word) {
    if (ch === '-' || ch === "'" || ch === '’' || ch === '.') {
      out += ch
      startOfWord = true
      continue
    }
    out += startOfWord ? ch.toLocaleUpperCase('tr-TR') : ch.toLocaleLowerCase('tr-TR')
    startOfWord = false
  }
  return out
}
