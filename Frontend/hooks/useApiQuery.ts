'use client'

import { useCallback, useEffect, useState, useSyncExternalStore, type DependencyList } from 'react'
import { getApiScopeEpoch, subscribeApiScope } from '@/lib/apiClient'

export interface UseApiQueryOptions<T> {
  initialData?: T | null
  enabled?: boolean
  clearOnError?: boolean
}

export interface UseApiQueryResult<T> {
  data: T | null
  loading: boolean
  error: string
  reload: () => Promise<T | null>
  setData: (value: T | null) => void
}

export function useApiQuery<T>(
  loader: () => Promise<T>,
  deps: DependencyList = [],
  options: UseApiQueryOptions<T> = {},
): UseApiQueryResult<T> {
  const initial = options.initialData ?? null
  const [data, setData] = useState<T | null>(initial)
  const [loading, setLoading] = useState<boolean>(Boolean(options.enabled ?? true))
  const [error, setError] = useState<string>('')
  // Aktif tenant/şube kapsamı değişince (örn. navbar'dan şube değiştirince) tüm sorgular yeniden çalışsın.
  const scopeEpoch = useSyncExternalStore(subscribeApiScope, getApiScopeEpoch, getApiScopeEpoch)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(async (): Promise<T | null> => {
    if (options.enabled === false) {
      setLoading(false)
      return null
    }
    setLoading(true)
    setError('')
    try {
      const result = await loader()
      setData(result)
      return result
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'API verisi alınamadı.'
      setError(message || 'API verisi alınamadı.')
      if (options.clearOnError !== false) setData(initial)
      return null
    } finally {
      setLoading(false)
    }
  }, [...deps, scopeEpoch])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    let cancelled = false
    const execute = async (): Promise<void> => {
      if (options.enabled === false) {
        if (!cancelled) setLoading(false)
        return
      }
      setLoading(true)
      setError('')
      try {
        const result = await loader()
        if (!cancelled) setData(result)
      } catch (err: unknown) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'API verisi alınamadı.'
          setError(message || 'API verisi alınamadı.')
          if (options.clearOnError !== false) setData(initial)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    execute()
    return () => {
      cancelled = true
    }
  }, [...deps, scopeEpoch])

  return { data, loading, error, reload: run, setData }
}
