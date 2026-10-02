import { useMemo, useState, type ChangeEvent } from 'react';
import { post } from '../api';
import { fmt, signed } from '../format';

type Cell = string | number | null;
type Figures = { leetcode: Rated; codechef: Rated; codeforces: Rated; hackerrank: number; smartinterviews: number; interviewbit: number };
type Rated = { problems: number; rating: number; contests: number };
interface Preview {
  person: { name: string; roll: string; username: string; rank: string };
  leaderboard: Figures; current: Figures;
  parts: { hackerrankDs: number; hackerrankAlgo: number; smartBasic: number; smartPrimary: number; interviewbitScore: number };
  sheetOverall: number | null; computedOverall: number; currentOverall: number; sheetAgrees: boolean | null;
}

const norm = (c: Cell) => String(c ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const cell = (c: unknown): Cell => (typeof c === 'number' || typeof c === 'string' ? c : c == null ? null : String(c));
/** A date in the file name, such as "..._October_2_2026.xlsx", becomes YYYY-MM-DD; anything else is left out. */
function dateFromName(name: string): string | undefined {
  const m = /([A-Za-z]+)[_\- ](\d{1,2})[_\- ](\d{4})/.exec(name);
  if (!m) return undefined;
  const t = new Date(`${m[1]} ${m[2]}, ${m[3]} 12:00:00 UTC`);
  return Number.isNaN(t.getTime()) ? undefined : t.toISOString().slice(0, 10);
}

const LINES: { key: keyof Figures; label: string }[] = [
  { key: 'leetcode', label: 'LeetCode' }, { key: 'codechef', label: 'CodeChef' }, { key: 'codeforces', label: 'Codeforces' },
  { key: 'hackerrank', label: 'HackerRank' }, { key: 'smartinterviews', label: 'Smart Interviews' }, { key: 'interviewbit', label: 'InterviewBit' },
];
const show = (v: Rated | number) => (typeof v === 'number' ? fmt(v) : `${v.problems} problems · rating ${v.rating} · ${v.contests} contests`);
const same = (a: Rated | number, b: Rated | number) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Sets every platform's figures from the person's own row of a Smart Interviews leaderboard export. The file is read
 * in the browser and never uploaded; only the two header rows and the chosen row are sent. Nothing is applied until
 * the person has seen what would change.
 */
export function LeaderboardImport({ hint, onDone }: { hint: string; onDone: (m: string) => void }) {
  const [rows, setRows] = useState<Cell[][] | null>(null);
  const [fileName, setFileName] = useState('');
  const [query, setQuery] = useState(hint);
  const [picked, setPicked] = useState<Cell[] | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const exportedOn = useMemo(() => dateFromName(fileName), [fileName]);
  const header = rows ? [rows[0], rows[1]] as [Cell[], Cell[]] : null;
  const idx = useMemo(() => {
    if (!rows) return { name: -1, roll: -1, user: -1 };
    const f = (n: string) => rows[0].findIndex((h) => norm(h) === n);
    return { name: f('name'), roll: f('rollnumber'), user: f('username') };
  }, [rows]);
  const matches = useMemo(() => {
    if (!rows || !query.trim()) return [];
    const q = norm(query);
    return rows.slice(2).filter((r) => [idx.name, idx.roll, idx.user].some((i) => i >= 0 && norm(r[i] ?? null).includes(q))).slice(0, 8);
  }, [rows, query, idx]);

  async function choose(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setErr(null); setPicked(null); setPreview(null); setRows(null);
    if (!file) return;
    if (file.size > 5_000_000) { setErr('That file is larger than 5 MB, which a leaderboard export should not be.'); return; }
    setBusy(true);
    try {
      const { readSheet } = await import('read-excel-file/universal');
      const sheet = (await readSheet(file)) as unknown as Array<{ sheet: string; data: unknown[][] }> | unknown[][];
      const data = (Array.isArray(sheet) && sheet.length > 0 && typeof (sheet[0] as any)?.sheet === 'string' ? (sheet as any[])[0].data : sheet) as unknown[][];
      const out = data.map((r) => r.map(cell));
      if (out.length < 3) throw new Error('The file has no data rows.');
      setRows(out); setFileName(file.name);
    } catch (x: any) {
      setErr(`That file could not be read as a spreadsheet (${x?.message ?? 'unknown error'}). Use the .xlsx file exported from the leaderboard.`);
    } finally { setBusy(false); }
  }

  async function select(r: Cell[]) {
    if (!header) return;
    setPicked(r); setPreview(null); setErr(null); setBusy(true);
    try { setPreview(await post<Preview>('/leaderboard/preview', { header, row: r, ...(exportedOn ? { exportedOn } : {}) })); }
    catch (x: any) { setErr(x.message); setPicked(null); } finally { setBusy(false); }
  }

  async function apply() {
    if (!header || !picked) return;
    setBusy(true); setErr(null);
    try {
      const r = await post<{ overall: number }>('/leaderboard/apply', { header, row: picked, ...(exportedOn ? { exportedOn } : {}) });
      onDone(`Your figures now match the leaderboard row. Your score is ${fmt(r.overall)}.`);
      setRows(null); setPicked(null); setPreview(null); setFileName('');
    } catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  }

  const changed = preview ? LINES.filter((l) => !same(preview.current[l.key], preview.leaderboard[l.key])) : [];
  return (
    <div className="stack">
      <p className="lead">LeetCode, CodeChef and Codeforces can be read directly. HackerRank, InterviewBit and Smart Interviews cannot, because none of them offers a public interface. Their figures reach your score only through the leaderboard, so the dependable route is its export.</p>
      <ol className="small">
        <li>On the leaderboard, open the menu at the top right and export the sheet.</li>
        <li>Choose the exported file below. It is read in your browser and is not uploaded.</li>
        <li>Select your own row and check what would change before applying it.</li>
      </ol>
      <div className="field"><label htmlFor="lb-file">Leaderboard export (.xlsx)</label><input id="lb-file" className="input" type="file" accept=".xlsx" onChange={(e) => void choose(e)} /></div>
      {busy && <p className="meta" role="status">Working.</p>}

      {rows && !preview && (
        <div className="stack">
          <div className="field"><label htmlFor="lb-q">Find your row by name, roll number or username</label><input id="lb-q" className="input" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
          {query.trim() && matches.length === 0 && <p className="small">No row matches. Try a different part of your name or your roll number.</p>}
          <ul className="ledger">
            {matches.map((r, i) => (
              <li key={i} className="ledger__row">
                <span className="ledger__k">{String(r[idx.name] ?? '')}</span>
                <span className="ledger__v">{[r[idx.roll], r[idx.user]].filter(Boolean).join(' · ')}</span>
                <button type="button" className="link-arrow as-button" disabled={busy} onClick={() => void select(r)}>Use this row</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {preview && (
        <div className="stack">
          <p className="strong">{preview.person.name}{preview.person.username ? ` · ${preview.person.username}` : ''}{preview.person.rank ? ` · rank ${preview.person.rank}` : ''}</p>
          <p className="body">
            The leaderboard row totals {fmt(preview.computedOverall)}
            {preview.sheetAgrees === true && ', which is the figure the sheet itself shows.'}
            {preview.sheetAgrees === false && `, but the sheet shows ${fmt(preview.sheetOverall ?? 0)}. The sheet's own total disagrees with the formula, so check that this is the right row.`}
            {preview.sheetAgrees === null && '.'} CAIRN currently shows {fmt(preview.currentOverall)}, a difference of {signed(preview.computedOverall - preview.currentOverall)}.
          </p>
          {changed.length === 0
            ? <p className="body">Every figure already matches. Nothing needs to change.</p>
            : <ul className="ledger">{changed.map((l) => (
                <li key={l.key} className="ledger__row">
                  <span className="ledger__k">{l.label}</span>
                  <span className="ledger__v">{show(preview.current[l.key])} → {show(preview.leaderboard[l.key])}</span>
                </li>))}</ul>}
          <p className="small">Smart Interviews is Basic {fmt(preview.parts.smartBasic)} + Primary {fmt(preview.parts.smartPrimary)}; HackerRank is Data Structures {fmt(preview.parts.hackerrankDs)} + Algorithms {fmt(preview.parts.hackerrankAlgo)}; InterviewBit is its score of {fmt(preview.parts.interviewbitScore)} divided by five.</p>
          <p className="small">Connected platforms are read again in the background and then show their live figures, which can run ahead of the leaderboard until it next refreshes. Applying this row sets the starting point, from which later problems are counted on top.</p>
          <div className="btn-row">
            <button type="button" className="btn" disabled={busy || changed.length === 0} aria-busy={busy} onClick={() => void apply()}>Apply these figures</button>
            <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => { setPreview(null); setPicked(null); }}>Choose a different row</button>
          </div>
        </div>
      )}
      {err && <p className="error-text" role="alert">{err}</p>}
    </div>
  );
}
