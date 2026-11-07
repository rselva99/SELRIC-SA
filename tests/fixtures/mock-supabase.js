// A stand-in for Supabase's REST, auth and storage endpoints, answering from
// in-memory tables. The smoke test routes a browser's Supabase requests here
// (Playwright's page.route), so pages that need a Business workspace can be
// opened without a real account and without touching the real database.
//
//   const handle = mockSupabase({ tables, user, session, rpc, missing });
//   handle({ method, url, headers, body }) → { status, headers, body }
//
// Reads understand the PostgREST filters the app uses (eq, neq, gt, gte, lt,
// lte, in, is, like, ilike, not.*, or=(…)), order, limit/offset, Range, a
// count request and a single-object Accept. Writes never change the tables:
// an insert or update answers with what it was sent, so a page that saves
// goes on working, and every write is recorded in `handle.writes`. A table in
// `missing` answers like a database without it (404, PGRST205).

const json = (status, body, headers = {}) => ({ status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers }, body: body === undefined ? '' : JSON.stringify(body) });

function parseValue(v) {
  if (v === 'null') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return decodeURIComponent(v.replace(/\+/g, ' '));
}
const cmp = (a, b) => {
  if (a == null || b == null) return a == null && b == null ? 0 : a == null ? -1 : 1;
  const na = Number(a), nb = Number(b);
  if (a !== '' && b !== '' && Number.isFinite(na) && Number.isFinite(nb) && typeof a !== 'boolean') return na - nb;
  return String(a).localeCompare(String(b));
};
const likeRe = (p, flags) => new RegExp(`^${String(p).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[*%]/g, '.*')}$`, flags);

// One condition "op.value" on a row's column → boolean.
function test(row, col, expr) {
  let neg = false;
  if (expr.startsWith('not.')) { neg = true; expr = expr.slice(4); }
  const dot = expr.indexOf('.');
  const op = expr.slice(0, dot), raw = expr.slice(dot + 1);
  const v = row[col];
  let ok;
  switch (op) {
    case 'eq': ok = cmp(v, parseValue(raw)) === 0 && v != null; break;
    case 'neq': ok = v == null || cmp(v, parseValue(raw)) !== 0; break;
    case 'gt': ok = v != null && cmp(v, parseValue(raw)) > 0; break;
    case 'gte': ok = v != null && cmp(v, parseValue(raw)) >= 0; break;
    case 'lt': ok = v != null && cmp(v, parseValue(raw)) < 0; break;
    case 'lte': ok = v != null && cmp(v, parseValue(raw)) <= 0; break;
    case 'is': { const p = parseValue(raw); ok = p === null ? v == null : v === p; break; }
    case 'in': { const list = raw.replace(/^\(|\)$/g, '').split(',').map((s) => parseValue(s.replace(/^"|"$/g, ''))); ok = list.some((x) => cmp(v, x) === 0); break; }
    case 'like': ok = v != null && likeRe(parseValue(raw)).test(String(v)); break;
    case 'ilike': ok = v != null && likeRe(parseValue(raw), 'i').test(String(v)); break;
    case 'cs': case 'cd': case 'ov': case 'fts': case 'plfts': case 'wfts': ok = true; break;
    default: ok = true;
  }
  return neg ? !ok : ok;
}

// or=(a.eq.1,b.is.null) — flat lists only, which is all the app sends.
function testOr(row, list) {
  return list.replace(/^\(|\)$/g, '').split(/,(?![^(]*\))/).some((cond) => {
    const i = cond.indexOf('.');
    return test(row, cond.slice(0, i), cond.slice(i + 1));
  });
}

const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'or', 'and', 'on_conflict', 'columns']);

