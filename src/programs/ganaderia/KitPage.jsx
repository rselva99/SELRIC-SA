import { useState } from 'react';
import { Stethoscope } from 'lucide-react';
import { useT } from '../../i18n/I18nContext';
import { cn } from '../../lib/utils';
import { Sheet, ActionSheet } from './Sheet';
import {
  ChapaTag, PregnancyBar, NeedsYouList, Kpi, EventIcon, Chip, ChipRow, MilkBars, LotBar, GroupLegend,
  FlagChip, StatusBadge, BrandChip, Card, btnClay, btnPaper, btnForest, fieldCls, labelCls,
} from './components';
import { EVENT_TYPES, todayISO, addDays } from './lib';

// /ganaderia/_kit — every Ganadería component in every state, on made-up
// animals, for checking the look on the dev server. The route exists only
// when import.meta.env.DEV is true (see src/main.jsx); it never ships.

const T = todayISO();
const A = (o) => ({ id: o.tag || o.name, name: 'Golondrina', species: 'bovino', status: 'activo', sex: 'H', category: 'vaca', tag: '1024', ...o });
const TAGS = [
  A({ category: 'vaca', tag: '1024' }), A({ category: 'toro', sex: 'M', tag: '12' }), A({ category: 'vaquilla', tag: '388' }),
  A({ category: 'novillo', sex: 'M', tag: '4410' }), A({ category: 'ternera', tag: '0812' }), A({ category: 'ternero', sex: 'M', tag: '' , name: 'Cría de Canela' }),
  A({ category: 'vaca', status: 'vendido', tag: '6061' }), A({ category: 'cerda', species: 'porcino', tag: '31' }),
];
const PREG = [
  A({ pregnant: true, preg_months: 2, preg_date: T }),
  A({ pregnant: true, preg_months: 7, preg_date: addDays(T, -10) }),
  A({ pregnant: true, preg_months: 9, preg_date: addDays(T, -40) }),
  A({ species: 'porcino', category: 'cerda', pregnant: true, preg_months: 2, preg_date: addDays(T, -20) }),
];
const WEEK = Array.from({ length: 7 }, (_, i) => ({ date: addDays(T, i - 6), liters: [58, 61, 0, 64, 60, 66, 62][i] }));
const FORTNIGHT = Array.from({ length: 14 }, (_, i) => ({ date: addDays(T, i - 13), liters: 50 + ((i * 7) % 17) }));

function Block({ title, children, className }) {
  return (
    <section className={cn('space-y-3', className)}>
      <h2 className="text-[13px] font-semibold uppercase tracking-wider text-finca-ink2">{title}</h2>
      {children}
    </section>
  );
}

