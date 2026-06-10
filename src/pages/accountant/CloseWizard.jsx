import { Fragment, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useData } from '../../contexts/DataContext';
import { formatCurrency, formatDate } from '../../lib/utils';
import { generatePnLPdf, generateBalanceSheetPdf } from '../../lib/reports';
import { aggregateForPnL, aggregateForBS, pickableCategories } from '../../lib/finance';
import PayrollJournalForm from '../../components/PayrollJournalForm';
import Spinner from '../../components/ui/Spinner';
import toast from 'react-hot-toast';
import {
  X, Minimize2, ChevronLeft, ChevronRight, Play, Trophy, Zap,
  CheckCircle2, SkipForward, AlertCircle, FileBarChart, FileText,
  Sparkles, Flame, Loader2, Plus, Trash2, RotateCw, Pencil,
} from 'lucide-react';

// ─── Period helpers ────────────────────────────────────────────────────────
const MONTHS_ABBR = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const MONTHS_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function periodLabel(p)     { const [y,m] = p.split('-'); return `${MONTHS_ABBR[+m-1]}-${y.slice(2)}`; }
function periodFullLabel(p) { const [y,m] = p.split('-'); return `${MONTHS_FULL[+m-1]} ${y}`; }
function periodRange(p) {
  const [y,m] = p.split('-');
  const last = new Date(+y, +m, 0).getDate();
  return { start: `${y}-${m}-01`, end: `${y}-${m}-${String(last).padStart(2,'0')}` };
}
function prevPeriod(p) {
  const [y,m] = p.split('-').map(Number);
  return m === 1 ? `${y-1}-12` : `${y}-${String(m-1).padStart(2,'0')}`;
}

// ─── Step definitions ──────────────────────────────────────────────────────
const STEPS = [
  { key: 'categorize',       title: 'Review Imported Transactions', subtitle: 'Categorize anything Claude or the rules missed', avgMinutes: 4 },
  { key: 'post',             title: 'Post Transactions',            subtitle: 'Move categorized entries into the ledger',     avgMinutes: 1 },
  { key: 'journal_rules',    title: 'Run Journal Rules',            subtitle: 'Execute recurring journal entries',            avgMinutes: 2 },
  { key: 'manual_journals',  title: 'Review Manual Journals',       subtitle: 'Resolve any draft journal entries',            avgMinutes: 2 },
  { key: 'reconcile',        title: 'Reconcile',                    subtitle: 'Match invoices to bank transactions',          avgMinutes: 4 },
  { key: 'payroll',          title: 'Payroll Journal Entry',        subtitle: 'Capture check/other payroll on top of Venmo/CashApp', avgMinutes: 2 },
  { key: 'review_balances',  title: 'Account Balance Review',       subtitle: 'Check each account balance looks right',       avgMinutes: 3 },
  { key: 'generate_pl',      title: 'Generate P&L',                 subtitle: 'Profit & Loss for the period',                 avgMinutes: 1 },
  { key: 'generate_bs',      title: 'Generate Balance Sheet',       subtitle: 'Balance sheet snapshot',                       avgMinutes: 1 },
  { key: 'close',            title: 'Close Period',                 subtitle: 'Lock the books and celebrate',                 avgMinutes: 1 },
];

// ─── CSS confetti (CSP allows only self-hosted scripts) ────────────────────
function fireConfetti() {
  const colors = ['#fbbf24','#34d399','#60a5fa','#f472b6','#a78bfa','#fb923c'];
  const root = document.createElement('div');
  root.className = 'pointer-events-none fixed inset-0 z-[10000] overflow-hidden';
  document.body.appendChild(root);
  for (let i = 0; i < 120; i++) {
    const piece = document.createElement('div');
    const c = colors[Math.floor(Math.random() * colors.length)];
    const left = Math.random() * 100;
    const dur = 2.2 + Math.random() * 2.2;
    const delay = Math.random() * 0.4;
    const rot = Math.random() * 720 - 360;
    const sway = (Math.random() * 60 - 30);
    piece.style.cssText = `
      position:absolute; top:-14px; left:${left}%;
      width:8px; height:14px; background:${c};
      transform: translateX(0) rotate(0deg);
      animation: cw-confetti ${dur}s ${delay}s cubic-bezier(.25,.46,.45,.94) forwards;
      --sway:${sway}px; --rot:${rot}deg;
      border-radius:2px;
    `;
    root.appendChild(piece);
  }
  setTimeout(() => root.remove(), 6000);
}

// ─── Achievement helpers ───────────────────────────────────────────────────
function fireAchievement(name, description, iconEmoji = '🏆') {
  toast.success(
    <div className="flex flex-col">
      <div className="font-semibold text-sm">{iconEmoji} Achievement: {name}</div>
      <div className="text-xs opacity-80 mt-0.5">{description}</div>
    </div>,
    { duration: 4500 }
  );
}

