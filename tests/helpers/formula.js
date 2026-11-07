// Recomputes the formulas of a workbook sheet (lib/workbook.js) from the
// cells they point at, so a test can check that every formula says what its
// stored value says. Understands what the report sheets write: cell
// references, SUM over a range (A1:A9, B4:M4), + and -.
const colIndex = (letters) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const colLetters = (n) => { let s = ''; for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s; return s; };

export function evaluator(s) {
  const cell = (ref) => {
    const m = /^([A-Z]+)(\d+)$/.exec(ref);
    const r = Number(m[2]), c = colIndex(m[1]);
    if (r < 3) return 0;
    const v = s.rows[r - 3]?.cells[c - 1];
    if (v && typeof v === 'object' && 'f' in v) return run(v.f);
    return typeof v === 'number' ? v : 0;
  };
  const run = (f) => {
    const expr = f
      .replace(/SUM\(([A-Z]+)(\d+):([A-Z]+)(\d+)\)/g, (_, c1, r1, c2, r2) => {
        let t = 0;
        for (let r = Number(r1); r <= Number(r2); r++) {
          for (let c = colIndex(c1); c <= colIndex(c2); c++) t += cell(`${colLetters(c)}${r}`);
        }
        return `(${t})`;
      })
      .replace(/\b([A-Z]+\d+)\b/g, (ref) => `(${cell(ref)})`);
    if (!/^[\d.()+\-\se]+$/.test(expr)) throw new Error(`cannot evaluate ${f} → ${expr}`);
    return Function(`return (${expr});`)();
  };
  return run;
}

// Every formula cell of a sheet: [{ ref, f, v }].
export function formulas(s) {
  const out = [];
  s.rows.forEach((r, i) => r.cells.forEach((v, j) => {
    if (v && typeof v === 'object' && 'f' in v) out.push({ ref: `${colLetters(j + 1)}${i + 3}`, f: v.f, v: v.v });
  }));
  return out;
}
