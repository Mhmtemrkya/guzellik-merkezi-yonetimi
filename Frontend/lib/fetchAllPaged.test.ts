import { describe, expect, it } from 'vitest'
import { fetchAllPaged } from './apiClient'

/**
 * SAYFALAMA — EKSİK LİSTE SESSİZCE DÖNMEZ.
 *
 * Döngü `page <= 100` ile duruyordu: 200'lük sayfada 20.000 kaydı aşan kurumda liste HATASIZ
 * ama EKSİK dönüyor, cari ekranı bunu gerçek toplam sanıp daha KÜÇÜK bir borç gösteriyordu.
 * Para ekranında sessiz eksik veri, hata mesajından çok daha tehlikelidir.
 */
describe('fetchAllPaged', () => {
  /** `total` kadar kaydı `pageSize`lik sayfalara bölen sahte sunucu. */
  const server = (total: number) => (page: number, pageSize: number) => {
    const start = (page - 1) * pageSize
    const items = Array.from(
      { length: Math.max(0, Math.min(pageSize, total - start)) },
      (_, i) => ({ id: `k-${start + i}` }),
    )
    return Promise.resolve({ items, total })
  }

  it('tüm sayfaları toplar', async () => {
    const rows = await fetchAllPaged(server(450), 100)
    expect(rows).toHaveLength(450)
  })

  it('tek sayfaya sığan liste tek turda biter', async () => {
    expect(await fetchAllPaged(server(30), 100)).toHaveLength(30)
  })

  it('ESKİ 100-SAYFA TAVANINI aşan liste tam gelir (20.000 sınırı kalktı)', async () => {
    // 200 × 100 = 20.000 idi; 20.500 kayıt eskiden sessizce 20.000'e kesiliyordu.
    const rows = await fetchAllPaged(server(20_500), 200)
    expect(rows).toHaveLength(20_500)
  })

  it('TAVAN AŞILIRSA HATA verir — kısa liste sessizce dönmez', async () => {
    // Güvenlik tavanı 500 sayfa; 1'lik sayfayla 600 kayıt tavanı aşar.
    await expect(fetchAllPaged(server(600), 1)).rejects.toThrow(/eksik/i)
  })

  it('erken boş sayfa HATA DEĞİLDİR — bayat sayım ekranı düşürmemeli', async () => {
    // totalCount 100 diyor ama sunucu 2. sayfada boş dönüyor. Bu SİSTEMATİK kesme değil,
    // büyük olasılıkla eşzamanlı silme yüzünden bayatlamış bir sayaçtır; iyi niyetli bir
    // yarışı ekran hatasına çevirmek felakete dönerdi.
    const flaky = (page: number) =>
      Promise.resolve({ items: page === 1 ? [{ id: 'a' }] : [], total: 100 })
    const rows = await fetchAllPaged(flaky, 1)
    expect(rows).toHaveLength(1)
  })
})
