-- Extend event staff roles without coupling authorization to frontend conditionals.
-- Kept separate so new enum values are committed before later migrations use them.

alter type public.event_role add value if not exists 'tournament_director';
alter type public.event_role add value if not exists 'scorekeeper';
alter type public.event_role add value if not exists 'registration_staff';
alter type public.event_role add value if not exists 'armor_inspector';
alter type public.event_role add value if not exists 'medical_staff';
