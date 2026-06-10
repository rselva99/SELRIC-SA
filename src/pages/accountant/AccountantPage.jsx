import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useData } from '../../contexts/DataContext';
import { formatCurrency } from '../../lib/utils';
import { generatePnLPdf, generateBalanceSheetPdf } from '../../lib/reports';
import Spinner from '../../components/ui/Spinner';
import toast from 'react-hot-toast';
import {
  Calculator, CheckCircle2, Circle, AlertCircle, Lock, ChevronRight,
  Upload, Tag, BookCheck, Repeat, Scale, Brain, FileBarChart, FileText,
  Download, Loader2, Inbox, ListChecks, Play, Maximize2,
} from 'lucide-react';
import CloseWizard, { CloseLauncher } from './CloseWizard';

const MONTHS_ABBR = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

const STEP_ICONS = {
  import_statements: Upload,
  categorize:        Tag,
  post:              BookCheck,
  journal_rules:     Repeat,
  reconcile:         Scale,
  review_balances:   Brain,
  generate_pl:       FileBarChart,
  generate_bs:       FileText,
  close:             Lock,
};

const STEP_LABELS = {
  import_statements: 'Import Bank Statements',
  categorize:        'Categorize All Transactions',
  post:              'Post All Transactions',
  journal_rules:     'Run Fixed Journal Entries',
  reconcile:         'Reconcile Accounts',
  review_balances:   'Review Account Balances',
  generate_pl:       'Generate P&L',
  generate_bs:       'Generate Balance Sheet',
  close:             'Close Period',
};

const REPORT_TYPE_LABELS = {
  pl:               'P&L',
  balance_sheet:    'Balance Sheet',
  income_statement: 'Income Statement',
  trial_balance:    'Trial Balance',
  account_analysis: 'Account Analysis',
  variance:         'Variance',
};

function periodLabel(period) {
  if (!period) return '';
  const [yr, mo] = period.split('-');
  return `${MONTHS_ABBR[parseInt(mo) - 1]}-${yr.slice(2)}`;
}

