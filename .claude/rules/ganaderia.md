---
paths:
  - "src/programs/ganaderia/**"
  - "src/programs/index.js"
---

# Batavia Ganadería — the herd program

A card for every animal and a record of everything that happens to it, worked from a phone in
the corral. Pages live under `/ganaderia/*`, wrapped by `GanaderiaRoot` → `HerdProvider`.

## Data
- `lv_animals` (one card) and `lv_events` (the timeline), both org-scoped with `org_isolation`.
- `HerdContext` loads both tables once per workspace (`fetchAll`) and refreshes after every write.
- Writes go through the context only:
  - `saveAnimal(row, id?)` — insert or update a card
  - `deleteAnimal(id)` — its events go with it
  - `recordEvent(p)` → RPC `lv_record_event` — **the event plus what it means on the card**
    (a calving adds the calving, can create the calf, clears the pregnancy; a sale or death changes status)
  - `deleteEvent(id)` → RPC `lv_delete_event` — undoes the effect too
- Never write the card's derived fields from the page after an event; the RPC owns them.

## Vocabulary (`lib.js`)
- Stored values are the notebook's own Spanish keys: species `bovino|porcino`, categories
  (`vaca`, `toro`, `ternero` …), statuses (`activo|vendido|muerto|historico`), flags, event types.
- Labels come from `t('lv.*')`. A new key in `lib.js` needs its label in **both** languages under `lv`.
- `EVENT_TYPES[].fields` drive the event form; order = the order of the record tiles.
- Slugs: `^[a-z0-9][a-z0-9-]{0,78}$`; the database enforces it.

## UI
- Spanish first, English parity. Phone first: big tap targets, one action per tile, no hover-only UI.
- Accent `ranch` (green) for cattle, `clay` for pigs — from `accentOf(program)` / Tailwind tokens, literal class strings.
- The program is registered in `src/programs/index.js` (`key`, `status`, `built`, `home`, `accent`);
  a workspace runs it when `org_programs` has the row.

## Not built (do not imply it is)
Offline mode, native app, milk / feed / genetics modules, reports, health calendar, pedigree tree,
RFID or scale hardware. The competition analysis ranks an offline PWA for Events and Animals first.