export function mockSupabase({ tables = {}, user = null, session = null, rpc = {}, missing = [] } = {}) {
  const gone = new Set(missing);
  const writes = [];

  function read(table, params, headers) {
    let rows = [...(tables[table] || [])];
    for (const [k, v] of params) {
      if (RESERVED.has(k)) continue;
      rows = rows.filter((r) => test(r, k, v));
    }
    const or = params.get('or');
    if (or) rows = rows.filter((r) => testOr(r, or));
    const order = params.get('order');
    if (order) {
      const keys = order.split(',').map((s) => { const [col, dir = 'asc'] = s.split('.'); return [col, dir === 'desc' ? -1 : 1]; });
      rows.sort((a, b) => { for (const [c, d] of keys) { const x = cmp(a[c], b[c]); if (x) return x * d; } return 0; });
    }
    const total = rows.length;
    let from = Number(params.get('offset') || 0), to = params.get('limit') != null ? from + Number(params.get('limit')) - 1 : rows.length - 1;
    const range = /^(\d+)-(\d+)$/.exec(headers.range || '');
    if (range) { from = Number(range[1]); to = Number(range[2]); }
    const page = rows.slice(from, to + 1);
    return { page, total, from };
  }

  function handle({ method = 'GET', url, headers = {}, body = null }) {
    const u = new URL(url);
    const path = u.pathname;
    const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));

    if (path.startsWith('/auth/v1/')) {
      const what = path.slice('/auth/v1/'.length);
      if (what.startsWith('user')) return user ? json(200, user) : json(401, { msg: 'no user' });
      if (what.startsWith('token')) return session ? json(200, session) : json(400, { error: 'invalid_grant' });
      if (what.startsWith('logout')) return json(204);
      if (what.startsWith('settings')) return json(200, { external: {}, disable_signup: false });
      return json(200, {});
    }
    if (path.startsWith('/storage/v1/')) {
      if (/\/object\/sign\//.test(path)) return json(200, { signedURL: '/missing-object' });
      return json(200, []);
    }
    if (path.startsWith('/functions/v1/')) return json(200, {});
    if (!path.startsWith('/rest/v1/')) return json(404, { message: 'not mocked' });

    const name = decodeURIComponent(path.slice('/rest/v1/'.length));
    if (name.startsWith('rpc/')) {
      const fn = name.slice(4);
      let args = {};
      try { args = body ? JSON.parse(body) : {}; } catch { args = {}; }
      if (gone.has(`rpc/${fn}`)) return json(404, { code: 'PGRST202', message: `Could not find the function public.${fn}` });
      const answer = typeof rpc[fn] === 'function' ? rpc[fn](args, tables) : rpc[fn];
      return json(200, answer === undefined ? null : answer);
    }
    if (gone.has(name)) return json(404, { code: 'PGRST205', message: `Could not find the table 'public.${name}' in the schema cache`, details: null, hint: null });

    const params = u.searchParams;
    if (method === 'GET' || method === 'HEAD') {
      const { page, total, from } = read(name, params, h);
      const wantsCount = /count=(exact|planned|estimated)/.test(h.prefer || '');
      const range = page.length ? `${from}-${from + page.length - 1}/${wantsCount ? total : '*'}` : `*/${wantsCount ? total : '*'}`;
      if (method === 'HEAD') return { status: 200, headers: { 'content-range': range }, body: '' };
      if ((h.accept || '').includes('vnd.pgrst.object')) {
        if (page.length !== 1) return json(406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${page.length} rows`, hint: null });
        return json(200, page[0], { 'content-range': range });
      }
      return json(200, page, { 'content-range': range });
    }
    let sent = null;
    try { sent = body ? JSON.parse(body) : null; } catch { sent = null; }
    writes.push({ method, table: name, at: new Date().toISOString() });
    const rows = Array.isArray(sent) ? sent : sent ? [sent] : [];
    const echo = rows.map((r, i) => ({ id: r.id || `mock-${writes.length}-${i}`, ...r }));
    if ((h.accept || '').includes('vnd.pgrst.object')) return json(method === 'POST' ? 201 : 200, echo[0] || {});
    return json(method === 'POST' ? 201 : 200, echo);
  }
  handle.writes = writes;
  return handle;
}

// A browser session supabase-js accepts from localStorage: an unsigned token
// whose claims say who the user is, valid for a day. The mock never checks it.
export function fakeSession(user, now = Date.now()) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const exp = Math.floor(now / 1000) + 86400;
  const access_token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user.id, role: 'authenticated', aud: 'authenticated', email: user.email, exp, iat: exp - 86400 })}.mock`;
  return { access_token, token_type: 'bearer', expires_in: 86400, expires_at: exp, refresh_token: 'mock-refresh', user };
}
