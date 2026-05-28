import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  format, parseISO, addDays, addWeeks, addMonths,
  startOfWeek, isToday, isBefore,
} from 'date-fns';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import Modal from '../../components/ui/Modal';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';
import toast from 'react-hot-toast';
import { Plus, Trash2, ListChecks, RefreshCw, AlertCircle } from 'lucide-react';

const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const RECURRENCES = ['none', 'daily', 'weekly', 'monthly'];

const PRIORITY_BORDER = {
  urgent: 'border-l-red-500',
  high:   'border-l-orange-400',
  medium: 'border-l-yellow-400',
  low:    'border-l-green-500',
};
const PRIORITY_BADGE = {
  urgent: 'bg-red-100 text-red-700',
  high:   'bg-orange-100 text-orange-700',
  medium: 'bg-yellow-100 text-yellow-700',
  low:    'bg-green-100 text-green-700',
};
const PRIORITY_LABEL = { urgent: '🔴 Urgent', high: '🟠 High', medium: '🟡 Medium', low: '🟢 Low' };

const EMPTY_FORM = {
  title: '', description: '', due_date: new Date().toISOString().slice(0, 10),
  assignee_id: '', priority: 'medium', recurrence: 'none',
};

function weekLabel(dateStr) {
  const d = parseISO(dateStr + 'T00:00:00');
  const ws = startOfWeek(d, { weekStartsOn: 0 });
  return `Week of ${format(ws, 'MMM d')}`;
}
function weekKey(dateStr) {
  const d = parseISO(dateStr + 'T00:00:00');
  return format(startOfWeek(d, { weekStartsOn: 0 }), 'yyyy-MM-dd');
}

