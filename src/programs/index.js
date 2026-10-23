import { Briefcase, Tractor } from 'lucide-react';

// The SelRic program registry.
//
// SelRic is one account with a program for each thing a person runs. Every
// program is a folder of pages and tables that plugs into the shared shell
// (login, workspace, team, language, Settings, billing, public site). Adding a
// program = a folder under src/programs/ plus one entry here, its copy under
// `programs.<key>` in src/i18n/translations.js, and a row in `org_programs`
// for each workspace that turns it on.
//
//   key     — stable id; also the `program` value in org_programs / waitlist
//   status  — what the public site says: 'live', 'pilot' (running at one
//             site, by invitation) or 'soon' (announced only)
//   built   — the program's pages exist in this app; a workspace on a program
//             that is not built yet gets the holding page after sign-in
//   home    — where the program's pages start
//   accent  — a key of ACCENTS (Tailwind classes must be literal strings)
//
// Business keeps its historical routes at the root so nothing bookmarked by
// Humphrey's changes; later programs mount under their own prefix.
export const PROGRAMS = [
  { key: 'business',  icon: Briefcase, status: 'live',  built: true, home: '/',          accent: 'brand', default: true },
  { key: 'ganaderia', icon: Tractor,   status: 'pilot', built: true, home: '/ganaderia', accent: 'ranch' },
];

export const DEFAULT_PROGRAM = 'business';

export const ACCENTS = {
  brand: {
    tile: 'bg-brand-600 text-white',
    soft: 'bg-brand-50 text-brand-700',
    border: 'border-brand-200',
    hover: 'hover:border-brand-400',
    text: 'text-brand-700',
    bar: 'bg-brand-500',
    rule: 'border-brand-900',
    dark: 'bg-brand-950',
  },
  ranch: {
    tile: 'bg-ranch-600 text-white',
    soft: 'bg-ranch-50 text-ranch-700',
    border: 'border-ranch-200',
    hover: 'hover:border-ranch-500',
    text: 'text-ranch-700',
    bar: 'bg-ranch-500',
    rule: 'border-ranch-700',
    dark: 'bg-ranch-900',
  },
};

export function getProgram(key) {
  return PROGRAMS.find((p) => p.key === key) || null;
}

export function accentOf(program) {
  return ACCENTS[program?.accent] || ACCENTS.brand;
}
