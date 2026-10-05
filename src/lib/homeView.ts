import type { FightNow } from '../data/myFightNow';
import type { MyEvent } from './myEventsView';
import { outstanding } from './myEventsView';

/**
 * What the signed-in Home screen puts first: "what matters to me right now". At most three cards, most pressing first, and none at all when
 * nothing needs attention (Home then stays calm). Pure: the facts come from the database, nothing is guessed here.
 */
export interface HomeCard { key: string; tone: 'go' | 'soon' | 'info'; title: string; detail: string; to: string; cta: string }

const STAGE: Record<FightNow['stage'], { title: string; tone: HomeCard['tone'] }> = {
  active: { title: 'You\'re up now', tone: 'go' },
  on_deck: { title: 'You\'re on deck', tone: 'go' },
  in_the_hole: { title: 'You\'re in the hole', tone: 'soon' }
};

const involved = (e: MyEvent) => e.registration?.status === 'accepted' || e.fighterEntry || e.captainEntry;

export function homeCards(i: { fight: FightNow | null; events: readonly MyEvent[]; today: string; captainRequests: number }): HomeCard[] {
  const cards: HomeCard[] = [];
  if (i.fight) {
    const s = STAGE[i.fight.stage];
    cards.push({
      key: 'fight', tone: s.tone, title: s.title,
      detail: `${i.fight.competition} · ${i.fight.field}${i.fight.opponent ? ` · vs ${i.fight.opponent}` : ''}`,
      to: `/events/${i.fight.eventSlug}#my-next-fight`, cta: 'Open My next fight'
    });
  }
  const live = i.events.filter(e => e.status === 'published' && involved(e) && e.startsOn <= i.today && e.endsOn >= i.today);
  for (const e of live) {
    if (i.fight && e.slug === i.fight.eventSlug) continue;
    const todo = outstanding(e);
    cards.push({ key: `today-${e.id}`, tone: 'info', title: `${e.name} is on today`, detail: todo.length ? todo.join(' · ') : 'See your fights, the schedule and live results.', to: `/events/${e.slug}#my-next-fight`, cta: 'Open event' });
  }
  if (live.length === 0) {
    const next = i.events.filter(e => e.status === 'published' && involved(e) && e.startsOn > i.today).sort((a, b) => a.startsOn.localeCompare(b.startsOn))[0];
    if (next) {
      const todo = outstanding(next);
      cards.push({ key: `next-${next.id}`, tone: 'info', title: `Next up: ${next.name}`, detail: [next.startsOn === next.endsOn ? next.startsOn : `${next.startsOn} to ${next.endsOn}`, ...todo].join(' · '), to: `/events/${next.slug}`, cta: 'Open event' });
    }
  }
  if (i.captainRequests > 0) {
    cards.push({ key: 'captain', tone: 'info', title: i.captainRequests === 1 ? '1 join request is waiting for you' : `${i.captainRequests} join requests are waiting for you`, detail: 'Someone asked to join your team.', to: '/team-manager', cta: 'Answer requests' });
  }
  return cards.slice(0, 3);
}
