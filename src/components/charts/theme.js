import { createContext, useContext, useEffect, useState } from 'react';

// The chart tokens for Business and Ganadería pages. Every chart reads its
// colours from here, so the charts read as one system.
//
// series  — the categorical hues, in fixed order: a chart's first series is
//           always the first hue, and a filter never repaints the others.
//           Checked as a set with Other: every pair at OKLab ΔE ≥ 15 for
//           normal vision and ≥ 8 under the three colour deficiencies, each
//           hue at 3:1 against the surface (tests/chartsTheme.test.js).
// other   — the "Other" bucket and context series; never an identity.
// up/down/total — the cash bridge: money in, money out, a balance.
// Status colours (green/amber/red of the checks) are not here: they belong
// to the checks and are never a series.
//
// Dark is its own set of steps from the same hues, checked against the dark
// surface. It applies when the page sets data-theme="dark" on <html>; the
// Business pages do not yet, so they draw light.
//
// Finca is the light hues on the herd pages' paper card, with the notebook's
// ink and rules. Ganadería pages ask for it through <ChartThemeName.Provider
// value="finca">, so the hues mean the same thing in both programs.
export const THEMES = {
  light: {
    name: 'light',
    surface: '#ffffff', border: '#e9ecef', ink: '#212529', text: '#6f777e', grid: '#e9ecef',
    series: ['#2f8a63', '#1c4f9c', '#d9480f', '#9775fa'],
    other: '#adb5bd', up: '#2f8a63', down: '#d9480f', total: '#495057',
    cursor: 'rgba(33, 37, 41, 0.05)', empty: '#f6f5f1',
  },
  dark: {
    name: 'dark',
    surface: '#17201b', border: '#26302a', ink: '#e9ecef', text: '#9aa59e', grid: '#26302a',
    series: ['#55a683', '#74c0fc', '#e8590c', '#9775fa'],
    other: '#5c6660', up: '#55a683', down: '#e8590c', total: '#ced4da',
    cursor: 'rgba(233, 236, 239, 0.06)', empty: '#1d2722',
  },
  finca: {
    name: 'finca',
    surface: '#FFFDF8', border: '#E4DDCF', ink: '#16211B', text: '#5E6D63', grid: '#EEE8DB',
    series: ['#2f8a63', '#1c4f9c', '#d9480f', '#9775fa'],
    other: '#B5AC9C', up: '#2f8a63', down: '#d9480f', total: '#3B4740',
    cursor: 'rgba(22, 33, 27, 0.05)', empty: '#F3EEE3',
  },
};

// A page that draws on its own ground names its theme here; everything else
// follows data-theme on <html>.
export const ChartThemeName = createContext(null);

const current = () => (typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');

// The theme the page is in, following data-theme on <html> as it changes.
export function useChartTheme() {
  const forced = useContext(ChartThemeName);
  const [name, setName] = useState(current);
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return undefined;
    const obs = new MutationObserver(() => setName(current()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return THEMES[forced] || THEMES[name];
}

// ── Formatters (locale from useT: 'en-US' | 'es-US') ────────────────────────
const nf = new Map();
const fmt = (locale, opts) => {
  const k = `${locale}|${JSON.stringify(opts)}`;
  if (!nf.has(k)) nf.set(k, new Intl.NumberFormat(locale, opts));
  return nf.get(k);
};
// $12,345 — tooltips and tables.
export const money = (n, locale = 'en-US') => (n == null || !Number.isFinite(Number(n)) ? '—' : fmt(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(n)));
// $12.3K — axis ticks.
export const moneyShort = (n, locale = 'en-US') => (n == null ? '' : fmt(locale, { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(Number(n)));
// 2.6% — rates given as fractions.
export const percent = (x, locale = 'en-US', digits = 1) => (x == null || !Number.isFinite(Number(x)) ? '—' : fmt(locale, { style: 'percent', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(x)));
export const count = (n, locale = 'en-US') => (n == null ? '—' : fmt(locale, { maximumFractionDigits: 0 }).format(Number(n)));
// 'YYYY-MM' → "Nov 26" / "nov 26".
export function monthShort(month, locale = 'en-US') {
  if (!month) return '';
  const [y, m] = String(month).split('-').map(Number);
  const name = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(locale, { month: 'short', timeZone: 'UTC' }).replace('.', '');
  return `${name} ${String(y).slice(2)}`;
}
// 'YYYY-MM-DD' → "Nov 7" / "7 nov".
export function dayShort(date, locale = 'en-US') {
  if (!date) return '';
  const [y, m, d] = String(date).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).replace('.', '');
}
// 'YYYY-MM' → "November 2026".
export function monthLong(month, locale = 'en-US') {
  if (!month) return '';
  const [y, m] = String(month).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
