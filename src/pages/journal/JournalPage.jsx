import { useState, useMemo, useEffect, useCallback, Fragment } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useData } from '../../contexts/DataContext';
import { formatCurrency, formatDate, DEFAULT_CATEGORIES } from '../../lib/utils';
import Modal from '../../components/ui/Modal';
import EmptyState from '../../components/ui/EmptyState';
import Spinner from '../../components/ui/Spinner';
import toast from 'react-hot-toast';
import {
  BookText, PlusCircle, Trash2, ChevronDown, ChevronRight,
  Repeat, CalendarRange, Power, PowerOff, Undo2, FileSpreadsheet, Wallet,
} from 'lucide-react';
import PayrollJournalForm from '../../components/PayrollJournalForm';

const RULE_TYPES = {
  net_to_zero:   'Net to Zero',
  fixed_amount:  'Fixed Amount',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function blankSimpleForm() {
  return {
    date: new Date().toISOString().slice(0,10),
    description: '', amount: '', type: 'debit',
    category: '', account_id: '', reference: '',
  };
}

function blankAdvancedForm() {
  return {
    date: new Date().toISOString().slice(0,10),
    description: '', memo: '',
    lines: [
      { account_id: '', description: '', debit: '', credit: '', category: '' },
      { account_id: '', description: '', debit: '', credit: '', category: '' },
    ],
  };
}

function blankRuleForm() {
  return {
    name: '', rule_type: 'net_to_zero',
    match_keyword: '', match_category: '',
    fixed_amount: '', fixed_type: 'debit',
    account_id: '', category: '',
    frequency: 'monthly', active: true,
  };
}

async function nextReference() {
  // Find the highest existing JE-NNN reference. We must ignore the
  // non-numeric variants (JE-OPENING, JE-CAP-NNN, JE-DA-YYYY-MM) — otherwise
  // peeking at just the most-recently-created entry yields a stray "JE-1"
  // (or some inner digit run) and the insert collides with an existing
  // reference, failing on the unique constraint.
  const { data, error } = await supabase
    .from('journal_entries')
    .select('reference')
    .ilike('reference', 'JE-%')
    .order('reference', { ascending: false })
    .limit(500);
  if (error) {
    console.error('nextReference: failed to load references', error);
    throw error;
  }
  let maxN = 0;
  for (const r of data || []) {
    const m = (r.reference || '').match(/^JE-(\d+)$/);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    if (n > maxN) maxN = n;
  }
  return `JE-${String(maxN + 1).padStart(3, '0')}`;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function JournalPage() {
  const { user } = useAuth();
  const { accounts, categories } = useData();

  const [mode, setMode] = useState('simple');   // simple | advanced | rules
  const [simpleForm, setSimpleForm]     = useState(blankSimpleForm);
  const [advancedForm, setAdvancedForm] = useState(blankAdvancedForm);
  const [savingSimple, setSavingSimple] = useState(false);
  const [savingAdvanced, setSavingAdvanced] = useState(false);

  const [rules, setRules]               = useState([]);
  const [rulesLoading, setRulesLoading] = useState(true);
  const [ruleForm, setRuleForm]         = useState(blankRuleForm);
  const [showRuleModal, setShowRuleModal] = useState(false);

  const [showGenModal, setShowGenModal]       = useState(false);
  const [genMonth, setGenMonth]               = useState(() => new Date().toISOString().slice(0,7));
  const [genPreview, setGenPreview]           = useState([]);  // [{rule, entry, lines}]
  const [selectedGen, setSelectedGen]         = useState(() => new Set());
  const [generating, setGenerating]           = useState(false);
  const [approvingGen, setApprovingGen]       = useState(false);
  const [showPayrollModal, setShowPayrollModal] = useState(false);

  const [entries, setEntries]               = useState([]);
  const [entryLines, setEntryLines]         = useState({});  // {entryId: [lines]}
  const [expandedEntries, setExpandedEntries] = useState(new Set());
  const [historyLoading, setHistoryLoading] = useState(true);

  const allCategories = useMemo(() => {
    const set = new Set([...DEFAULT_CATEGORIES, ...categories.map(c => c.name)]);
    return [...set].sort();
  }, [categories]);

  // ── Loaders ───────────────────────────────────────────────────────────────

  const loadRules = useCallback(async () => {
    setRulesLoading(true);
    const { data } = await supabase.from('journal_rules')
      .select('*').order('created_at', { ascending: false });
    setRules(data || []);
    setRulesLoading(false);
  }, []);

  const loadEntries = useCallback(async () => {
    setHistoryLoading(true);
    const { data } = await supabase.from('journal_entries')
      .select('*').order('created_at', { ascending: false }).limit(100);
    setEntries(data || []);
    setHistoryLoading(false);
  }, []);

  useEffect(() => { loadRules(); }, [loadRules]);
  useEffect(() => { loadEntries(); }, [loadEntries]);

  async function toggleExpand(entryId) {
    setExpandedEntries(prev => {
      const next = new Set(prev);
      if (next.has(entryId)) next.delete(entryId); else next.add(entryId);
      return next;
    });
    if (!entryLines[entryId]) {
      const { data } = await supabase.from('journal_entry_lines')
        .select('*').eq('journal_entry_id', entryId).order('created_at');
      setEntryLines(prev => ({ ...prev, [entryId]: data || [] }));
    }
  }

  // ── Simple entry ──────────────────────────────────────────────────────────

  async function handleSimpleSubmit(e) {
    e.preventDefault();
    if (!simpleForm.description || !simpleForm.amount || !simpleForm.date) {
      toast.error('Date, description, and amount are required'); return;
    }
    setSavingSimple(true);
    try {
      const amount = Math.abs(parseFloat(simpleForm.amount));
      const reference = await nextReference();
      const { data: entry, error: e1 } = await supabase.from('journal_entries')
        .insert({
          reference, date: simpleForm.date,
          description: simpleForm.description,
          memo: simpleForm.reference || null,
          total_amount: amount,
          status: 'posted',
          entry_type: 'simple',
          created_by: user?.id || null,
          posted_at: new Date().toISOString(),
        }).select().single();
      if (e1) throw e1;

      // simpleForm.account_id holds a `categories.id`; the schema's account_id
      // column FKs to the legacy (empty) `accounts` table. Pass null and fall
      // back to the chosen account's name for the category text if the user
      // didn't pick a separate Category.
      const accountName = categoryNameById[simpleForm.account_id] || '';
      const categoryText = simpleForm.category || accountName || '';

      await supabase.from('journal_entry_lines').insert({
        journal_entry_id: entry.id,
        account_id: null,
        description: simpleForm.description,
        debit_amount:  simpleForm.type === 'debit'  ? amount : 0,
        credit_amount: simpleForm.type === 'credit' ? amount : 0,
        category: categoryText || null,
      });

      await supabase.from('transactions').insert({
        date: simpleForm.date,
        description: simpleForm.description,
        supplier: simpleForm.description,
        amount, type: simpleForm.type,
        category: categoryText,
        account_id: null,
        reference: simpleForm.reference || '',
        bank_statement_id: null,
        journal_entry_id: entry.id,
        posted: true,
      });

      toast.success(`Posted ${reference}`);
      setSimpleForm(blankSimpleForm());
      loadEntries();
    } catch (err) { toast.error(err.message || 'Failed'); }
    finally { setSavingSimple(false); }
  }

  // ── Advanced (double-entry) ───────────────────────────────────────────────

  const totalDebit  = useMemo(
    () => advancedForm.lines.reduce((s, l) => s + (parseFloat(l.debit)  || 0), 0),
    [advancedForm.lines]
  );
  const totalCredit = useMemo(
    () => advancedForm.lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0),
    [advancedForm.lines]
  );
  const diff       = totalDebit - totalCredit;
  const balanced   = Math.abs(diff) < 0.005 && totalDebit > 0;

  function setLine(idx, patch) {
    setAdvancedForm(f => ({
      ...f,
      lines: f.lines.map((l, i) => i === idx ? { ...l, ...patch } : l),
    }));
  }
  function addLine() {
    setAdvancedForm(f => ({
      ...f,
      lines: [...f.lines, { account_id: '', description: '', debit: '', credit: '', category: '' }],
    }));
  }
  function removeLine(idx) {
    setAdvancedForm(f => ({
      ...f,
      lines: f.lines.length <= 2 ? f.lines : f.lines.filter((_, i) => i !== idx),
    }));
  }

  async function handleAdvancedPost(e) {
    e.preventDefault();
    if (!balanced) { toast.error('Total debits must equal total credits'); return; }
    if (!advancedForm.description) { toast.error('Description required'); return; }
    setSavingAdvanced(true);
    try {
      const reference = await nextReference();
      const { data: entry, error: e1 } = await supabase.from('journal_entries')
        .insert({
          reference, date: advancedForm.date,
          description: advancedForm.description,
          memo: advancedForm.memo || null,
          total_amount: totalDebit,
          status: 'posted',
          entry_type: 'double',
          created_by: user?.id || null,
          posted_at: new Date().toISOString(),
        }).select().single();
      if (e1) throw e1;

      const validLines = advancedForm.lines.filter(l =>
        (parseFloat(l.debit) || 0) > 0 || (parseFloat(l.credit) || 0) > 0
      );

      // Same workaround as Simple mode: account_id is sourced from `categories`,
      // FK is to the empty `accounts` table — write null, fall back to the
      // account-as-category name for the category text column.
      const lineRows = validLines.map(l => {
        const accountName = categoryNameById[l.account_id] || '';
        return {
          journal_entry_id: entry.id,
          account_id: null,
          description: l.description || advancedForm.description,
          debit_amount:  parseFloat(l.debit)  || 0,
          credit_amount: parseFloat(l.credit) || 0,
          category: (l.category || accountName) || null,
        };
      });
      const { error: e2 } = await supabase.from('journal_entry_lines').insert(lineRows);
      if (e2) throw e2;

      const txnRows = validLines.map(l => {
        const isDebit = (parseFloat(l.debit) || 0) > 0;
        const accountName = categoryNameById[l.account_id] || '';
        return {
          date: advancedForm.date,
          description: l.description || advancedForm.description,
          supplier: l.description || advancedForm.description,
          amount: isDebit ? parseFloat(l.debit) : parseFloat(l.credit),
          type: isDebit ? 'debit' : 'credit',
          category: l.category || accountName || '',
          account_id: null,
          reference,
          bank_statement_id: null,
          journal_entry_id: entry.id,
          posted: true,
        };
      });
      const { error: e3 } = await supabase.from('transactions').insert(txnRows);
      if (e3) throw e3;

      toast.success(`Posted ${reference} (${validLines.length} lines)`);
      setAdvancedForm(blankAdvancedForm());
      loadEntries();
    } catch (err) { toast.error(err.message || 'Failed'); }
    finally { setSavingAdvanced(false); }
  }

  // ── Rules CRUD ────────────────────────────────────────────────────────────

  async function handleSaveRule(e) {
    e.preventDefault();
    if (!ruleForm.name) { toast.error('Name required'); return; }
    if (ruleForm.rule_type === 'net_to_zero' && !ruleForm.match_keyword && !ruleForm.match_category) {
      toast.error('Net to Zero needs a keyword or category to match'); return;
    }
    if (ruleForm.rule_type === 'fixed_amount' && (!ruleForm.fixed_amount || parseFloat(ruleForm.fixed_amount) <= 0)) {
      toast.error('Fixed amount must be > 0'); return;
    }
    try {
      const payload = {
        ...ruleForm,
        fixed_amount: parseFloat(ruleForm.fixed_amount) || 0,
        match_keyword: ruleForm.match_keyword || null,
        match_category: ruleForm.match_category || null,
        account_id: ruleForm.account_id || null,
        category: ruleForm.category || null,
        user_id: user?.id || null,
      };
      const { error } = await supabase.from('journal_rules').insert(payload);
      if (error) throw error;
      toast.success('Rule saved');
      setShowRuleModal(false);
      setRuleForm(blankRuleForm());
      loadRules();
    } catch (err) { toast.error(err.message || 'Failed'); }
  }

  async function toggleRuleActive(rule) {
    setRules(prev => prev.map(r => r.id === rule.id ? { ...r, active: !r.active } : r));
    await supabase.from('journal_rules').update({ active: !rule.active }).eq('id', rule.id);
  }

  async function deleteRule(rule) {
    if (!confirm(`Delete rule "${rule.name}"?`)) return;
    setRules(prev => prev.filter(r => r.id !== rule.id));
    await supabase.from('journal_rules').delete().eq('id', rule.id);
    toast.success('Rule deleted');
  }

  // ── Generate Monthly Entries ──────────────────────────────────────────────

  async function buildMonthlyPreview() {
    setGenerating(true);
    setGenPreview([]);
    try {
      const [yr, mo] = genMonth.split('-').map(Number);
      const start = `${yr}-${String(mo).padStart(2,'0')}-01`;
      const endDate = new Date(yr, mo, 0).getDate();
      const end = `${yr}-${String(mo).padStart(2,'0')}-${String(endDate).padStart(2,'0')}`;

      const previews = [];
      for (const rule of rules.filter(r => r.active)) {
        if (rule.rule_type === 'fixed_amount') {
          const isDebit = rule.fixed_type === 'debit';
          previews.push({
            rule,
            entry: {
              date: end,
              description: rule.name,
              memo: `Auto-generated for ${genMonth}`,
              total_amount: rule.fixed_amount,
            },
            lines: [{
              account_id: rule.account_id,
              description: rule.name,
              debit_amount:  isDebit ? rule.fixed_amount : 0,
              credit_amount: isDebit ? 0 : rule.fixed_amount,
              category: rule.category || null,
            }],
          });
        } else {
          // net_to_zero: find matching transactions in the month, sum them, offset
          let q = supabase.from('transactions').select('amount, type')
            .gte('date', start).lte('date', end);
          if (rule.match_category) q = q.eq('category', rule.match_category);
          if (rule.match_keyword)  q = q.ilike('description', `%${rule.match_keyword}%`);
          const { data: matched } = await q;
          const net = (matched || []).reduce((s, t) =>
            s + (t.type === 'debit' ? -Math.abs(t.amount) : Math.abs(t.amount)), 0);
          if (Math.abs(net) < 0.01) continue;
          // Offset: if net is negative (debits > credits), add a credit equal to |net|
          const offsetIsCredit = net < 0;
          const amt = Math.abs(net);
          previews.push({
            rule,
            entry: {
              date: end,
              description: `${rule.name} — net to zero`,
              memo: `Auto-generated for ${genMonth} · ${matched?.length || 0} matched txns`,
              total_amount: amt,
            },
            lines: [{
              account_id: rule.account_id,
              description: `Offset for ${rule.match_keyword || rule.match_category}`,
              debit_amount:  offsetIsCredit ? 0 : amt,
              credit_amount: offsetIsCredit ? amt : 0,
              category: rule.category || rule.match_category || null,
            }],
          });
        }
      }
      setGenPreview(previews);
      setSelectedGen(new Set(previews.map((_, i) => i)));
      if (!previews.length) toast('No entries generated — check rule keywords/categories', { icon: 'ℹ️' });
    } catch (err) { toast.error(err.message || 'Generate failed'); }
    finally { setGenerating(false); }
  }

  async function approveAllGenerated() {
    const toPost = genPreview.filter((_, i) => selectedGen.has(i));
    if (!toPost.length) return;
    setApprovingGen(true);
    try {
      for (const p of toPost) {
        const reference = await nextReference();
        const { data: entry } = await supabase.from('journal_entries').insert({
          reference,
          date: p.entry.date,
          description: p.entry.description,
          memo: p.entry.memo,
          total_amount: p.entry.total_amount,
          status: 'posted',
          entry_type: 'auto',
          rule_id: p.rule.id,
          created_by: user?.id || null,
          posted_at: new Date().toISOString(),
        }).select().single();
        if (!entry) continue;

        const lineRows = p.lines.map(l => ({ ...l, journal_entry_id: entry.id }));
        await supabase.from('journal_entry_lines').insert(lineRows);

        const txnRows = p.lines.map(l => {
          const isDebit = (l.debit_amount || 0) > 0;
          return {
            date: entry.date,
            description: l.description || entry.description,
            supplier: l.description || entry.description,
            amount: isDebit ? l.debit_amount : l.credit_amount,
            type: isDebit ? 'debit' : 'credit',
            category: l.category || '',
            account_id: l.account_id || null,
            reference,
            bank_statement_id: null,
            journal_entry_id: entry.id,
            posted: true,
          };
        });
        await supabase.from('transactions').insert(txnRows);
      }
      toast.success(`Posted ${toPost.length} auto entr${toPost.length === 1 ? 'y' : 'ies'}`);
      setShowGenModal(false);
      setGenPreview([]);
      setSelectedGen(new Set());
      loadEntries();
    } catch (err) { toast.error(err.message || 'Failed'); }
    finally { setApprovingGen(false); }
  }

  function discardGenerated() {
    setGenPreview([]);
    setSelectedGen(new Set());
    setShowGenModal(false);
  }

  function toggleSelectGen(i) {
    setSelectedGen(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }
  function toggleSelectAllGen() {
    if (selectedGen.size === genPreview.length) setSelectedGen(new Set());
    else setSelectedGen(new Set(genPreview.map((_, i) => i)));
  }

  // ── Void / Reverse a posted entry ─────────────────────────────────────────

  async function voidEntry(entry) {
    if (!confirm(`Reverse ${entry.reference}? This creates an offsetting entry.`)) return;
    let createdReversalId = null; // tracked so we can roll back partial state
    try {
      // 1. Load original lines.
      const { data: origLines, error: linesErr } = await supabase
        .from('journal_entry_lines')
        .select('*')
        .eq('journal_entry_id', entry.id);
      if (linesErr) {
        console.error('voidEntry: failed to load original lines', linesErr);
        throw linesErr;
      }
      if (!origLines?.length) throw new Error('No lines to reverse');

      const reference = await nextReference();
      const today = new Date().toISOString().slice(0, 10);

      // 2. Insert the reversal JE. Captures the Supabase error so a unique-
      //    constraint collision (or RLS failure, etc.) shows the real reason
      //    instead of a silent "Failed to create reversal".
      const { data: rev, error: revErr } = await supabase
        .from('journal_entries')
        .insert({
          reference,
          date: today,
          description: `Reversal of ${entry.reference}`,
          memo: entry.description || null,
          total_amount: entry.total_amount,
          status: 'posted',
          entry_type: 'auto',
          created_by: user?.id || null,
          posted_at: new Date().toISOString(),
        })
        .select()
        .single();
      if (revErr) {
        console.error('voidEntry: failed to insert reversal JE', revErr);
        throw revErr;
      }
      if (!rev) throw new Error('Reversal insert returned no row');
      createdReversalId = rev.id;

      // 3. Swap debit ↔ credit on each line. For a Simple entry (single line,
      //    only debit OR only credit populated) this produces a single line
      //    on the opposite side — the same shape as a Simple JE.
      const revLines = origLines.map(l => ({
        journal_entry_id: rev.id,
        account_id: l.account_id,
        description: `Reversal: ${l.description || ''}`.trim(),
        debit_amount:  l.credit_amount || 0,
        credit_amount: l.debit_amount  || 0,
        category: l.category,
      }));
      const { error: revLinesErr } = await supabase.from('journal_entry_lines').insert(revLines);
      if (revLinesErr) {
        console.error('voidEntry: failed to insert reversal lines', revLinesErr);
        throw revLinesErr;
      }

      // 4. Mirror to the transactions table so P&L / Balance Sheet pick it up.
      const txnRows = revLines.map(l => {
        const isDebit = (l.debit_amount || 0) > 0;
        const amount  = isDebit ? l.debit_amount : l.credit_amount;
        return {
          date: today,
          description: l.description,
          supplier: l.description,
          amount,
          type: isDebit ? 'debit' : 'credit',
          category: l.category || '',
          account_id: l.account_id || null,
          reference,
          bank_statement_id: null,
          journal_entry_id: rev.id,
          posted: true,
        };
      });
      const { error: txnsErr } = await supabase.from('transactions').insert(txnRows);
      if (txnsErr) {
        console.error('voidEntry: failed to insert reversal transactions', txnsErr);
        throw txnsErr;
      }

      // 5. Mark the original voided.
      const { error: voidErr } = await supabase
        .from('journal_entries')
        .update({ status: 'voided' })
        .eq('id', entry.id);
      if (voidErr) {
        console.error('voidEntry: failed to mark original voided', voidErr);
        throw voidErr;
      }

      // All four writes succeeded — clear the rollback marker.
      createdReversalId = null;
      toast.success(`Reversed ${entry.reference} via ${reference}`);
      loadEntries();
    } catch (err) {
      // Roll back any partial state. journal_entry_lines cascade off the JE;
      // transactions have a SET NULL FK so we delete those explicitly first.
      if (createdReversalId) {
        try {
          await supabase.from('transactions').delete().eq('journal_entry_id', createdReversalId);
          await supabase.from('journal_entries').delete().eq('id', createdReversalId);
        } catch (cleanupErr) {
          console.error('voidEntry: rollback of partial reversal failed', cleanupErr);
        }
      }
      console.error('voidEntry failed:', err);
      toast.error(err?.message || 'Failed to create reversal');
    }
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  // The Account dropdown sources from `categories` (the table the Chart of
  // Accounts page actually maintains). The legacy `accounts` table is empty,
  // so we keep `accounts` destructured only for the journal-history Account
  // column lookup on older entries.
  const categoryNameById = useMemo(() => {
    const m = {};
    for (const c of categories) m[c.id] = c.name;
    return m;
  }, [categories]);

  const accountOptions = useMemo(() => {
    const order = ['expense', 'liability', 'asset', 'equity', 'revenue'];
    const label = { expense: 'Expense', liability: 'Liability', asset: 'Asset', equity: 'Equity', revenue: 'Revenue' };
    const groups = {};
    for (const c of categories) {
      const t = (c.type || 'other').toLowerCase();
      (groups[t] = groups[t] || []).push(c);
    }
    Object.values(groups).forEach(list => list.sort((a, b) => a.name.localeCompare(b.name)));
    const pairs = order
      .filter(t => groups[t])
      .map(t => [label[t] || t, groups[t]])
      .concat(Object.entries(groups).filter(([t]) => !order.includes(t)).map(([t, list]) => [t, list]));
    return (
      <>
        <option value="">— Select account —</option>
        {pairs.map(([type, list]) => (
          <optgroup key={type} label={type}>
            {list.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </optgroup>
        ))}
      </>
    );
  }, [categories]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="page-title">Journal</h1>
          <p className="text-surface-500 text-sm mt-0.5">Quick entries, double-entry journal, and recurring rules</p>
        </div>
        <button onClick={() => setShowPayrollModal(true)} className="btn-secondary flex items-center gap-2 text-sm">
          <Wallet size={14} /> Payroll Entry
        </button>
      </div>

      {/* Mode tabs */}
      <div className="flex flex-wrap gap-1 bg-surface-100 rounded-lg p-1 mb-6 w-fit">
        {[
          { id: 'simple',   label: 'Simple Mode' },
          { id: 'advanced', label: 'Advanced (Double-Entry)' },
          { id: 'rules',    label: 'Recurring Rules', count: rules.length },
        ].map(t => (
          <button key={t.id} onClick={() => setMode(t.id)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition ${mode===t.id?'bg-white shadow-sm text-surface-900':'text-surface-500 hover:text-surface-700'}`}>
            {t.label}{t.count != null && <span className="ml-1 text-xs opacity-60">({t.count})</span>}
          </button>
        ))}
      </div>

      {/* ── SIMPLE MODE ── */}
      {mode === 'simple' && (
        <div className="card p-6 mb-8">
          <h2 className="font-display text-lg mb-4 text-surface-900">Quick Entry</h2>
          <form onSubmit={handleSimpleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Date</label>
                <input type="date" value={simpleForm.date}
                  onChange={e => setSimpleForm({...simpleForm, date: e.target.value})}
                  className="input-field" required />
              </div>
              <div>
                <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Type</label>
                <select value={simpleForm.type}
                  onChange={e => setSimpleForm({...simpleForm, type: e.target.value})}
                  className="input-field">
                  <option value="debit">Debit (expense)</option>
                  <option value="credit">Credit (income)</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Description</label>
              <input type="text" value={simpleForm.description}
                onChange={e => setSimpleForm({...simpleForm, description: e.target.value})}
                className="input-field" placeholder="e.g. Payroll — May 2026" required />
            </div>
            <div>
              <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Amount</label>
              <input type="number" min="0" step="0.01" value={simpleForm.amount}
                onChange={e => setSimpleForm({...simpleForm, amount: e.target.value})}
                className="input-field" placeholder="0.00" required />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Category</label>
                <select value={simpleForm.category}
                  onChange={e => setSimpleForm({...simpleForm, category: e.target.value})}
                  className="input-field">
                  <option value="">— Uncategorized —</option>
                  {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Account</label>
                <select value={simpleForm.account_id}
                  onChange={e => setSimpleForm({...simpleForm, account_id: e.target.value})}
                  className="input-field">
                  {accountOptions}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Reference</label>
                <input type="text" value={simpleForm.reference}
                  onChange={e => setSimpleForm({...simpleForm, reference: e.target.value})}
                  className="input-field" placeholder="optional" />
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <button type="submit" disabled={savingSimple} className="btn-primary">
                {savingSimple ? <Spinner size="sm" className="text-white" /> : 'Post Entry'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── ADVANCED MODE ── */}
      {mode === 'advanced' && (
        <div className="card p-6 mb-8">
          <h2 className="font-display text-lg mb-4 text-surface-900 flex items-center gap-2">
            <FileSpreadsheet size={18} /> Double-Entry Journal
          </h2>
          <form onSubmit={handleAdvancedPost} className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Date</label>
                <input type="date" value={advancedForm.date}
                  onChange={e => setAdvancedForm({...advancedForm, date: e.target.value})}
                  className="input-field" required />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Description</label>
                <input type="text" value={advancedForm.description}
                  onChange={e => setAdvancedForm({...advancedForm, description: e.target.value})}
                  className="input-field" placeholder="e.g. Owner contribution to bar account" required />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Memo</label>
              <input type="text" value={advancedForm.memo}
                onChange={e => setAdvancedForm({...advancedForm, memo: e.target.value})}
                className="input-field" placeholder="Optional notes about this entry" />
            </div>

            {/* Lines table */}
            <div className="overflow-x-auto border border-surface-200 rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-surface-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-surface-600 uppercase tracking-wider">Account</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-surface-600 uppercase tracking-wider">Category</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-surface-600 uppercase tracking-wider">Line Description</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-surface-600 uppercase tracking-wider w-32">Debit</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-surface-600 uppercase tracking-wider w-32">Credit</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {advancedForm.lines.map((line, idx) => (
                    <tr key={idx} className="border-t border-surface-100">
                      <td className="px-2 py-1.5">
                        <select value={line.account_id}
                          onChange={e => setLine(idx, { account_id: e.target.value })}
                          className="input-field text-xs py-1">
                          {accountOptions}
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <select value={line.category}
                          onChange={e => setLine(idx, { category: e.target.value })}
                          className="input-field text-xs py-1">
                          <option value="">—</option>
                          {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="text" value={line.description}
                          onChange={e => setLine(idx, { description: e.target.value })}
                          className="input-field text-xs py-1" placeholder="line memo" />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="number" min="0" step="0.01" value={line.debit}
                          onChange={e => setLine(idx, { debit: e.target.value, credit: e.target.value ? '' : line.credit })}
                          className="input-field text-xs py-1 text-right font-mono" placeholder="0.00" />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="number" min="0" step="0.01" value={line.credit}
                          onChange={e => setLine(idx, { credit: e.target.value, debit: e.target.value ? '' : line.debit })}
                          className="input-field text-xs py-1 text-right font-mono" placeholder="0.00" />
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <button type="button" onClick={() => removeLine(idx)}
                          disabled={advancedForm.lines.length <= 2}
                          className="text-surface-300 hover:text-red-500 disabled:opacity-30">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-surface-50">
                  <tr className="border-t-2 border-surface-200">
                    <td colSpan={3} className="px-3 py-2 text-right font-semibold text-sm">Totals</td>
                    <td className="px-3 py-2 text-right font-mono text-sm">{formatCurrency(totalDebit)}</td>
                    <td className="px-3 py-2 text-right font-mono text-sm">{formatCurrency(totalCredit)}</td>
                    <td></td>
                  </tr>
                  <tr>
                    <td colSpan={3} className="px-3 py-2 text-right font-semibold text-sm">Difference</td>
                    <td colSpan={2} className={`px-3 py-2 text-right font-mono text-sm font-semibold ${balanced ? 'text-green-600' : 'text-red-600'}`}>
                      {formatCurrency(Math.abs(diff))} {balanced ? '· Balanced' : '· Unbalanced'}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="flex justify-between items-center pt-2">
              <button type="button" onClick={addLine} className="btn-ghost text-sm flex items-center gap-1.5">
                <PlusCircle size={14} /> Add Line
              </button>
              <button type="submit" disabled={!balanced || savingAdvanced} className="btn-primary disabled:opacity-50">
                {savingAdvanced ? <Spinner size="sm" className="text-white" /> : 'Post Entry'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── RULES TAB ── */}
      {mode === 'rules' && (
        <div className="space-y-4 mb-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-lg text-surface-900 flex items-center gap-2">
                <Repeat size={18} /> Recurring Rules
              </h2>
              <p className="text-xs text-surface-500 mt-0.5">Automatically generate offsetting or fixed-amount entries each month</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => { setGenPreview([]); setShowGenModal(true); }}
                className="btn-secondary flex items-center gap-2 text-sm">
                <CalendarRange size={14} /> Generate Monthly Entries
              </button>
              <button onClick={() => { setRuleForm(blankRuleForm()); setShowRuleModal(true); }}
                className="btn-primary flex items-center gap-2 text-sm">
                <PlusCircle size={14} /> New Rule
              </button>
            </div>
          </div>

          {rulesLoading ? <div className="flex justify-center py-12"><Spinner size="lg" /></div>
          : rules.length === 0 ? (
            <EmptyState icon={Repeat} title="No rules yet"
              description="Create a recurring rule (e.g. Amazon net-to-zero, fixed labor adjustment) and generate entries monthly"
              action={{ label: 'Create First Rule', onClick: () => setShowRuleModal(true) }} />
          ) : (
            <div className="card overflow-hidden">
              <table className="w-full">
                <thead className="border-b border-surface-100">
                  <tr>
                    <th className="table-header">Rule</th>
                    <th className="table-header">Type</th>
                    <th className="table-header">Settings</th>
                    <th className="table-header text-right">Amount</th>
                    <th className="table-header w-32">Status</th>
                    <th className="table-header w-16"></th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map(r => (
                    <tr key={r.id} className="border-b border-surface-50 hover:bg-surface-50">
                      <td className="table-cell font-medium">{r.name}</td>
                      <td className="table-cell text-xs">{RULE_TYPES[r.rule_type]}</td>
                      <td className="table-cell text-xs text-surface-500">
                        {r.rule_type === 'net_to_zero'
                          ? `Match: ${r.match_category ? `category "${r.match_category}"` : ''}${r.match_category && r.match_keyword ? ' · ' : ''}${r.match_keyword ? `keyword "${r.match_keyword}"` : ''}`
                          : `${r.fixed_type === 'debit' ? 'Debit' : 'Credit'} · ${r.category || '—'}`}
                      </td>
                      <td className="table-cell text-right font-mono text-xs">
                        {r.rule_type === 'fixed_amount' ? formatCurrency(r.fixed_amount) : 'computed'}
                      </td>
                      <td className="table-cell">
                        <button onClick={() => toggleRuleActive(r)}
                          className={`text-xs flex items-center gap-1 rounded-full px-2 py-0.5 ${r.active ? 'bg-green-100 text-green-700' : 'bg-surface-100 text-surface-500'}`}>
                          {r.active ? <Power size={11} /> : <PowerOff size={11} />}
                          {r.active ? 'Active' : 'Off'}
                        </button>
                      </td>
                      <td className="table-cell">
                        <button onClick={() => deleteRule(r)} className="p-1.5 text-surface-400 hover:text-red-500">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── HISTORY ── */}
      <div className="mt-2">
        <h2 className="font-display text-lg text-surface-900 mb-3">Journal History</h2>
        {historyLoading ? <div className="flex justify-center py-12"><Spinner size="lg" /></div>
        : entries.length === 0 ? (
          <EmptyState icon={BookText} title="No journal entries yet" description="Post your first entry above" />
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full">
              <thead className="border-b border-surface-100">
                <tr>
                  <th className="w-8"></th>
                  <th className="table-header">Date</th>
                  <th className="table-header">Reference</th>
                  <th className="table-header">Description</th>
                  <th className="table-header">Type</th>
                  <th className="table-header text-right">Total</th>
                  <th className="table-header">Status</th>
                  <th className="table-header w-12"></th>
                </tr>
              </thead>
              <tbody>
                {entries.map(e => {
                  const open = expandedEntries.has(e.id);
                  const lines = entryLines[e.id];
                  return (
                    <Fragment key={e.id}>
                      <tr className="border-b border-surface-50 hover:bg-surface-50 cursor-pointer"
                        onClick={() => toggleExpand(e.id)}>
                        <td className="pl-3">
                          {open ? <ChevronDown size={14} className="text-surface-400" /> : <ChevronRight size={14} className="text-surface-400" />}
                        </td>
                        <td className="table-cell font-mono text-xs whitespace-nowrap">{formatDate(e.date)}</td>
                        <td className="table-cell font-mono text-xs">{e.reference}</td>
                        <td className="table-cell font-medium">{e.description}</td>
                        <td className="table-cell text-xs">
                          <span className={`rounded-full px-2 py-0.5 ${
                            e.entry_type === 'auto'   ? 'bg-purple-100 text-purple-700' :
                            e.entry_type === 'double' ? 'bg-blue-100   text-blue-700'   :
                                                        'bg-surface-100 text-surface-600'
                          }`}>
                            {e.entry_type === 'auto' ? 'Auto' : e.entry_type === 'double' ? 'Double-Entry' : 'Simple'}
                          </span>
                        </td>
                        <td className="table-cell text-right font-mono text-sm">{formatCurrency(e.total_amount || 0)}</td>
                        <td className="table-cell">
                          <span className={`text-xs rounded-full px-2 py-0.5 ${
                            e.status === 'posted' ? 'bg-green-100 text-green-700' :
                            e.status === 'voided' ? 'bg-red-100   text-red-700'   :
                                                    'bg-surface-100 text-surface-500'
                          }`}>
                            {e.status}
                          </span>
                        </td>
                        <td className="table-cell">
                          {e.status === 'posted' && (
                            <button onClick={ev => { ev.stopPropagation(); voidEntry(e); }}
                              title="Reverse / Void" className="p-1.5 text-surface-400 hover:text-amber-600">
                              <Undo2 size={14} />
                            </button>
                          )}
                        </td>
                      </tr>
                      {open && (
                        <tr className="bg-surface-50/60">
                          <td colSpan={8} className="px-6 py-3">
                            {!lines ? <div className="flex justify-center py-2"><Spinner size="sm" /></div>
                            : lines.length === 0 ? <p className="text-xs text-surface-400">No lines</p> : (
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-surface-500">
                                    <th className="text-left py-1">Account</th>
                                    <th className="text-left py-1">Description</th>
                                    <th className="text-left py-1">Category</th>
                                    <th className="text-right py-1">Debit</th>
                                    <th className="text-right py-1">Credit</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {lines.map(l => {
                                    const acct = accounts.find(a => a.id === l.account_id);
                                    return (
                                      <tr key={l.id} className="border-t border-surface-100">
                                        <td className="py-1">{acct?.name || '—'}</td>
                                        <td className="py-1">{l.description || '—'}</td>
                                        <td className="py-1">{l.category || '—'}</td>
                                        <td className="py-1 text-right font-mono">{l.debit_amount  ? formatCurrency(l.debit_amount)  : '—'}</td>
                                        <td className="py-1 text-right font-mono">{l.credit_amount ? formatCurrency(l.credit_amount) : '—'}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── NEW RULE MODAL ── */}
      <Modal open={showRuleModal} onClose={() => setShowRuleModal(false)} title="New Recurring Rule" size="lg">
        <form onSubmit={handleSaveRule} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Name</label>
            <input type="text" value={ruleForm.name}
              onChange={e => setRuleForm({...ruleForm, name: e.target.value})}
              className="input-field" placeholder="e.g. Amazon Netting" required />
          </div>
          <div>
            <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Rule Type</label>
            <select value={ruleForm.rule_type}
              onChange={e => setRuleForm({...ruleForm, rule_type: e.target.value})}
              className="input-field">
              <option value="net_to_zero">Net to Zero (sum matched transactions, offset)</option>
              <option value="fixed_amount">Fixed Amount</option>
            </select>
          </div>

          {ruleForm.rule_type === 'net_to_zero' ? (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Match Category</label>
                <select value={ruleForm.match_category}
                  onChange={e => setRuleForm({...ruleForm, match_category: e.target.value})}
                  className="input-field">
                  <option value="">— any —</option>
                  {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Match Keyword</label>
                <input type="text" value={ruleForm.match_keyword}
                  onChange={e => setRuleForm({...ruleForm, match_keyword: e.target.value})}
                  className="input-field" placeholder="e.g. Amazon" />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Amount</label>
                <input type="number" min="0" step="0.01" value={ruleForm.fixed_amount}
                  onChange={e => setRuleForm({...ruleForm, fixed_amount: e.target.value})}
                  className="input-field" required />
              </div>
              <div>
                <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Debit or Credit</label>
                <select value={ruleForm.fixed_type}
                  onChange={e => setRuleForm({...ruleForm, fixed_type: e.target.value})}
                  className="input-field">
                  <option value="debit">Debit</option>
                  <option value="credit">Credit</option>
                </select>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Offset Account</label>
              <select value={ruleForm.account_id}
                onChange={e => setRuleForm({...ruleForm, account_id: e.target.value})}
                className="input-field">
                {accountOptions}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Offset Category</label>
              <select value={ruleForm.category}
                onChange={e => setRuleForm({...ruleForm, category: e.target.value})}
                className="input-field">
                <option value="">—</option>
                {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setShowRuleModal(false)} className="btn-ghost">Cancel</button>
            <button type="submit" className="btn-primary">Save Rule</button>
          </div>
        </form>
      </Modal>

      {/* ── PAYROLL MODAL ── */}
      <Modal open={showPayrollModal} onClose={() => setShowPayrollModal(false)} title="Payroll Journal Entry" size="lg">
        <PayrollJournalForm
          period={new Date().toISOString().slice(0,7)}
          allowPeriodChange
          onPosted={() => { loadEntries(); }}
        />
      </Modal>

      {/* ── GENERATE MONTHLY MODAL ── */}
      <Modal open={showGenModal} onClose={discardGenerated} title="Generate Monthly Entries" size="lg">
        <div className="space-y-4">
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Month</label>
              <input type="month" value={genMonth}
                onChange={e => { setGenMonth(e.target.value); setGenPreview([]); }}
                className="input-field" />
            </div>
            <button onClick={buildMonthlyPreview} disabled={generating}
              className="btn-secondary">
              {generating ? <Spinner size="sm" /> : 'Run Rules'}
            </button>
          </div>

          {genPreview.length > 0 && (
            <>
              <div className="border border-surface-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-surface-50">
                    <tr>
                      <th className="px-3 py-2 text-center w-10">
                        <input
                          type="checkbox"
                          ref={el => { if (el) el.indeterminate = selectedGen.size > 0 && selectedGen.size < genPreview.length; }}
                          checked={genPreview.length > 0 && selectedGen.size === genPreview.length}
                          onChange={toggleSelectAllGen}
                          aria-label="Select all"
                        />
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-surface-600 uppercase tracking-wider">Rule</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-surface-600 uppercase tracking-wider">Description</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-surface-600 uppercase tracking-wider">Debit</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-surface-600 uppercase tracking-wider">Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {genPreview.map((p, i) => (
                      <Fragment key={i}>
                        {p.lines.map((l, j) => (
                          <tr key={`${i}-${j}`} className={`border-t border-surface-100 ${selectedGen.has(i) ? '' : 'opacity-40'}`}>
                            {j === 0 && (
                              <td rowSpan={p.lines.length} className="px-3 py-1.5 text-center align-middle">
                                <input
                                  type="checkbox"
                                  checked={selectedGen.has(i)}
                                  onChange={() => toggleSelectGen(i)}
                                  aria-label={`Select ${p.rule.name}`}
                                />
                              </td>
                            )}
                            {j === 0 && (
                              <td rowSpan={p.lines.length} className="px-3 py-1.5 text-xs align-middle">{p.rule.name}</td>
                            )}
                            <td className="px-3 py-1.5 text-xs">{l.description}</td>
                            <td className="px-3 py-1.5 text-right font-mono text-xs">{l.debit_amount ? formatCurrency(l.debit_amount) : '—'}</td>
                            <td className="px-3 py-1.5 text-right font-mono text-xs">{l.credit_amount ? formatCurrency(l.credit_amount) : '—'}</td>
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button onClick={discardGenerated} className="btn-ghost">Discard</button>
                <button onClick={approveAllGenerated} disabled={approvingGen || selectedGen.size === 0} className="btn-primary">
                  {approvingGen ? <Spinner size="sm" className="text-white" /> : `Approve & Post (${selectedGen.size})`}
                </button>
              </div>
            </>
          )}

          {!genPreview.length && !generating && (
            <p className="text-sm text-surface-400 text-center py-6">Pick a month and click "Run Rules" to preview.</p>
          )}
        </div>
      </Modal>
    </div>
  );
}
