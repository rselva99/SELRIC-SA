import { useState, useEffect, useMemo } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isToday, parseISO } from 'date-fns';
import { supabase } from '../../lib/supabase';
import Modal from '../../components/ui/Modal';
import Spinner from '../../components/ui/Spinner';
import toast from 'react-hot-toast';
import { ChevronLeft, ChevronRight, Plus, Trash2, Brain } from 'lucide-react';

const EVENT_TYPES = [
  'Sports Game', 'Greek Life', 'Holiday', 'Bar Special',
  'Live Music', 'University Event', 'Private Event', 'Other',
];

export const COLOR_CONFIG = {
  dark_red: { bg: 'bg-red-800',    text: 'text-white',         hex: '#991b1b', label: '🔴 Packed' },
  orange:   { bg: 'bg-orange-500', text: 'text-white',         hex: '#f97316', label: '🟠 Very Busy' },
  green:    { bg: 'bg-green-500',  text: 'text-white',         hex: '#22c55e', label: '🟢 Busy' },
  yellow:   { bg: 'bg-yellow-400', text: 'text-gray-900',      hex: '#facc15', label: '🟡 Normal' },
  blue:     { bg: 'bg-blue-500',   text: 'text-white',         hex: '#3b82f6', label: '🔵 Slow' },
  gray:     { bg: 'bg-gray-300',   text: 'text-surface-700',   hex: '#d1d5db', label: '⚪ Closed/Private' },
};

const EMPTY_FORM = {
  name: '', date: '', time: '', description: '', event_type: 'Bar Special', color_label: 'green',
};

