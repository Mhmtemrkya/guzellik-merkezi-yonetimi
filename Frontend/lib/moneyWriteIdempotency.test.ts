import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * KONVANSİYON KAPISI — para yazan çağrılar `Idempotency-Key` göndermek ZORUNDA.
 *
 * Sunucudaki `IdempotencyMiddleware` yalnız başlığı TAŞIYAN isteği korur; başlıksız istek sessizce
 * korumasızdır. İstemci sarmalayıcılarında anahtar OPSİYONEL bir parametredir, dolayısıyla
 * unutulduğunda ne derleyici ne de tip denetimi uyarır — nitekim 11 tahsilat çağrısının hepsi
 * aylarca anahtarsız kaldı ve çift gönderim 400 ₺'yi 800 ₺ yazabiliyordu.
 *
 * Bu test o sınıfı makineye bağlar: aşağıdaki uçların HER çağrısı anahtar argümanını geçmeli.
 * Yeni bir çağrı eklenip anahtar unutulursa test kırılır ve dosya adı + satır numarası basar.
 *
 * Kapsam dışı bırakılanlar (sunucuda korunuyor, bilerek):
 *  • `approveAdisyon` — `ApproveCoreAsync` satır kilidi altında durum kapısı uyguluyor
 *    ("Yalnızca açık adisyon onaylanabilir"), çift onay finansal etkiyi tekrar üretemez.
 *  • `forceNew` göndermeyen `createAdisyon` — sunucu açık fiş varsa onu döndürür (idempotent).
 */

/** Anahtarın KAÇINCI argüman olduğu (1 tabanlı) — bu sayıda argüman geçilmiş olmalı. */
const GUARDED = {
  'adminApi.registerAccountPayment(': 4,
  'adminApi.addAdisyonItem(': 4,
} as const

const ROOT = join(__dirname, '..')
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'out', 'dist'])

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, acc)
    else if (/\.tsx?$/.test(entry) && !entry.endsWith('.test.ts')) acc.push(full)
  }
  return acc
}

/**
 * `open` konumundaki '(' ile eşleşen ')' arasındaki ÜST SEVİYE argümanları döndürür.
 * Dizeler ve şablon dizeleri atlanır: kalem açıklamaları virgül ve parantez içerir
 * (`Paket satışı: ${x}`), naif bir `split(',')` argüman sayısını yanlış sayardı.
 */
function topLevelArgs(text: string, open: number): string[] | null {
  const args: string[] = []
  let depth = 0
  let current = ''
  let quote: string | null = null
  for (let i = open; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (ch === '\\') { current += ch + (text[i + 1] ?? ''); i++; continue }
      if (ch === quote) quote = null
      current += ch
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; current += ch; continue }
    if (ch === '(' || ch === '[' || ch === '{') {
      depth++
      if (depth === 1) continue // dış '(' argümana yazılmaz
      current += ch
      continue
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      depth--
      if (depth === 0) { if (current.trim()) args.push(current.trim()); return args }
      current += ch
      continue
    }
    if (ch === ',' && depth === 1) { args.push(current.trim()); current = ''; continue }
    current += ch
  }
  return null // parantez kapanmadı (dosya kesik) — çağrıyı doğrulayamayız
}

describe('para yazan çağrılar Idempotency-Key geçmeli', () => {
  const files = sourceFiles(ROOT)

  it('taranan dosya sayısı makul (yürüyüş gerçekten çalışıyor)', () => {
    // Yürüyüş sessizce boş dönerse test hiçbir şeyi korumaz ama YEŞİL kalırdı.
    expect(files.length).toBeGreaterThan(50)
  })

  for (const [call, minArgs] of Object.entries(GUARDED)) {
    it(`${call.replace('adminApi.', '').replace('(', '')} — her çağrı anahtar argümanını veriyor`, () => {
      const offenders: string[] = []
      let found = 0

      for (const file of files) {
        const text = readFileSync(file, 'utf8')
        let from = 0
        for (;;) {
          const at = text.indexOf(call, from)
          if (at < 0) break
          from = at + call.length
          found++
          const args = topLevelArgs(text, at + call.length - 1)
          if (args && args.length >= minArgs) continue
          const line = text.slice(0, at).split('\n').length
          offenders.push(`${relative(ROOT, file).replace(/\\/g, '/')}:${line} (${args?.length ?? '?'} argüman, en az ${minArgs} olmalı)`)
        }
      }

      // Uç yeniden adlandırılırsa arama sessizce 0 bulur ve test yine yeşil kalırdı.
      expect(found, `"${call}" hiç bulunamadı — uç yeniden mi adlandırıldı?`).toBeGreaterThan(0)
      expect(offenders, `Anahtarsız para yazan çağrı:\n${offenders.join('\n')}`).toEqual([])
    })
  }
})
