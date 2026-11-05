import { Link, useLocation } from 'react-router-dom';
import { Home, Tag, ClipboardList, MoreHorizontal, Plus } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useT } from '../../i18n/I18nContext';

// The phone's navigation, under the thumb: Inicio · Animales · Registrar ·
// Eventos · Más. Registrar is the raised clay button in the middle — the one
// thing done most in the corral. Hidden from 768 px, where the sidebar takes over.

function Item({ to, icon: Icon, label, onClick, active }) {
  const cls = cn('w-full h-16 flex flex-col items-center justify-center gap-1 text-[11px] font-semibold', active ? 'text-finca-forest' : 'text-finca-ink2');
  const body = (
    <>
      <span className={cn('w-12 h-7 rounded-full flex items-center justify-center', active && 'bg-finca-greenSoft')} aria-hidden="true">
        <Icon size={21} strokeWidth={active ? 2.4 : 2} />
      </span>
      <span>{label}</span>
    </>
  );
  if (onClick) return <button type="button" onClick={onClick} className={cls} aria-expanded={active} aria-haspopup="dialog">{body}</button>;
  return <Link to={to} className={cls} aria-current={active ? 'page' : undefined}>{body}</Link>;
}

export default function BottomNav({ onRegister, onMore, moreOpen }) {
  const { t } = useT();
  const { pathname } = useLocation();
  const on = (path, exact) => (exact ? pathname === path : pathname.startsWith(path));

  return (
    <nav aria-label={t('lv.shell.nav')} className="md:hidden fixed inset-x-0 bottom-0 z-40 h-nav bg-finca-surface border-t border-finca-line" data-testid="lv-bottom-nav">
      <ul className="grid grid-cols-5 h-16">
        <li><Item to="/ganaderia" icon={Home} label={t('nav.lvHome')} active={on('/ganaderia', true)} /></li>
        <li><Item to="/ganaderia/animales" icon={Tag} label={t('nav.lvAnimals')} active={on('/ganaderia/animales')} /></li>
        <li className="relative">
          <button type="button" onClick={onRegister} className="absolute left-1/2 -top-[30px] -ml-9 flex flex-col items-center" style={{ width: 72 }} data-testid="lv-register">
            <span className="w-14 h-14 rounded-full bg-finca-clay text-white flex items-center justify-center shadow-modal ring-4 ring-finca-paper" aria-hidden="true">
              <Plus size={28} strokeWidth={2.5} />
            </span>
            <span className="mt-1 text-[11px] font-bold text-finca-clayText">{t('lv.recordEvent')}</span>
          </button>
        </li>
        <li><Item to="/ganaderia/eventos" icon={ClipboardList} label={t('nav.lvEvents')} active={on('/ganaderia/eventos')} /></li>
        <li><Item icon={MoreHorizontal} label={t('lv.shell.more')} onClick={onMore} active={moreOpen} /></li>
      </ul>
    </nav>
  );
}