export default function CalendarPage() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [predicting, setPredicting] = useState(false);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  useEffect(() => { loadEvents(); }, [year, month]); // eslint-disable-line

  async function loadEvents() {
    setLoading(true);
    try {
      const start = format(startOfMonth(currentDate), 'yyyy-MM-dd');
      const end   = format(endOfMonth(currentDate),   'yyyy-MM-dd');
      const { data, error } = await supabase
        .from('calendar_events').select('*').gte('date', start).lte('date', end).order('date');
      if (error) throw error;
      setEvents(data || []);
    } catch { toast.error('Failed to load events'); }
    finally { setLoading(false); }
  }

  // Calendar grid: padded array of Date|null
  const calendarDays = useMemo(() => {
    const start = startOfMonth(currentDate);
    const days  = eachDayOfInterval({ start, end: endOfMonth(currentDate) });
    const pad   = Array(getDay(start)).fill(null);
    const grid  = [...pad, ...days];
    while (grid.length % 7 !== 0) grid.push(null);
    return grid;
  }, [currentDate]);

  const eventsByDate = useMemo(() => {
    const m = {};
    events.forEach((e) => { (m[e.date] = m[e.date] || []).push(e); });
    return m;
  }, [events]);

  async function predictColor(data) {
    setPredicting(true);
    try {
      const res = await fetch('/api/calendar-predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: data.name, event_type: data.event_type, date: data.date, description: data.description }),
      });
      const json = await res.json();
      return json.color_label || 'green';
    } catch { return 'green'; }
    finally { setPredicting(false); }
  }

  function openAdd(day) {
    const dateStr = format(day, 'yyyy-MM-dd');
    setEditingEvent(null);
    setForm({ ...EMPTY_FORM, date: dateStr });
    setShowModal(true);
  }

  function openEdit(ev, e) {
    e.stopPropagation();
    setEditingEvent(ev);
    setForm({ name: ev.name, date: ev.date, time: ev.time || '', description: ev.description || '', event_type: ev.event_type || 'Bar Special', color_label: ev.color_label || 'green' });
    setShowModal(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name || !form.date) { toast.error('Name and date are required'); return; }
    setSaving(true);
    try {
      let colorLabel = form.color_label;
      if (!editingEvent) {
        colorLabel = await predictColor(form);
      }
      const payload = { name: form.name, date: form.date, time: form.time, description: form.description, event_type: form.event_type, color_label: colorLabel };
      const { error } = editingEvent
        ? await supabase.from('calendar_events').update(payload).eq('id', editingEvent.id)
        : await supabase.from('calendar_events').insert(payload);
      if (error) throw error;
      toast.success(editingEvent ? 'Event updated' : 'Event added');
      setShowModal(false);
      loadEvents();
    } catch (err) { toast.error(err.message || 'Failed to save'); }
    finally { setSaving(false); }
  }

  async function handleDelete(id, e) {
    e.stopPropagation();
    if (!window.confirm('Delete this event?')) return;
    const { error } = await supabase.from('calendar_events').delete().eq('id', id);
    if (error) { toast.error('Failed to delete'); return; }
    toast.success('Deleted');
    loadEvents();
  }

  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
        <div>
          <h1 className="page-title">Events Calendar</h1>
          <p className="text-surface-500 text-sm mt-0.5">Plan events · AI predicts crowd levels</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setCurrentDate(new Date(year, month - 1, 1))} className="p-2 hover:bg-surface-100 rounded-lg transition"><ChevronLeft size={18} /></button>
          <span className="font-display text-base w-36 text-center select-none">{format(currentDate, 'MMMM yyyy')}</span>
          <button onClick={() => setCurrentDate(new Date(year, month + 1, 1))} className="p-2 hover:bg-surface-100 rounded-lg transition"><ChevronRight size={18} /></button>
          <button onClick={() => setCurrentDate(new Date())} className="btn-ghost text-xs ml-1">Today</button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {Object.entries(COLOR_CONFIG).map(([key, c]) => (
          <span key={key} className={`text-xs px-2.5 py-1 rounded-full font-medium ${c.bg} ${c.text}`}>{c.label}</span>
        ))}
      </div>

      {/* Calendar */}
      <div className="card overflow-hidden">
        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-surface-100 bg-surface-50">
          {DAYS.map((d) => (
            <div key={d} className="py-2.5 text-center text-xs font-semibold text-surface-500 uppercase tracking-wider">{d}</div>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24"><Spinner size="lg" /></div>
        ) : (
          <div className="grid grid-cols-7 divide-x divide-y divide-surface-100">
            {calendarDays.map((day, i) => {
              if (!day) return <div key={`pad-${i}`} className="min-h-[96px] bg-surface-50/40" />;
              const ds = format(day, 'yyyy-MM-dd');
              const dayEvs = eventsByDate[ds] || [];
              const today = isToday(day);
              const isWeekend = [0, 6].includes(getDay(day));

              return (
                <div
                  key={ds}
                  onClick={() => openAdd(day)}
                  className={`min-h-[96px] p-1.5 cursor-pointer transition group ${isWeekend ? 'bg-surface-50/60' : ''} hover:bg-brand-50/30`}
                >
                  <div className={`w-7 h-7 flex items-center justify-center rounded-full text-sm font-medium mb-1 ${
                    today ? 'bg-brand-600 text-white' : 'text-surface-600 group-hover:text-brand-700'
                  }`}>
                    {format(day, 'd')}
                  </div>
                  <div className="space-y-0.5">
                    {dayEvs.slice(0, 2).map((ev) => {
                      const c = COLOR_CONFIG[ev.color_label] || COLOR_CONFIG.green;
                      return (
                        <div
                          key={ev.id}
                          onClick={(e) => openEdit(ev, e)}
                          title={ev.name}
                          className={`text-xs px-1.5 py-0.5 rounded truncate font-medium flex items-center justify-between gap-0.5 cursor-pointer hover:opacity-80 transition ${c.bg} ${c.text}`}
                        >
                          <span className="truncate">{ev.name}</span>
                          <Trash2 size={9} className="opacity-0 group-hover:opacity-60 shrink-0 hover:opacity-100" onClick={(e) => handleDelete(ev.id, e)} />
                        </div>
                      );
                    })}
                    {dayEvs.length > 2 && <div className="text-[10px] text-surface-400 px-1">+{dayEvs.length - 2} more</div>}
                    {dayEvs.length === 0 && (
                      <Plus size={12} className="text-surface-200 opacity-0 group-hover:opacity-100 transition mt-0.5" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title={editingEvent ? 'Edit Event' : `Add Event${form.date ? ` — ${format(parseISO(form.date), 'MMM d, yyyy')}` : ''}`}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Event Name</label>
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input-field" placeholder="e.g. SLU Billikens vs. Xavier" required />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Date</label>
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="input-field" required />
            </div>
            <div>
              <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Time <span className="text-surface-400 normal-case font-normal">(optional)</span></label>
              <input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} className="input-field" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Event Type</label>
            <select value={form.event_type} onChange={(e) => setForm({ ...form, event_type: e.target.value })} className="input-field">
              {EVENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Description <span className="text-surface-400 normal-case font-normal">(optional)</span></label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="input-field resize-none" rows={2} placeholder="Any extra context for the AI prediction..." />
          </div>

          <div>
            <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              Crowd Prediction
              {!editingEvent && <span className="text-brand-500 text-xs normal-case font-normal flex items-center gap-1"><Brain size={11} /> AI auto-assigns on save</span>}
            </label>
            <select value={form.color_label} onChange={(e) => setForm({ ...form, color_label: e.target.value })} className="input-field">
              {Object.entries(COLOR_CONFIG).map(([key, c]) => <option key={key} value={key}>{c.label}</option>)}
            </select>
            {!editingEvent && <p className="text-xs text-surface-400 mt-1">AI predicts based on event + date. Override here if you want.</p>}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setShowModal(false)} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={saving || predicting} className="btn-primary">
              {saving || predicting ? <Spinner size="sm" className="text-white" /> : editingEvent ? 'Save Changes' : 'Add Event'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