// ===========================================================================
// MAIN CLOSE WIZARD
// ===========================================================================
export default function CloseWizard({ period, onExit, onMinimize }) {
  const { user } = useAuth();
  const { categories, accounts } = useData();
  const navigate = useNavigate();

  const [stepIdx, setStepIdx]               = useState(0);
  const [direction, setDirection]           = useState('next');
  const [stepData, setStepData]             = useState({});
  const [stepLoading, setStepLoading]       = useState(false);
  const [loadedStepKey, setLoadedStepKey]   = useState('');
  const [completing, setCompleting]         = useState(false);
  const [accountsReviewed, setAccountsReviewed] = useState(new Set());
  const [achievementsEarned, setAchievements]   = useState(new Set());
  const [skipped, setSkipped]                   = useState(new Set());
  const [streak, setStreak]                     = useState(0);
  const [showExitConfirm, setShowExitConfirm]   = useState(false);
  const [finalStats, setFinalStats]             = useState(null);

  const startedAtRef     = useRef(Date.now());
  const stepStartedAtRef = useRef(Date.now());
  // Each loadStepData call gets an incrementing id. Only the latest call is
  // allowed to commit results — protects against a stale categorize-step fetch
  // overwriting the payroll step's loadedStepKey and stranding the UI on the
  // wizard's full-step spinner.
  const loadRequestIdRef = useRef(0);

  const { start: periodStart, end: periodEnd } = useMemo(() => periodRange(period), [period]);
  const currentStep = STEPS[stepIdx];

  // ── Inject confetti keyframes once ──
  useEffect(() => {
    if (document.getElementById('cw-confetti-keyframes')) return;
    const style = document.createElement('style');
    style.id = 'cw-confetti-keyframes';
    style.textContent = `
      @keyframes cw-confetti {
        to { transform: translate(var(--sway), 110vh) rotate(var(--rot)); opacity: 0.85; }
      }
      @keyframes cw-slide-in-right { from { transform: translateX(40px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
      @keyframes cw-slide-in-left  { from { transform: translateX(-40px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
      @keyframes cw-pulse-ring { 0% { box-shadow: 0 0 0 0 rgba(34,197,94,.6); } 100% { box-shadow: 0 0 0 12px rgba(34,197,94,0); } }
      .cw-slide-next { animation: cw-slide-in-right 220ms ease-out; }
      .cw-slide-prev { animation: cw-slide-in-left  220ms ease-out; }
      .cw-pulse-ring  { animation: cw-pulse-ring 1.4s ease-out infinite; }
    `;
    document.head.appendChild(style);
  }, []);

  // ── Resume from close_checklist on mount ──
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('close_checklist')
        .select('step_key, status')
        .eq('period', period);
      const done = new Set((data || []).filter(r => r.status === 'done').map(r => r.step_key));
      const skipSet = new Set((data || []).filter(r => r.status === 'skipped').map(r => r.step_key));
      setSkipped(skipSet);
      let resumeAt = 0;
      for (let i = 0; i < STEPS.length; i++) {
        if (done.has(STEPS[i].key) || skipSet.has(STEPS[i].key)) resumeAt = i + 1;
        else break;
      }
      if (resumeAt >= STEPS.length) resumeAt = STEPS.length - 1;
      setStepIdx(resumeAt);
      stepStartedAtRef.current = Date.now();
    })();
  }, [period]);

  // ── Streak: consecutive closed periods ending at the previous period ──
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('period_close').select('period').eq('status', 'closed');
      const closedSet = new Set((data || []).map(r => r.period));
      let cursor = prevPeriod(period);
      let count = 0;
      while (closedSet.has(cursor)) {
        count++;
        cursor = prevPeriod(cursor);
        if (count > 60) break;
      }
      setStreak(count);
    })();
  }, [period]);

  // ── Load step data when step changes ──
  // Race-protected: each call gets a request id. A late-arriving fetch from a
  // previous step cannot overwrite the latest step's data or loadedStepKey.
  const loadStepData = useCallback(async () => {
    const myId = ++loadRequestIdRef.current;
    const key  = currentStep.key;
    const isLatest = () => myId === loadRequestIdRef.current;

    setStepLoading(true);
    try {
      let next = null;
      if (key === 'categorize') {
        const { data } = await supabase.from('transactions')
          .select('id, date, description, supplier, amount, type, category, account_id, posted')
          .gte('date', periodStart).lte('date', periodEnd)
          .or('category.is.null,category.eq.')
          .order('date', { ascending: true });
        const total = await supabase.from('transactions')
          .select('*', { count: 'exact', head: true })
          .gte('date', periodStart).lte('date', periodEnd);
        next = { uncategorized: data || [], totalTxns: total.count || 0 };
      } else if (key === 'post') {
        const { data } = await supabase.from('transactions')
          .select('id, date, description, amount, type, category')
          .gte('date', periodStart).lte('date', periodEnd)
          .eq('posted', false).not('category', 'is', null).neq('category', '')
          .order('date', { ascending: true });
        next = { unposted: data || [], selected: new Set((data || []).map(r => r.id)) };
      } else if (key === 'journal_rules') {
        const { data: rules } = await supabase.from('journal_rules').select('*').eq('active', true);
        const { data: entries } = await supabase.from('journal_entries').select('rule_id').gte('date', periodStart).lte('date', periodEnd).not('rule_id', 'is', null);
        const ranRuleIds = new Set((entries || []).map(e => e.rule_id));
        next = { rules: rules || [], ranRuleIds };
      } else if (key === 'manual_journals') {
        const { data } = await supabase.from('journal_entries')
          .select('id, reference, date, description, status, total_amount')
          .gte('date', periodStart).lte('date', periodEnd)
          .eq('status', 'draft')
          .is('rule_id', null)
          .order('date');
        next = { drafts: data || [] };
      } else if (key === 'payroll') {
        const { count } = await supabase.from('journal_entries')
          .select('*', { count: 'exact', head: true })
          .gte('date', periodStart).lte('date', periodEnd)
          .ilike('description', 'Payroll —%');
        next = { payrollJECount: count || 0 };
      } else if (key === 'reconcile') {
        const { data } = await supabase.from('transactions')
          .select('id, date, description, amount, category')
          .gte('date', periodStart).lte('date', periodEnd)
          .eq('type', 'debit').eq('reconciled', false)
          .order('date');
        next = { unreconciled: data || [] };
      } else if (key === 'review_balances') {
        // Group balances by category (the chart of accounts the user maintains).
        // Pull id/date/description too so the step can drill into each balance
        // without a second fetch.
        const { data: txns } = await supabase.from('transactions')
          .select('id, date, description, category, amount, type')
          .gte('date', periodStart).lte('date', periodEnd)
          .eq('posted', true)
          .order('date', { ascending: true });
        const balByCat = {};
        const txnsByCategory = {};
        (txns || []).forEach(t => {
          if (!t.category) return;
          const delta = t.type === 'credit' ? Math.abs(t.amount) : -Math.abs(t.amount);
          balByCat[t.category] = (balByCat[t.category] || 0) + delta;
          (txnsByCategory[t.category] = txnsByCategory[t.category] || []).push(t);
        });
        const list = categories
          .map(c => ({ id: c.id, name: c.name, type: c.type, balance: balByCat[c.name] || 0 }))
          .filter(c => c.balance !== 0)
          .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
        const max = Math.max(...list.map(c => Math.abs(c.balance)), 1);
        list.forEach(c => { c.unusual = Math.abs(c.balance) > max * 0.4 && Math.abs(c.balance) > 1000; });
        next = { accountBalances: list, txnsByCategory };
      } else if (key === 'generate_pl' || key === 'generate_bs') {
        const reportType = key === 'generate_pl' ? 'pl' : 'balance_sheet';
        const queries = [
          supabase.from('report_deliverables').select('id, created_at, file_url').eq('period', period).eq('report_type', reportType).order('created_at', { ascending: false }).limit(1),
          supabase.from('transactions').select('*').gte('date', periodStart).lte('date', periodEnd).eq('posted', true),
        ];
        if (key === 'generate_pl') {
          // Existing revenue JEs for this period — drives "Replace" instead of stacking.
          queries.push(
            supabase.from('journal_entries')
              .select('id, reference, date, description, total_amount, status')
              .gte('date', periodStart).lte('date', periodEnd)
              .ilike('description', 'Revenue Breakdown — %')
              .neq('status', 'void')
              .order('created_at', { ascending: false })
          );
          // Daily Sales rollup for the period — used to offer a one-click prefill.
          queries.push(
            supabase.from('daily_sales')
              .select('total_sales, food_sales, liquor_sales, beer_sales, wine_sales, other_sales')
              .gte('date', periodStart).lte('date', periodEnd)
          );
        }
        const results = await Promise.all(queries);
        const existing = results[0]?.data;
        const txns = results[1]?.data || [];
        next = {
          existingReport: existing?.[0],
          postedTxns: txns,
          preview: key === 'generate_pl'
            ? aggregateForPnL(txns, categories)
            : aggregateForBS(txns, categories),
        };
        if (key === 'generate_pl') {
          next.existingRevenueJEs = results[2]?.data || [];
          const ds = results[3]?.data || [];
          const sums = ds.reduce((acc, r) => {
            acc.total  += Number(r.total_sales)  || 0;
            acc.food   += Number(r.food_sales)   || 0;
            acc.liquor += Number(r.liquor_sales) || 0;
            acc.beer   += Number(r.beer_sales)   || 0;
            acc.wine   += Number(r.wine_sales)   || 0;
            acc.other  += Number(r.other_sales)  || 0;
            return acc;
          }, { total: 0, food: 0, liquor: 0, beer: 0, wine: 0, other: 0 });
          next.dailySalesTotals  = sums;
          next.dailySalesRowCount = ds.length;
        }
      } else if (key === 'close') {
        const [postedRes, jeRes, deliverRes] = await Promise.all([
          supabase.from('transactions').select('*', { count: 'exact', head: true }).gte('date', periodStart).lte('date', periodEnd).eq('posted', true),
          supabase.from('journal_entries').select('*', { count: 'exact', head: true }).gte('date', periodStart).lte('date', periodEnd).eq('status', 'posted'),
          supabase.from('report_deliverables').select('report_type').eq('period', period),
        ]);
        next = {
          postedCount: postedRes.count || 0,
          journalCount: jeRes.count || 0,
          reportsCount: deliverRes.data?.length || 0,
          reportTypes: [...new Set((deliverRes.data || []).map(r => r.report_type))],
        };
      }

      // Only commit if a newer call hasn't superseded us.
      if (!isLatest()) return;
      if (next) setStepData(next);
      setLoadedStepKey(key);
    } catch (err) {
      console.error('loadStepData error:', err);
      // If we're still the latest call, surface the failure so the UI can recover
      // (the wizard's step body falls back gracefully on missing data).
      if (isLatest()) setLoadedStepKey(key);
    } finally {
      if (isLatest()) setStepLoading(false);
    }
  }, [currentStep.key, periodStart, periodEnd, period, accounts, categories]);

  useEffect(() => { loadStepData(); }, [loadStepData]);
  useEffect(() => { stepStartedAtRef.current = Date.now(); }, [stepIdx]);

  // ── Achievements ──
  function awardAchievement(name, description, emoji) {
    setAchievements(prev => {
      if (prev.has(name)) return prev;
      const next = new Set(prev);
      next.add(name);
      fireAchievement(name, description, emoji);
      return next;
    });
  }

  // ── Step completion criteria ──
  const stepCriteria = useMemo(() => {
    const key = currentStep.key;
    if (stepLoading) return { met: false, label: 'Loading…' };
    if (key === 'categorize')      return { met: (stepData.uncategorized?.length || 0) === 0, label: `${stepData.uncategorized?.length || 0} uncategorized remaining` };
    if (key === 'post')            return { met: (stepData.unposted?.length || 0) === 0, label: `${stepData.unposted?.length || 0} unposted remaining` };
    if (key === 'journal_rules')   return { met: (stepData.rules?.length || 0) === 0 || (stepData.rules || []).every(r => stepData.ranRuleIds?.has(r.id)), label: `${(stepData.rules?.length || 0) - (stepData.ranRuleIds?.size || 0)} rule(s) not yet run` };
    if (key === 'manual_journals') return { met: (stepData.drafts?.length || 0) === 0, label: `${stepData.drafts?.length || 0} draft journal entries` };
    if (key === 'reconcile')       return { met: (stepData.unreconciled?.length || 0) === 0, label: `${stepData.unreconciled?.length || 0} unreconciled` };
    if (key === 'payroll')         return { met: (stepData.payrollJECount || 0) > 0, label: (stepData.payrollJECount || 0) > 0 ? 'Payroll JE posted' : 'No payroll JE for this period yet' };
    if (key === 'review_balances') return { met: (stepData.accountBalances?.length || 0) === 0 || (stepData.accountBalances || []).every(a => accountsReviewed.has(a.id)), label: `${(stepData.accountBalances?.length || 0) - accountsReviewed.size} account(s) not yet reviewed` };
    if (key === 'generate_pl')     return { met: !!stepData.existingReport, label: stepData.existingReport ? 'P&L generated' : 'P&L not generated' };
    if (key === 'generate_bs')     return { met: !!stepData.existingReport, label: stepData.existingReport ? 'Balance Sheet generated' : 'Balance Sheet not generated' };
    if (key === 'close')           return { met: true, label: 'Ready to close' };
    return { met: false, label: '' };
  }, [currentStep.key, stepData, stepLoading, accountsReviewed]);

  // ── Persist step status ──
  async function persistStep(stepKey, status) {
    await supabase.from('close_checklist').upsert({
      period,
      step_key: stepKey,
      status,
      completed_by: user?.id,
      completed_at: new Date().toISOString(),
    }, { onConflict: 'period,step_key' });
    await supabase.from('accountant_audit_log').insert({
      action: `wizard_step_${stepKey}_${status}`,
      description: `Wizard: "${currentStep.title}" marked ${status} for ${periodFullLabel(period)}`,
      period,
      performed_by: 'user',
      approved_by: user?.id,
    });
  }

  // ── Navigation ──
  async function completeStep() {
    if (completing) return;
    setCompleting(true);
    try {
      await persistStep(currentStep.key, 'done');

      // Achievement triggers
      const seconds = Math.floor((Date.now() - stepStartedAtRef.current) / 1000);
      if (currentStep.key === 'categorize') {
        if (seconds < 120) awardAchievement('Speed Demon', `Categorized in ${seconds}s`, '⚡');
        if (stepData.totalTxns >= 20 && (stepData.uncategorized?.length || 0) === 0)
          awardAchievement('Clean Books', 'Zero uncategorized on first pass', '✨');
      }
      if (currentStep.key === 'reconcile') awardAchievement('Balanced', 'All transactions reconciled', '⚖️');
      if (currentStep.key === 'review_balances') awardAchievement('Auditor', 'Every account reviewed by hand', '🔍');

      if (stepIdx < STEPS.length - 1) {
        setDirection('next');
        setStepIdx(stepIdx + 1);
      } else {
        await doFinalClose();
      }
    } catch (err) {
      toast.error(err.message || 'Could not save progress');
    } finally {
      setCompleting(false);
    }
  }

  async function skipStep() {
    if (!confirm(`Skip "${currentStep.title}"? You can come back later.`)) return;
    try {
      await persistStep(currentStep.key, 'skipped');
      setSkipped(prev => new Set(prev).add(currentStep.key));
      setDirection('next');
      setStepIdx(Math.min(stepIdx + 1, STEPS.length - 1));
    } catch (err) {
      toast.error(err.message || 'Could not skip');
    }
  }

  function goBack() {
    if (stepIdx === 0) return;
    setDirection('prev');
    setStepIdx(stepIdx - 1);
  }

  async function doFinalClose() {
    const { error } = await supabase.from('period_close').upsert({
      period,
      status: 'closed',
      closed_by: user?.id,
      closed_at: new Date().toISOString(),
    }, { onConflict: 'period' });
    if (error) { toast.error(error.message); return; }

    await supabase.from('accountant_audit_log').insert({
      action: 'close_period',
      description: `Closed ${periodFullLabel(period)} via wizard`,
      period,
      performed_by: 'user',
      approved_by: user?.id,
    });

    fireConfetti();
    awardAchievement('Closer', `${periodLabel(period)} is in the books`, '🏆');
    if (streak >= 2) awardAchievement('On Fire', `${streak + 1} months closed in a row`, '🔥');

    const elapsedSec = Math.floor((Date.now() - startedAtRef.current) / 1000);
    const minutes = Math.floor(elapsedSec / 60);
    const seconds = elapsedSec % 60;
    const score = Math.max(0, 100 - skipped.size * 10 - Math.max(0, minutes - 30));
    setFinalStats({
      postedCount:    stepData.postedCount || 0,
      journalCount:   stepData.journalCount || 0,
      reportsCount:   stepData.reportsCount || 0,
      timeLabel:      `${minutes}m ${seconds}s`,
      score,
      skipped:        skipped.size,
      newStreak:      streak + 1,
    });
  }

  // ── Step body renderer ──
  function renderStepBody() {
    // Only show the full-step spinner while we don't have data for THIS step yet.
    // Reloading the same step (e.g. after an action) keeps the body mounted so the
    // form/state isn't blown away on every refresh.
    if (loadedStepKey !== currentStep.key) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;
    switch (currentStep.key) {
      case 'categorize':       return <StepCategorize data={stepData} setData={setStepData} period={period} categories={categories} reload={loadStepData} />;
      case 'post':             return <StepPost       data={stepData} setData={setStepData} reload={loadStepData} />;
      case 'journal_rules':    return <StepJournalRules data={stepData} navigate={navigate} />;
      case 'manual_journals':  return <StepManualJournals data={stepData} navigate={navigate} />;
      case 'reconcile':        return <StepReconcile  data={stepData} setData={setStepData} navigate={navigate} reload={loadStepData} />;
      case 'payroll':          return <StepPayroll    period={period} reload={loadStepData} />;
      case 'review_balances':  return <StepReviewBalances data={stepData} reviewed={accountsReviewed} setReviewed={setAccountsReviewed} />;
      case 'generate_pl':      return <StepGenerateReport data={stepData} period={period} reportType="pl" reload={loadStepData} />;
      case 'generate_bs':      return <StepGenerateReport data={stepData} period={period} reportType="balance_sheet" reload={loadStepData} />;
      case 'close':            return <StepClose data={stepData} period={period} streak={streak} finalStats={finalStats} />;
      default: return null;
    }
  }

  // ── Header progress ──
  const doneCount       = stepIdx + (finalStats ? 1 : 0);
  const pct             = Math.round((doneCount / STEPS.length) * 100);
  const remainingMins   = STEPS.slice(stepIdx + 1).reduce((s, st) => s + st.avgMinutes, 0);

  return (
    <div className="fixed inset-0 z-[9999] bg-surface-900/85 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">

        {/* ── Header ── */}
        <div className="px-6 pt-5 pb-4 border-b border-surface-100">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-[11px] uppercase tracking-widest text-brand-600 font-semibold">Close Wizard</div>
              <div className="font-display text-xl mt-0.5 flex items-center gap-2">
                {periodFullLabel(period)}
                {streak > 0 && (
                  <span className="inline-flex items-center gap-1 text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-medium">
                    <Flame size={12} /> {streak} streak
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={onMinimize} className="btn-ghost p-2" title="Minimize">
                <Minimize2 size={16} />
              </button>
              <button onClick={() => setShowExitConfirm(true)} className="btn-ghost p-2" title="Exit">
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex-1 h-2 bg-surface-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-brand-500 to-green-500 transition-all duration-500 ease-out"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="text-xs text-surface-500 font-mono whitespace-nowrap">
              Step {stepIdx + 1} of {STEPS.length} · {pct}%
              {!finalStats && remainingMins > 0 && <span className="text-surface-400"> · ~{remainingMins}m left</span>}
            </div>
          </div>

          <div className="flex gap-1 mt-3">
            {STEPS.map((s, i) => (
              <div
                key={s.key}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  i < stepIdx ? 'bg-green-500'
                  : i === stepIdx ? 'bg-brand-500'
                  : 'bg-surface-200'
                }`}
                title={s.title}
              />
            ))}
          </div>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto">
          <div className={`px-6 py-6 ${direction === 'next' ? 'cw-slide-next' : 'cw-slide-prev'}`} key={stepIdx}>
            <div className="mb-5">
              <div className="text-xs uppercase tracking-wider text-surface-500 font-semibold">
                Step {stepIdx + 1} of {STEPS.length}
              </div>
              <h2 className="font-display text-2xl mt-0.5">{currentStep.title}</h2>
              <p className="text-sm text-surface-500 mt-1">{currentStep.subtitle}</p>
              {!finalStats && (
                <div className={`mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
                  stepCriteria.met ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                }`}>
                  {stepCriteria.met ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                  {stepCriteria.label}
                </div>
              )}
            </div>
            {renderStepBody()}
          </div>
        </div>

        {/* ── Footer ── */}
        {!finalStats && (
          <div className="px-6 py-4 border-t border-surface-100 bg-surface-50 flex items-center justify-between gap-3">
            <button
              onClick={goBack}
              disabled={stepIdx === 0}
              className="btn-ghost text-sm flex items-center gap-1.5 disabled:opacity-30"
            >
              <ChevronLeft size={14} /> Back
            </button>
            <div className="flex items-center gap-2">
              {currentStep.key !== 'close' && (
                <button onClick={skipStep} className="btn-ghost text-sm flex items-center gap-1.5">
                  <SkipForward size={14} /> Skip
                </button>
              )}
              <button
                onClick={completeStep}
                disabled={!stepCriteria.met || completing}
                className={`text-sm px-5 py-2 rounded-lg font-medium flex items-center gap-2 transition ${
                  stepCriteria.met && !completing
                    ? currentStep.key === 'close'
                      ? 'bg-green-600 text-white hover:bg-green-700 cw-pulse-ring'
                      : 'bg-brand-600 text-white hover:bg-brand-700'
                    : 'bg-surface-200 text-surface-400 cursor-not-allowed'
                }`}
              >
                {completing && <Loader2 size={14} className="animate-spin" />}
                {currentStep.key === 'close' ? (<>Close {periodLabel(period)} <Sparkles size={14} /></>) : (<>Complete Step <ChevronRight size={14} /></>)}
              </button>
            </div>
          </div>
        )}

        {finalStats && (
          <div className="px-6 py-4 border-t border-surface-100 bg-surface-50 flex items-center justify-end">
            <button onClick={onExit} className="btn-primary text-sm">Back to Dashboard</button>
          </div>
        )}
      </div>

      {/* Exit confirm */}
      {showExitConfirm && (
        <div className="fixed inset-0 z-[10001] bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-5">
            <h3 className="font-display text-lg">Exit close wizard?</h3>
            <p className="text-sm text-surface-500 mt-1">
              Your progress is saved. You can resume from the same step later.
            </p>
            <div className="flex gap-2 mt-4 justify-end">
              <button onClick={() => setShowExitConfirm(false)} className="btn-ghost text-sm">Keep going</button>
              <button onClick={onExit} className="btn-secondary text-sm">Exit wizard</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// LAUNCHER MODAL
// ===========================================================================
export function CloseLauncher({ initialPeriod, periodStatuses, onLaunch, onCancel }) {
  const [period, setPeriod] = useState(initialPeriod);
  const year = parseInt(initialPeriod.split('-')[0]);
  const options = Array.from({ length: 12 }, (_, i) => `${year}-${String(i+1).padStart(2,'0')}`);

  return (
    <div className="fixed inset-0 z-[9998] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-xl bg-brand-100 text-brand-600 flex items-center justify-center">
            <Play size={22} />
          </div>
          <div>
            <h3 className="font-display text-xl">Start Close Process</h3>
            <p className="text-sm text-surface-500">Which period do you want to close?</p>
          </div>
        </div>
        <label className="text-xs uppercase tracking-wider text-surface-500 font-semibold">Period</label>
        <select value={period} onChange={e => setPeriod(e.target.value)} className="input-field w-full mt-1">
          {options.map(p => {
            const status = periodStatuses?.[p] || 'open';
            const tag = status === 'closed' ? ' (already closed)'
                      : status === 'in_progress' ? ' (in progress)'
                      : status === 'no_data' ? ' (no transactions)' : '';
            return <option key={p} value={p}>{periodFullLabel(p)}{tag}</option>;
          })}
        </select>
        <div className="flex gap-2 mt-5 justify-end">
          <button onClick={onCancel} className="btn-ghost text-sm">Cancel</button>
          <button onClick={() => onLaunch(period)} className="btn-primary text-sm flex items-center gap-1.5">
            <Play size={14} /> Start
          </button>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// STEP COMPONENTS
// ===========================================================================
function StepCategorize({ data, setData, period, categories, reload }) {
  const { aiCategorizeUncategorized } = useData();
  const [busy, setBusy] = useState(false);

  async function setCat(id, category) {
    const prev = data.uncategorized;
    setData({ ...data, uncategorized: prev.filter(t => t.id !== id) });
    const { error } = await supabase.from('transactions').update({ category }).eq('id', id);
    if (error) { toast.error(error.message); setData({ ...data, uncategorized: prev }); }
  }

  async function runAI() {
    setBusy(true);
    const loading = toast.loading('Asking Claude to categorize…');
    try {
      const n = await aiCategorizeUncategorized(period);
      toast.dismiss(loading);
      if (n > 0) toast.success(`AI categorized ${n}`);
      else toast('No high-confidence matches', { icon: 'ℹ️' });
      await reload();
    } catch (err) {
      toast.dismiss(loading);
      toast.error(err.message || 'AI categorization failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="grid grid-cols-3 gap-3 mb-4">
        <StatPill label="Total transactions" value={data.totalTxns || 0} />
        <StatPill label="Uncategorized" value={data.uncategorized?.length || 0} tone={data.uncategorized?.length ? 'amber' : 'green'} />
        <StatPill label="Categorized" value={(data.totalTxns || 0) - (data.uncategorized?.length || 0)} tone="green" />
      </div>
      {(data.uncategorized?.length || 0) > 0 && (
        <button onClick={runAI} disabled={busy}
          className="btn-primary text-sm mb-3 flex items-center gap-2">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
          AI Categorize All
        </button>
      )}
      {(data.uncategorized?.length || 0) === 0 ? (
        <div className="card p-8 text-center">
          <CheckCircle2 size={36} className="mx-auto text-green-500 mb-2" />
          <div className="font-display text-lg">Everything is categorized.</div>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-surface-100 bg-surface-50">
                <th className="table-header">Date</th>
                <th className="table-header">Description</th>
                <th className="table-header text-right">Amount</th>
                <th className="table-header">Category</th>
              </tr>
            </thead>
            <tbody>
              {data.uncategorized.map(t => (
                <tr key={t.id} className="border-b border-surface-50">
                  <td className="table-cell font-mono text-xs">{formatDate(t.date)}</td>
                  <td className="table-cell text-sm truncate max-w-xs" title={t.description}>{t.description}</td>
                  <td className="table-cell text-right font-mono text-xs">{formatCurrency(Math.abs(t.amount))}</td>
                  <td className="table-cell">
                    <select onChange={e => e.target.value && setCat(t.id, e.target.value)} defaultValue=""
                      className="input-field text-xs py-1 px-2 w-auto">
                      <option value="" disabled>Choose…</option>
                      {pickableCategories(categories).map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StepPost({ data, setData, reload }) {
  const [busy, setBusy] = useState(false);
  const list = data.unposted || [];
  const selected = data.selected || new Set();
  const total = list.filter(t => selected.has(t.id)).reduce((s, t) => s + Math.abs(t.amount), 0);

  function toggle(id) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setData({ ...data, selected: next });
  }
  function toggleAll() {
    setData({ ...data, selected: selected.size === list.length ? new Set() : new Set(list.map(t => t.id)) });
  }

  async function postSelected() {
    if (!selected.size) return;
    setBusy(true);
    try {
      const { error } = await supabase.from('transactions').update({ posted: true }).in('id', [...selected]);
      if (error) throw error;
      toast.success(`Posted ${selected.size}`);
      await reload();
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  }

  if (!list.length) {
    return (
      <div className="card p-8 text-center">
        <CheckCircle2 size={36} className="mx-auto text-green-500 mb-2" />
        <div className="font-display text-lg">Nothing left to post.</div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm text-surface-600">
          {selected.size} of {list.length} selected — <span className="font-mono">{formatCurrency(total)}</span>
        </div>
        <div className="flex gap-2">
          <button onClick={toggleAll} className="btn-ghost text-xs">
            {selected.size === list.length ? 'Clear' : 'Select All'}
          </button>
          <button onClick={postSelected} disabled={!selected.size || busy} className="btn-primary text-xs flex items-center gap-1.5">
            {busy ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
            Post {selected.size} Selected
          </button>
        </div>
      </div>
      <div className="card overflow-hidden max-h-[400px] overflow-y-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-surface-50">
            <tr className="border-b border-surface-100">
              <th className="table-header w-8"></th>
              <th className="table-header">Date</th>
              <th className="table-header">Description</th>
              <th className="table-header">Category</th>
              <th className="table-header text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {list.map(t => (
              <tr key={t.id} className="border-b border-surface-50 hover:bg-surface-50">
                <td className="table-cell">
                  <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} />
                </td>
                <td className="table-cell font-mono text-xs">{formatDate(t.date)}</td>
                <td className="table-cell text-sm truncate max-w-xs" title={t.description}>{t.description}</td>
                <td className="table-cell text-xs"><span className="badge-green">{t.category}</span></td>
                <td className="table-cell text-right font-mono text-xs">{formatCurrency(Math.abs(t.amount))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StepJournalRules({ data, navigate }) {
  const rules = data.rules || [];
  const ran   = data.ranRuleIds || new Set();
  if (!rules.length) {
    return (
      <div className="card p-8 text-center">
        <CheckCircle2 size={36} className="mx-auto text-green-500 mb-2" />
        <div className="font-display text-lg">No active rules — you can move on.</div>
      </div>
    );
  }
  return (
    <div>
      <div className="text-sm text-surface-500 mb-3">
        Recurring rules generate journal entries automatically. Open the Journal page to preview & post,
        then come back here.
      </div>
      <div className="card overflow-hidden mb-4">
        <table className="w-full">
          <thead><tr className="border-b border-surface-100 bg-surface-50">
            <th className="table-header">Rule</th>
            <th className="table-header">Type</th>
            <th className="table-header text-right">Status</th>
          </tr></thead>
          <tbody>
            {rules.map(r => (
              <tr key={r.id} className="border-b border-surface-50">
                <td className="table-cell text-sm font-medium">{r.name}</td>
                <td className="table-cell text-xs text-surface-500">{r.rule_type}</td>
                <td className="table-cell text-right">
                  {ran.has(r.id)
                    ? <span className="badge-green text-xs">Ran this period</span>
                    : <span className="badge-warning text-xs">Pending</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button onClick={() => navigate('/journal')} className="btn-secondary text-sm">
        Open Journal → Run Rules
      </button>
    </div>
  );
}

function StepManualJournals({ data, navigate }) {
  const drafts = data.drafts || [];
  if (!drafts.length) {
    return (
      <div className="card p-8 text-center">
        <CheckCircle2 size={36} className="mx-auto text-green-500 mb-2" />
        <div className="font-display text-lg">No draft journal entries.</div>
      </div>
    );
  }
  return (
    <div>
      <div className="text-sm text-surface-500 mb-3">
        Resolve any draft journal entries before closing.
      </div>
      <div className="card overflow-hidden mb-4">
        <table className="w-full">
          <thead><tr className="border-b border-surface-100 bg-surface-50">
            <th className="table-header">Reference</th>
            <th className="table-header">Date</th>
            <th className="table-header">Description</th>
            <th className="table-header text-right">Amount</th>
          </tr></thead>
          <tbody>
            {drafts.map(j => (
              <tr key={j.id} className="border-b border-surface-50">
                <td className="table-cell font-mono text-xs">{j.reference}</td>
                <td className="table-cell font-mono text-xs">{formatDate(j.date)}</td>
                <td className="table-cell text-sm">{j.description}</td>
                <td className="table-cell text-right font-mono text-xs">{formatCurrency(j.total_amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button onClick={() => navigate('/journal')} className="btn-secondary text-sm">
        Open Journal
      </button>
    </div>
  );
}

function StepReconcile({ data, setData, navigate, reload }) {
  // Pull the same update path Bookkeeping uses for inline category edits — so a
  // correction here trains the supplier-memory loop identically. No parallel
  // write path; same DataContext.updateTransaction + learnSupplierCategory.
  const { categories: chartCategories, updateTransaction, learnSupplierCategory } = useData();
  const pickable = useMemo(() => pickableCategories(chartCategories), [chartCategories]);

  const list = data.unreconciled || [];
  const [selected, setSelected]           = useState(() => new Set());
  const [categoryFilter, setCategoryFilter] = useState('');
  const [busy, setBusy]                   = useState(false);
  const [editingTxnId, setEditingTxnId]   = useState(null);

  // The category-filter dropdown shows distinct category names actually present
  // on this step's transactions.
  const usedCategoryNames = useMemo(() => {
    const s = new Set();
    list.forEach(t => { if (t.category) s.add(t.category); });
    return [...s].sort();
  }, [list]);

  const filtered = useMemo(() => {
    if (!categoryFilter) return list;
    if (categoryFilter === '__uncat__') return list.filter(t => !t.category);
    return list.filter(t => t.category === categoryFilter);
  }, [list, categoryFilter]);

  // Optimistic category change. Mirrors Bookkeeping.handleCategorize:
  //   1. Patch the row in this step's local `data.unreconciled` immediately
  //   2. Persist via DataContext.updateTransaction
  //   3. Train supplier→category memory; if it propagates to other txns the
  //      wizard reload picks them up the next time the user navigates back to
  //      this step, and other steps refetch their own data when re-entered.
  //   4. On failure: revert the optimistic patch + toast.
  async function handleCategorize(txn, nextCategory) {
    setEditingTxnId(null);
    const prevCategory = txn.category || null;
    const newCategory  = nextCategory || null;
    if (prevCategory === newCategory) return;

    setData(d => ({
      ...d,
      unreconciled: (d.unreconciled || []).map(t => t.id === txn.id ? { ...t, category: newCategory } : t),
    }));

    try {
      await updateTransaction(txn.id, { category: newCategory });
    } catch (err) {
      // Roll back the optimistic patch so the badge matches the truth.
      setData(d => ({
        ...d,
        unreconciled: (d.unreconciled || []).map(t => t.id === txn.id ? { ...t, category: prevCategory } : t),
      }));
      toast.error(err?.message || 'Could not update category');
      return;
    }

    const supplier = txn.supplier || txn.description;
    if (supplier && newCategory) {
      try {
        const propagated = await learnSupplierCategory(supplier, newCategory);
        if (propagated > 0) {
          toast.success(`Auto-categorized ${propagated} more transaction${propagated !== 1 ? 's' : ''}`);
          await reload();
        }
      } catch {
        // Supplier learning is best-effort — the primary update already succeeded.
      }
    }
  }

  const visibleIds       = useMemo(() => filtered.map(t => t.id), [filtered]);
  const visibleSelected  = visibleIds.filter(id => selected.has(id)).length;
  const allVisibleChecked = filtered.length > 0 && visibleSelected === filtered.length;
  const someVisibleChecked = visibleSelected > 0 && visibleSelected < filtered.length;

  function toggleOne(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAllVisible() {
    setSelected(prev => {
      const next = new Set(prev);
      if (allVisibleChecked) visibleIds.forEach(id => next.delete(id));
      else visibleIds.forEach(id => next.add(id));
      return next;
    });
  }

  async function markSelectedReconciled() {
    if (!selected.size) return;
    setBusy(true);
    try {
      const ids = [...selected];
      const { error } = await supabase.from('transactions').update({ reconciled: true }).in('id', ids);
      if (error) throw error;
      toast.success(`Marked ${ids.length} as reconciled`);
      setSelected(new Set());
      await reload();
    } catch (err) {
      toast.error(err.message || 'Failed');
    } finally {
      setBusy(false);
    }
  }

  if (!list.length) {
    return (
      <div className="card p-8 text-center">
        <CheckCircle2 size={36} className="mx-auto text-green-500 mb-2" />
        <div className="font-display text-lg">Everything reconciled.</div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <label className="text-xs uppercase tracking-wider text-surface-500 font-semibold">Category</label>
          <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
            className="input-field text-sm py-1.5 w-auto">
            <option value="">All ({list.length})</option>
            <option value="__uncat__">— Uncategorized —</option>
            {usedCategoryNames.map(c => {
              const n = list.filter(t => t.category === c).length;
              return <option key={c} value={c}>{c} ({n})</option>;
            })}
          </select>
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <button onClick={() => setSelected(new Set())} className="btn-ghost text-xs">
              Clear ({selected.size})
            </button>
          )}
          <button onClick={markSelectedReconciled} disabled={!selected.size || busy}
            className="btn-primary text-xs flex items-center gap-1.5">
            {busy ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
            Mark Selected as Reconciled{selected.size ? ` (${selected.size})` : ''}
          </button>
          <button onClick={() => navigate('/bookkeeping/reconcile')} className="btn-secondary text-xs">Open Reconciliation</button>
        </div>
      </div>
      <div className="card overflow-hidden max-h-[400px] overflow-y-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-surface-50 z-10">
            <tr className="border-b border-surface-100">
              <th className="table-header w-8">
                <input type="checkbox"
                  ref={el => { if (el) el.indeterminate = someVisibleChecked; }}
                  checked={allVisibleChecked} onChange={toggleAllVisible}
                  aria-label="Select all visible" />
              </th>
              <th className="table-header">Date</th>
              <th className="table-header">Description</th>
              <th className="table-header">Category</th>
              <th className="table-header text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(t => {
              const isEditing = editingTxnId === t.id;
              return (
                <tr key={t.id}
                  onClick={() => { if (!isEditing) toggleOne(t.id); }}
                  className={`border-b border-surface-50 ${isEditing ? '' : 'cursor-pointer'} ${selected.has(t.id) ? 'bg-brand-50' : 'hover:bg-surface-50'}`}>
                  <td className="table-cell w-8">
                    <input type="checkbox" checked={selected.has(t.id)}
                      onChange={() => toggleOne(t.id)} onClick={e => e.stopPropagation()}
                      disabled={isEditing} />
                  </td>
                  <td className="table-cell font-mono text-xs">{formatDate(t.date)}</td>
                  <td className="table-cell text-sm truncate max-w-xs" title={t.description}>{t.description}</td>
                  <td
                    className="table-cell text-xs"
                    onClick={e => { if (isEditing) e.stopPropagation(); }}
                    onMouseDown={e => { if (isEditing) e.stopPropagation(); }}
                  >
                    {isEditing ? (
                      <CategoryCombobox
                        initial={t.category || ''}
                        options={pickable.map(c => c.name)}
                        onCommit={value => handleCategorize(t, value)}
                        onCancel={() => setEditingTxnId(null)}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); setEditingTxnId(t.id); }}
                        className="group/cat inline-flex items-center gap-1 rounded-full px-2 py-0.5 transition hover:bg-surface-100"
                        title="Click to recategorize"
                      >
                        {t.category
                          ? <span className="badge-green text-xs rounded-full px-2 py-0.5">{t.category}</span>
                          : <span className="text-xs text-surface-400">+ Categorize</span>}
                        <Pencil size={10} className="opacity-0 group-hover/cat:opacity-50 text-surface-400" />
                      </button>
                    )}
                  </td>
                  <td className="table-cell text-right font-mono text-xs">{formatCurrency(Math.abs(t.amount))}</td>
                </tr>
              );
            })}
            {!filtered.length && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-surface-400">No transactions match this category.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Small combobox used by the Reconcile-step inline category editor. Type to
// filter; Enter commits the highlighted match; Esc or any click outside
// cancels. Renders inline so it inherits the row's styling.
function CategoryCombobox({ initial, options, onCommit, onCancel }) {
  const [query, setQuery]       = useState(initial || '');
  const [activeIdx, setActiveIdx] = useState(0);
  const containerRef            = useRef(null);

  const filtered = useMemo(() => {
    const q = (query || '').toLowerCase();
    if (!q) return options;
    return options.filter(o => o.toLowerCase().includes(q));
  }, [options, query]);

  // Outside-click closes — same affordance as Esc.
  useEffect(() => {
    function onDown(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) onCancel();
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onCancel]);

  // Keep the highlighted option in range as the filter narrows.
  useEffect(() => { setActiveIdx(0); }, [query]);

  function handleKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); return; }
    if (e.key === 'Enter')  {
      e.preventDefault();
      const pick = filtered[activeIdx];
      if (pick) onCommit(pick);
      else onCancel();
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, filtered.length - 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
  }

  return (
    <div ref={containerRef} className="relative inline-block">
      <input
        autoFocus
        value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={handleKey}
        placeholder="Type to filter…"
        className="input-field text-xs py-1 px-2 w-44"
      />
      <div className="absolute z-30 left-0 top-full mt-1 bg-white border border-surface-100 rounded-lg shadow-lg max-h-56 overflow-y-auto min-w-[200px]">
        {filtered.length === 0 ? (
          <div className="px-3 py-2 text-xs text-surface-400">No matches</div>
        ) : (
          filtered.slice(0, 50).map((opt, i) => (
            <button
              key={opt}
              type="button"
              // Use onMouseDown so the click registers before the input's blur.
              onMouseDown={e => { e.preventDefault(); onCommit(opt); }}
              onMouseEnter={() => setActiveIdx(i)}
              className={`w-full text-left px-3 py-1.5 text-xs ${i === activeIdx ? 'bg-brand-50 text-brand-800' : 'hover:bg-surface-50'}`}
            >
              {opt}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function StepPayroll({ period, reload }) {
  return (
    <div>
      <p className="text-sm text-surface-500 mb-4">
        Enter the total payroll for the period. We'll subtract what was paid via Venmo / Cash App
        (already posted from the bank statement) and post the check / other remainder as a journal entry
        debiting your payroll expense account.
      </p>
      <PayrollJournalForm period={period} onPosted={reload} />
    </div>
  );
}

function StepReviewBalances({ data, reviewed, setReviewed }) {
  const list = data.accountBalances || [];
  const txnsByCategory = data.txnsByCategory || {};
  const [expanded, setExpanded] = useState(() => new Set());

  function toggle(id) {
    const next = new Set(reviewed);
    if (next.has(id)) next.delete(id); else next.add(id);
    setReviewed(next);
  }
  function toggleExpanded(id) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  if (!list.length) {
    return (
      <div className="card p-8 text-center">
        <CheckCircle2 size={36} className="mx-auto text-green-500 mb-2" />
        <div className="font-display text-lg">No account movement this period.</div>
      </div>
    );
  }
  return (
    <div>
      <div className="text-sm text-surface-500 mb-3">
        Click an account once you've eyeballed its balance. Use the chevron to drill into the transactions behind a balance. Amber rows look unusually large.
      </div>
      <div className="card overflow-hidden">
        <table className="w-full">
          <thead><tr className="border-b border-surface-100 bg-surface-50">
            <th className="table-header w-8"></th>
            <th className="table-header w-8"></th>
            <th className="table-header">Account</th>
            <th className="table-header">Type</th>
            <th className="table-header text-right">Period balance</th>
          </tr></thead>
          <tbody>
            {list.map(a => {
              const done = reviewed.has(a.id);
              const isOpen = expanded.has(a.id);
              const rowBg = done ? 'bg-green-50' : a.unusual ? 'bg-amber-50' : '';
              return (
                <Fragment key={a.id}>
                  <tr onClick={() => toggle(a.id)} className={`border-b border-surface-50 cursor-pointer ${rowBg}`}>
                    <td
                      className="table-cell"
                      onClick={e => { e.stopPropagation(); toggleExpanded(a.id); }}
                    >
                      <button
                        type="button"
                        className="p-1 rounded hover:bg-surface-100 transition"
                        aria-label={isOpen ? 'Collapse detail' : 'Expand detail'}
                        aria-expanded={isOpen}
                      >
                        <ChevronRight size={14} className={`transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                      </button>
                    </td>
                    <td className="table-cell">
                      <input type="checkbox" checked={done} readOnly />
                    </td>
                    <td className="table-cell text-sm font-medium flex items-center gap-2">
                      {a.name}
                      {a.unusual && !done && <span className="badge-warning text-[10px]">Review</span>}
                    </td>
                    <td className="table-cell text-xs text-surface-500 capitalize">{a.type}</td>
                    <td className={`table-cell text-right font-mono text-sm ${a.balance >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                      {formatCurrency(a.balance)}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className={rowBg}>
                      <td colSpan={5} className="px-4 pb-4 pt-1">
                        <TxnDetail txns={txnsByCategory[a.name] || []} parentBalance={a.balance} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TxnDetail({ txns, parentBalance }) {
  const { debitTotal, creditTotal, subtotal } = useMemo(() => {
    let d = 0, c = 0;
    for (const t of txns) {
      const amt = Math.abs(t.amount);
      if (t.type === 'debit') d += amt;
      else if (t.type === 'credit') c += amt;
    }
    return { debitTotal: d, creditTotal: c, subtotal: c - d };
  }, [txns]);
  const mismatched = Math.abs(subtotal - parentBalance) > 0.005;

  return (
    <div className="ml-6 rounded-lg border border-surface-100 bg-white overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-surface-100 bg-surface-50/60">
            <th className="table-header">Date</th>
            <th className="table-header">Description</th>
            <th className="table-header text-right">Debit</th>
            <th className="table-header text-right">Credit</th>
          </tr>
        </thead>
        <tbody>
          {txns.map(t => (
            <tr key={t.id} className="border-b border-surface-50 last:border-b-0">
              <td className="table-cell font-mono text-xs">{formatDate(t.date)}</td>
              <td className="table-cell text-xs truncate max-w-md" title={t.description}>{t.description}</td>
              <td className="table-cell text-right font-mono text-xs">
                {t.type === 'debit' ? formatCurrency(Math.abs(t.amount)) : ''}
              </td>
              <td className="table-cell text-right font-mono text-xs">
                {t.type === 'credit' ? formatCurrency(Math.abs(t.amount)) : ''}
              </td>
            </tr>
          ))}
          <tr className="bg-surface-50">
            <td className="table-cell text-xs font-semibold" colSpan={2}>
              Subtotal ·{' '}
              <span className={`font-mono ${subtotal >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                {formatCurrency(subtotal)}
              </span>
              {mismatched && (
                <span className="ml-2 inline-flex items-center gap-1 text-[10px] text-amber-700 font-normal">
                  <AlertCircle size={10} /> Detail doesn't sum to balance
                </span>
              )}
            </td>
            <td className="table-cell text-right font-mono text-xs font-semibold">{formatCurrency(debitTotal)}</td>
            <td className="table-cell text-right font-mono text-xs font-semibold">{formatCurrency(creditTotal)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function StepGenerateReport({ data, period, reportType, reload }) {
  if (reportType === 'pl') return <StepGeneratePnL data={data} period={period} reload={reload} />;
  return <StepGenerateBalanceSheet data={data} period={period} reload={reload} />;
}

// ── Balance Sheet variant (unchanged behavior — single generate + download) ──
function StepGenerateBalanceSheet({ data, period, reload }) {
  const { user } = useAuth();
  const { getSignedUrl, categories } = useData();
  const [busy, setBusy] = useState(false);
  const preview = data.preview || {};
  const existing = data.existingReport;

  async function generate() {
    setBusy(true);
    try {
      const label = periodFullLabel(period);
      const pdf = generateBalanceSheetPdf(aggregateForBS(data.postedTxns || [], categories), label);
      const blob = pdf.output('blob');
      const fileName = `balance_sheet_${period}_${Date.now()}.pdf`;
      const path = `${period}/${fileName}`;
      const { error: upErr } = await supabase.storage.from('reports').upload(path, blob, { contentType: 'application/pdf' });
      if (upErr) throw upErr;
      const { error: insErr } = await supabase.from('report_deliverables').insert({
        period, report_type: 'balance_sheet', file_url: path, file_name: fileName, generated_by: user?.id,
      });
      if (insErr) throw insErr;
      toast.success('Report generated');
      await reload();
    } catch (err) {
      toast.error(err.message || 'Failed to generate');
    } finally { setBusy(false); }
  }

  async function download() {
    try {
      const url = await getSignedUrl('reports', existing.file_url);
      window.open(url, '_blank');
    } catch (err) { toast.error(err.message || 'Could not download'); }
  }

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <button onClick={generate} disabled={busy}
          className="card p-5 text-left hover:border-brand-400 hover:shadow-md transition flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-brand-100 text-brand-600 flex items-center justify-center">
            {busy ? <Loader2 className="animate-spin" /> : <FileText />}
          </div>
          <div>
            <div className="font-display text-lg">{existing ? 'Regenerate' : 'Generate'} Balance Sheet</div>
            <div className="text-xs text-surface-500 mt-0.5">Uses posted transactions for this period</div>
          </div>
        </button>
        {existing && (
          <button onClick={download}
            className="card p-5 text-left hover:border-green-400 hover:shadow-md transition flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-green-100 text-green-600 flex items-center justify-center">
              <CheckCircle2 />
            </div>
            <div>
              <div className="font-display text-lg">Download PDF</div>
              <div className="text-xs text-surface-500 mt-0.5">Generated {new Date(existing.created_at).toLocaleString()}</div>
            </div>
          </button>
        )}
      </div>
      <div className="card p-5">
        <div className="text-xs uppercase tracking-wider text-surface-500 font-semibold mb-3">Preview</div>
        <div className="grid grid-cols-3 gap-3">
          <StatPill label="Assets"      value={formatCurrency(preview.totalAssets || 0)} />
          <StatPill label="Liabilities" value={formatCurrency(preview.totalLiabilities || 0)} />
          <StatPill label="Equity"      value={formatCurrency(preview.totalEquity || 0)} />
        </div>
      </div>
    </div>
  );
}

// ── P&L variant: revenue breakdown input, live preview, generate PDF ──
//
// State machine: posting / generating / idle. No mount-time refresh — the
// wizard's loadStepData already supplied the existing report, posted txns,
// existing revenue JEs, and Daily Sales totals.
function StepGeneratePnL({ data, period, reload }) {
  const { user } = useAuth();
  const { getSignedUrl, categories, addCategory, refresh } = useData();

  const preview          = data.preview || { totalRevenue: 0, totalExpenses: 0 };
  const existing         = data.existingReport;
  const existingRevJEs   = data.existingRevenueJEs || [];
  const dailySales       = data.dailySalesTotals;
  const dailyRowCount    = data.dailySalesRowCount || 0;
  const monthLabel       = periodFullLabel(period);

  // Form state for the breakdown lines. Strings while typing — parsed on
  // posting and inside the live-preview memo.
  const [lines, setLines]       = useState(() => [{ label: '', amount: '' }]);
  const [posting, setPosting]   = useState(false);
  const [generating, setGenerating] = useState(false);

  // Live preview: corrected aggregation + entered breakdown.
  const breakdownTotal = useMemo(
    () => lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0),
    [lines]
  );
  const liveRevenue   = (preview.totalRevenue || 0) + breakdownTotal;
  const liveExpenses  = preview.totalExpenses || 0;
  const liveNet       = liveRevenue - liveExpenses;

  const revenueCatNames = useMemo(
    () => categories.filter(c => (c.type || '').toLowerCase() === 'revenue').map(c => c.name),
    [categories]
  );

  function updateLine(i, field, value) {
    setLines(prev => prev.map((l, idx) => idx === i ? { ...l, [field]: value } : l));
  }
  function addLine() { setLines(prev => [...prev, { label: '', amount: '' }]); }
  function removeLine(i) { setLines(prev => prev.length === 1 ? [{ label: '', amount: '' }] : prev.filter((_, idx) => idx !== i)); }

  function prefillFromDailySales() {
    if (!dailySales) return;
    const candidates = [
      ['Liquor Sales', dailySales.liquor],
      ['Food Sales',   dailySales.food],
      ['Beer Sales',   dailySales.beer],
      ['Wine Sales',   dailySales.wine],
      ['Other Sales',  dailySales.other],
    ];
    const filled = candidates.filter(([, amt]) => amt > 0).map(([label, amt]) => ({ label, amount: amt.toFixed(2) }));
    // Allocate any rounding gap between sum-of-parts and total to "Other Sales".
    const partsSum = filled.reduce((s, l) => s + parseFloat(l.amount), 0);
    const gap = (dailySales.total || 0) - partsSum;
    if (Math.abs(gap) > 0.005) {
      const other = filled.find(l => l.label === 'Other Sales');
      if (other) other.amount = (parseFloat(other.amount) + gap).toFixed(2);
      else filled.push({ label: 'Other Sales', amount: gap.toFixed(2) });
    }
    setLines(filled.length ? filled : [{ label: 'Sales Revenue', amount: (dailySales.total || 0).toFixed(2) }]);
  }

  // Make sure every breakdown line maps to a revenue-type category. Reuses
  // existing categories by name; auto-creates anything missing as type 'revenue'.
  // If the chart of accounts has no revenue category at all, ensures a default
  // "Sales Revenue" exists so the books always have somewhere to credit.
  async function ensureRevenueCategories(labels) {
    const byName = new Map(categories.map(c => [c.name, c]));
    const created = [];
    for (const label of labels) {
      const existingCat = byName.get(label);
      if (existingCat) continue;
      const newCat = await addCategory(label, 'revenue');
      created.push(newCat);
      byName.set(label, newCat);
    }
    if (!revenueCatNames.length && !labels.some(l => byName.get(l)?.type === 'revenue')) {
      if (!byName.get('Sales Revenue')) {
        const fallback = await addCategory('Sales Revenue', 'revenue');
        created.push(fallback);
      }
    }
    return created;
  }

  // Delete prior revenue-breakdown JEs (and their txns) for this period so we
  // don't stack duplicates when the user replaces. journal_entry_lines cascade
  // off the JE; transactions only get the FK set null, so we must delete those
  // txns explicitly before deleting the JE.
  async function deleteExistingRevenueJEs() {
    if (!existingRevJEs.length) return;
    const ids = existingRevJEs.map(j => j.id);
    const { error: txnErr } = await supabase.from('transactions').delete().in('journal_entry_id', ids);
    if (txnErr) throw txnErr;
    const { error: jeErr } = await supabase.from('journal_entries').delete().in('id', ids);
    if (jeErr) throw jeErr;
  }

  async function postBreakdown() {
    const clean = lines
      .map(l => ({ label: l.label.trim(), amount: parseFloat(l.amount) || 0 }))
      .filter(l => l.label && l.amount > 0);
    if (!clean.length) { toast.error('Add at least one revenue line with a label and amount'); return; }

    const verb = existingRevJEs.length ? 'Replace' : 'Post';
    if (existingRevJEs.length) {
      const refs = existingRevJEs.map(j => j.reference).join(', ');
      if (!confirm(`Replace existing revenue entries (${refs}) with this breakdown?`)) return;
    }

    setPosting(true);
    try {
      await ensureRevenueCategories(clean.map(l => l.label));
      await deleteExistingRevenueJEs();

      const reference = await nextRevenueReference();
      const total     = clean.reduce((s, l) => s + l.amount, 0);
      const jeDate    = periodRange(period).end;

      const { data: entry, error: e1 } = await supabase.from('journal_entries').insert({
        reference,
        date: jeDate,
        description: `Revenue Breakdown — ${monthLabel}`,
        memo: `Manual revenue breakdown for ${monthLabel}: ${clean.map(l => `${l.label} ${l.amount.toFixed(2)}`).join(', ')}`,
        total_amount: total,
        status: 'posted',
        entry_type: 'simple',
        created_by: user?.id || null,
        posted_at: new Date().toISOString(),
      }).select().single();
      if (e1) throw e1;

      const lineRows = clean.map(l => ({
        journal_entry_id: entry.id,
        account_id:       null,
        description:      l.label,
        debit_amount:     0,
        credit_amount:    l.amount,
        category:         l.label,
      }));
      const { error: e2 } = await supabase.from('journal_entry_lines').insert(lineRows);
      if (e2) throw e2;

      const txnRows = clean.map(l => ({
        date:              jeDate,
        description:       `${l.label} — ${monthLabel}`,
        supplier:          'Revenue JE',
        amount:            l.amount,
        type:              'credit',
        category:          l.label,
        account_id:        null,
        reference,
        bank_statement_id: null,
        journal_entry_id:  entry.id,
        posted:            true,
      }));
      const { error: e3 } = await supabase.from('transactions').insert(txnRows);
      if (e3) throw e3;

      toast.success(`${verb}d ${reference} — ${formatCurrency(total)}`);
      // Reload the step so preview reflects the new posted revenue, and refresh
      // DataContext so any auto-created revenue categories propagate.
      await refresh?.();
      await reload();
      setLines([{ label: '', amount: '' }]);
    } catch (err) {
      toast.error(err.message || 'Failed to post revenue');
    } finally {
      setPosting(false);
    }
  }

  async function generatePdf() {
    setGenerating(true);
    try {
      const label = periodFullLabel(period);
      const pdf = generatePnLPdf(aggregateForPnL(data.postedTxns || [], categories), label);
      const blob = pdf.output('blob');
      const fileName = `pl_${period}_${Date.now()}.pdf`;
      const path = `${period}/${fileName}`;
      const { error: upErr } = await supabase.storage.from('reports').upload(path, blob, { contentType: 'application/pdf' });
      if (upErr) throw upErr;
      const { error: insErr } = await supabase.from('report_deliverables').insert({
        period, report_type: 'pl', file_url: path, file_name: fileName, generated_by: user?.id,
      });
      if (insErr) throw insErr;
      toast.success('Report generated');
      await reload();
    } catch (err) {
      toast.error(err.message || 'Failed to generate');
    } finally {
      setGenerating(false);
    }
  }

  async function downloadPdf() {
    try {
      const url = await getSignedUrl('reports', existing.file_url);
      window.open(url, '_blank');
    } catch (err) { toast.error(err.message || 'Could not download'); }
  }

  return (
    <div className="space-y-4">
      {/* ── Revenue Breakdown ── */}
      <div className="card p-5">
        <div className="flex items-start justify-between mb-3 gap-3">
          <div>
            <div className="font-display text-lg">Revenue Breakdown</div>
            <div className="text-xs text-surface-500 mt-0.5">
              POS-driven revenue that isn't in the bank feed. Posted as credits to revenue categories on {periodRange(period).end}.
            </div>
          </div>
          {dailySales && dailyRowCount > 0 && (
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-surface-500 font-semibold">Daily Sales total for {monthLabel}</div>
              <div className="font-mono text-sm font-semibold">{formatCurrency(dailySales.total)}</div>
              <button onClick={prefillFromDailySales} className="btn-ghost text-xs mt-1">Use this</button>
            </div>
          )}
        </div>

        {existingRevJEs.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 mb-3">
            <div className="flex items-center gap-2 text-sm text-amber-900">
              <AlertCircle size={14} />
              <span>
                {existingRevJEs.length} revenue {existingRevJEs.length === 1 ? 'entry' : 'entries'} already posted for {monthLabel}:
                {' '}
                {existingRevJEs.map(j => (
                  <span key={j.id} className="font-mono font-semibold ml-1">{j.reference} ({formatCurrency(j.total_amount)})</span>
                ))}
              </span>
            </div>
            <div className="text-xs text-amber-800 mt-1">Posting again will replace these, not stack on top.</div>
          </div>
        )}

        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={l.label}
                onChange={e => updateLine(i, 'label', e.target.value)}
                placeholder="Label (e.g. Liquor Sales)"
                className="input-field flex-1"
                list="revenue-category-suggestions"
              />
              <input
                type="number"
                min="0"
                step="0.01"
                value={l.amount}
                onChange={e => updateLine(i, 'amount', e.target.value)}
                placeholder="0.00"
                className="input-field w-32 text-right font-mono"
              />
              <button
                type="button"
                onClick={() => removeLine(i)}
                className="btn-ghost p-2 text-surface-400 hover:text-red-600"
                aria-label="Remove line"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <datalist id="revenue-category-suggestions">
            {revenueCatNames.map(n => <option key={n} value={n} />)}
          </datalist>
        </div>

        <div className="flex items-center justify-between mt-3">
          <button onClick={addLine} className="btn-ghost text-xs flex items-center gap-1.5">
            <Plus size={12} /> Add line
          </button>
          <div className="flex items-center gap-3">
            <div className="text-xs text-surface-500">Breakdown total</div>
            <div className="font-mono text-sm font-semibold">{formatCurrency(breakdownTotal)}</div>
            <button
              onClick={postBreakdown}
              disabled={posting || breakdownTotal <= 0}
              className="btn-primary text-sm flex items-center gap-2"
            >
              {posting && <Loader2 size={14} className="animate-spin" />}
              {existingRevJEs.length ? <RotateCw size={14} /> : <CheckCircle2 size={14} />}
              {existingRevJEs.length ? 'Replace & Post' : 'Post Revenue'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Live preview ── */}
      <div className="card p-5">
        <div className="text-xs uppercase tracking-wider text-surface-500 font-semibold mb-3">
          Preview · live
          {breakdownTotal > 0 && <span className="ml-2 text-surface-400 normal-case tracking-normal text-[10px]">(includes unposted breakdown)</span>}
        </div>
        <div className="grid grid-cols-3 gap-3">
          <StatPill label="Revenue"  value={formatCurrency(liveRevenue)}  tone="green" />
          <StatPill label="Expenses" value={formatCurrency(liveExpenses)} tone="red" />
          <StatPill label="Net"      value={formatCurrency(liveNet)}      tone={liveNet >= 0 ? 'green' : 'red'} />
        </div>
        {preview.revenue?.length > 0 && (
          <details className="mt-3">
            <summary className="text-xs text-surface-500 cursor-pointer hover:text-surface-700">Posted revenue by category</summary>
            <table className="w-full mt-2 text-xs">
              <tbody>
                {preview.revenue.map(r => (
                  <tr key={r.account} className="border-b border-surface-50 last:border-0">
                    <td className="py-1 pr-2">{r.account}</td>
                    <td className="py-1 text-right font-mono">{formatCurrency(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
      </div>

      {/* ── Generate PDF ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <button onClick={generatePdf} disabled={generating}
          className="card p-5 text-left hover:border-brand-400 hover:shadow-md transition flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-brand-100 text-brand-600 flex items-center justify-center">
            {generating ? <Loader2 className="animate-spin" /> : <FileBarChart />}
          </div>
          <div>
            <div className="font-display text-lg">{existing ? 'Regenerate' : 'Generate'} P&L</div>
            <div className="text-xs text-surface-500 mt-0.5">Uses posted transactions for this period</div>
          </div>
        </button>
        {existing && (
          <button onClick={downloadPdf}
            className="card p-5 text-left hover:border-green-400 hover:shadow-md transition flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-green-100 text-green-600 flex items-center justify-center">
              <CheckCircle2 />
            </div>
            <div>
              <div className="font-display text-lg">Download PDF</div>
              <div className="text-xs text-surface-500 mt-0.5">Generated {new Date(existing.created_at).toLocaleString()}</div>
            </div>
          </button>
        )}
      </div>
    </div>
  );
}

// Revenue JE reference numbers share the JE-### sequence with payroll.
async function nextRevenueReference() {
  const { data } = await supabase.from('journal_entries')
    .select('reference').order('created_at', { ascending: false }).limit(1);
  const last = data?.[0]?.reference || '';
  const m = last.match(/JE-(\d+)/);
  const n = m ? parseInt(m[1], 10) + 1 : 1;
  return `JE-${String(n).padStart(3, '0')}`;
}

function StepClose({ data, period, streak, finalStats }) {
  if (finalStats) {
    return (
      <div className="text-center py-4">
        <div className="inline-block bg-gradient-to-br from-green-100 to-brand-100 px-10 py-8 rounded-3xl">
          <Trophy size={56} className="mx-auto text-amber-500 mb-2" />
          <div className="font-display text-3xl">{periodLabel(period)} Closed!</div>
          <div className="text-sm text-surface-600 mt-1">
            {finalStats.postedCount} transactions · {finalStats.journalCount} journal entries · {finalStats.reportsCount} reports
          </div>
          <div className="mt-4 flex items-center justify-center gap-4">
            <div>
              <div className="text-xs uppercase tracking-wider text-surface-500">Time</div>
              <div className="font-mono text-lg font-semibold">{finalStats.timeLabel}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-surface-500">Score</div>
              <div className="font-mono text-lg font-semibold">{finalStats.score}/100</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-surface-500">Streak</div>
              <div className="font-mono text-lg font-semibold flex items-center justify-center gap-1">
                <Flame size={16} className="text-orange-500" /> {finalStats.newStreak}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <StatPill label="Transactions posted" value={data.postedCount || 0} tone="green" />
        <StatPill label="Journal entries"     value={data.journalCount || 0} />
        <StatPill label="Reports generated"   value={data.reportsCount || 0} tone="green" />
      </div>
      <div className="card p-5 bg-gradient-to-br from-brand-50 to-green-50">
        <div className="font-display text-lg mb-1">Ready to close {periodFullLabel(period)}?</div>
        <p className="text-sm text-surface-600">
          Once closed, this period is marked done. You can reopen it later from the Accountant dashboard if needed.
        </p>
        {streak > 0 && (
          <p className="text-sm mt-2 text-orange-700 flex items-center gap-1.5">
            <Flame size={14} /> Closing this keeps your {streak}-month streak alive.
          </p>
        )}
      </div>
    </div>
  );
}

// ===========================================================================
// SHARED LITTLE BITS
// ===========================================================================
function StatPill({ label, value, tone = 'neutral' }) {
  const toneClass = {
    green:   'text-green-700',
    red:     'text-red-700',
    amber:   'text-amber-700',
    neutral: 'text-surface-800',
  }[tone];
  return (
    <div className="card p-3">
      <div className="text-[10px] uppercase tracking-wider text-surface-500 font-semibold">{label}</div>
      <div className={`font-mono text-lg font-semibold mt-1 ${toneClass}`}>{value}</div>
    </div>
  );
}

// P&L / BS aggregators live in src/lib/finance.js — shared by every report site.
