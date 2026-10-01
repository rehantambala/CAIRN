import { useEffect, useState, type ReactNode } from 'react';
import { get } from '../api';
import { BRAND } from '../brand';
import { Mark } from '../components/Mark';

const UPDATED = '2 October 2026';

function useContact() {
  const [contact, setContact] = useState<string | null>(null);
  useEffect(() => { void get<{ contact: string | null }>('/public/info').then((r) => setContact(r.contact)).catch(() => {}); }, []);
  return contact;
}

function Contact({ contact }: { contact: string | null }) {
  return contact
    ? <>write to <a className="link-arrow" href={`mailto:${contact}`}>{contact}</a></>
    : <>use the contact address shown on the Google sign-in screen for {BRAND}</>;
}

function Frame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main id="main" className="legal block block-sky">
      <div className="frame legal__frame">
        <a href="/" className="wordmark legal__brand" aria-label={`${BRAND}, home`}><Mark size={34} mode="settle" /><span>{BRAND}</span></a>
        <h1 className="display fig-2xl">{title}</h1>
        <p className="meta">Last updated {UPDATED}</p>
        <div className="legal__body">{children}</div>
        <p className="legal__nav"><a className="link-arrow" href="/privacy">Privacy</a> · <a className="link-arrow" href="/terms">Terms</a> · <a className="link-arrow" href="/">Back to {BRAND}</a></p>
      </div>
    </main>
  );
}

export function Privacy() {
  const contact = useContact();
  return (
    <Frame title="Privacy">
      <p className="lead">{BRAND} keeps only what it needs to measure your coding performance, keeps it for you alone, and lets you take it away or delete it at any time.</p>

      <h2>Who runs {BRAND}</h2>
      <p>{BRAND} is an independent project run by an individual developer. It is not affiliated with Google, GitHub, LeetCode, Codeforces, CodeChef, HackerRank, InterviewBit or Smart Interviews. For any question about your data, <Contact contact={contact} />.</p>

      <h2>What {BRAND} collects</h2>
      <ul>
        <li><strong>When you sign in with Google:</strong> your Google account identifier, your name, your email address (only if Google has verified it) and the address of your profile picture.</li>
        <li><strong>When you sign in with GitHub:</strong> your GitHub user number, username, name and the address of your profile picture, all from your public profile.</li>
        <li><strong>What you enter:</strong> the public handles of your coding profiles, any figures you type in, your target, daily time budget, timezone and reminder preferences.</li>
        <li><strong>What {BRAND} reads for you:</strong> public figures for the handles you connect (problems solved, ratings, contest history), and public contest timetables.</li>
        <li><strong>Devices you enable for reminders:</strong> the address your browser's push service gives that device, so reminders can reach it.</li>
        <li><strong>Technical records:</strong> a session cookie while you are signed in, and short server logs of each request (time, page or action, result, duration, and your account number). Logs never contain passwords, tokens, cookies or the content you enter.</li>
      </ul>

      <h2>What {BRAND} never collects</h2>
      <ul>
        <li>Passwords or credentials for any coding platform. {BRAND} never asks for them.</li>
        <li>Access to your GitHub repositories, or permission to post or change anything on Google or GitHub. The access token a provider issues at sign-in is used once to read your profile and is then discarded; it is never stored.</li>
        <li>Advertising or analytics trackers, or third-party cookies.</li>
      </ul>

      <h2>How it is used</h2>
      <p>Only to provide {BRAND} to you: to recognise you when you sign in, compute your score and trajectory, plan your day, list contests, send the reminders you ask for, and show your record. Your data is never sold, rented or used for advertising, and nobody else using {BRAND} can see it.</p>

      <h2>Google user data</h2>
      <p>{BRAND}'s use of information received from Google APIs adheres to the <a className="link-arrow" href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer noopener">Google API Services User Data Policy</a>, including the Limited Use requirements. {BRAND} requests only your basic profile and email address, uses them only to sign you in and to show your name, and does not transfer them to anyone except as needed to run the service described here.</p>

      <h2>Who else handles data</h2>
      <ul>
        <li><strong>Hosting and database providers</strong> store and serve {BRAND} on its behalf.</li>
        <li><strong>Your browser's push service</strong> (Google, Mozilla, Apple or Microsoft, depending on the browser) carries reminder notifications to devices you enable.</li>
        <li><strong>Coding platforms</strong> receive requests for the public handles you connect, as any visitor's browser would.</li>
        <li><strong>The optional strategist</strong>, when switched on by the operator, sends your figures and today's plan (never your name, email or handles) to an AI model provider to draft advice. It cannot change any of your data.</li>
      </ul>

      <h2>Cookies</h2>
      <p>{BRAND} uses one cookie to keep you signed in, and one short-lived cookie during Google or GitHub sign-in to protect it from forgery. Both are strictly necessary; there are no others.</p>

      <h2>How long it is kept</h2>
      <p>Your account data is kept until you delete it. Sign-in sessions end after 30 days or when you sign out. Server logs are kept by the hosting provider for a limited period.</p>

      <h2>Your choices</h2>
      <ul>
        <li><strong>Download</strong> everything {BRAND} holds about you: Preferences → Your data → Download my data.</li>
        <li><strong>Delete</strong> your account and all of its data immediately: Preferences → Your data → Delete account.</li>
        <li><strong>Disconnect</strong> a coding profile or unlink Google or GitHub in Preferences, and revoke {BRAND}'s access from your Google or GitHub account settings at any time.</li>
        <li><strong>Turn off reminders</strong> in Preferences, or in your browser's notification settings.</li>
      </ul>

      <h2>Security</h2>
      <p>Connections are encrypted, sessions are random and stored only as a fingerprint, and every request is checked against your own account. See the project's security document for details. If you find a vulnerability, please report it privately.</p>

      <h2>Children</h2>
      <p>{BRAND} is not directed at children under 13 and does not knowingly collect their data.</p>

      <h2>Changes</h2>
      <p>If this policy changes, the date above changes with it, and significant changes are announced in {BRAND}.</p>
    </Frame>
  );
}