export default function TasksPage() {
  const { user } = useAuth();
  const [tasks,    setTasks]    = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  // Filters
  const [filterStatus,   setFilterStatus]   = useState('open');
  const [filterPriority, setFilterPriority] = useState('');
  const [filterAssignee, setFilterAssignee] = useState('');

  const profileMap = useMemo(() => {
    const m = {};
    profiles.forEach(p => { m[p.id] = p.full_name || p.email || p.id.slice(0, 8); });
    return m;
  }, [profiles]);

  const load = useCallback(async () => {
    setLoading(true);
    const [taskRes, profRes] = await Promise.all([
      supabase.from('tasks').select('*').order('due_date').order('created_at'),
      supabase.from('profiles').select('id, full_name, email'),
    ]);
    setTasks(taskRes.data || []);
    setProfiles(profRes.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Derived ─────────────────────────────────────────────────────────────

  const today = new Date().toISOString().slice(0, 10);

  const filtered = useMemo(() => {
    let list = [...tasks];
    if (filterStatus === 'open') list = list.filter(t => t.status === 'open');
    if (filterStatus === 'done') list = list.filter(t => t.status === 'done');
    if (filterPriority) list = list.filter(t => t.priority === filterPriority);
    if (filterAssignee) list = list.filter(t => t.assignee_id === filterAssignee);
    return list.sort((a, b) => a.due_date.localeCompare(b.due_date));
  }, [tasks, filterStatus, filterPriority, filterAssignee]);

  const overdue = useMemo(() =>
    filtered.filter(t => t.status === 'open' && t.due_date < today),
    [filtered, today]
  );

  const upcoming = useMemo(() =>
    filtered.filter(t => t.due_date >= today || t.status === 'done'),
    [filtered, today]
  );

  const weekGroups = useMemo(() => {
    const groups = {};
    for (const t of upcoming) {
      const key = weekKey(t.due_date);
      if (!groups[key]) groups[key] = { label: weekLabel(t.due_date), tasks: [] };
      groups[key].tasks.push(t);
    }
    return Object.entries(groups)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => v);
  }, [upcoming]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.title.trim() || !form.due_date) { toast.error('Title and due date are required'); return; }
    setSaving(true);
    try {
      const payload = {
        title:       form.title.trim(),
        description: form.description.trim(),
        due_date:    form.due_date,
        assignee_id: form.assignee_id || null,
        priority:    form.priority,
        recurrence:  form.recurrence,
        status:      'open',
        created_by:  user?.id,
      };
      const { data: parent, error } = await supabase.from('tasks').insert(payload).select().single();
      if (error) throw error;

      // Generate recurring instances for the next 3 months
      if (form.recurrence !== 'none') {
        const instances = [];
        const base = parseISO(form.due_date + 'T00:00:00');
        const horizon = addMonths(base, 3);
        let cursor = base;

        while (true) {
          if (form.recurrence === 'daily')   cursor = addDays(cursor, 1);
          else if (form.recurrence === 'weekly')  cursor = addWeeks(cursor, 1);
          else if (form.recurrence === 'monthly') cursor = addMonths(cursor, 1);
          if (cursor > horizon) break;
          instances.push({
            ...payload,
            due_date:       format(cursor, 'yyyy-MM-dd'),
            parent_task_id: parent.id,
          });
        }
        if (instances.length) await supabase.from('tasks').insert(instances);
      }

      toast.success(`Task created${form.recurrence !== 'none' ? ' with recurring instances' : ''}`);
      setShowModal(false);
      setForm(EMPTY_FORM);
      load();
    } catch (err) { toast.error(err.message || 'Failed to create task'); }
    finally { setSaving(false); }
  }

  async function toggleDone(task) {
    const isDone = task.status === 'done';
    const updates = isDone
      ? { status: 'open', completed_at: null }
      : { status: 'done', completed_at: new Date().toISOString() };
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, ...updates } : t));
    await supabase.from('tasks').update(updates).eq('id', task.id);
  }

  async function deleteTask(id) {
    if (!window.confirm('Delete this task?')) return;
    setTasks(prev => prev.filter(t => t.id !== id));
    await supabase.from('tasks').delete().eq('id', id);
    toast.success('Deleted');
  }

  // ── Task card ─────────────────────────────────────────────────────────────

  function TaskCard({ task, highlight = false }) {
    const done     = task.status === 'done';
    const isOvd    = !done && task.due_date < today;
    const isTdy    = isToday(parseISO(task.due_date + 'T00:00:00'));
    return (
      <div className={`flex items-start gap-3 p-3 rounded-lg border border-surface-200 border-l-4 bg-white transition
        ${PRIORITY_BORDER[task.priority]}
        ${highlight ? 'bg-red-50 border-red-200' : ''}
        ${done ? 'opacity-60' : 'hover:shadow-sm'}`}>
        <input
          type="checkbox"
          checked={done}
          onChange={() => toggleDone(task)}
          className="mt-0.5 w-4 h-4 rounded accent-brand-600 cursor-pointer shrink-0"
        />
        <div className="flex-1 min-w-0">
          <p className={`font-medium text-sm ${done ? 'line-through text-surface-400' : 'text-surface-800'}`}>
            {task.title}
          </p>
          {task.description && (
            <p className="text-xs text-surface-500 mt-0.5 truncate">{task.description}</p>
          )}
          <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-surface-400">
            <span className={isOvd ? 'text-red-600 font-semibold' : isTdy ? 'text-amber-600 font-semibold' : ''}>
              {isOvd ? '⚠ ' : isTdy ? '📅 ' : ''}{format(parseISO(task.due_date + 'T00:00:00'), 'MMM d, yyyy')}
            </span>
            {task.assignee_id && profileMap[task.assignee_id] && (
              <span>→ {profileMap[task.assignee_id]}</span>
            )}
            {task.recurrence !== 'none' && (
              <span className="flex items-center gap-0.5"><RefreshCw size={10} /> {task.recurrence}</span>
            )}
            {done && task.completed_at && (
              <span className="text-green-600">✓ Done {format(new Date(task.completed_at), 'MMM d')}</span>
            )}
          </div>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${PRIORITY_BADGE[task.priority]}`}>
          {task.priority}
        </span>
        <button onClick={() => deleteTask(task.id)} className="p-1 text-surface-300 hover:text-red-500 transition shrink-0">
          <Trash2 size={13} />
        </button>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="page-title">Tasks</h1>
          <p className="text-surface-500 text-sm mt-0.5">
            {tasks.filter(t => t.status === 'open').length} open · {overdue.length > 0 && <span className="text-red-600">{overdue.length} overdue</span>}
          </p>
        </div>
        <button onClick={() => { setForm(EMPTY_FORM); setShowModal(true); }} className="btn-primary flex items-center gap-2">
          <Plus size={16} /> Add Task
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-6">
        {/* Status pills */}
        <div className="flex gap-1 bg-surface-100 rounded-lg p-1">
          {[['all','All'], ['open','Open'], ['done','Done']].map(([val, lbl]) => (
            <button key={val} onClick={() => setFilterStatus(val)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${filterStatus===val ? 'bg-white shadow-sm text-surface-900' : 'text-surface-500 hover:text-surface-700'}`}>
              {lbl}
            </button>
          ))}
        </div>
        <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)} className="input-field w-auto text-sm py-1.5">
          <option value="">All Priorities</option>
          {PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
        </select>
        <select value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)} className="input-field w-auto text-sm py-1.5 min-w-[140px]">
          <option value="">All Assignees</option>
          {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}
        </select>
        {(filterPriority || filterAssignee) && (
          <button onClick={() => { setFilterPriority(''); setFilterAssignee(''); }} className="btn-ghost text-xs">Clear</button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={ListChecks} title="No tasks" description="Add your first task using the button above" />
      ) : (
        <div className="space-y-6">
          {/* Overdue section */}
          {overdue.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle size={15} className="text-red-500" />
                <h2 className="font-semibold text-sm text-red-600">Overdue ({overdue.length})</h2>
              </div>
              <div className="space-y-2">
                {overdue.map(t => <TaskCard key={t.id} task={t} highlight />)}
              </div>
            </div>
          )}

          {/* Week groups */}
          {weekGroups.map(group => (
            <div key={group.label}>
              <h2 className="font-semibold text-sm text-surface-500 uppercase tracking-wider mb-2">{group.label}</h2>
              <div className="space-y-2">
                {group.tasks.map(t => <TaskCard key={t.id} task={t} />)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Task Modal */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title="Add Task">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Title</label>
            <input type="text" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
              className="input-field" placeholder="e.g. Order beer stock" required />
          </div>

          <div>
            <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">
              Description <span className="text-surface-400 normal-case font-normal">(optional)</span>
            </label>
            <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
              className="input-field resize-none" rows={2} placeholder="Any extra details…" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Due Date</label>
              <input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })}
                className="input-field" required />
            </div>
            <div>
              <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Priority</label>
              <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })} className="input-field">
                {PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Assignee</label>
              <select value={form.assignee_id} onChange={e => setForm({ ...form, assignee_id: e.target.value })} className="input-field">
                <option value="">— Unassigned —</option>
                {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Recurrence</label>
              <select value={form.recurrence} onChange={e => setForm({ ...form, recurrence: e.target.value })} className="input-field">
                {RECURRENCES.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
              </select>
            </div>
          </div>

          {form.recurrence !== 'none' && (
            <p className="text-xs text-brand-600 bg-brand-50 rounded-lg px-3 py-2">
              <RefreshCw size={11} className="inline mr-1" />
              Auto-generates instances for the next 3 months ({form.recurrence === 'daily' ? '~90' : form.recurrence === 'weekly' ? '~13' : '3'} tasks).
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setShowModal(false)} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? <Spinner size="sm" className="text-white" /> : 'Create Task'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
