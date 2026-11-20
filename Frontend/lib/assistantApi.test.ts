import { afterEach, describe, expect, it, vi } from 'vitest'
import { businessAssistant, isAppreciation, isStoreBuild, readDataCard, readHowTo, storedToReply } from './assistantApi'

/**
 * Maydi web istemcisi. Kritik kural: yapay zekâ onayı reddedildiyse istek bunu sunucuya SÖYLER (allowAi=false /
 * ai=false) — yoksa soru buluta gider (App Store 5.1.2(i)). Mağaza sürümü bayrağı da sunucuya taşınır (3.1.1).
 */
describe('assistantApi', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function captureFetch() {
    const calls: { url: string; body?: string }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: typeof init?.body === 'string' ? init.body : undefined })
      return new Response(JSON.stringify({ success: true, data: { suggestions: [], actions: [] } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }))
    return calls
  }

  it('declined consent is sent as allowAi=false on messages and ai=false on briefing', async () => {
    const calls = captureFetch()
    await businessAssistant.send('kasa nasıl kapatılır', { route: '/panel/kasa', allowAi: false, storeBuild: true })
    await businessAssistant.briefing({ route: '/panel', allowAi: false })

    const body = JSON.parse(calls[0].body ?? '{}')
    expect(calls[0].url).toContain('/api/assistant/messages')
    expect(body.context).toEqual({ route: '/panel/kasa', storeBuild: true, english: false, allowAi: false })
    expect(body.message).toBe('kasa nasıl kapatılır')
    expect(calls[1].url).toContain('/api/assistant/briefing?route=%2Fpanel&ai=false')
  })

  it('granted consent omits the ai flag (server default is on)', async () => {
    const calls = captureFetch()
    await businessAssistant.suggestions({ route: '/ekip', allowAi: true })
    expect(calls[0].url).not.toContain('ai=')
  })

  it('store build is detected only from the Mac App Store shell flag', () => {
    expect(isStoreBuild()).toBe(false)
    vi.stubGlobal('window', { __BA_STORE__: true })
    expect(isStoreBuild()).toBe(true)
    vi.stubGlobal('window', { __BA_STORE__: 'true' })
    expect(isStoreBuild()).toBe(false)
  })

  it('reads how-to and data cards defensively', () => {
    expect(readHowTo({ id: 'x', title: 'T', steps: ['a', 3, 'b'], route: '/panel' })).toEqual({ id: 'x', title: 'T', steps: ['a', 'b'], route: '/panel', matchedBy: undefined })
    expect(readHowTo({ title: 'T' })).toBeNull()
    expect(readDataCard({ intent: 'Revenue', items: [{ method: 'Nakit' }, 'bad', null] })).toEqual({ intent: 'Revenue', items: [{ method: 'Nakit' }] })
    expect(readDataCard(null)).toBeNull()
  })

  it('stored history becomes a live reply; broken payload keeps the text', () => {
    const reply = storedToReply('c1', {
      id: 'm1', sender: 'assistant', text: 'Merhaba', kind: 'how_to', intent: 'HowTo', outcome: 'how_to', createdAtUtc: '2026-11-19T10:00:00Z',
      payloadJson: JSON.stringify({ data: { title: 'T', steps: ['a'] }, actions: [{ type: 'navigate', label: 'Aç', route: '/panel/kasa' }], suggestions: ['x', 1] }),
    })
    expect(reply.actions[0].route).toBe('/panel/kasa')
    expect(reply.suggestions).toEqual(['x'])
    expect(readHowTo(reply.data)?.steps).toEqual(['a'])

    const broken = storedToReply('c1', { id: 'm2', sender: 'assistant', text: 'Metin', kind: 'text', intent: 'Unknown', outcome: 'not_found', createdAtUtc: '', payloadJson: '{bozuk' })
    expect(broken.text).toBe('Metin')
    expect(broken.actions).toEqual([])
  })

  it('appreciation is only a standalone thanks', () => {
    expect(isAppreciation('Teşekkürler Maydi!')).toBe(true)
    expect(isAppreciation('çok teşekkür ederim')).toBe(true)
    expect(isAppreciation('teşekkürler, kasa nasıl kapatılır')).toBe(false)
  })
})
