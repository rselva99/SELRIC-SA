import { Link } from 'react-router-dom';
import { MoreHorizontal } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useT } from '../../i18n/I18nContext';

// The Business phone navigation, under the thumb: the four places an owner
// goes most (by mode — see PHONE_ORDER in AppLayout) and More, which opens
// the full sidebar as a drawer. Hidden from 768 px, where the header's menu
// button and, from 1024 px, the sidebar take over.

function Item({ to, icon: Icon, label, active, onClick, expanded }) {
  const cls = cn('w-full h-16 flex flex-col items-center justify-center gap-1 px-1 text-[11px] font-medium', active ? 'text-brand-700' : 'text-surface-500');
  const body = (
    <>
      <span className={cn('w-12 h-7 rounded-full flex items-center justify-center', active && 'bg-brand-50')} aria-hidden="true">
        <Icon size={20} strokeWidth={active ? 2.4 : 2} />
      </span>
      <span className="max-w-full truncate">{label}</span>
    </>
  );
  if (onClick) return <button type="button" onClick={onClick} className={cls} aria-expanded={expanded} aria-haspopup="dialog">{body}</button>;
  return <Link to={to} className={cls} aria-current={active ? 'page' : undefined}>{body}</Link>;
}

export default function BusinessBottomNav({ items, labelOf, isActive, onMore, moreOpen }) {
  const { t } = useT();
  return (
    <nav aria-label={t('nav.bottom')} className="md:hidden fixed inset-x-0 bottom-0 z-30 h-nav bg-white border-t border-surface-200" data-testid="biz-bottom-nav">
      <ul className="grid h-16" style={{ gridTemplateColumns: `repeat(${items.length + 1}, minmax(0, 1fr))` }}>
        {items.map((item) => (
          <li key={item.path}><Item to={item.path} icon={item.icon} label={labelOf(item)} active={isActive(item)} /></li>
        ))}
        <li><Item icon={MoreHorizontal} label={t('nav.more')} onClick={onMore} expanded={moreOpen} /></li>
      </ul>
    </nav>
  );
}
