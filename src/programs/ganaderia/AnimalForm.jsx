import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import Modal from '../../components/ui/Modal';
import Spinner from '../../components/ui/Spinner';
import { useT } from '../../i18n/I18nContext';
import { cn } from '../../lib/utils';
import { useHerd } from './HerdContext';
import { SPECIES, CATEGORIES, CATEGORY_SEX, STATUSES, FLAGS, slugify } from './lib';

// New animal / edit the card. One modal, every field the card holds.
// Dam and sire are picked from the herd (females / males of the same
// species); a dam that is not in the herd can still be written by name.

const EMPTY = {
  name: '', species: 'bovino', category: 'vaca', sex: 'H', tag: '', brand: '', lot: '', breed: '',
  birth_date: '', dam_id: '', dam_name: '', sire_id: '', sire_name: '', status: 'activo', flags: [], notes: '', aliases: '',
};

function fromRow(a) {
  if (!a) return EMPTY;
  return {
    name: a.name || '', species: a.species || 'bovino', category: a.category || 'vaca', sex: a.sex || 'H',
    tag: a.tag || '', brand: a.brand || '', lot: a.lot || '', breed: a.breed || '',
    birth_date: a.birth_date || '', dam_id: a.dam_id || '', dam_name: a.dam_name || '',
    sire_id: a.sire_id || '', sire_name: a.sire_name || '', status: a.status || 'activo',
    flags: a.flags || [], notes: (a.notes || []).join('\n'), aliases: (a.aliases || []).join(', '),
  };
}

