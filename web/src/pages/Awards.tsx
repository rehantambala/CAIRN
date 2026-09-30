import { useFetch } from '../hooks';
import { ErrorBanner, Loading, PageHead } from '../components/ui';
import { AwardFigure } from './Home';

interface Payload {
  awards: { key: string; figure: string; unit: string; title: string; achievedAt: string | null }[];
  metrics: { verifiedDays: number; ratedContests: number; problems: Record<string, number>; ratings: Record<string, number>; overall: number };
}

export function Awards() {
  const { data, error, loading, reload } = useFetch<Payload>('/awards');
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBanner error={error ?? new Error('NO_DATA')} retry={reload} />;
  const earned = data.awards.filter((a) => a.achievedAt);
  const open = data.awards.filter((a) => !a.achievedAt);
  const m = data.metrics;
  return (
    <>
      <PageHead title="Awards" sub="Measured accomplishment. Each one is a rule evaluated against recorded data." />
      <section className="section block block-deep" aria-label="Earned">
        <div className="frame">
          <p className="eyebrow"><span className="eyebrow__no">{earned.length}</span><span className="eyebrow__q">Earned</span></p>
          {earned.length === 0 ? <p className="serif-lead">None yet. The first is seven verified execution days.</p> : (
            <ul className="awards awards--earned">{earned.map((a) => <AwardFigure key={a.key} k={a.key} earned />)}</ul>
          )}
        </div>
      </section>
      <section className="section" aria-label="Open">
        <div className="frame">
          <p className="eyebrow"><span className="eyebrow__no">{open.length}</span><span className="eyebrow__q">Open</span></p>
          <ul className="awards">{open.map((a) => <AwardFigure key={a.key} k={a.key} earned={false} />)}</ul>
          <ul className="ledger" style={{ marginTop: 'var(--space-9)' }}>
            <li className="ledger__row"><span className="ledger__k">Verified days</span><span className="ledger__v" /><span className="ledger__n">{m.verifiedDays}</span></li>
            <li className="ledger__row"><span className="ledger__k">Rated contests</span><span className="ledger__v" /><span className="ledger__n">{m.ratedContests}</span></li>
            <li className="ledger__row"><span className="ledger__k">Problems</span><span className="ledger__v muted">LeetCode · CodeChef · Codeforces</span><span className="ledger__n">{m.problems.leetcode} · {m.problems.codechef} · {m.problems.codeforces}</span></li>
            <li className="ledger__row"><span className="ledger__k">Ratings</span><span className="ledger__v muted">LeetCode · CodeChef · Codeforces</span><span className="ledger__n">{m.ratings.leetcode} · {m.ratings.codechef} · {m.ratings.codeforces}</span></li>
          </ul>
        </div>
      </section>
    </>
  );
}
