import type { Platform, Consistency } from '../api';
import { fmt, signed } from '../format';
import { useFetch } from '../hooks';
import { ErrorBanner, Loading, PageHead, Section, Empty } from '../components/ui';
import { ConsistencyBlock } from './Home';
import { LineChart } from './Trajectory';

interface Payload {
  velocity: { day: string; gain: number }[];
  ratings: { platform: Platform; rating: number; at: string }[];
  contests: { title: string; platform: Platform; at: string; delta: number | null; after: number | null }[];
  solvedWeekly: { platform: Platform; week: string; count: number }[];
  consistency: Consistency;
  contribution: { label: string; value: number }[];
  weeks: { date: string; state: string }[];
}
const LABEL: Record<string, string> = { leetcode: 'LeetCode', codechef: 'CodeChef', codeforces: 'Codeforces' };

export function Analytics() {
  const { data: d, error, loading, reload } = useFetch<Payload>('/analytics');
  if (loading) return <Loading />;
  if (error || !d) return <ErrorBanner error={error ?? new Error('NO_DATA')} retry={reload} />;
  const total = d.contribution.reduce((a, c) => a + c.value, 0);
  const ratingPlatforms = (['leetcode', 'codechef', 'codeforces'] as const).map((p) => ({ p, pts: d.ratings.filter((r) => r.platform === p) }));
  const weeks = [...new Set(d.solvedWeekly.map((s) => s.week))];

  return (
    <>
      <PageHead title="Analytics" sub="Only what informs a decision. Empty means there is no data yet, never a placeholder." />

      <Section no="01" q="Platform contribution" label="Platform contribution">
        <ul className="ledger">
          {d.contribution.map((c) => (
            <li key={c.label} className="ledger__row">
              <span className="ledger__k">{c.label}</span>
              <span className="ledger__v"><span className="bar" style={{ width: `${Math.max(1, (c.value / Math.max(1, total)) * 100)}%` }} aria-hidden="true" /></span>
              <span className="ledger__n">{fmt(c.value)} <span className="muted">· {Math.round((c.value / Math.max(1, total)) * 100)}%</span></span>
            </li>
          ))}
        </ul>
      </Section>

      <Section no="02" q="Score velocity" tone="deep" label="Score velocity">
        {d.velocity.length < 2 ? <Empty title="INSUFFICIENT DATA">Daily gains appear after the score has history on more than two days.</Empty> : (
          <>
            <Bars data={d.velocity.map((v) => ({ k: v.day.slice(5), v: v.gain }))} />
            <p className="muted" style={{ marginTop: 'var(--space-3)' }}>Daily score gain, last {d.velocity.length} days.</p>
          </>
        )}
      </Section>

      <Section no="03" q="Rating movement" label="Rating movement">
        <div className="stack-lg">
          {ratingPlatforms.map(({ p, pts }) => (
            <div key={p}>
              <h3 className="h-sub">{LABEL[p]}</h3>
              {pts.length < 2 ? <p className="serif-lead">{pts.length === 1 ? `${pts[0].rating}. Movement appears after a second rating point.` : 'No rating recorded.'}</p> : <LineChart points={pts.map((r) => ({ x: r.at.slice(0, 10), y: r.rating }))} />}
            </div>
          ))}
        </div>
      </Section>

      <Section no="04" q="Contest performance" tone="deep" label="Contest performance">
        {d.contests.length === 0 ? <Empty title="No contests recorded">Participation is recorded from verified syncs or manual confirmation.</Empty> : (
          <ul className="ledger">
            {d.contests.map((c, i) => (
              <li key={i} className="ledger__row"><span className="ledger__k">{LABEL[c.platform]} · {c.at.slice(0, 10)}</span><span className="ledger__v">{c.title}</span><span className="ledger__n">{c.delta === null ? '—' : signed(c.delta)}</span></li>
            ))}
          </ul>
        )}
      </Section>

      <Section no="05" q="Problem completion" label="Problem completion">
        {weeks.length === 0 ? <Empty title="No accepted problems in the last 12 weeks">Weekly counts appear after verified acceptances.</Empty> : (
          <ul className="ledger">
            {weeks.map((w) => (
              <li key={w} className="ledger__row"><span className="ledger__k">Week of {w}</span><span className="ledger__v muted">{d.solvedWeekly.filter((s) => s.week === w).map((s) => `${LABEL[s.platform]} ${s.count}`).join(' · ')}</span><span className="ledger__n">{d.solvedWeekly.filter((s) => s.week === w).reduce((a, s) => a + s.count, 0)}</span></li>
            ))}
          </ul>
        )}
      </Section>

      <Section no="06" q="Execution consistency" tone="deep" label="Execution consistency">
        <ConsistencyBlock c={d.consistency} />
      </Section>
    </>
  );
}

function Bars({ data }: { data: { k: string; v: number }[] }) {
  const max = Math.max(1, ...data.map((d) => Math.abs(d.v)));
  return (
    <div className="bars" role="img" aria-label={`Daily score gain, maximum ${fmt(max)}`}>
      {data.map((d) => <div key={d.k} className="bars__col" title={`${d.k}: ${signed(d.v)}`}><div className="bars__bar" style={{ height: `${Math.max(2, (Math.abs(d.v) / max) * 100)}%` }} /></div>)}
    </div>
  );
}