export function Terms() {
  const contact = useContact();
  return (
    <Frame title="Terms">
      <p className="lead">{BRAND} is a free tool for tracking your own competitive-programming progress. Using it means accepting these terms.</p>

      <h2>The service</h2>
      <p>{BRAND} is provided as it is, free of charge, by an independent developer. It may change, pause or end at any time. There is no warranty of any kind, and no liability for any loss arising from its use, to the extent the law allows.</p>

      <h2>Figures and advice</h2>
      <p>Figures come from the platforms you connect or from what you enter. Platforms can be unavailable or change, so figures may be out of date or wrong. Plans, trajectories and any strategist advice are guidance only; ratings are never promised.</p>

      <h2>Your account</h2>
      <ul>
        <li>Connect only coding profiles that are yours, and enter figures honestly.</li>
        <li>Keep your Google or GitHub account secure; it is how you sign in to {BRAND}.</li>
        <li>You can download or delete your data at any time in Preferences.</li>
      </ul>

      <h2>Acceptable use</h2>
      <p>Do not attempt to access other people's data, disrupt the service, overload the platforms {BRAND} reads from, or use {BRAND} for anything unlawful. Accounts that do may be suspended.</p>

      <h2>Other services</h2>
      <p>{BRAND} is not affiliated with or endorsed by Google, GitHub, LeetCode, Codeforces, CodeChef, HackerRank, InterviewBit or Smart Interviews. Their names belong to their owners, and their own terms apply to your use of them.</p>

      <h2>Contact</h2>
      <p>For questions about these terms, <Contact contact={contact} />. See also the <a className="link-arrow" href="/privacy">privacy policy</a>.</p>
    </Frame>
  );
}
