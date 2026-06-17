import { useState, useCallback } from 'react'
import { useUIStore } from '@/stores/uiStore'

interface UseAPIOptions<T> {
  onSuccess?: (data: T) => void
  onError?: (error: Error) => void
  successMessage?: string
  errorMessage?: string
}

/**
 * Generic hook for API calls with loading/error state and toast notifications.
 */
export function useAPI<T, Args extends unknown[]>(
  fn: (...args: Args) => Promise<T>,
  options: UseAPIOptions<T> = {},
) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<T | null>(null)
  const { addToast } = useUIStore()

  const execute = useCallback(
    async (...args: Args) => {
      setIsLoading(true)
      setError(null)
      try {
        const result = await fn(...args)
        setData(result)
        if (options.successMessage) {
          addToast({ type: 'success', title: options.successMessage })
        }
        options.onSuccess?.(result)
        return result
      } catch (err) {
        const message = err instanceof Error ? err.message : 'An error occurred'
        setError(message)
        addToast({
          type: 'error',
          title: options.errorMessage || 'Error',
          message,
        })
        options.onError?.(err instanceof Error ? err : new Error(message))
        throw err
      } finally {
        setIsLoading(false)
      }
    },
    [fn, options, addToast],
  )

  return { execute, isLoading, error, data }
}
