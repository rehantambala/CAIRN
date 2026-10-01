import type { Brief } from '../api';
import { fmt, signed } from '../format';

const dur = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim() : `${m} min`);
const clock = (ms: number, tz: string) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms);

/** What the day is worth, platform by platform: the specific quantity, the points it adds, and the consequence. */
export function Yield({ brief: b, tz, now, streak }: { brief: Brief; tz: string; now: number; streak: number }) {
  if (b.steps.length === 0) return null;
  const latest = b.dayEndsAt - (b.minutes + 30) * 60_000;
  const left = b.dayEndsAt - now;
  const feasible = left >= b.minutes * 60_000;
  return (
    <div className="yield">
      <ol className="yield__rows" aria-label="Score added by each platform">
        {b.steps.map((s, i) => (
          <li key={i} className="yield__row" style={{ ['--i' as string]: i }}>
            <span className="yield__what">
              <span className="strong">{s.label}</span>
              <span className="small">{s.kind === 'CONTEST' ? 'Rated attempt' : `${s.remaining} ${s.remaining === 1 ? 'problem' : 'problems'}`} · about {dur(s.minutes)}</span>
            </span>
            <span className="yield__pts">{signed(s.points)}</span>
            <span className="yield__to" aria-label={`Score afterwards ${fmt(s.scoreAfter)}`}>{fmt(s.scoreAfter)}</span>
          </li>
        ))}
      </ol>
      <ul className="yield__notes">
        <li>
          {feasible
            ? <>The complete list takes about {dur(b.minutes)}. To finish before the day closes, begin by <span className="strong">{clock(latest, tz)}</span>.</>
            : <>About {dur(b.minutes)} of work remains and {dur(Math.max(0, Math.round(left / 60_000)))} of the day. Complete the highest-yield item first.</>}
        </li>
        {b.milestone !== null && b.toMilestone! > 0 && (
          <li>
            Completing the list brings the score to <span className="strong">{fmt(b.scoreAfter)}</span>, leaving {fmt(b.toMilestoneAfter ?? 0)} points to {fmt(b.milestone)}.
            {b.daysAtThisRate !== null && <> At this daily yield, that milestone is reached in {b.daysAtThisRate} {b.daysAtThisRate === 1 ? 'day' : 'days'}.</>}
          </li>
        )}
        {b.mostEfficient && b.steps.filter((s) => s.kind === 'PROBLEMS').length > 1 && (
          <li>The highest return per hour today is {b.mostEfficient.label}, at {b.mostEfficient.perHour} points.</li>
        )}
        {streak > 0 && <li>Completing today extends your unbroken record to {streak + 1} days; leaving it incomplete ends a record of {streak}.</li>}
      </ul>
    </div>
  );
}
