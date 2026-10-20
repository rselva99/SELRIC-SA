import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../../contexts/AuthContext';
import { useT, LangToggle } from '../../i18n/I18nContext';
import PortalEditor from '../../components/PortalEditor';
import { LayoutTemplate } from 'lucide-react';

// One-step setup for a Simple-mode workspace that has not shaped its portal
// yet: pick the template that fits, adjust modules and names, done. Shown
// once (main.jsx sends an admin here while config.configured is false);
// everything here is editable later in Settings → Your portal.
export default function SetupPage() {
  const { organization, config, updateConfig } = useAuth();
  const { t } = useT();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);

  async function save(draft) {
    setSaving(true);
    try {
      await updateConfig(draft);
      toast.success(t('portal.setupDone'));
      navigate('/', { replace: true });
    } catch (err) {
      toast.error(err.message || t('settings.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-surface-50 px-4 py-8 sm:py-12">
      <div className="absolute top-5 right-5"><LangToggle /></div>
      <div className="max-w-3xl mx-auto">
        <div className="text-center">
          <span className="mx-auto w-12 h-12 rounded-2xl bg-brand-600 text-white flex items-center justify-center"><LayoutTemplate size={22} /></span>
          <h1 className="font-display text-3xl text-brand-950 mt-4">{t('portal.setupTitle', { business: organization?.name || '' })}</h1>
          <p className="text-surface-600 mt-2 max-w-xl mx-auto">{t('portal.setupBody')}</p>
        </div>
        <div className="card p-6 mt-8">
          <PortalEditor initial={config} onSave={save} saving={saving} compact submitLabel={t('portal.setupSubmit')} />
        </div>
        <p className="text-center text-xs text-surface-400 mt-4">{t('portal.setupNote')}</p>
      </div>
    </div>
  );
}
