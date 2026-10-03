import { PageHead } from '../components/ui';
import { setPreference, useAnalyticsChoice } from '../lib/analyticsConsent';
import { useDocumentTitle } from '../lib/useDocumentTitle';

/** Edit this date whenever the text or the way analytics work changes. */
export const PRIVACY_UPDATED = '3 October 2026';
/** Set VITE_PRIVACY_EMAIL (repository variable PRIVACY_EMAIL) to show a privacy contact address. None is invented here. */
const PRIVACY_EMAIL = (import.meta.env.VITE_PRIVACY_EMAIL as string | undefined)?.trim() || '';

function Choice() {
  const { allowed, pref, signal, mode } = useAnalyticsChoice();
  const why = pref === 'off' ? 'You turned analytics off.'
    : pref === 'on' ? 'You turned analytics on.'
      : signal ? `Your browser sends a ${signal === 'gpc' ? 'Global Privacy Control' : 'Do Not Track'} signal, so analytics are off unless you turn them on here.`
        : mode === 'opt-in' ? 'Analytics stay off until you turn them on.' : 'Analytics are on by default, and you can turn them off.';
  return (
    <section className="panel info" style={{ display: 'grid', gap: 10 }} aria-labelledby="choice-h" data-testid="analytics-choice">
      <h2 id="choice-h">Your choice</h2>
      <label style={{ display: 'flex', gap: 12, alignItems: 'center', minHeight: 44, cursor: 'pointer' }}>
        <input type="checkbox" checked={allowed} style={{ width: 22, height: 22, flex: 'none' }} onChange={e => setPreference(e.target.checked ? 'on' : 'off')} />
        <span><b>Allow limited analytics</b></span>
      </label>
      <p role="status" className="src" style={{ fontSize: 14 }}>{why}</p>
      <p className="muted">Turning analytics off takes effect at once, in every tab of this browser. It stops the records described below, and removes the random ids BuhurtOS keeps in this browser. It does not delete earlier records; to have those removed, use the privacy contact below. Signing in, sending a bug report and the security log in the database are not analytics and keep working.</p>
    </section>
  );
}

export function PrivacyPage() {
  useDocumentTitle('Privacy');
  return (
    <section className="fade-in" style={{ display: 'grid', gap: 18, maxWidth: 760 }}>
      <PageHead eyebrow="Privacy" title="How BuhurtOS uses analytics" lede="Plain answers about what is recorded when you use the site, why, who handles it, how long it is kept, and how to opt out." />
      <p className="src">Last updated {PRIVACY_UPDATED}. This page covers analytics and the browser storage behind it. Other information you give BuhurtOS, such as when you register for an event or ask to join a team, is handled where you give it; ask through the contact below if you want to know more.</p>

      <Choice />

      <section className="panel info" style={{ display: 'grid', gap: 10 }} aria-labelledby="what-h">
        <h2 id="what-h">What is recorded</h2>
        <ul className="plain">
          <li><b>Pages you open</b>: the page path, for example <span className="mono">/teams</span>, and when. The part of an address after “?” or “#” is never recorded.</li>
          <li><b>Your device</b>: whether it is a phone, tablet or computer, the name of your browser (for example Chrome) and system (for example Windows), and your time zone. Not version numbers, screen sizes or your full browser identification.</li>
          <li><b>Where you came from</b>: the website that linked to BuhurtOS, if any (the site, not the page).</li>
          <li><b>Actions</b>: that something happened, for example signing in, registering for an event, or using a search box. Not what you entered. Search words are not recorded.</li>
          <li><b>Random ids</b>: one kept in this browser so a new visitor can be told from a returning one, one for each visit, and one from PostHog. They are not your name or email, but they are identifiers.</li>
          <li><b>If you are signed in</b>: your visits and actions are linked to your BuhurtOS account. The records kept by BuhurtOS can be read only by the platform owner. PostHog receives your BuhurtOS account id (a random code), not your name, email or phone. This is not anonymous.</li>
          <li><b>Approximate location</b>: PostHog works out an approximate country, region and city from your IP address when you visit. The project is set so that PostHog does not keep the IP address itself.</li>
        </ul>
      </section>

      <section className="panel info" style={{ display: 'grid', gap: 10 }} aria-labelledby="not-h">
        <h2 id="not-h">What is not recorded for analytics</h2>
        <ul className="plain">
          <li>GPS or any precise location. BuhurtOS never asks your browser for your location.</li>
          <li>Passwords, sign-in codes or tokens, or anything you type into forms and search boxes.</li>
          <li>Messages, registration answers, medical or safety details, or payment details.</li>
          <li>Page titles, clicks on buttons and links, or recordings or screenshots of your visit.</li>
        </ul>
      </section>

      <section className="panel info" style={{ display: 'grid', gap: 10 }} aria-labelledby="why-h">
        <h2 id="why-h">Why</h2>
        <p>To see which parts of BuhurtOS people use, find pages that confuse people or break, check which devices and browsers to support, and decide what to improve. Analytics are not used for advertising, and no advertising tools are loaded.</p>
      </section>

      <section className="panel info" style={{ display: 'grid', gap: 10 }} aria-labelledby="who-h">
        <h2 id="who-h">Who handles it</h2>
        <p>BuhurtOS keeps its own analytics records in its database. It also uses <a href="https://posthog.com/privacy" target="_blank" rel="noopener noreferrer">PostHog</a>, an analytics service, which processes the limited information above for BuhurtOS. PostHog stores it in the United States, so it is processed outside Canada.</p>
      </section>

      <section className="panel info" style={{ display: 'grid', gap: 10 }} aria-labelledby="keep-h">
        <h2 id="keep-h">How long it is kept</h2>
        <ul className="plain">
          <li><b>BuhurtOS’s own records</b>: 90 days, then deleted.</li>
          <li><b>Events held by PostHog</b>: up to 1 year. That is the limit of the PostHog plan BuhurtOS uses, and BuhurtOS cannot make it shorter. You can ask for the PostHog events linked to your account to be deleted sooner.</li>
        </ul>
      </section>

      <details className="panel info">
        <summary style={{ cursor: 'pointer', fontWeight: 600, minHeight: 44, display: 'flex', alignItems: 'center' }}>What BuhurtOS stores in your browser</summary>
        <ul className="plain" style={{ marginTop: 10 }}>
          <li><span className="mono">bos-visitor</span> (local storage): a random id, kept until you turn analytics off or clear site data.</li>
          <li><span className="mono">bos-visit</span> (session storage): a random id for one visit, gone when the tab closes.</li>
          <li><span className="mono">ph_…</span> (local and session storage): PostHog’s random id and visit state. PostHog sets no cookie.</li>
          <li><span className="mono">bos-analytics</span> (local storage): your choice above.</li>
          <li>A sign-in session, only while you are signed in. That is needed to run your account and is not analytics.</li>
        </ul>
      </details>

      <section className="panel info" style={{ display: 'grid', gap: 10 }} aria-labelledby="ask-h">
        <h2 id="ask-h">Privacy questions and requests</h2>
        <p>You can ask what personal information BuhurtOS holds about you, ask for it to be corrected or deleted, or ask a question about this page.</p>
        {PRIVACY_EMAIL
          ? <p>Email <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>.</p>
          : <p>Use the <b>Report a bug</b> button (the bug icon at the top of any page). Start the first box with “Privacy”, and put an email address in the contact box if you want a reply.</p>}
      </section>
    </section>
  );
}
