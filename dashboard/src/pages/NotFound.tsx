import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Home } from 'lucide-react'

export function NotFoundPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="text-center space-y-4">
        <div className="text-8xl">👹</div>
        <h1 className="text-4xl font-bold">404</h1>
        <p className="text-xl text-muted-foreground">Page not found</p>
        <p className="text-sm text-muted-foreground max-w-sm">
          Even CURSED can't find this page. It might have been deleted, moved, or never existed.
        </p>
        <Link to="/">
  <Button leftIcon={<Home />}>
    Go Home
  </Button>
</Link>
      </div>
    </div>
  )
}
