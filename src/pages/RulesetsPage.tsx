import { useEffect, useMemo, useState } from 'react';
import { useAppState } from '../features/AppState';
import { competitionFormats } from '../lib/competitionFormats';
import {
  activateEventRuleset,
  createRuleset,
  defaultRulesetSettings,
  listRulesets,
  resolveRulesetSettings,
  setRulesetStatus,
  updateDraftRuleset
} from '../lib/rulesetAdmin';
import type { RulesetRecord, RulesetSettings } from '../types';

const cloneSettings = (settings: RulesetSettings): RulesetSettings => structuredClone(settings);

export function RulesetsPage() {
  const { event, user, dataMode, reload } = useAppState();
  const [rulesets, setRulesets] = useState<RulesetRecord[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState<RulesetRecord | null>(null);
  const [createForm, setCreateForm] = useState({ name: '', shortName: '', version: '1.0', parentRulesetId: '', description: '' });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const canManage = Boolean(
    dataMode === 'demo'
    || user?.platformRoles.includes('platform_super_admin')
    || (event && user?.organizationRoles.some(role => role.organizationId === event.organizationId && role.role === 'organization_admin'))
  );

  const refresh = async () => {
    if (!event) return;
    const rows = await listRulesets(event.organizationId);
    setRulesets(rows);
    setSelectedId(current => current && rows.some(row => row.id === current) ? current : rows[0]?.id || '');
  };

  useEffect(() => {
    refresh().catch(error => setMessage(error instanceof Error ? error.message : 'Unable to load rulesets.'));
  }, [event?.id]);

  useEffect(() => {
    const selected = rulesets.find(row => row.id === selectedId);
    setDraft(selected ? { ...selected, settings: cloneSettings(resolveRulesetSettings(rulesets, selected.id)) } : null);
  }, [selectedId, rulesets]);

  const effective = useMemo(() => draft ? resolveRulesetSettings(
    rulesets.map(row => row.id === draft.id ? { ...draft, overrides: draft.settings } : row),
    draft.id
  ) : null, [draft, rulesets]);

  if (!event) return <div className="state-card">Choose an event before managing rulesets.</div>;
  if (!canManage) return <div className="state-card">Organization administrator access is required to manage rulesets.</div>;

  const run = async (work: () => Promise<void>, success: string) => {
    setBusy(true);
    setMessage('');
    try {
      await work();
      await reload();
      await refresh();
      setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The ruleset change could not be completed.');
    } finally {
      setBusy(false);
    }
  };

  const create = () => run(async () => {
    if (!createForm.name.trim() || !createForm.shortName.trim() || !createForm.version.trim()) throw new Error('Name, short name, and version are required.');
    const inherited = createForm.parentRulesetId
      ? resolveRulesetSettings(rulesets, createForm.parentRulesetId)
      : defaultRulesetSettings;
    const id = await createRuleset(event, {
      name: createForm.name.trim(),
      shortName: createForm.shortName.trim(),
      version: createForm.version.trim(),
      description: createForm.description.trim() || undefined,
      status: 'draft',
      parentRulesetId: createForm.parentRulesetId || undefined,
      settings: cloneSettings(inherited)
    });
    setCreateForm({ name: '', shortName: '', version: '1.0', parentRulesetId: '', description: '' });
    setSelectedId(id);
  }, 'Draft ruleset created.');

  const patchSettings = (patch: (current: RulesetSettings) => RulesetSettings) => {
    setDraft(current => current ? { ...current, settings: patch(cloneSettings(current.settings)), overrides: undefined } : current);
  };

  const saveDraft = () => {
    if (!draft) return;
    return run(
      () => updateDraftRuleset(event, { ...draft, overrides: draft.settings }),
      'Draft ruleset saved.'
    );
  };

  const changeStatus = (record: RulesetRecord, status: 'published' | 'retired') => run(
    () => setRulesetStatus(event, record, status),
    status === 'published' ? 'Ruleset published and locked for historical stability.' : 'Ruleset retired.'
  );

  const activate = (record: RulesetRecord | null) => run(
    () => activateEventRuleset(event, record?.id || null),
    record ? record.name + ' is now locked to this event.' : 'Event ruleset cleared.'
  );

  return <>
    <section className="section-head">
      <div>
        <span className="eyebrow">Versioned rules engine</span>
        <h1>Rulesets</h1>
        <p>Publish immutable rule versions, inherit from a parent ruleset, configure event requirements, and lock the exact version used by this event.</p>
      </div>
    </section>

    <div className="admin-grid">
      <section className="panel-card">
        <h2>Create ruleset version</h2>
        <div className="form-stack">
          <input placeholder="Ruleset name" value={createForm.name} onChange={e => setCreateForm(form => ({ ...form, name: e.target.value }))}/>
          <input placeholder="Short name" value={createForm.shortName} onChange={e => setCreateForm(form => ({ ...form, shortName: e.target.value }))}/>
          <input placeholder="Version" value={createForm.version} onChange={e => setCreateForm(form => ({ ...form, version: e.target.value }))}/>
          <label>Inherit from
            <select value={createForm.parentRulesetId} onChange={e => setCreateForm(form => ({ ...form, parentRulesetId: e.target.value }))}>
              <option value="">Platform defaults</option>
              {rulesets.filter(row => row.status === 'published').map(row => <option key={row.id} value={row.id}>{row.shortName} {row.version}</option>)}
            </select>
          </label>
          <textarea placeholder="Description" value={createForm.description} onChange={e => setCreateForm(form => ({ ...form, description: e.target.value }))}/>
          <button className="primary big" disabled={busy || !createForm.name.trim() || !createForm.shortName.trim()} onClick={create}>Create Draft</button>
        </div>
      </section>

      <section className="panel-card">
        <h2>Ruleset library</h2>
        <div className="membership-list">
          {rulesets.length === 0 ? <div className="state-card">No rulesets yet.</div> : rulesets.map(record => <article key={record.id}>
            <div>
              <strong>{record.name} · {record.version}</strong>
              <small>{record.status}{record.parentRulesetId ? ' · inherited' : ''}{event.rulesetId === record.id ? ' · active on this event' : ''}</small>
            </div>
            <button className={selectedId === record.id ? 'primary' : ''} onClick={() => setSelectedId(record.id)}>Open</button>
          </article>)}
        </div>
        <div className="header-actions">
          <button disabled={busy || !event.rulesetId} onClick={() => activate(null)}>Clear Event Ruleset</button>
        </div>
      </section>

      {draft && <section className="panel-card">
        <h2>{draft.name} {draft.version}</h2>
        <p>{draft.status === 'draft' ? 'Drafts can be edited. Publishing makes this version immutable.' : 'Published and retired versions remain readable so historical events never change.'}</p>
        <div className="form-stack">
          <label>Name<input disabled={draft.status !== 'draft'} value={draft.name} onChange={e => setDraft(row => row ? ({ ...row, name: e.target.value }) : row)}/></label>
          <label>Short name<input disabled={draft.status !== 'draft'} value={draft.shortName} onChange={e => setDraft(row => row ? ({ ...row, shortName: e.target.value }) : row)}/></label>
          <label>Version<input disabled={draft.status !== 'draft'} value={draft.version} onChange={e => setDraft(row => row ? ({ ...row, version: e.target.value }) : row)}/></label>
          <label>Description<textarea disabled={draft.status !== 'draft'} value={draft.description || ''} onChange={e => setDraft(row => row ? ({ ...row, description: e.target.value }) : row)}/></label>
        </div>
        <h3>Enabled competition formats</h3>
        <div className="selector-list">
          {competitionFormats.map(format => {
            const checked = draft.settings.enabledFormats.includes(format.id);
            return <label key={format.id}><input type="checkbox" disabled={draft.status !== 'draft'} checked={checked} onChange={e => patchSettings(settings => ({ ...settings, enabledFormats: e.target.checked ? [...new Set([...settings.enabledFormats, format.id])] : settings.enabledFormats.filter(id => id !== format.id) }))}/><span>{format.name}</span></label>;
          })}
        </div>
      </section>}

      {draft && <section className="panel-card">
        <h2>Safety & discipline</h2>
        <div className="form-stack">
          {([
            ['requireCheckIn','Require check in'],
            ['requireArmorClearance','Require armor clearance'],
            ['requireMedicalClearance','Require medical clearance'],
            ['requireWaiver','Require waiver'],
            ['requireWeighIn','Require weigh in']
          ] as const).map(([key,label]) => <label className="checkbox-line" key={key}><input type="checkbox" disabled={draft.status !== 'draft'} checked={draft.settings.compliance[key]} onChange={e => patchSettings(settings => ({ ...settings, compliance: { ...settings.compliance, [key]: e.target.checked } }))}/><span>{label}</span></label>)}
          <label>Yellow cards before suspension<input type="number" min="1" disabled={draft.status !== 'draft'} value={draft.settings.discipline.yellowCardsBeforeSuspension} onChange={e => patchSettings(settings => ({ ...settings, discipline: { ...settings.discipline, yellowCardsBeforeSuspension: Math.max(1, Number(e.target.value) || 1) } }))}/></label>
          <label>Red card suspension matches<input type="number" min="1" disabled={draft.status !== 'draft'} value={draft.settings.discipline.redCardSuspensionMatches} onChange={e => patchSettings(settings => ({ ...settings, discipline: { ...settings.discipline, redCardSuspensionMatches: Math.max(1, Number(e.target.value) || 1) } }))}/></label>
          <label className="checkbox-line"><input type="checkbox" disabled={draft.status !== 'draft'} checked={draft.settings.bracket.antiFratricide} onChange={e => patchSettings(settings => ({ ...settings, bracket: { ...settings.bracket, antiFratricide: e.target.checked } }))}/><span>Anti fratricide seeding</span></label>
        </div>
        <div className="header-actions">
          {draft.status === 'draft' && <button className="primary" disabled={busy} onClick={saveDraft}>Save Draft</button>}
          {draft.status === 'draft' && <button disabled={busy} onClick={() => changeStatus(draft, 'published')}>Publish Version</button>}
          {draft.status === 'published' && <button className={event.rulesetId === draft.id ? 'primary' : ''} disabled={busy} onClick={() => activate(draft)}>{event.rulesetId === draft.id ? 'Active on Event' : 'Use for Event'}</button>}
          {draft.status === 'published' && <button disabled={busy || event.rulesetId === draft.id} onClick={() => changeStatus(draft, 'retired')}>Retire Version</button>}
        </div>
        {effective && <div className="state-card">Effective configuration: {effective.enabledFormats.length} formats, armor {effective.compliance.requireArmorClearance ? 'required' : 'optional'}, medical {effective.compliance.requireMedicalClearance ? 'required' : 'optional'}, anti fratricide {effective.bracket.antiFratricide ? 'on' : 'off'}.</div>}
      </section>}
    </div>

    {message && <div className="auth-message">{message}</div>}
  </>;
}
