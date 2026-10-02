import { BRAND } from './brand.js';

/**
 * iCalendar (RFC 5545) output for contest reminders. Pure: no I/O. Each event carries display alarms, so a
 * calendar application on the person's own device raises the reminder even when the web push channel is
 * unavailable (for example an iPhone on which the app has not been installed to the home screen).
 */

export interface IcsEvent {
  uid: string;
  start: number; // epoch ms
  end: number; // epoch ms
  summary: string;
  description: string;
  url: string | null;
  /** Minutes before the start at which the calendar application should alert. */
  alarmsMinutes: number[];
  tentative?: boolean;
}

export function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Content lines are limited to 75 octets; continuation lines begin with one space. Folding never splits a character. */
export function fold(line: string): string {
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = Buffer.byteLength(ch, 'utf8');
    if (bytes + n > limit) {
      out.push(cur);
      cur = ' ';
      bytes = 1;
      limit = 75;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n');
}

export function icsUtc(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function alarm(minutes: number, summary: string): string[] {
  const m = Math.max(1, Math.round(minutes));
  const phrase = m >= 60 && m % 60 === 0 ? `${m / 60} ${m === 60 ? 'hour' : 'hours'}` : `${m} minutes`;
  return [
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeText(`${summary} begins in ${phrase}.`)}`,
    `TRIGGER:-PT${m}M`,
    'END:VALARM',
  ];
}

export function buildCalendar(events: IcsEvent[], now: number, name = `${BRAND} contests`): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${BRAND}//Contest reminders//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
    'X-PUBLISHED-TTL:PT1H',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
  ];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTAMP:${icsUtc(now)}`,
      `DTSTART:${icsUtc(e.start)}`,
      `DTEND:${icsUtc(Math.max(e.end, e.start + 60_000))}`,
      `SUMMARY:${escapeText(e.summary)}`,
      `DESCRIPTION:${escapeText(e.description)}`,
      `STATUS:${e.tentative ? 'TENTATIVE' : 'CONFIRMED'}`,
      'TRANSP:OPAQUE',
    );
    // The address is only ever an http(s) link taken from the platform's own listing.
    if (e.url && /^https?:\/\//i.test(e.url)) lines.push(`URL:${e.url.replace(/[\r\n]/g, '')}`);
    for (const m of [...new Set(e.alarmsMinutes)].sort((a, b) => b - a)) lines.push(...alarm(m, e.summary));
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