export default function AnimalForm({ open, onClose, animal = null, defaults = null, onSaved }) {
  const { t } = useT();
  const { animals, bySlug, lots, saveAnimal } = useHerd();
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const editing = !!animal;

  // Reset when the modal opens (or opens for another animal) — not on every
  // herd refresh, which would wipe what is being typed.
  useEffect(() => {
    if (open) setForm({ ...fromRow(animal), ...(animal ? {} : defaults || {}) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, animal?.id, defaults]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setCategory = (category) => setForm((f) => ({ ...f, category, sex: CATEGORY_SEX[category] || f.sex }));
  const setSpecies = (species) => setForm((f) => {
    const category = CATEGORIES[species][0];
    return { ...f, species, category, sex: CATEGORY_SEX[category] || f.sex };
  });
  const toggleFlag = (flag) => setForm((f) => ({ ...f, flags: f.flags.includes(flag) ? f.flags.filter((x) => x !== flag) : [...f.flags, flag] }));

  const dams = useMemo(() => animals.filter((a) => a.sex === 'H' && a.species === form.species && a.id !== animal?.id).sort((x, y) => x.name.localeCompare(y.name)), [animals, form.species, animal]);
  const sires = useMemo(() => animals.filter((a) => a.sex === 'M' && a.species === form.species && a.id !== animal?.id).sort((x, y) => x.name.localeCompare(y.name)), [animals, form.species, animal]);
  const sexLocked = !!CATEGORY_SEX[form.category];

  async function handleSubmit(e) {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) { toast.error(t('lv.form.nameRequired')); return; }
    const dam = form.dam_id ? animals.find((a) => a.id === form.dam_id) : null;
    const sire = form.sire_id ? animals.find((a) => a.id === form.sire_id) : null;
    const row = {
      name,
      species: form.species,
      category: form.category,
      sex: form.sex,
      tag: form.tag.trim(),
      brand: form.brand.trim().toUpperCase(),
      lot: form.lot.trim(),
      breed: form.breed.trim(),
      birth_date: form.birth_date || null,
      dam_id: dam ? dam.id : null,
      dam_name: dam ? dam.name : form.dam_name.trim(),
      sire_id: sire ? sire.id : null,
      sire_name: sire ? sire.name : form.sire_name.trim(),
      status: form.status,
      flags: form.flags,
      notes: form.notes.split('\n').map((s) => s.trim()).filter(Boolean),
      aliases: form.aliases.split(',').map((s) => s.trim()).filter(Boolean),
    };
    if (!editing) {
      let slug = slugify(name);
      for (let n = 2; bySlug[slug]; n++) slug = `${slugify(name)}-${n}`;
      row.slug = slug;
    }
    setSaving(true);
    try {
      const saved = await saveAnimal(row, animal?.id || null);
      toast.success(t(editing ? 'lv.form.updated' : 'lv.form.created', { name }));
      onSaved?.(saved);
      onClose();
    } catch (err) {
      toast.error(err.message || t('lv.form.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  const label = 'block text-xs font-semibold text-surface-600 mb-1.5';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? t('lv.form.editTitle', { name: animal.name }) : t('lv.form.newTitle')}
      description={editing ? null : t('lv.form.newBody')}
      size="lg"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">{t('common.cancel')}</button>
          <button type="submit" form="lv-animal-form" disabled={saving} className="btn-primary">
            {saving ? <Spinner size="sm" className="text-white" /> : t(editing ? 'common.save' : 'lv.form.create')}
          </button>
        </div>
      )}
    >
      <form id="lv-animal-form" onSubmit={handleSubmit} className="space-y-5">
        {/* Who */}
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label htmlFor="lv-name" className={label}>{t('lv.fields.name')}</label>
            <input id="lv-name" type="text" value={form.name} onChange={set('name')} className="input-field" placeholder={t('lv.form.namePh')} required autoFocus />
          </div>
          <div>
            <label className={label}>{t('lv.fields.species')}</label>
            <div className="flex rounded-lg bg-surface-100 p-0.5" role="radiogroup">
              {SPECIES.map((s) => (
                <button key={s} type="button" role="radio" aria-checked={form.species === s} onClick={() => setSpecies(s)}
                  className={cn('flex-1 py-1.5 rounded-md text-sm font-medium transition-colors', form.species === s ? 'bg-white shadow-card text-surface-900' : 'text-surface-500 hover:text-surface-800')}>
                  {t(`lv.species.${s}`)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor="lv-cat" className={label}>{t('lv.fields.category')}</label>
            <select id="lv-cat" value={form.category} onChange={(e) => setCategory(e.target.value)} className="input-field">
              {CATEGORIES[form.species].map((c) => <option key={c} value={c}>{t(`lv.category.${c}`)}</option>)}
            </select>
          </div>
          <div>
            <label className={label}>{t('lv.fields.sex')}</label>
            <div className="flex rounded-lg bg-surface-100 p-0.5" role="radiogroup">
              {['H', 'M'].map((s) => (
                <button key={s} type="button" role="radio" aria-checked={form.sex === s} disabled={sexLocked && form.sex !== s}
                  onClick={() => setForm((f) => ({ ...f, sex: s }))}
                  className={cn('flex-1 py-1.5 rounded-md text-sm font-medium transition-colors disabled:opacity-40', form.sex === s ? 'bg-white shadow-card text-surface-900' : 'text-surface-500 hover:text-surface-800')}>
                  {t(`lv.sex.${s}`)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor="lv-birth" className={label}>{t('lv.fields.birthDate')}</label>
            <input id="lv-birth" type="date" value={form.birth_date} onChange={set('birth_date')} className="input-field" />
          </div>
        </div>

        {/* Marks */}
        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="lv-tag" className={label}>{t('lv.fields.tag')}</label>
            <input id="lv-tag" type="text" value={form.tag} onChange={set('tag')} className="input-field" placeholder="7275" />
          </div>
          <div>
            <label htmlFor="lv-brand" className={label}>{t('lv.fields.brand')}</label>
            <input id="lv-brand" type="text" value={form.brand} onChange={set('brand')} className="input-field font-mono uppercase" placeholder="TO/SR" />
          </div>
          <div>
            <label htmlFor="lv-lot" className={label}>{t('lv.fields.lot')}</label>
            <input id="lv-lot" type="text" value={form.lot} onChange={set('lot')} className="input-field" list="lv-lots" placeholder={t('lv.form.lotPh')} />
            <datalist id="lv-lots">{lots.map((l) => <option key={l} value={l} />)}</datalist>
          </div>
          <div>
            <label htmlFor="lv-breed" className={label}>{t('lv.fields.breed')}</label>
            <input id="lv-breed" type="text" value={form.breed} onChange={set('breed')} className="input-field" placeholder="Brahman" />
          </div>
          <div>
            <label htmlFor="lv-dam" className={label}>{t('lv.fields.dam')}</label>
            <select id="lv-dam" value={form.dam_id} onChange={set('dam_id')} className="input-field">
              <option value="">{form.dam_name ? t('lv.form.damByName', { name: form.dam_name }) : t('lv.form.unknown')}</option>
              {dams.map((a) => <option key={a.id} value={a.id}>{a.name}{a.tag ? ` · ${a.tag}` : ''}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="lv-sire" className={label}>{t('lv.fields.sire')}</label>
            <select id="lv-sire" value={form.sire_id} onChange={set('sire_id')} className="input-field">
              <option value="">{form.sire_name ? t('lv.form.damByName', { name: form.sire_name }) : t('lv.form.unknown')}</option>
              {sires.map((a) => <option key={a.id} value={a.id}>{a.name}{a.tag ? ` · ${a.tag}` : ''}</option>)}
            </select>
          </div>
        </div>

        {/* State */}
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="lv-status" className={label}>{t('lv.fields.status')}</label>
            <select id="lv-status" value={form.status} onChange={set('status')} className="input-field">
              {STATUSES.map((s) => <option key={s} value={s}>{t(`lv.status.${s}`)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="lv-aliases" className={label}>{t('lv.fields.aliases')}</label>
            <input id="lv-aliases" type="text" value={form.aliases} onChange={set('aliases')} className="input-field" placeholder={t('lv.form.aliasesPh')} />
          </div>
          <div className="sm:col-span-2">
            <label className={label}>{t('lv.fields.flags')}</label>
            <div className="flex flex-wrap gap-1.5">
              {FLAGS.map((f) => {
                const on = form.flags.includes(f);
                return (
                  <button key={f} type="button" onClick={() => toggleFlag(f)} aria-pressed={on}
                    className={cn('px-2.5 py-1 rounded-full text-xs font-medium border transition-colors', on ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white border-surface-300 text-surface-600 hover:border-surface-400')}>
                    {t(`lv.flags.${f}`)}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="lv-notes" className={label}>{t('lv.fields.notes')}</label>
            <textarea id="lv-notes" value={form.notes} onChange={set('notes')} className="input-field min-h-[80px]" placeholder={t('lv.form.notesPh')} />
          </div>
        </div>
      </form>
    </Modal>
  );
}
