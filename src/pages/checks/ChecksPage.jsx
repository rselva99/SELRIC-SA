import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ShieldCheck, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useT } from '../../i18n/I18nContext';
import { formatCurrency, formatDate, cn } from '../../lib/utils';
import { BUSINESS_CHECKS, healthScore, runChecks } from '../../lib/checks/index.js';
import { fetchBusinessData } from '../../lib/checks/fetch.js';
import { loadLatest, saveResults } from '../../lib/checks/store.js';
import EmptyState from '../../components/ui/EmptyState';
import { HealthTile, StatusChip, statusOf } from './parts';

// /checks — the integrity checks of the books (src/lib/checks). Shows the
// newest stored run per check; "Run checks now" runs them in the browser over
// this workspace's rows (RLS limits the reads to it) and saves the run. Until
// the integrity tables exist the run is shown but not saved, and the page
// says so; with no run at all it says "no checks have run yet".

function CheckRow({ check, result, open, onToggle }) {
  const { t } = useT();
  const status = statusOf(result);
  const rows = result?.detail?.rows || [];
  const more = (result?.detail?.total || 0) - rows.length;
  const id = `check-${check.key}`;
  return (
    <li className="border-b border-surface-100 last:border-0">
      <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={id}
        className="w-full flex items-start sm:items-center gap-3 px-4 py-3 text-left hover:bg-surface-50 transition min-h-[44px]">
        <StatusChip status={status} />
        <span className="flex-1 min-w-0 text-sm text-surface-800">{t(`checks.items.${check.key}.name`)}</span>
        {result && !result.detail?.skipped && result.count > 0 && (
          <span className="hidden sm:block text-xs text-surface-500 tabular-nums whitespace-nowrap">
            {t('checks.count', { n: result.count })}{result.amount ? ` · ${formatCurrency(result.amount)}` : ''}
          </span>
        )}
        <ChevronDown size={16} aria-hidden="true" className={cn('shrink-0 text-surface-400 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div id={id} className="px-4 pb-4 -mt-1 space-y-3">
          {result && !result.detail?.skipped && result.count > 0 && (
            <p className="sm:hidden text-xs text-surface-500 tabular-nums">{t('checks.count', { n: result.count })}{result.amount ? ` · ${formatCurrency(result.amount)}` : ''}</p>
          )}
          {result?.detail?.skipped && <p className="text-sm text-surface-500">{t(`checks.skipped.${result.detail.skipped}`)}</p>}
          {result?.detail?.error && <p className="text-sm text-red-700">{t('checks.checkError', { msg: result.detail.error })}</p>}
          <div className="rounded-lg bg-surface-50 px-3 py-2">
            <p className="text-xs font-medium text-surface-500 uppercase tracking-wider">{t('checks.whatToDo')}</p>
            <p className="text-sm text-surface-700 mt-0.5">{t(`checks.items.${check.key}.action`)}</p>
          </div>
          {status !== 'none' && status !== 'skipped' && status !== 'green' && (
            <div>
              <p className="text-xs font-medium text-surface-500 uppercase tracking-wider mb-1">{t('checks.rowsTitle')}</p>
              {rows.length ? (
                <ul className="divide-y divide-surface-100 rounded-lg border border-surface-200 bg-white">
                  {rows.map((r) => (
                    <li key={`${r.id}-${r.pair || ''}`} className="flex items-baseline gap-3 px-3 py-2 text-sm">
                      <span className="w-24 shrink-0 text-xs text-surface-500 tabular-nums">{r.date ? formatDate(r.date, 'dd MMM yyyy') : '—'}</span>
                      <span className="flex-1 min-w-0 break-words text-surface-700">{r.text}</span>
                      <span className="shrink-0 tabular-nums text-surface-800">{formatCurrency(r.amount)}</span>
                    </li>
                  ))}
                  {more > 0 && <li className="px-3 py-2 text-xs text-surface-500">{t('checks.moreRows', { n: more })}</li>}
                </ul>
              ) : <p className="text-sm text-surface-500">{t('checks.noRows')}</p>}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export default function ChecksPage() {
  const { organization } = useAuth();
  const { t } = useT();
  const orgId = organization?.id;
  const [stored, setStored] = useState({ byCheck: new Map(), runAt: null, missing: false, loaded: false });
  const [live, setLive] = useState(null);       // { byKey, runAt, saved, missing }
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(() => new Set());

  useEffect(() => {
    if (!orgId) return;
    let alive = true;
    loadLatest(supabase, orgId)
      .then((s) => { if (alive) setStored({ ...s, loaded: true }); })
      .catch((e) => { if (alive) { setStored((x) => ({ ...x, loaded: true })); setError(String(e?.message || e)); } });
    return () => { alive = false; };
  }, [orgId]);

  const run = useCallback(async () => {
    if (!orgId) return;
    setRunning(true); setError(null);
    try {
      const data = await fetchBusinessData(supabase, orgId);
      const results = runChecks(data, { program: 'business' });
      const s = await saveResults(supabase, { orgId, results });
      setLive({ byKey: new Map(results.map((r) => [r.key, r])), runAt: s.runAt || new Date().toISOString(), missing: s.missing });
      setOpen(new Set(results.filter((r) => r.status !== 'green').map((r) => r.key)));
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setRunning(false);
    }
  }, [orgId]);

  const byKey = live?.byKey || new Map([...stored.byCheck].map(([k, r]) => [k, { key: k, ...r }]));
  const runAt = live?.runAt || stored.runAt;
  const results = useMemo(() => BUSINESS_CHECKS.map((c) => byKey.get(c.key)).filter(Boolean), [byKey]);
  const health = results.length ? healthScore(results) : null;
  const toggle = (k) => setOpen((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  return (
    <div className="animate-fade-in max-w-4xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="min-w-0">
          <h1 className="page-title">{t('checks.title')}</h1>
          <p className="text-surface-500 text-sm mt-0.5">{t('checks.subtitle')}</p>
        </div>
        <button type="button" onClick={run} disabled={running || !orgId} className="btn-primary flex items-center justify-center gap-2 min-h-[44px]">
          <RefreshCw size={16} aria-hidden="true" className={running ? 'motion-safe:animate-pulse' : ''} /> {running ? t('checks.running') : t('checks.runNow')}
        </button>
      </div>

      {error && <div role="alert" className="mb-4 rounded-lg bg-red-50 text-red-800 text-sm px-4 py-3">{t('checks.runFailed', { msg: error })}</div>}
      {live?.missing && <div role="status" className="mb-4 rounded-lg bg-amber-50 text-amber-900 text-sm px-4 py-3">{t('checks.notSaved')}</div>}

      <HealthTile health={health} runAt={runAt} className="mb-4" />

      {stored.loaded && !results.length && !running && (
        <div className="card mb-4">
          <EmptyState icon={ShieldCheck} title={t('checks.noRunsTitle')} description={t('checks.noRunsBody')} action={{ label: t('checks.runNow'), onClick: run }} />
        </div>
      )}

      <ul className="card overflow-hidden" aria-label={t('checks.title')}>
        {BUSINESS_CHECKS.map((c) => (
          <CheckRow key={c.key} check={c} result={byKey.get(c.key)} open={open.has(c.key)} onToggle={() => toggle(c.key)} />
        ))}
      </ul>
    </div>
  );
}
