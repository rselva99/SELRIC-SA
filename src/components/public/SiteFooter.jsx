import { Link } from 'react-router-dom';
import { useT } from '../../i18n/I18nContext';
import { PROGRAMS } from '../../programs';

export default function SiteFooter() {
  const { t } = useT();
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-surface-200">
      <div className="max-w-6xl mx-auto px-5 sm:px-8 py-10 grid gap-8 md:grid-cols-[1.2fr_1fr_1fr] text-sm text-surface-500">
        <div>
          <div className="flex items-center gap-2.5 text-surface-800">
            <span className="w-6 h-6 rounded bg-brand-600 text-white font-display text-xs flex items-center justify-center">S</span>
            <span className="font-display text-base">SelRic</span>
          </div>
          <p className="mt-3 max-w-[28rem]">{t('site.heroEyebrow')}</p>
          <p className="mt-2">{t('landing.footerCompany')}</p>
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-surface-400">{t('site.navPrograms')}</div>
          <ul className="mt-3 space-y-2">
            {PROGRAMS.map((p) => (
              <li key={p.key}><Link to={`/programs/${p.key}`} className="hover:text-brand-700">{t(`programs.${p.key}.name`)}</Link></li>
            ))}
          </ul>
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-surface-400">SelRic</div>
          <ul className="mt-3 space-y-2">
            <li><Link to="/#how-it-works" className="hover:text-brand-700">{t('site.navHow')}</Link></li>
            <li><Link to="/#who-we-are" className="hover:text-brand-700">{t('site.navWho')}</Link></li>
            <li><Link to="/#pricing" className="hover:text-brand-700">{t('site.navPricing')}</Link></li>
            <li><Link to="/#waitlist" className="hover:text-brand-700">{t('landing.joinWaitlist')}</Link></li>
            <li><Link to="/login" className="hover:text-brand-700">{t('common.signIn')}</Link></li>
          </ul>
        </div>
      </div>
      <div className="max-w-6xl mx-auto px-5 sm:px-8 pb-8 text-xs text-surface-400">&copy; {year} SelRic LLC</div>
    </footer>
  );
}
