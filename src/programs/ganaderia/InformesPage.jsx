import { Link } from 'react-router-dom';
import { FileBarChart } from 'lucide-react';
import { useT } from '../../i18n/I18nContext';
import { PageTitle, Card } from './components';

// Informes: not built yet, and the page says so. It points to where the same
// numbers can be seen today.

export default function InformesPage() {
  const { t } = useT();
  return (
    <div className="animate-rise">
      <PageTitle>{t('lv.shell.reports')}</PageTitle>
      <Card className="mt-5 px-5 py-6 max-w-xl">
        <div className="flex items-center gap-3">
          <span className="w-11 h-11 rounded-xl bg-finca-lineSoft text-finca-ink2 flex items-center justify-center" aria-hidden="true"><FileBarChart size={22} /></span>
          <span className="inline-flex items-center h-7 px-3 rounded-full bg-finca-amber text-finca-amberInk text-[13px] font-semibold">{t('lv.shell.soon')}</span>
        </div>
        <h2 className="font-display text-[24px] mt-4">{t('lv.reports.title')}</h2>
        <p className="text-[15px] text-finca-ink2 mt-2">{t('lv.reports.body')}</p>
        <div className="flex flex-wrap gap-x-5 gap-y-1 mt-4">
          <Link to="/ganaderia" className="min-h-[44px] inline-flex items-center text-[15px] font-semibold text-finca-green underline underline-offset-2">{t('nav.lvHome')}</Link>
          <Link to="/ganaderia/eventos" className="min-h-[44px] inline-flex items-center text-[15px] font-semibold text-finca-green underline underline-offset-2">{t('nav.lvEvents')}</Link>
          <Link to="/ganaderia/lotes" className="min-h-[44px] inline-flex items-center text-[15px] font-semibold text-finca-green underline underline-offset-2">{t('lv.shell.lots')}</Link>
        </div>
      </Card>
    </div>
  );
}