export default function KitPage() {
  const { t } = useT();
  const [sheet, setSheet] = useState(false);
  const [actions, setActions] = useState(false);
  const [chip, setChip] = useState('all');

  const rows = [
    { key: 'a', to: '/ganaderia/_kit', lead: <ChapaTag animal={PREG[2]} size="sm" />, title: 'Golondrina', sub: '24 nov · Potrero 2' },
    { key: 'b', to: '/ganaderia/_kit', lead: <span className="w-[30px] h-[34px] shrink-0 rounded-lg bg-finca-claySoft text-finca-clayText flex items-center justify-center"><Stethoscope size={17} /></span>, title: 'Sin palpar', sub: '90 d' },
  ];

  return (
    <div className="animate-rise space-y-10 pb-10">
      <h1 className="font-display text-[36px]">Ganadería kit</h1>

      <Block title="ChapaTag · sm / md / lg">
        {['sm', 'md', 'lg'].map((size) => (
          <div key={size} className="flex flex-wrap items-end gap-3">
            {TAGS.map((a) => <ChapaTag key={a.id + size} animal={a} size={size} />)}
          </div>
        ))}
      </Block>

      <Block title="PregnancyBar">
        <div className="grid sm:grid-cols-2 gap-4 max-w-xl">
          {PREG.map((a, i) => <Card key={i} className="px-4 py-3"><PregnancyBar animal={a} today={T} size={i % 2 ? 'md' : 'sm'} /></Card>)}
        </div>
      </Block>

      <Block title="NeedsYouList · empty">
        <div className="max-w-xl" data-testid="kit-needs-empty"><NeedsYouList items={[]} /></div>
      </Block>
      <Block title="NeedsYouList · two rows">
        <div className="max-w-xl"><NeedsYouList items={rows} /></div>
      </Block>

      <Block title="Kpi">
        <div className="grid grid-cols-3 gap-2 max-w-xl">
          <Kpi label={t('lv.fields.calvings')} value={4} />
          <Kpi label={t('lv.ficha.lastWeight')} value="412 kg" sub="12 oct" />
          <Kpi label={t('lv.ficha.milk7')} value="61 L" to="/ganaderia/_kit" />
        </div>
      </Block>

      <Block title="EventIcon">
        <div className="flex flex-wrap gap-3">
          {EVENT_TYPES.map((e) => (
            <span key={e.key} className="inline-flex items-center gap-2 text-[14px]"><EventIcon type={e.key} /> {t(`lv.types.${e.key}`)}</span>
          ))}
        </div>
      </Block>

      <Block title="Chip · ChipRow">
        <ChipRow label="kit">
          {['all', 'vacas', 'prenadas', 'crias', 'sin_palpar', 'cerrados'].map((k, i) => (
            <Chip key={k} on={chip === k} onClick={() => setChip(k)} count={[84, 43, 12, 9, 7, 5][i]}>{t(`lv.animals.kind.${k}`)}</Chip>
          ))}
        </ChipRow>
        <div className="flex flex-wrap gap-2">
          <FlagChip flag="por_confirmar" /> <FlagChip flag="vieja" /> <StatusBadge status="activo" /> <StatusBadge status="vendido" /> <StatusBadge status="muerto" /> <BrandChip brand="AB/12" />
        </div>
      </Block>

      <Block title="MilkBars">
        <div className="flex flex-wrap items-end gap-6">
          <MilkBars series={WEEK} height={56} className="w-[112px]" summary="7 d" />
          <MilkBars series={FORTNIGHT} height={132} labels valueOnLast className="w-full max-w-lg" summary="14 d" />
        </div>
      </Block>

      <Block title="LotBar · GroupLegend">
        <div className="max-w-sm space-y-2">
          <LotBar groups={{ hembras: 14, jovenes: 6, crias: 9, machos: 1 }} total={30} />
          <GroupLegend groups={{ hembras: 14, jovenes: 6, crias: 9, machos: 1 }} />
          <LotBar groups={{ hembras: 1, jovenes: 0, crias: 0, machos: 0 }} total={1} />
          <GroupLegend groups={{ hembras: 1, jovenes: 0, crias: 0, machos: 0 }} />
        </div>
      </Block>

      <Block title="Buttons · fields">
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnClay}>{t('lv.reg.save')}</button>
          <button type="button" className={btnPaper}>{t('common.cancel')}</button>
          <button type="button" className={btnForest}>{t('lv.ficha.recordAny')}</button>
        </div>
        <div className="max-w-sm">
          <label htmlFor="kit-field" className={labelCls}>{t('lv.fields.tag')}</label>
          <input id="kit-field" className={fieldCls} placeholder="1024" />
        </div>
      </Block>

      <Block title="Sheet · ActionSheet">
        <div className="flex gap-2">
          <button type="button" className={btnPaper} onClick={() => setSheet(true)} data-testid="kit-open-sheet">Sheet</button>
          <button type="button" className={btnPaper} onClick={() => setActions(true)}>ActionSheet</button>
        </div>
      </Block>

      <Sheet open={sheet} onClose={() => setSheet(false)} title={t('lv.reg.whatHappened')} subtitle="Golondrina · 1024"
        footer={<button type="button" className={cn(btnClay, 'w-full')} onClick={() => setSheet(false)}>{t('lv.reg.save')}</button>}>
        <div className="space-y-3">
          {Array.from({ length: 24 }, (_, i) => <Card key={i} className="px-4 py-3 text-[15px]">{i + 1}</Card>)}
        </div>
      </Sheet>
      <ActionSheet open={actions} onClose={() => setActions(false)} title="Golondrina"
        actions={[{ key: 'a', label: t('lv.ficha.edit') }, { key: 'b', label: t('lv.ficha.deleteEvent'), danger: true }]} />
    </div>
  );
}
