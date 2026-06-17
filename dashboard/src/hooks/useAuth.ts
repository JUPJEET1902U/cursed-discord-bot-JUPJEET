import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'

export function useAuth() {
  const store = useAuthStore()
  return store
}

/**
 * Redirect to login if not authenticated.
 */
export function useRequireAuth() {
  const { isAuthenticated, isLoading, fetchMe } = useAuthStore()
  const navigate = useNavigate()

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      fetchMe().catch(() => {
        navigate('/login', { replace: true })
      })
    }
  }, [isAuthenticated, isLoading, fetchMe, navigate])

  return { isAuthenticated, isLoading }
}
