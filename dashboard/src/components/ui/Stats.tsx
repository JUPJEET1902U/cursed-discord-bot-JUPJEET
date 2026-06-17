import { cn } from '@/utils/cn'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { formatCompact } from '@/utils/formatting'

interface StatCardProps {
  title: string
  value: number | string
  icon?: React.ReactNode
  trend?: number // percentage change
  description?: string
  color?: 'default' | 'green' | 'yellow' | 'red' | 'blue' | 'purple'
  className?: string
}

const colorClasses = {
  default: 'text-foreground',
  green: 'text-green-400',
  yellow: 'text-yellow-400',
  red: 'text-red-400',
  blue: 'text-blue-400',
  purple: 'text-purple-400',
}

const bgClasses = {
  default: 'bg-muted',
  green: 'bg-green-500/10',
  yellow: 'bg-yellow-500/10',
  red: 'bg-red-500/10',
  blue: 'bg-blue-500/10',
  purple: 'bg-purple-500/10',
}

export function StatCard({
  title,
  value,
  icon,
  trend,
  description,
  color = 'default',
  className,
}: StatCardProps) {
  const displayValue = typeof value === 'number' ? formatCompact(value) : value

  return (
    <div className={cn('stat-card', className)}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-muted-foreground font-medium truncate">{title}</p>
          <p className={cn('text-2xl font-bold mt-1', colorClasses[color])}>{displayValue}</p>
          {description && (
            <p className="text-xs text-muted-foreground mt-1">{description}</p>
          )}
          {trend !== undefined && (
            <div className="flex items-center gap-1 mt-2">
              {trend > 0 ? (
                <TrendingUp className="h-3 w-3 text-green-400" />
              ) : trend < 0 ? (
                <TrendingDown className="h-3 w-3 text-red-400" />
              ) : (
                <Minus className="h-3 w-3 text-muted-foreground" />
              )}
              <span
                className={cn(
                  'text-xs font-medium',
                  trend > 0 ? 'text-green-400' : trend < 0 ? 'text-red-400' : 'text-muted-foreground',
                )}
              >
                {trend > 0 ? '+' : ''}{trend}%
              </span>
              <span className="text-xs text-muted-foreground">vs last week</span>
            </div>
          )}
        </div>
        {icon && (
          <div className={cn('p-2.5 rounded-lg shrink-0 ml-4', bgClasses[color])}>
            <div className={cn('h-5 w-5', colorClasses[color])}>{icon}</div>
          </div>
        )}
      </div>
    </div>
  )
}
