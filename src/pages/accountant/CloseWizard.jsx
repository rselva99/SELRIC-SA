import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useData } from '../../contexts/DataContext';
import { formatCurrency, formatDate } from '../../lib/utils';
import { generatePnLPdf, generateBalanceSheetPdf } from '../../lib/reports';
import Spinner from '../../components/ui/Spinner';
import toast from 'react-hot-toast';
import {
  X, Minimize2, ChevronLeft, ChevronRight, Play, Trophy, Zap,
  CheckCircle2, SkipForward, AlertCircle, FileBarChart, FileText,
  Sparkles, Flame, Loader2,
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
  const [completing, setCompleting]         = useState(false);
  const [accountsReviewed, setAccountsReviewed] = useState(new Set());
  const [achievementsEarned, setAchievements]   = useState(new Set());
  const [skipped, setSkipped]                   = useState(new Set());
  const [streak, setStreak]                     = useState(0);
  const [showExitConfirm, setShowExitConfirm]   = useState(false);
  const [finalStats, setFinalStats]             = useState(null);

  const startedAtRef     = useRef(Date.now());
  const stepStartedAtRef = useRef(Date.now());

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
  const loadStepData = useCallback(async () => {
    setStepLoading(true);
    try {
      const key = currentStep.key;
      if (key === 'categorize') {
        const { data } = await supabase.from('transactions')
          .select('id, date, description, supplier, amount, type, category, account_id, posted')
          .gte('date', periodStart).lte('date', periodEnd)
          .or('category.is.null,category.eq.')
          .order('date', { ascending: true });
        const total = await supabase.from('transactions')
          .select('*', { count: 'exact', head: true })
          .gte('date', periodStart).lte('date', periodEnd);
        setStepData({ uncategorized: data || [], totalTxns: total.count || 0 });
      } else if (key === 'post') {
        const { data } = await supabase.from('transactions')
          .select('id, date, description, amount, type, category')
          .gte('date', periodStart).lte('date', periodEnd)
          .eq('posted', false).not('category', 'is', null).neq('category', '')
          .order('date', { ascending: true });
        setStepData({ unposted: data || [], selected: new Set((data || []).map(r => r.id)) });
      } else if (key === 'journal_rules') {
        const { data: rules } = await supabase.from('journal_rules').select('*').eq('active', true);
        const { data: entries } = await supabase.from('journal_entries').select('rule_id').gte('date', periodStart).lte('date', periodEnd).not('rule_id', 'is', null);
        const ranRuleIds = new Set((entries || []).map(e => e.rule_id));
        setStepData({ rules: rules || [], ranRuleIds });
      } else if (key === 'manual_journals') {
        const { data } = await supabase.from('journal_entries')
          .select('id, reference, date, description, status, total_amount')
          .gte('date', periodStart).lte('date', periodEnd)
          .eq('status', 'draft')
          .is('rule_id', null)
          .order('date');
        setStepData({ drafts: data || [] });
      } else if (key === 'reconcile') {
        const { data } = await supabase.from('transactions')
          .select('id, date, description, amount')
          .gte('date', periodStart).lte('date', periodEnd)
          .eq('type', 'debit').eq('reconciled', false)
          .order('date');
        setStepData({ unreconciled: data || [] });
      } else if (key === 'review_balances') {
        const { data: txns } = await supabase.from('transactions')
          .select('account_id, amount, type')
          .gte('date', periodStart).lte('date', periodEnd)
          .eq('posted', true);
        const balByAcc = {};
        (txns || []).forEach(t => {
          if (!t.account_id) return;
          const delta = t.type === 'credit' ? Math.abs(t.amount) : -Math.abs(t.amount);
          balByAcc[t.account_id] = (balByAcc[t.account_id] || 0) + delta;
        });
        const list = accounts
          .map(a => ({ id: a.id, name: a.name, type: a.type, balance: balByAcc[a.id] || 0 }))
          .filter(a => a.balance !== 0)
          .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
        const max = Math.max(...list.map(a => Math.abs(a.balance)), 1);
        list.forEach(a => { a.unusual = Math.abs(a.balance) > max * 0.4 && Math.abs(a.balance) > 1000; });
        setStepData({ accountBalances: list });
      } else if (key === 'generate_pl' || key === 'generate_bs') {
        const reportType = key === 'generate_pl' ? 'pl' : 'balance_sheet';
        const [{ data: existing }, { data: txns }] = await Promise.all([
          supabase.from('report_deliverables').select('id, created_at, file_url').eq('period', period).eq('report_type', reportType).order('created_at', { ascending: false }).limit(1),
          supabase.from('transactions').select('*').gte('date', periodStart).lte('date', periodEnd).eq('posted', true),
        ]);
        setStepData({
          existingReport: existing?.[0],
          postedTxns: txns || [],
          preview: key === 'generate_pl' ? aggregateForPnL(txns || []) : aggregateForBS(txns || [], accounts),
        });
      } else if (key === 'close') {
        const [postedRes, jeRes, deliverRes] = await Promise.all([
          supabase.from('transactions').select('*', { count: 'exact', head: true }).gte('date', periodStart).lte('date', periodEnd).eq('posted', true),
          supabase.from('journal_entries').select('*', { count: 'exact', head: true }).gte('date', periodStart).lte('date', periodEnd).eq('status', 'posted'),
          supabase.from('report_deliverables').select('report_type').eq('period', period),
        ]);
        setStepData({
          postedCount: postedRes.count || 0,
          journalCount: jeRes.count || 0,
          reportsCount: deliverRes.data?.length || 0,
          reportTypes: [...new Set((deliverRes.data || []).map(r => r.report_type))],
        });
      }
    } finally {
      setStepLoading(false);
    }
  }, [currentStep.key, periodStart, periodEnd, period, accounts]);

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
    if (stepLoading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;
    switch (currentStep.key) {
      case 'categorize':       return <StepCategorize data={stepData} setData={setStepData} period={period} categories={categories} reload={loadStepData} />;
      case 'post':             return <StepPost       data={stepData} setData={setStepData} reload={loadStepData} />;
      case 'journal_rules':    return <StepJournalRules data={stepData} navigate={navigate} />;
      case 'manual_journals':  return <StepManualJournals data={stepData} navigate={navigate} />;
      case 'reconcile':        return <StepReconcile  data={stepData} navigate={navigate} reload={loadStepData} />;
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
                      {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
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

function StepReconcile({ data, navigate, reload }) {
  const list = data.unreconciled || [];
  async function markReconciled(id) {
    const { error } = await supabase.from('transactions').update({ reconciled: true }).eq('id', id);
    if (error) toast.error(error.message); else await reload();
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
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm text-surface-500">
          For full invoice matching use the Reconciliation page; here you can quickly mark as reconciled.
        </div>
        <button onClick={() => navigate('/bookkeeping/reconcile')} className="btn-secondary text-xs">Open Reconciliation</button>
      </div>
      <div className="card overflow-hidden max-h-[400px] overflow-y-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-surface-50">
            <tr className="border-b border-surface-100">
              <th className="table-header">Date</th>
              <th className="table-header">Description</th>
              <th className="table-header text-right">Amount</th>
              <th className="table-header text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {list.map(t => (
              <tr key={t.id} className="border-b border-surface-50">
                <td className="table-cell font-mono text-xs">{formatDate(t.date)}</td>
                <td className="table-cell text-sm truncate max-w-xs" title={t.description}>{t.description}</td>
                <td className="table-cell text-right font-mono text-xs">{formatCurrency(Math.abs(t.amount))}</td>
                <td className="table-cell text-right">
                  <button onClick={() => markReconciled(t.id)} className="btn-ghost text-xs">Mark reconciled</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StepReviewBalances({ data, reviewed, setReviewed }) {
  const list = data.accountBalances || [];
  function toggle(id) {
    const next = new Set(reviewed);
    if (next.has(id)) next.delete(id); else next.add(id);
    setReviewed(next);
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
        Click an account once you've eyeballed its balance. Amber rows look unusually large.
      </div>
      <div className="card overflow-hidden">
        <table className="w-full">
          <thead><tr className="border-b border-surface-100 bg-surface-50">
            <th className="table-header w-8"></th>
            <th className="table-header">Account</th>
            <th className="table-header">Type</th>
            <th className="table-header text-right">Period balance</th>
          </tr></thead>
          <tbody>
            {list.map(a => {
              const done = reviewed.has(a.id);
              return (
                <tr key={a.id} onClick={() => toggle(a.id)}
                  className={`border-b border-surface-50 cursor-pointer ${
                    done ? 'bg-green-50' : a.unusual ? 'bg-amber-50' : ''
                  }`}>
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
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StepGenerateReport({ data, period, reportType, reload }) {
  const { user } = useAuth();
  const { getSignedUrl, accounts } = useData();
  const [busy, setBusy] = useState(false);
  const isPL = reportType === 'pl';
  const preview = data.preview || {};
  const existing = data.existingReport;

  async function generate() {
    setBusy(true);
    try {
      const label = periodFullLabel(period);
      const pdf = isPL
        ? generatePnLPdf(aggregateForPnL(data.postedTxns || []), label)
        : generateBalanceSheetPdf(aggregateForBS(data.postedTxns || [], accounts), label);
      const blob = pdf.output('blob');
      const fileName = `${reportType}_${period}_${Date.now()}.pdf`;
      const path = `${period}/${fileName}`;
      const { error: upErr } = await supabase.storage.from('reports').upload(path, blob, { contentType: 'application/pdf' });
      if (upErr) throw upErr;
      const { error: insErr } = await supabase.from('report_deliverables').insert({
        period, report_type: reportType, file_url: path, file_name: fileName, generated_by: user?.id,
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
            {busy ? <Loader2 className="animate-spin" /> : (isPL ? <FileBarChart /> : <FileText />)}
          </div>
          <div>
            <div className="font-display text-lg">{existing ? 'Regenerate' : 'Generate'} {isPL ? 'P&L' : 'Balance Sheet'}</div>
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

      {/* Inline preview */}
      {isPL ? (
        <div className="card p-5">
          <div className="text-xs uppercase tracking-wider text-surface-500 font-semibold mb-3">Preview</div>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <StatPill label="Revenue"  value={formatCurrency(preview.totalRevenue || 0)} tone="green" />
            <StatPill label="Expenses" value={formatCurrency(preview.totalExpenses || 0)} tone="red" />
            <StatPill label="Net" value={formatCurrency((preview.totalRevenue || 0) - (preview.totalExpenses || 0))} tone={(preview.totalRevenue || 0) - (preview.totalExpenses || 0) >= 0 ? 'green' : 'red'} />
          </div>
        </div>
      ) : (
        <div className="card p-5">
          <div className="text-xs uppercase tracking-wider text-surface-500 font-semibold mb-3">Preview</div>
          <div className="grid grid-cols-3 gap-3">
            <StatPill label="Assets"      value={formatCurrency(preview.totalAssets || 0)} />
            <StatPill label="Liabilities" value={formatCurrency(preview.totalLiabilities || 0)} />
            <StatPill label="Equity"      value={formatCurrency(preview.totalEquity || 0)} />
          </div>
        </div>
      )}
    </div>
  );
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

// ===========================================================================
// PDF aggregation helpers (duplicated from AccountantPage to keep wizard self-contained)
// ===========================================================================
function aggregateForPnL(transactions) {
  const revByCat = {}, expByCat = {};
  for (const t of transactions) {
    const cat = t.category || 'Uncategorized';
    if (t.type === 'credit' || cat.startsWith('Revenue')) revByCat[cat] = (revByCat[cat] || 0) + Math.abs(t.amount);
    else if (t.type === 'debit') expByCat[cat] = (expByCat[cat] || 0) + Math.abs(t.amount);
  }
  const revenue       = Object.entries(revByCat).sort((a,b) => b[1] - a[1]).map(([account, amount]) => ({ account, amount }));
  const expenses      = Object.entries(expByCat).sort((a,b) => b[1] - a[1]).map(([account, amount]) => ({ account, amount }));
  const totalRevenue  = revenue.reduce((s, r) => s + r.amount, 0);
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
  return { revenue, expenses, totalRevenue, totalExpenses };
}

function aggregateForBS(transactions, accounts) {
  const balanceByAcc = {};
  for (const t of transactions) {
    if (!t.account_id) continue;
    const delta = t.type === 'credit' ? -Math.abs(t.amount) : Math.abs(t.amount);
    balanceByAcc[t.account_id] = (balanceByAcc[t.account_id] || 0) + delta;
  }
  const sections = { asset: [], liability: [], equity: [] };
  for (const acc of accounts || []) {
    const bal = balanceByAcc[acc.id] || 0;
    if (bal === 0) continue;
    const bucket = sections[acc.type];
    if (bucket) bucket.push({ account: acc.name, amount: bal });
  }
  return {
    assets: sections.asset, liabilities: sections.liability, equity: sections.equity,
    totalAssets:      sections.asset.reduce((s, x) => s + x.amount, 0),
    totalLiabilities: sections.liability.reduce((s, x) => s + x.amount, 0),
    totalEquity:      sections.equity.reduce((s, x) => s + x.amount, 0),
  };
}
