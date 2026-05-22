import { cn } from '../../lib/utils';

export default function StatCard({ icon: Icon, label, value, sublabel, trend, className }) {
  return (
    <div className={cn('card p-5', className)}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-surface-500 uppercase tracking-wider">{label}</p>
          <p className="stat-value mt-1">{value}</p>
          {sublabel && <p className="text-xs text-surface-500 mt-1">{sublabel}</p>}
        </div>
        {Icon && (
          <div className="w-10 h-10 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center">
            <Icon size={20} />
          </div>
        )}
      </div>
      {trend && (
        <div className={cn('mt-3 text-xs font-medium', trend >= 0 ? 'text-green-600' : 'text-red-600')}>
          {trend >= 0 ? '↑' : '↓'} {Math.abs(trend)}% vs last period
        </div>
      )}
    </div>
  );
}
