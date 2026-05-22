import { cn } from '../../lib/utils';

export default function EmptyState({ icon: Icon, title, description, action, className }) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16 px-4 text-center', className)}>
      {Icon && (
        <div className="w-14 h-14 rounded-2xl bg-surface-100 text-surface-400 flex items-center justify-center mb-4">
          <Icon size={28} />
        </div>
      )}
      <h3 className="font-display text-lg text-surface-700">{title}</h3>
      {description && <p className="text-sm text-surface-500 mt-1.5 max-w-sm">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
