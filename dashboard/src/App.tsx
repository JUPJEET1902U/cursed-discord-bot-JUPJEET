import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { useEffect } from 'react'
import { SpeedInsights } from '@vercel/speed-insights/react'
import { useAuthStore } from '@/stores/authStore'
import { useUIStore } from '@/stores/uiStore'
import { Navbar } from '@/components/layout/Navbar'
import { Sidebar } from '@/components/layout/Sidebar'
import { ToastContainer } from '@/components/ui/Toast'
import { Loading } from '@/components/ui/Loading'
import { LoginPage } from '@/pages/Login'
import { ServerSelectorPage } from '@/pages/ServerSelector'
import { OverviewPage } from '@/pages/Overview'
import { BotConfigPage } from '@/pages/BotConfig'
import { AIConfigPage } from '@/pages/AIConfig'
import { WelcomeGoodbyePage } from '@/pages/WelcomeGoodbye'
import { StatisticsPage } from '@/pages/Statistics'
import { CommunityPage } from '@/pages/Community'
import { CustomRolesPage } from '@/pages/CustomRoles'
import { NotFoundPage } from '@/pages/NotFound'
import { cn } from '@/utils/cn'

function DashboardLayout() {
  const { sidebarOpen } = useUIStore()

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main
          className={cn(
            'flex-1 overflow-y-auto p-6 transition-all duration-200',
            'min-h-[calc(100vh-3.5rem)]',
          )}
        >
          <div className="max-w-5xl mx-auto">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, fetchMe, token } = useAuthStore()

  useEffect(() => {
    if (token) fetchMe()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) return <Loading fullPage text="Loading..." />
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/auth/callback" element={<LoginPage />} />

        <Route
          path="/dashboard"
          element={
            <RequireAuth>
              <DashboardLayout />
            </RequireAuth>
          }
        >
          <Route index element={<ServerSelectorPage />} />
          <Route path=":guildId/overview" element={<OverviewPage />} />
          <Route path=":guildId/statistics" element={<StatisticsPage />} />
          <Route path=":guildId/bot-config" element={<BotConfigPage />} />
          <Route path=":guildId/ai-config" element={<AIConfigPage />} />
          <Route path=":guildId/welcome" element={<WelcomeGoodbyePage />} />
          <Route path=":guildId/community" element={<CommunityPage />} />
          <Route path=":guildId/custom-roles" element={<CustomRolesPage />} />
          <Route path=":guildId/moderation" element={<BotConfigPage />} />
        </Route>

        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>

      <ToastContainer />
      <SpeedInsights />
    </BrowserRouter>
  )
}
