# What can be learned after the Rumble (without a surveillance project)

Uses the existing analytics design (`docs/ANALYTICS_PRIVACY.md`): page paths, device class, named actions with small plain properties, no precise location,
people can opt out. Everything below is a count, not a person. Numbers from the browser sinks cover only visitors who left analytics on; the database counts
(second section) are complete.

## From the first-party analytics (Super Admin > Insights, or `admin_activity` / `admin_analytics`)
| Question | Where |
|---|---|
| Public event page views | page views of `/events/<slug>` |
| Approximate live-view usage | event `live_connection` with `status` live / polling / connecting (how many viewers had realtime working vs fell back to polling); page views of the event page during the event |
| Which pages drew interest | page views by path (events, teams, fighters, rankings) |
| Registration / event flow usage | existing registration events and page views of `/events/<slug>/register` and the manage tabs |
| Realtime problems | `live_refresh_failed` (a spectator refresh failed) and `live_connection` status changes |
| Scoring problems seen by devices | `result_pending_no_signal`, `result_conflict`, `result_stale`, `score_action_refused` (count only), `result_official`, `app_update_ready`, `app_update_applied` (with `emergency`) |

## From the database (complete, not dependent on consent; run as the owner after the event)
```sql
-- how each device-submitted result ended
select status, count(*) from public.result_proposals where event_id = '<event id>' group by 1 order by 2 desc;
-- results entered from paper, conflicts, corrections, reopenings
select action, count(*) from public.audit_log where event_id = '<event id>' and action in
  ('match.finalized','match.reopened','result.conflict','result.conflict_resolved','result.paper_entered','result.corrected','result.voided','pool.tie_decided','schedule.built')
group by 1 order by 2 desc;
-- score actions recorded per match (volume of live scoring)
select m.id, count(*) from public.score_events s join public.matches m on m.id = s.match_id
join public.competitions k on k.id = m.competition_id where k.event_id = '<event id>' group by 1 order by 2 desc limit 20;
```

## Not available without disproportionate work (documented, not built)
* Per-competition spectator interest: the event page is one page, so there is no per-competition navigation to count. Page views of the event page are the proxy.
* Exact concurrent live viewers: Supabase Realtime connection counts are in the Supabase dashboard (Reports > Realtime), not in BuhurtOS.
* Precise location or per-person tracking: deliberately never collected.
