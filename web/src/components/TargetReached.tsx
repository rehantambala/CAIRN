import { useState } from 'react';
import { put, safeHref, type Goal, type GoalOption } from '../api';
import { fmt, longDate } from '../format';
import { Section } from './ui';

/** The date `days` from the person's own today, as YYYY-MM-DD, without involving the browser's timezone. */
function dateAfter(today: string, days: number): string {
  const [y, m, d] = today.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const BASIS: { label: string; href: string }[] = [
  { label: 'Locke and Latham (2002), goal-setting theory', href: 'https://med.stanford.edu/content/dam/sm/s-spire/documents/PD.locke-and-latham-retrospective_Paper.pdf' },
  { label: 'Kivetz, Urminsky and Zheng (2006), the goal-gradient effect', href: 'https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2733214' },
  { label: 'Ryan and Deci (2000), self-determination theory', href: 'https://selfdeterminationtheory.org/SDT/documents/2000_RyanDeci_SDT.pdf' },
  { label: 'Gollwitzer (1999), implementation intentions', href: 'https://www.prospectivepsych.org/sites/default/files/pictures/Gollwitzer_Implementation-intentions-1999.pdf' },
];

/**
 * Shown on the briefing once the score has passed the target. It states the position with evidence, explains in
 * one paragraph why a target that is met without a successor tends to end the habit, and offers a choice. Nothing
 * is changed unless the person adopts an option; declining leaves the target exactly as it is.
 */
export function TargetReached({ goal, today, onChange }: { goal: Goal; today: string; onChange: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [kept, setKept] = useState(false);
  if (!goal.reached) return null;

  async function adopt(o: GoalOption) {
    const date = dateAfter(today, o.days);
    setBusy(o.id); setErr(null);
    try {
      await put('/settings', { targetScore: o.targetScore, targetDate: date });
      setDone(`Your target is now ${fmt(o.targetScore)}, to be reached by ${longDate(date)}. Trajectory is measured against it from now.`);
      onChange();
    } catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  }

  if (kept) {
    return (
      <Section kicker="Target reached" label="Target reached">
        <p className="body">The target of {fmt(goal.target)} stands. Your score continues to be recorded beyond it, and the choice of a further target remains open in Preferences.</p>
      </Section>
    );
  }

  return (
    <Section kicker="Target reached" tone="deep" id="target-reached" label="Target reached">
      <h2 className="statement statement--wide">Your score of {fmt(goal.current)} has passed the target of {fmt(goal.target)}.</h2>
      <p className="body" style={{ marginTop: 'var(--space-4)' }}>
        You are {fmt(goal.overshoot)} points beyond it. Research on goal-setting is consistent about what follows: once a goal is met,
        effort tends to slacken unless a specific, difficult goal takes its place, and the satisfaction of arrival fades sooner than people expect.
        Choosing the next target now, while the evidence of progress is recent, is what preserves the habit that produced this result.
      </p>

      {done ? (
        <p className="lead" role="status" style={{ marginTop: 'var(--space-8)' }}>{done}</p>
      ) : (
        <>
          <ol className="qlist" style={{ marginTop: 'var(--space-8)' }}>
            {goal.options.map((o) => (
              <li key={o.id} className="q">
                <div className="q__body">
                  <h3 className="strong">{o.title}</h3>
                  <p className="body">{o.detail}</p>
                  <p className="small">{o.reason}</p>
                  <p className="small">Suggested date: {longDate(dateAfter(today, o.days))}.</p>
                  <div className="btn-row" style={{ marginTop: 'var(--space-3)' }}>
                    <button type="button" className="btn" disabled={busy !== null} aria-busy={busy === o.id} onClick={() => void adopt(o)}>Adopt this target</button>
                  </div>
                </div>
              </li>
            ))}
          </ol>
          <p className="body" style={{ marginTop: 'var(--space-8)' }}>
            Whichever you choose, write one rule of the form “when this happens, I will do that”, for example “when I sit down after dinner on a weekday,
            I will open today’s list”. Plans of this form measurably improve follow-through.
          </p>
          <div className="btn-row" style={{ marginTop: 'var(--space-6)' }}>
            <button type="button" className="link-arrow as-button" onClick={() => setKept(true)}>Keep the present target</button>
          </div>
          <p className="small" style={{ marginTop: 'var(--space-2)' }}>Keeping it is a legitimate choice if your priorities have moved. The decision is yours; nothing changes unless you adopt an option.</p>
        </>
      )}
      {err && <p className="error-text" role="alert" style={{ marginTop: 'var(--space-3)' }}>{err}</p>}

      <details style={{ marginTop: 'var(--space-8)' }}>
        <summary>Basis for this advice</summary>
        <ul className="small" style={{ marginTop: 'var(--space-3)' }}>
          {BASIS.map((b) => <li key={b.href}><a className="link-arrow" href={safeHref(b.href)} target="_blank" rel="noreferrer noopener">{b.label}<span className="sr-only"> (opens in a new tab)</span></a></li>)}
        </ul>
      </details>
    </Section>
  );
}
