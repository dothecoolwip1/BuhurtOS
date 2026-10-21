import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { LiveCompetition, LiveEvent } from '../data/api';
import { fetchEventRoster, fetchRegistrationFlags, saveQueuePlan } from '../data/eventDay';
import { buildTournamentPlan, fetchCompetitionMatchesOrdered, fetchEntries, type CompetitionEntry } from '../data/matches';
import { DEFAULT_TIME_ZONE, fetchEventTimeZone } from '../data/runSchedule';
import { FORMAT_WORD, planTotals, previewPlan, propose, type BuildCompetition, type FormatChoice } from '../lib/buildPlan';
import { competitionSorts, withdrawnEntryIds, fieldLabel } from '../lib/eventDay';
import { heldMatches, planEvent } from '../lib/eventPlan';
import { friendlyError } from '../lib/friendlyError';
import { REST_TARGET } from '../lib/planner';
import { activeEntries, randomSeed, type DrawFormat } from '../lib/runDraw';
import { useAsync } from '../lib/useAsync';

const todayIn = (tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/**
 * Manage › Build tournament (Pack 09D). Turns the registrations already in the competitions into a proposed tournament: which competitions run, their
 * format, their field and the fight order, with the rest summary, before anything is written. "Use this plan" then builds each draw through the
 * existing build_schedule (server side, atomic per competition, draw number saved) and saves the fight order. Everything stays editable afterwards.
 */
export function BuildTournamentTab({ event, competitions, onChanged }: { event: LiveEvent; competitions: LiveCompetition[]; onChanged: () => void }) {
  const ids = useMemo(() => competitions.map(c => c.id), [competitions]);
  const [reload, setReload] = useState(0);
  const tz = useAsync(() => fetchEventTimeZone(event.id).catch(() => DEFAULT_TIME_ZONE), [event.id]);
  const data = useAsync(async () => {
    const per = await Promise.all(competitions.map(async c => ({ c, entries: await fetchEntries(c.id), matches: await fetchCompetitionMatchesOrdered(c.id) })));
    const [roster, regs] = await Promise.all([fetchEventRoster(ids), fetchRegistrationFlags(event.id).catch(() => [])]);
    return { per, roster, regs };
  }, [ids.join(','), reload]);
  const [fields, setFields] = useState(event.fieldCount ?? 1);
  const [seeds, setSeeds] = useState<Map<string, number>>(() => new Map(competitions.map(c => [c.id, randomSeed()])));
  const [overrides, setOverrides] = useState<Map<string, Partial<FormatChoice> & { field?: string }>>(new Map());
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [done, setDone] = useState<{ built: number; fights: number } | null>(null);

  const comps: BuildCompetition[] = useMemo(() => (data.data?.per ?? []).map(({ c, entries, matches }) => {
    const act = activeEntries(entries);
    const people = new Map<string, string[]>();
    for (const e of act) people.set(e.id, e.fighterId ? [e.fighterId] : (data.data?.roster ?? []).filter(r => r.entryId === e.id).map(r => r.fighterId));
    return { id: c.id, name: c.name, sort: c.sort ?? 0, entryIds: act.map(e => e.id), people, alreadyBuilt: matches.length > 0 };
  }), [data.data]);
  const names = useMemo(() => new Map((data.data?.per ?? []).flatMap(p => p.entries.map((e: CompetitionEntry) => [e.id, e.name] as const))), [data.data]);
  const proposals = useMemo(() => propose(comps, fields, seeds, overrides), [comps, fields, seeds, overrides]);
  const day = useMemo(() => {
    const today = todayIn(tz.data ?? DEFAULT_TIME_ZONE);
    return today >= event.startsOn && today <= event.endsOn ? today : event.startsOn;
  }, [tz.data, event.startsOn, event.endsOn]);
  const unavailable = useMemo(() => new Set((data.data?.regs ?? []).filter(r => r.status === 'accepted' && (r.attendDates?.length ?? 0) > 0 && !r.attendDates!.includes(day)).map(r => r.fighterId)), [data.data, day]);
  const plan = useMemo(() => previewPlan(comps, proposals, fields, unavailable), [comps, proposals, fields, unavailable]);
  const totals = planTotals(comps, proposals);
  const toBuild = proposals.filter(p => p.state === 'build');
  const notRun = proposals.filter(p => p.state === 'too_few');
  const built = proposals.filter(p => p.state === 'built');
  const setOverride = (id: string, patch: Partial<FormatChoice> & { field?: string }) => setOverrides(m => new Map(m).set(id, { ...(m.get(id) ?? {}), ...patch }));
  const fieldNames = Array.from({ length: fields }, (_, i) => `Field ${i + 1}`);

  const saveOrder = async () => {
      const [per, roster, regs] = await Promise.all([Promise.all(competitions.map(async c => ({ entries: await fetchEntries(c.id), matches: await fetchCompetitionMatchesOrdered(c.id) }))), fetchEventRoster(ids), fetchRegistrationFlags(event.id).catch(() => [])]);
      const matches = per.flatMap(x => x.matches), entries = per.flatMap(x => x.entries);
      const live = planEvent({ matches, entries, roster, registrations: regs, sorts: competitionSorts(competitions), withdrawn: withdrawnEntryIds(entries), today: day, fieldCount: fields });
      await saveQueuePlan(event.id, live.upcoming, heldMatches(live));
  };
  const retryOrder = async () => {
    setBusy('Planning the fight order…'); setProblems([]);
    try { await saveOrder(); onChanged(); }
    catch (e) { setProblems([`The fight order was not saved (${friendlyError(e)}). Retry planning, or open Live ops.`]); }
    finally { setBusy(null); }
  };
  const use = async () => {
    setBusy('Building…'); setProblems([]);
    try {
      const result = await buildTournamentPlan(event.id, fields, toBuild.map(p => ({ id: p.id, matches: p.matches, field: p.field, draw: { format: p.choice.format, mode: 'random', seed: p.seed } })));
      setDone(result); setBusy('Planning the fight order…');
      try { await saveOrder(); }
      catch (e) { setProblems([`Draws and Lysts are saved. The fight order was not saved (${friendlyError(e)}). Retry planning, or open Live ops.`]); }
    } catch (e) {
      // A lost response can mean the transaction committed. Refresh before
      // allowing another build; existing draws are never replaced by a retry.
      setProblems([`Build not confirmed: ${friendlyError(e)}. Refreshing the draws. Check them before retrying.`]);
    } finally { setBusy(null); setReload(k => k + 1); onChanged(); }
  };

  if (data.loading && !data.data) return <p className="muted">Reading the registrations…</p>;
  if (data.error != null) return <p role="alert">{friendlyError(data.error, 'Could not read the competitions.')}</p>;

  if (done) {
    return (
      <section className="panel info bt-done" role="status" style={{ display: 'grid', gap: 10 }}>
        <h2 style={{ margin: 0 }}>{done.built > 0 ? 'Tournament built' : 'Nothing was built'}</h2>
        <p>{done.built > 0 ? `${done.built} competition${done.built === 1 ? '' : 's'}, ${done.fights} fights. Draws and Lyst assignments are saved.${problems.length === 0 ? ' The fight order is planned for rest.' : ''}` : 'No competition could be built.'}</p>
        {problems.length > 0 && <ul role="alert" style={{ color: 'var(--live)', margin: 0, paddingLeft: 18 }}>{problems.map(p => <li key={p}>{p}</li>)}</ul>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-line" disabled={!!busy} onClick={() => void retryOrder()}>{busy ?? 'Replan fight order'}</button>
          <Link className="btn btn-ink eh-primary" to={`/events/${event.slug}/control?mode=live`}><span>Open Live ops</span><small>Who fights next, on every Lyst</small></Link>
          <Link className="btn btn-line" to={`/events/${event.slug}/control?mode=setup&tool=run`}>See the draws</Link>
        </div>
      </section>
    );
  }

  return (
    <section className="bt" aria-label="Build tournament" style={{ display: 'grid', gap: 16 }}>
      {problems.length > 0 && <ul role="alert">{problems.map(p => <li key={p}>{p}</li>)}</ul>}
      {built.length > 0 && <div className="panel info"><p>Existing draws keep their saved Lysts. You can plan their fight order again after a connection failure.</p><button type="button" className="btn btn-line" disabled={!!busy} onClick={() => void retryOrder()}>{busy ?? 'Replan fight order'}</button><Link className="ly-link" to={`/events/${event.slug}/control?mode=setup&tool=run`}>Check draws and Lysts</Link></div>}
      <div className="panel info eh-next" aria-labelledby="bt-h">
        <p className="eyebrow">Build tournament</p>
        {toBuild.length === 0
          ? <h2 id="bt-h">{built.length > 0 ? 'Every competition with entrants is already built.' : 'No competition has 2 or more entrants yet.'}</h2>
          : (
            <>
              <h2 id="bt-h">Tournament plan ready</h2>
              <ul className="bt-totals" aria-label="Plan totals">
                <li><b>{totals.people}</b> fighters</li>
                <li><b>{totals.competitions}</b> competition{totals.competitions === 1 ? '' : 's'}</li>
                <li><b>{totals.fights}</b> fights</li>
                <li><b>{fields}</b> Lyst{fields === 1 ? '' : 's'}</li>
              </ul>
              <p className="bt-rest">
                Preferred rest: {REST_TARGET} fights between appearances.<br />
                <b>{plan.summary.meetTarget}</b> of the {plan.summary.planned} fights ready to plan meet it
                {plan.summary.shortRest > 0 && <>; <b>{plan.summary.shortRest}</b> have shorter rest because no better order is possible{plan.summary.backToBack > 0 ? ` (${plan.summary.backToBack} back-to-back)` : ''}</>}.
                {totals.laterFights > 0 && <><br />{totals.laterFights} bracket fight{totals.laterFights === 1 ? '' : 's'} are planned as soon as both sides are known.</>}
              </p>
              {plan.summary.unavailable > 0 && <p className="bt-warn" role="alert"><b>{plan.summary.unavailable} fight{plan.summary.unavailable === 1 ? '' : 's'} wait for someone who is not here on {day}.</b> They are held back and run on a day that person can attend, or you can call them by hand.</p>}
              <button type="button" className="btn btn-ink eh-primary" disabled={!!busy} onClick={() => void use()}><span>{busy ?? 'Use this plan'}</span>{!busy && <small>Builds {toBuild.length} draw{toBuild.length === 1 ? '' : 's'} and plans the fight order</small>}</button>
              <button type="button" className="btn btn-line" aria-expanded={review} onClick={() => setReview(r => !r)}>{review ? 'Hide the plan' : 'Review plan'}</button>
            </>
          )}
      </div>

      <div className="panel info qs-fields">
        <span id="bt-fields-l"><b>Lysts</b><span className="src">Competitions are spread so every Lyst has about the same number of fights.</span></span>
        <div className="qs-stepper" role="group" aria-labelledby="bt-fields-l">
          <button type="button" className="btn btn-line" aria-label="One Lyst fewer" disabled={fields <= 1 || !!busy} onClick={() => setFields(n => Math.max(1, n - 1))}>−</button>
          <output aria-label="Lysts">{fields}</output>
          <button type="button" className="btn btn-line" aria-label="One Lyst more" disabled={fields >= 12 || !!busy} onClick={() => setFields(n => Math.min(12, n + 1))}>+</button>
        </div>
      </div>

      {toBuild.length > 0 && (
        <ul className="bt-list" aria-label="Competitions to build">
          {toBuild.map(p => (
            <li key={p.id} className="panel info">
              <div className="bt-row"><b>{p.name}</b><span className="chip">{fieldLabel(p.field)}</span></div>
              <span>{p.entrants} entrants · {FORMAT_WORD[p.choice.format]}{p.choice.format === 'pools' ? ` (${p.choice.poolCount} pools)` : ''} · {p.matches.length} fights</span>
              <span className="src">{p.why}</span>
              <details>
                <summary>Change</summary>
                <div className="bt-change">
                  <label className="field-in">Format
                    <select value={p.choice.format} onChange={e => setOverride(p.id, { format: e.target.value as DrawFormat })}>
                      {(['round_robin', 'pools', 'single_elimination'] as const).map(f => <option key={f} value={f} disabled={f === 'pools' && p.entrants < 4}>{FORMAT_WORD[f]}</option>)}
                    </select>
                  </label>
                  {p.choice.format === 'pools' && (
                    <label className="field-in">Pools
                      <input type="number" inputMode="numeric" min={2} max={Math.floor(p.entrants / 2)} value={p.choice.poolCount} onChange={e => setOverride(p.id, { poolCount: Math.max(2, Math.min(Math.floor(p.entrants / 2), Number(e.target.value) || 2)) })} />
                    </label>
                  )}
                  {p.choice.format === 'single_elimination' && p.entrants >= 4 && (
                    <label className="qs-check"><input type="checkbox" checked={p.choice.thirdPlace} onChange={e => setOverride(p.id, { thirdPlace: e.target.checked })} /> Third-place fight</label>
                  )}
                  <label className="field-in">Lyst
                    <select value={p.field} onChange={e => setOverride(p.id, { field: e.target.value })}>
                      {fieldNames.map(f => <option key={f} value={f}>{fieldLabel(f)}</option>)}
                    </select>
                  </label>
                  <p className="src">Draw number {p.seed}. <button type="button" className="linklike" onClick={() => setSeeds(m => new Map(m).set(p.id, randomSeed()))}>Draw again</button> · Need manual seeding? Use <Link to={`/events/${event.slug}/control?mode=setup&tool=run`}>Draws and schedule</Link>.</p>
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}

      {review && toBuild.length > 0 && (
        <section className="panel info bt-review" aria-label="The fight order">
          <h3>Fight order</h3>
          <div className="bt-lanes">
            {[...plan.lanes.entries()].map(([field, lane]) => (
              <div key={field}>
                <b>{fieldLabel(field)}</b>
                <ol>
                  {lane.slice(0, 40).map(f => {
                    const [compId, key] = f.matchId.split(':');
                    const m = proposals.find(x => x.id === compId)?.matches.find(x => x.key === key);
                    return <li key={f.matchId} className={f.short ? 'short' : ''}>{m ? `${names.get(m.a ?? '') ?? '?'} vs ${names.get(m.b ?? '') ?? '?'}` : f.matchId}<span className="src"> · {proposals.find(x => x.id === compId)?.name}{f.short ? ` · short rest (${f.minRest})` : ''}</span></li>;
                  })}
                </ol>
                {lane.length > 40 && <p className="src">…and {lane.length - 40} more</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {(notRun.length > 0 || built.length > 0) && (
        <div className="panel info" style={{ display: 'grid', gap: 6 }}>
          {notRun.length > 0 && <p><b>Not built:</b> {notRun.map(p => `${p.name} (${p.entrants === 0 ? 'nobody entered' : '1 entrant'})`).join(', ')}. They stay offered and are built later if more people enter.</p>}
          {built.length > 0 && <p><b>Already built:</b> {built.map(p => p.name).join(', ')}. Change a draw in <Link to={`/events/${event.slug}/control?mode=setup&tool=run`}>Draws and schedule</Link>.</p>}
        </div>
      )}
    </section>
  );
}
