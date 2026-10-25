---
paths:
  - "src/pages/ceo/**"
  - "src/lib/ceo*.js"
  - "src/components/layout/CeoLayout.jsx"
---

# /ceo — the company's oversight, model and documents

**Nothing confidential in these files.** Every number is computed by `ceoModel.compute(assumptions)`;
every sentence of the plan comes from `platform_documents`. A value or a plan sentence typed here is a bug.

## Data — four sources, loaded once in `CeoPage.load()`
- `ceo_overview()` RPC — workspace aggregates only (raises `NOT_PLATFORM_ADMIN` otherwise)
- `platform_assumptions` — newest `version` is current; `R = compute(versions[0].data)`
- `platform_documents` — newest per `doc`: `business_plan`, `market_gtm`, `findings`, `plan`, `competition`
- `platform_leads` + `platform_lead_events` — the funnel; events are written by trigger
- `platform_research` is legacy and is not read.

Tables are **append-only**: save = `insert({ data|sections, note })`, restore = insert an old row's
payload with note `Restored from vN`. Never send `version` (the trigger sets it). Call `onSaved()` → `load()`.

## Documents
- A document is `sections: [{ key, title, body, level? }]`; `level: 3` renders as a sub-section.
- A `{ kind: 'json', data }` section is data (the competition dataset), never a chapter; `docs.competition` = its `data`.
- Tokens: `{{path|fmt}}` resolved by `resolve(text, R)` from `ceoDocs.js`; formats in `FMT`
  (`usd usd2 usdK num num1 pct pct1 pct2 x mon month ym lower word …`). Unknown paths render `⟨path⟩` — never blank.
- `{{table:name}}` on its own line → `tableFor(name, R, docs)`; add a table to `TABLES` in `ceoDocs.js`,
  returning `{ head, rows, align }` with cells already formatted. Exports use the same tables.
- Shared renderers live in `docParts.jsx` (`Blocks`, `Section`, `Versions`, `DocTable`) — reuse, don't copy.

## Engine (`ceoModel.js`, `ceoCompetition.js`)
- Pure functions, no constants, no imports from React. Runs in the browser and under node
  (`~/selric-business` imports it), so no `window`, no JSX, no `import.meta.env`.
- A new input = a field in the assumptions object (seeded outside the repo) + a `ceoFields.js` entry
  (label, type, unit) + its use in the engine. After an engine change, `verify_model.mjs` must show 0 differences.
- SelRic's own competitor rows carry a `priceToken`; resolve with `get(R, token)`.

## Charts (`charts.jsx`)
- Colours from `C` (validated palette: `brand`, `blue`, `clay` for segments; `gray` for context; `amber` status only).
- Axes and grid are **called**: `{MonthAxis()}`, `{NumAxis({...})}`, `{NumAxisX({...})}`, `{CatAxisY({...})}`, `{Grid()}`.
- Every chart sits in `ChartCard` with a `table` twin and a legend when it has two or more series.
- `useNarrow()` for phone widths (category axis ~118 px). Tooltips through `Tip`.
- Data handed to `<Bar>` carries only plain fields — recharts passes them to the SVG as props.
- `LabelList` content gets `{ x, y, width, height, index }`, not the row: read `data[index]`.

## Exports
- `exportDocx.js` / `exportXlsx.js` are imported with `await import()` on click — never statically.
- Download names: `<File>_<local YYYY-MM-DD>.<ext>`; the edition line names assumptions vN and document vN.

## Language
- Chrome strings for the Competition page live under `ceoComp.*`; the rail under `nav.*`. Both languages.
- Feature labels in the dataset carry `es`; use it when `lang === 'es'`.
- The documents' prose is English only, by decision.
