/*
  Specialized event staff roles are isolated in their own migration so PostgreSQL
  commits enum additions before later policies and functions reference them.
*/
alter type public.event_role add value if not exists 'tournament_director';
alter type public.event_role add value if not exists 'scorekeeper';
alter type public.event_role add value if not exists 'registration_staff';
alter type public.event_role add value if not exists 'armor_inspector';
alter type public.event_role add value if not exists 'medical_staff';
