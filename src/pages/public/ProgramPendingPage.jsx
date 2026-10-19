import { useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useT, LangToggle } from '../../i18n/I18nContext';
import { accentOf } from '../../programs';

// Shown after sign-in to a workspace whose program is not built yet (for
// example a Ganadería pilot invite used before that program ships). Each
// SelRic program is its own workspace, so there is nothing else to show.
export default function ProgramPendingPage({ program }) {
  const { organization, signOut } = useAuth();
  const { t } = useT();
  const navigate = useNavigate();
  const a = accentOf(program);
  const name = t(`programs.${program.key}.name`);

  async function handleSignOut() {
    await signOut();
    navigate('/login');
  }

  return (
    <div className="min-h-screen bg-surface-50 flex items-center justify-center px-6 py-12 relative">
      <div className="absolute top-5 right-5"><LangToggle /></div>
      <div className="w-full max-w-md card p-8 text-center">
        <span className={`mx-auto w-14 h-14 rounded-2xl flex items-center justify-center ${a.tile}`}><program.icon size={26} /></span>
        <h1 className="font-display text-2xl text-brand-950 mt-5">{t('pending.title', { program: name })}</h1>
        <p className="text-surface-600 mt-3 leading-relaxed">
          {t('pending.body', { business: organization?.name || '' })}
        </p>
        <button type="button" onClick={handleSignOut} className="btn-secondary mt-8">
          <LogOut size={16} /> {t('common.signOut')}
        </button>
      </div>
    </div>
  );
}