function periodFullLabel(period) {
  if (!period) return '';
  const [yr, mo] = period.split('-');
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${monthNames[parseInt(mo) - 1]} ${yr}`;
}

function periodRange(period) {
  const [yr, mo] = period.split('-');
  const lastDay = new Date(parseInt(yr), parseInt(mo), 0).getDate();
  return {
    start: `${yr}-${mo}-01`,
    end:   `${yr}-${mo}-${String(lastDay).padStart(2, '0')}`,
  };
}

const STATUS_STYLES = {
  closed:      { bg: 'bg-green-100 border-green-300', dot: 'bg-green-500', text: 'text-green-800', label: 'Closed'      },
  in_progress: { bg: 'bg-amber-100 border-amber-300', dot: 'bg-amber-500', text: 'text-amber-800', label: 'In Progress' },
  open:        { bg: 'bg-red-50 border-red-200',      dot: 'bg-red-500',   text: 'text-red-700',   label: 'Open'        },
  no_data:     { bg: 'bg-surface-50 border-surface-200', dot: 'bg-surface-300', text: 'text-surface-400', label: 'No Data' },
};

export default function AccountantPage() {
  const { user } = useAuth();
  const { accounts, categories, aiCategorizeUncategorized, getSignedUrl } = useData();
  const navigate = useNavigate();

  const today = new Date();
  const [year, setYear]                         = useState(today.getFullYear());
  const [selectedPeriod, setSelectedPeriod]     = useState(
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  );
  const [periodStatuses, setPeriodStatuses]     = useState({});
  const [checklist, setChecklist]               = useState(null);
  const [openItems, setOpenItems]               = useState(null);
  const [deliverables, setDeliverables]         = useState([]);
  const [actionBusy, setActionBusy]             = useState('');
  const [generating, setGenerating]             = useState('');
  const [showLauncher, setShowLauncher]         = useState(false);
  const [wizardPeriod, setWizardPeriod]         = useState(null);
  const [wizardMinimized, setWizardMinimized]   = useState(false);

  const periodsOfYear = useMemo(
    () => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`),
    [year]
  );

  // ── Period status detection ────────────────────────────────────────────────
  const loadPeriodStatuses = useCallback(async () => {
    const yearStart = `${year}-01-01`;
    const yearEnd   = `${year}-12-31`;

    const [{ data: txns }, { data: closes }, { data: cl }] = await Promise.all([
      supabase.from('transactions').select('date').gte('date', yearStart).lte('date', yearEnd),
      supabase.from('period_close').select('period, status').like('period', `${year}-%`),
      supabase.from('close_checklist').select('period, status').like('period', `${year}-%`).eq('status', 'done'),
    ]);

    const txnCountByPeriod = {};
    (txns || []).forEach(t => {
      const k = t.date.slice(0, 7);
      txnCountByPeriod[k] = (txnCountByPeriod[k] || 0) + 1;
    });

    const closeByPeriod = {};
    (closes || []).forEach(c => { closeByPeriod[c.period] = c.status; });

    const doneStepsByPeriod = {};
    (cl || []).forEach(r => { doneStepsByPeriod[r.period] = (doneStepsByPeriod[r.period] || 0) + 1; });

    const statuses = {};
    for (const p of periodsOfYear) {
      const closeStatus = closeByPeriod[p];
      if (closeStatus === 'closed') statuses[p] = 'closed';
      else if (!txnCountByPeriod[p]) statuses[p] = 'no_data';
      else if (closeStatus === 'in_progress' || doneStepsByPeriod[p]) statuses[p] = 'in_progress';
      else statuses[p] = 'open';
    }
    setPeriodStatuses(statuses);
  }, [year, periodsOfYear]);

  // ── Checklist for the selected period ──────────────────────────────────────
  const loadChecklist = useCallback(async () => {
    if (!selectedPeriod) return;
    setChecklist(null);
    const { start, end } = periodRange(selectedPeriod);

    const [
      stmtRes, uncatRes, unpostedRes, manualRes, unrecRes, plRes, bsRes, closeRes,
    ] = await Promise.all([
      supabase.from('bank_statements')
        .select('*', { count: 'exact', head: true })
        .lte('period_start', end).gte('period_end', start),

      supabase.from('transactions')
        .select('*', { count: 'exact', head: true })
        .gte('date', start).lte('date', end)
        .or('category.is.null,category.eq.'),

      supabase.from('transactions')
        .select('*', { count: 'exact', head: true })
        .gte('date', start).lte('date', end)
        .eq('posted', false).not('category', 'is', null).neq('category', ''),

      supabase.from('close_checklist').select('step_key, status').eq('period', selectedPeriod),

      supabase.from('transactions')
        .select('*', { count: 'exact', head: true })
        .gte('date', start).lte('date', end)
        .eq('type', 'debit').eq('reconciled', false),

      supabase.from('report_deliverables')
        .select('*', { count: 'exact', head: true })
        .eq('period', selectedPeriod).eq('report_type', 'pl'),

      supabase.from('report_deliverables')
        .select('*', { count: 'exact', head: true })
        .eq('period', selectedPeriod).eq('report_type', 'balance_sheet'),

      supabase.from('period_close').select('status').eq('period', selectedPeriod).maybeSingle(),
    ]);

    const manualByKey = {};
    (manualRes.data || []).forEach(r => { manualByKey[r.step_key] = r.status; });

    const stmtCount   = stmtRes.count   || 0;
    const uncatCount  = uncatRes.count  || 0;
    const unposted    = unpostedRes.count || 0;
    const unrecCount  = unrecRes.count  || 0;
    const plCount     = plRes.count     || 0;
    const bsCount     = bsRes.count     || 0;
    const closeStatus = closeRes.data?.status;

    const steps = [
      {
        key:    'import_statements',
        status: stmtCount > 0 ? 'done' : 'pending',
        detail: stmtCount > 0 ? `${stmtCount} statement${stmtCount !== 1 ? 's' : ''} cover this period` : 'No bank statement covers this period',
        actionLabel: 'Go to Bookkeeping',
        actionType:  'navigate',
        actionTarget: '/bookkeeping',
      },
      {
        key:    'categorize',
        status: uncatCount === 0 ? 'done' : 'pending',
        detail: uncatCount === 0 ? 'All categorized' : `${uncatCount} uncategorized`,
        actionLabel: uncatCount > 0 ? 'AI Categorize' : 'Done',
        actionType:  'ai_categorize',
        actionDisabled: uncatCount === 0,
        actionCount: uncatCount,
      },
      {
        key:    'post',
        status: unposted === 0 ? 'done' : 'pending',
        detail: unposted === 0 ? 'All posted' : `${unposted} ready to post`,
        actionLabel: unposted > 0 ? `Post All (${unposted})` : 'Done',
        actionType:  'post_all',
        actionDisabled: unposted === 0,
        actionCount: unposted,
      },
      {
        key:    'journal_rules',
        status: manualByKey.journal_rules === 'done' ? 'done' : 'pending',
        detail: manualByKey.journal_rules === 'done' ? 'Marked complete' : 'Review and run recurring journal rules',
        actionLabel: 'Generate & Review',
        actionType:  'navigate',
        actionTarget: '/journal',
        secondaryActionLabel: manualByKey.journal_rules === 'done' ? null : 'Mark Done',
        secondaryActionType: 'mark_done',
      },
      {
        key:    'reconcile',
        status: unrecCount === 0 ? 'done' : 'pending',
        detail: unrecCount === 0 ? 'All reconciled' : `${unrecCount} unreconciled debit transaction${unrecCount !== 1 ? 's' : ''}`,
        actionLabel: 'Go to Reconciliation',
        actionType:  'navigate',
        actionTarget: '/bookkeeping/reconcile',
      },
      {
        key:    'review_balances',
        status: manualByKey.review_balances === 'done' ? 'done' : 'pending',
        detail: manualByKey.review_balances === 'done' ? 'Reviewed' : 'AI analysis coming in next phase — review manually for now',
        actionLabel: manualByKey.review_balances === 'done' ? 'Done' : 'Mark Reviewed',
        actionType:  'mark_done',
        actionDisabled: manualByKey.review_balances === 'done',
      },
      {
        key:    'generate_pl',
        status: plCount > 0 ? 'done' : 'pending',
        detail: plCount > 0 ? 'Generated' : 'Not generated for this period',
        actionLabel: plCount > 0 ? 'Regenerate' : 'Generate P&L',
        actionType:  'generate_report',
        actionTarget: 'pl',
      },
      {
        key:    'generate_bs',
        status: bsCount > 0 ? 'done' : 'pending',
        detail: bsCount > 0 ? 'Generated' : 'Not generated for this period',
        actionLabel: bsCount > 0 ? 'Regenerate' : 'Generate Balance Sheet',
        actionType:  'generate_report',
        actionTarget: 'balance_sheet',
      },
      {
        key:    'close',
        status: closeStatus === 'closed' ? 'done' : 'pending',
        detail: closeStatus === 'closed' ? 'Period closed' : 'Complete all steps above to enable',
        actionLabel: closeStatus === 'closed' ? 'Reopen' : 'Close Period',
        actionType:  closeStatus === 'closed' ? 'reopen_period' : 'close_period',
      },
    ];

    // Close enabled only when all prior steps done
    const priorAllDone = steps.slice(0, -1).every(s => s.status === 'done');
    steps[steps.length - 1].actionDisabled = !priorAllDone && closeStatus !== 'closed';

    setChecklist(steps);
  }, [selectedPeriod]);

  // ── Open Items (cross-period) ──────────────────────────────────────────────
  const loadOpenItems = useCallback(async () => {
    const yearStart = `${year}-01-01`;
    const yearEnd   = `${year}-12-31`;
    const todayStr  = new Date().toISOString().slice(0, 10);

    const [uncatRes, unpostedRes, unrecRes, rulesRes, tasksRes] = await Promise.all([
      supabase.from('transactions').select('date')
        .gte('date', yearStart).lte('date', yearEnd)
        .or('category.is.null,category.eq.'),
      supabase.from('transactions').select('date')
        .gte('date', yearStart).lte('date', yearEnd)
        .eq('posted', false).not('category', 'is', null).neq('category', ''),
      supabase.from('transactions').select('*', { count: 'exact', head: true })
        .eq('type', 'debit').eq('reconciled', false),
      supabase.from('journal_rules').select('*', { count: 'exact', head: true }).eq('active', true),
      supabase.from('tasks').select('*', { count: 'exact', head: true })
        .eq('status', 'open').lt('due_date', todayStr),
    ]);

    const groupByPeriod = (rows) => {
      const m = {};
      (rows || []).forEach(r => { const k = r.date.slice(0, 7); m[k] = (m[k] || 0) + 1; });
      return Object.entries(m).sort(([a],[b]) => b.localeCompare(a));
    };

    setOpenItems({
      uncategorizedByPeriod: groupByPeriod(uncatRes.data),
      unpostedByPeriod:      groupByPeriod(unpostedRes.data),
      unreconciledTotal:     unrecRes.count || 0,
      activeRules:           rulesRes.count || 0,
      overdueTasks:          tasksRes.count || 0,
    });
  }, [year]);

  const loadDeliverables = useCallback(async () => {
    const { data } = await supabase
      .from('report_deliverables')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    setDeliverables(data || []);
  }, []);

  useEffect(() => { loadPeriodStatuses(); }, [loadPeriodStatuses]);
  useEffect(() => { loadChecklist(); },      [loadChecklist]);
  useEffect(() => { loadOpenItems(); },      [loadOpenItems]);
  useEffect(() => { loadDeliverables(); },   [loadDeliverables]);

  // ── Actions ────────────────────────────────────────────────────────────────
  async function runAction(step) {
    if (step.actionDisabled) return;
    const key = `${step.key}:${step.actionType}`;
    setActionBusy(key);
    try {
      switch (step.actionType) {
        case 'navigate':
          navigate(step.actionTarget);
          break;

        case 'ai_categorize': {
          const loadingId = toast.loading('Asking Claude to categorize…');
          const n = await aiCategorizeUncategorized(selectedPeriod);
          toast.dismiss(loadingId);
          if (n > 0) toast.success(`AI categorized ${n} transaction${n !== 1 ? 's' : ''}`);
          else toast('No new matches — try uploading more bank statements', { icon: 'ℹ️' });
          break;
        }

        case 'post_all': {
          if (!confirm(`Post ${step.actionCount} categorized transactions for ${periodLabel(selectedPeriod)}?`)) {
            setActionBusy('');
            return;
          }
          const { start, end } = periodRange(selectedPeriod);
          const { data: ids } = await supabase.from('transactions')
            .select('id')
            .gte('date', start).lte('date', end)
            .eq('posted', false).not('category', 'is', null).neq('category', '');
          if (!ids?.length) { toast('Nothing to post'); break; }
          const { error } = await supabase.from('transactions')
            .update({ posted: true }).in('id', ids.map(r => r.id));
          if (error) throw error;
          toast.success(`Posted ${ids.length} transactions`);
          break;
        }

        case 'mark_done': {
          const { error } = await supabase.from('close_checklist').upsert({
            period:       selectedPeriod,
            step_key:     step.key,
            status:       'done',
            completed_by: user?.id,
            completed_at: new Date().toISOString(),
          }, { onConflict: 'period,step_key' });
          if (error) throw error;
          await supabase.from('accountant_audit_log').insert({
            action: `step_${step.key}_done`,
            description: `Marked "${STEP_LABELS[step.key]}" complete for ${periodFullLabel(selectedPeriod)}`,
            period: selectedPeriod,
            performed_by: 'user',
            approved_by: user?.id,
          });
          toast.success('Marked complete');
          break;
        }

        case 'generate_report':
          await generateReport(step.actionTarget);
          break;

        case 'close_period': {
          if (!confirm(`Close ${periodFullLabel(selectedPeriod)}? This marks the period as closed.`)) {
            setActionBusy('');
            return;
          }
          const { error } = await supabase.from('period_close').upsert({
            period:    selectedPeriod,
            status:    'closed',
            closed_by: user?.id,
            closed_at: new Date().toISOString(),
          }, { onConflict: 'period' });
          if (error) throw error;
          await supabase.from('accountant_audit_log').insert({
            action: 'close_period',
            description: `Closed ${periodFullLabel(selectedPeriod)}`,
            period: selectedPeriod,
            performed_by: 'user',
            approved_by: user?.id,
          });
          toast.success(`${periodFullLabel(selectedPeriod)} closed`);
          break;
        }

        case 'reopen_period': {
          if (!confirm(`Reopen ${periodFullLabel(selectedPeriod)}?`)) { setActionBusy(''); return; }
          const { error } = await supabase.from('period_close')
            .update({ status: 'open', closed_by: null, closed_at: null })
            .eq('period', selectedPeriod);
          if (error) throw error;
          await supabase.from('accountant_audit_log').insert({
            action: 'reopen_period',
            description: `Reopened ${periodFullLabel(selectedPeriod)}`,
            period: selectedPeriod,
            performed_by: 'user',
            approved_by: user?.id,
          });
          toast.success(`${periodFullLabel(selectedPeriod)} reopened`);
          break;
        }
      }
      await Promise.all([loadChecklist(), loadPeriodStatuses(), loadOpenItems(), loadDeliverables()]);
    } catch (err) {
      console.error('action error:', err);
      toast.error(err.message || 'Action failed');
    } finally {
      setActionBusy('');
    }
  }

  async function runSecondaryAction(step) {
    if (step.secondaryActionType === 'mark_done') {
      await runAction({ ...step, actionType: 'mark_done', actionDisabled: false });
    }
  }

  // ── Report generation ──────────────────────────────────────────────────────
  async function generateReport(reportType) {
    setGenerating(reportType);
    try {
      const { start, end } = periodRange(selectedPeriod);
      const { data: txns, error } = await supabase.from('transactions')
        .select('*').gte('date', start).lte('date', end).eq('posted', true);
      if (error) throw error;

      let pdf;
      const label = periodFullLabel(selectedPeriod);
      if (reportType === 'pl' || reportType === 'income_statement') {
        const agg = aggregateForPnL(txns || []);
        pdf = generatePnLPdf(agg, label);
      } else if (reportType === 'balance_sheet') {
        const agg = aggregateForBS(txns || [], categories);
        pdf = generateBalanceSheetPdf(agg, label);
      } else {
        toast('That report type is coming soon', { icon: 'ℹ️' });
        return;
      }

      const blob = pdf.output('blob');
      const fileName = `${reportType}_${selectedPeriod}_${Date.now()}.pdf`;
      const path = `${selectedPeriod}/${fileName}`;

      const { error: upErr } = await supabase.storage.from('reports').upload(path, blob, {
        contentType: 'application/pdf',
      });
      if (upErr) throw upErr;

      const { error: insErr } = await supabase.from('report_deliverables').insert({
        period:       selectedPeriod,
        report_type:  reportType,
        file_url:     path,
        file_name:    fileName,
        generated_by: user?.id,
      });
      if (insErr) throw insErr;

      await supabase.from('accountant_audit_log').insert({
        action: `generate_${reportType}`,
        description: `Generated ${REPORT_TYPE_LABELS[reportType]} for ${label}`,
        period: selectedPeriod,
        performed_by: 'user',
        approved_by: user?.id,
      });

      toast.success(`${REPORT_TYPE_LABELS[reportType]} generated`);
      await Promise.all([loadDeliverables(), loadChecklist()]);
    } catch (err) {
      console.error('generate error:', err);
      toast.error(err.message || 'Failed to generate report');
    } finally {
      setGenerating('');
    }
  }

  async function downloadDeliverable(d) {
    try {
      const url = await getSignedUrl('reports', d.file_url);
      if (!url) throw new Error('Could not sign URL');
      window.open(url, '_blank');
    } catch (err) {
      toast.error(err.message || 'Could not download');
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const selectedStatus = periodStatuses[selectedPeriod] || 'open';
  const selectedStyle  = STATUS_STYLES[selectedStatus];

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Calculator size={26} className="text-brand-600" />
            Accountant
          </h1>
          <p className="text-surface-500 text-sm mt-0.5">
            Month-end close, reports, and the state of the books at a glance
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => setShowLauncher(true)}
            className="bg-gradient-to-r from-brand-600 to-green-600 text-white font-semibold text-sm px-4 py-2.5 rounded-lg shadow-md hover:shadow-lg hover:from-brand-700 hover:to-green-700 transition flex items-center gap-2"
          >
            <Play size={16} fill="currentColor" />
            Start Close Process
          </button>
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wider text-surface-500 font-semibold">Year</span>
            <select value={year} onChange={e => setYear(parseInt(e.target.value))} className="input-field w-auto">
              {[year - 2, year - 1, year, year + 1].filter((v, i, a) => a.indexOf(v) === i).map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Minimized wizard pill */}
      {wizardPeriod && wizardMinimized && (
        <button
          onClick={() => setWizardMinimized(false)}
          className="fixed bottom-4 right-4 z-50 bg-brand-600 text-white rounded-full shadow-2xl px-4 py-3 flex items-center gap-2 hover:bg-brand-700 transition"
        >
          <Maximize2 size={14} />
          <span className="text-sm font-semibold">Resume close: {periodLabel(wizardPeriod)}</span>
        </button>
      )}

      {/* Period status panel */}
      <div className="card p-4">
        <div className="text-xs uppercase tracking-wider text-surface-500 font-semibold mb-3">
          {year} Periods
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-12 gap-2">
          {periodsOfYear.map(p => {
            const status = periodStatuses[p] || 'open';
            const style  = STATUS_STYLES[status];
            const isSelected = p === selectedPeriod;
            return (
              <button
                key={p}
                onClick={() => setSelectedPeriod(p)}
                className={`relative border rounded-lg px-2 py-2 text-center transition-all ${style.bg} ${
                  isSelected ? 'ring-2 ring-brand-500 ring-offset-1' : 'hover:scale-105'
                }`}
              >
                <div className={`flex items-center justify-center gap-1.5 ${style.text}`}>
                  <span className={`w-2 h-2 rounded-full ${style.dot}`} />
                  <span className="font-mono text-xs font-bold">{periodLabel(p)}</span>
                </div>
                <div className={`text-[9px] uppercase tracking-wider mt-0.5 ${style.text} opacity-80`}>
                  {style.label}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected period banner */}
      <div className={`card p-4 flex items-center justify-between ${selectedStyle.bg} border-l-4`}
        style={{ borderLeftColor: 'currentColor' }}>
        <div className={selectedStyle.text}>
          <div className="text-xs uppercase tracking-wider opacity-70 font-semibold">Working on</div>
          <div className="font-display text-2xl">{periodFullLabel(selectedPeriod)}</div>
        </div>
        <div className={`flex items-center gap-2 ${selectedStyle.text}`}>
          <span className={`w-2.5 h-2.5 rounded-full ${selectedStyle.dot}`} />
          <span className="text-sm font-semibold uppercase tracking-wider">{selectedStyle.label}</span>
        </div>
      </div>

      {/* Main two-column grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Checklist */}
          <div className="card overflow-hidden">
            <div className="px-5 py-4 border-b border-surface-100 flex items-center justify-between">
              <h2 className="section-title flex items-center gap-2">
                <ListChecks size={18} />
                Monthly Close Checklist
              </h2>
              {checklist && (
                <span className="text-xs text-surface-500">
                  {checklist.filter(s => s.status === 'done').length} / {checklist.length} done
                </span>
              )}
            </div>
            {!checklist ? (
              <div className="flex justify-center py-12"><Spinner size="lg" /></div>
            ) : (
              <ul className="divide-y divide-surface-100">
                {checklist.map(step => {
                  const Icon  = STEP_ICONS[step.key] || Circle;
                  const busy  = actionBusy.startsWith(step.key + ':');
                  const done  = step.status === 'done';
                  return (
                    <li key={step.key} className="px-5 py-3 flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        done ? 'bg-green-100 text-green-700' : 'bg-surface-100 text-surface-500'
                      }`}>
                        {done ? <CheckCircle2 size={16} /> : <Icon size={16} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm text-surface-800">{STEP_LABELS[step.key]}</div>
                        <div className={`text-xs mt-0.5 ${done ? 'text-green-700' : 'text-surface-500'}`}>
                          {step.detail}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {step.secondaryActionLabel && (
                          <button
                            onClick={() => runSecondaryAction(step)}
                            disabled={busy}
                            className="btn-ghost text-xs px-3 py-1.5"
                          >
                            {step.secondaryActionLabel}
                          </button>
                        )}
                        <button
                          onClick={() => runAction(step)}
                          disabled={step.actionDisabled || busy}
                          className={`text-xs px-3 py-1.5 rounded-lg font-medium flex items-center gap-1.5 transition ${
                            step.actionDisabled
                              ? 'bg-surface-100 text-surface-400 cursor-not-allowed'
                              : step.key === 'close'
                                ? 'bg-brand-600 text-white hover:bg-brand-700'
                                : 'bg-surface-100 text-surface-700 hover:bg-surface-200'
                          }`}
                        >
                          {busy && <Loader2 size={12} className="animate-spin" />}
                          {step.actionLabel}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Deliverables */}
          <div className="card overflow-hidden">
            <div className="px-5 py-4 border-b border-surface-100 flex items-center justify-between">
              <h2 className="section-title">Deliverables</h2>
              <div className="flex gap-2 flex-wrap">
                {[
                  { type: 'pl',               label: 'Generate P&L' },
                  { type: 'balance_sheet',    label: 'Generate Balance Sheet' },
                  { type: 'income_statement', label: 'Income Statement' },
                ].map(opt => (
                  <button
                    key={opt.type}
                    onClick={() => generateReport(opt.type)}
                    disabled={!!generating}
                    className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5"
                  >
                    {generating === opt.type ? <Loader2 size={12} className="animate-spin" /> : <FileBarChart size={12} />}
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            {deliverables.length === 0 ? (
              <div className="px-5 py-12 text-center text-sm text-surface-500">
                <Inbox size={28} className="mx-auto text-surface-300 mb-2" />
                No reports generated yet
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-surface-100">
                      <th className="table-header">Period</th>
                      <th className="table-header">Type</th>
                      <th className="table-header">Generated</th>
                      <th className="table-header text-right">Download</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deliverables.map(d => (
                      <tr key={d.id} className="border-b border-surface-50 hover:bg-surface-50 transition">
                        <td className="table-cell font-mono text-xs">{periodLabel(d.period)}</td>
                        <td className="table-cell text-sm">{REPORT_TYPE_LABELS[d.report_type] || d.report_type}</td>
                        <td className="table-cell text-xs text-surface-500">
                          {new Date(d.created_at).toLocaleString()}
                        </td>
                        <td className="table-cell text-right">
                          <button onClick={() => downloadDeliverable(d)}
                            className="btn-ghost text-xs px-2 py-1 inline-flex items-center gap-1.5">
                            <Download size={12} /> PDF
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Launcher modal */}
        {showLauncher && (
          <CloseLauncher
            initialPeriod={selectedPeriod}
            periodStatuses={periodStatuses}
            onLaunch={(p) => { setShowLauncher(false); setWizardPeriod(p); setWizardMinimized(false); }}
            onCancel={() => setShowLauncher(false)}
          />
        )}

        {/* Wizard overlay */}
        {wizardPeriod && !wizardMinimized && (
          <CloseWizard
            period={wizardPeriod}
            onMinimize={() => setWizardMinimized(true)}
            onExit={async () => {
              setWizardPeriod(null);
              setWizardMinimized(false);
              await Promise.all([loadChecklist(), loadPeriodStatuses(), loadOpenItems(), loadDeliverables()]);
            }}
          />
        )}

        {/* Open Items panel */}
        <div className="lg:col-span-1">
          <div className="card overflow-hidden sticky top-4">
            <div className="px-5 py-4 border-b border-surface-100 flex items-center justify-between">
              <h2 className="section-title flex items-center gap-2">
                <AlertCircle size={18} className="text-amber-500" />
                Open Items
              </h2>
            </div>
            {!openItems ? (
              <div className="flex justify-center py-12"><Spinner /></div>
            ) : (
              <div className="p-4 space-y-4">
                <OpenItemGroup
                  title="Uncategorized by period"
                  items={openItems.uncategorizedByPeriod}
                  emptyText="All categorized ✓"
                  onItemClick={(p) => { setSelectedPeriod(p); }}
                />
                <OpenItemGroup
                  title="Unposted (categorized) by period"
                  items={openItems.unpostedByPeriod}
                  emptyText="All posted ✓"
                  onItemClick={(p) => { setSelectedPeriod(p); }}
                />
                <div className="space-y-1.5">
                  <Link to="/bookkeeping/reconcile"
                    className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-surface-50 transition text-sm">
                    <span className="text-surface-700">Unreconciled debits</span>
                    <span className={`font-mono font-semibold ${openItems.unreconciledTotal > 0 ? 'text-amber-700' : 'text-green-600'}`}>
                      {openItems.unreconciledTotal}
                    </span>
                  </Link>
                  <Link to="/journal"
                    className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-surface-50 transition text-sm">
                    <span className="text-surface-700">Active journal rules</span>
                    <span className="font-mono font-semibold text-surface-700">{openItems.activeRules}</span>
                  </Link>
                  <Link to="/tasks"
                    className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-surface-50 transition text-sm">
                    <span className="text-surface-700">Overdue tasks</span>
                    <span className={`font-mono font-semibold ${openItems.overdueTasks > 0 ? 'text-red-700' : 'text-green-600'}`}>
                      {openItems.overdueTasks}
                    </span>
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function OpenItemGroup({ title, items, emptyText, onItemClick }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-surface-500 font-semibold mb-1.5">{title}</div>
      {items.length === 0 ? (
        <div className="text-xs text-green-600 px-3 py-1.5">{emptyText}</div>
      ) : (
        <div className="space-y-0.5">
          {items.map(([period, count]) => (
            <button
              key={period}
              onClick={() => onItemClick(period)}
              className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg hover:bg-surface-50 transition text-sm"
            >
              <span className="font-mono text-xs text-surface-600">{periodLabel(period)}</span>
              <div className="flex items-center gap-1.5">
                <span className="font-mono font-semibold text-amber-700">{count}</span>
                <ChevronRight size={12} className="text-surface-300" />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── PDF aggregation helpers ──────────────────────────────────────────────────
function aggregateForPnL(transactions) {
  const revByCat = {};
  const expByCat = {};
  for (const t of transactions) {
    const cat = t.category || 'Uncategorized';
    if (t.type === 'credit' || cat.startsWith('Revenue')) {
      revByCat[cat] = (revByCat[cat] || 0) + Math.abs(t.amount);
    } else if (t.type === 'debit') {
      expByCat[cat] = (expByCat[cat] || 0) + Math.abs(t.amount);
    }
  }
  const revenue       = Object.entries(revByCat).sort((a,b) => b[1] - a[1]).map(([account, amount]) => ({ account, amount }));
  const expenses      = Object.entries(expByCat).sort((a,b) => b[1] - a[1]).map(([account, amount]) => ({ account, amount }));
  const totalRevenue  = revenue.reduce((s, r) => s + r.amount, 0);
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
  return { revenue, expenses, totalRevenue, totalExpenses };
}

// Aggregates by category name (the chart of accounts the user actually maintains).
// Transactions written under the categories workaround have account_id=null and
// the chart-of-accounts label in the `category` text column, so we group by that.
function aggregateForBS(transactions, categories) {
  const balanceByCat = {};
  for (const t of transactions) {
    const cat = t.category;
    if (!cat) continue;
    const delta = t.type === 'credit' ? -Math.abs(t.amount) : Math.abs(t.amount);
    balanceByCat[cat] = (balanceByCat[cat] || 0) + delta;
  }
  const sections = { asset: [], liability: [], equity: [] };
  for (const c of categories || []) {
    const bal = balanceByCat[c.name] || 0;
    if (bal === 0) continue;
    const bucket = sections[(c.type || '').toLowerCase()];
    if (bucket) bucket.push({ account: c.name, amount: bal });
  }
  return {
    assets:           sections.asset,
    liabilities:      sections.liability,
    equity:           sections.equity,
    totalAssets:      sections.asset.reduce((s, x) => s + x.amount, 0),
    totalLiabilities: sections.liability.reduce((s, x) => s + x.amount, 0),
    totalEquity:      sections.equity.reduce((s, x) => s + x.amount, 0),
  };
}
