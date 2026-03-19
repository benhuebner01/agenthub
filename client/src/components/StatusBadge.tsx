import clsx from 'clsx'

type Status = string

interface StatusBadgeProps {
  status: Status
  className?: string
}

const statusConfig: Record<
  string,
  { label: string; className: string; pulse?: boolean }
> = {
  active: { label: 'Active', className: 'bg-green-500/20 text-green-400 border-green-500/30' },
  enabled: { label: 'Enabled', className: 'bg-green-500/20 text-green-400 border-green-500/30' },
  success: { label: 'Success', className: 'bg-green-500/20 text-green-400 border-green-500/30' },
  paused: { label: 'Paused', className: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
  pending: { label: 'Pending', className: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
  disabled: { label: 'Disabled', className: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
  error: { label: 'Error', className: 'bg-red-500/20 text-red-400 border-red-500/30' },
  failed: { label: 'Failed', className: 'bg-red-500/20 text-red-400 border-red-500/30' },
  cancelled: { label: 'Cancelled', className: 'bg-red-500/20 text-red-400 border-red-500/30' },
  running: {
    label: 'Running',
    className: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    pulse: true,
  },
}

export default function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusConfig[status] ?? {
    label: status,
    className: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
  }

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border',
        config.className,
        className
      )}
    >
      {config.pulse && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-400" />
        </span>
      )}
      {config.label}
    </span>
  )
}
