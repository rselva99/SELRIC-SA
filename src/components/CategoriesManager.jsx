import { useState } from 'react';
import toast from 'react-hot-toast';
import { useData } from '../contexts/DataContext';
import { useT } from '../i18n/I18nContext';
import { pickableCategories } from '../lib/finance';
import { cn } from '../lib/utils';
import Modal from './ui/Modal';
import Spinner from './ui/Spinner';
import { Check, Trash2, Plus, ArrowDownLeft, ArrowUpRight, X } from 'lucide-react';

// Money-in / money-out categories for a Simple-mode workspace: add, rename,
// delete. Renaming carries every transaction with it. Deleting a category
// that transactions still use asks where to move them first — a name with
// rows left behind would vanish from the P&L.
export default function CategoriesManager({ open, onClose }) {
  const { categories, addCategory, renameCategory, deleteCategory, categoryUsage } = useData();
  const { t, tn } = useT();

  const [drafts, setDrafts] = useState({});          // id → draft name
  const [busy, setBusy] = useState('');
  const [removing, setRemoving] = useState(null);    // { id, name, used, moveTo }
  const [adding, setAdding] = useState({ name: '', type: 'expense' });

  const list = pickableCategories(categories);
  const groups = [
    { type: 'revenue', icon: ArrowDownLeft, label: t('tx.moneyIn') },
    { type: 'expense', icon: ArrowUpRight, label: t('tx.moneyOut') },
  ];

  async function save(c) {
    const name = (drafts[c.id] ?? c.name).trim();
    if (!name || name === c.name) return;
    if (list.some((x) => x.id !== c.id && x.name.toLowerCase() === name.toLowerCase())) { toast.error(t('cats.duplicate', { name })); return; }
    setBusy(c.id);
    try {
      await renameCategory(c.id, name);
      setDrafts((d) => { const n = { ...d }; delete n[c.id]; return n; });
      toast.success(t('cats.renamed', { name }));
    } catch (err) { toast.error(err.message || t('settings.saveFailed')); }
    finally { setBusy(''); }
  }

  async function askRemove(c) {
    setBusy(c.id);
    try {
      const used = await categoryUsage(c.name);
      setRemoving({ id: c.id, name: c.name, type: c.type, used, moveTo: '' });
    } catch (err) { toast.error(err.message || t('settings.saveFailed')); }
    finally { setBusy(''); }
  }

  async function confirmRemove() {
    if (!removing) return;
    if (removing.used > 0 && !removing.moveTo) { toast.error(t('cats.pickTarget')); return; }
    setBusy(removing.id);
    try {
      await deleteCategory(removing.id, removing.used > 0 ? removing.moveTo : null);
      toast.success(removing.used > 0 ? t('cats.deletedMoved', { name: removing.name, n: removing.used, target: removing.moveTo }) : t('cats.deleted', { name: removing.name }));
      setRemoving(null);
    } catch (err) { toast.error(err.message === 'CATEGORY_IN_USE' ? t('cats.pickTarget') : (err.message || t('settings.saveFailed'))); }
    finally { setBusy(''); }
  }

  async function add(e) {
    e.preventDefault();
    const name = adding.name.trim();
    if (!name) return;
    if (list.some((x) => x.name.toLowerCase() === name.toLowerCase())) { toast.error(t('cats.duplicate', { name })); return; }
    setBusy('new');
    try {
      await addCategory(name, adding.type);
      setAdding((a) => ({ ...a, name: '' }));
      toast.success(t('tx.categoryAdded', { name }));
    } catch (err) { toast.error(err.message || t('settings.saveFailed')); }
    finally { setBusy(''); }
  }

  return (
    <Modal open={open} onClose={onClose} title={t('cats.title')} size="lg">
      <p className="text-sm text-surface-500">{t('cats.body')}</p>

      <form onSubmit={add} className="mt-4 flex flex-col sm:flex-row gap-2">
        <input type="text" value={adding.name} onChange={(e) => setAdding((a) => ({ ...a, name: e.target.value }))} className="input-field py-2 text-sm flex-1" placeholder={t('cats.newPlaceholder')} />
        <div className="inline-flex rounded-lg bg-surface-100 p-1 shrink-0" role="radiogroup" aria-label={t('tx.kind')}>
          {['expense', 'revenue'].map((k) => (
            <button key={k} type="button" role="radio" aria-checked={adding.type === k} onClick={() => setAdding((a) => ({ ...a, type: k }))}
              className={cn('px-3 py-1 rounded-md text-xs font-medium', adding.type === k ? 'bg-white shadow-sm text-brand-900' : 'text-surface-600')}>
              {k === 'revenue' ? t('tx.moneyIn') : t('tx.moneyOut')}
            </button>
          ))}
        </div>
        <button type="submit" disabled={!adding.name.trim() || busy === 'new'} className="btn-primary px-3 py-2 text-sm shrink-0">
          {busy === 'new' ? <Spinner size="sm" className="text-white" /> : <Plus size={15} />} {t('cats.add')}
        </button>
      </form>

      <div className="mt-5 grid md:grid-cols-2 gap-5">
        {groups.map(({ type, icon: Icon, label }) => {
          const items = list.filter((c) => (c.type || '').toLowerCase() === type);
          return (
            <section key={type}>
              <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-surface-500 mb-2"><Icon size={13} className={type === 'revenue' ? 'text-brand-600' : ''} /> {label} <span className="text-surface-400 normal-case tracking-normal">· {items.length}</span></h3>
              {items.length === 0 ? (
                <p className="text-sm text-surface-400 py-3">{t('cats.none')}</p>
              ) : (
                <ul className="divide-y divide-surface-100 border border-surface-200 rounded-lg">
                  {items.map((c) => {
                    const draft = drafts[c.id] ?? c.name;
                    const dirty = draft.trim() !== c.name && draft.trim() !== '';
                    const isBusy = busy === c.id;
                    return (
                      <li key={c.id} className="flex items-center gap-1.5 px-2.5 py-1.5">
                        <input type="text" value={draft} onChange={(e) => setDrafts((d) => ({ ...d, [c.id]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(c); } }}
                          className="input-field py-1.5 text-sm" aria-label={t('cats.rename', { name: c.name })} />
                        <button type="button" onClick={() => save(c)} disabled={!dirty || isBusy} className="btn-primary px-2.5 py-1.5 text-xs" aria-label={t('common.save')}>
                          {isBusy ? <Spinner size="sm" className="text-white" /> : <Check size={14} />}
                        </button>
                        <button type="button" onClick={() => askRemove(c)} disabled={isBusy} className="p-1.5 rounded text-surface-400 hover:text-red-600 hover:bg-red-50" aria-label={t('cats.delete', { name: c.name })}>
                          <Trash2 size={14} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      {removing && (
        <div className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="text-sm text-red-900">
              <div className="font-semibold">{t('cats.confirmTitle', { name: removing.name })}</div>
              <p className="mt-1">{removing.used > 0 ? tn('cats.inUse', removing.used) : t('cats.notInUse')}</p>
            </div>
            <button type="button" onClick={() => setRemoving(null)} className="p-1 rounded text-red-700 hover:bg-red-100" aria-label={t('common.cancel')}><X size={16} /></button>
          </div>
          {removing.used > 0 && (
            <select value={removing.moveTo} onChange={(e) => setRemoving((r) => ({ ...r, moveTo: e.target.value }))} className="input-field py-2 text-sm mt-3">
              <option value="">{t('cats.moveTo')}</option>
              {list.filter((x) => x.id !== removing.id && (x.type || '').toLowerCase() === (removing.type || '').toLowerCase()).map((x) => <option key={x.id} value={x.name}>{x.name}</option>)}
            </select>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={() => setRemoving(null)} className="btn-ghost text-sm">{t('common.cancel')}</button>
            <button type="button" onClick={confirmRemove} disabled={busy === removing.id || (removing.used > 0 && !removing.moveTo)} className="btn-danger text-sm px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed">
              {busy === removing.id ? <Spinner size="sm" className="text-white" /> : <Trash2 size={14} />} {t('tx.delete')}
            </button>
          </div>
        </div>
      )}

      <div className="flex justify-end pt-5">
        <button type="button" onClick={onClose} className="btn-ghost">{t('cats.done')}</button>
      </div>
    </Modal>
  );
}
