import { useAuth } from '../contexts/AuthContext';
import { useT } from '../i18n/I18nContext';
import { MODULES } from '../lib/workspaceConfig';

// The name a workspace gave a module ("Pulperías" for customers), falling
// back to the translated default. Used by the sidebar and page titles.
export function useLabel() {
  const { config } = useAuth();
  const { t } = useT();
  return (moduleKey) => {
    const custom = config?.labels?.[moduleKey];
    if (custom) return custom;
    const m = MODULES.find((x) => x.key === moduleKey);
    return m ? t(m.labelKey) : moduleKey;
  };
}
