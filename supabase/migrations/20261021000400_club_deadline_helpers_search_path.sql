-- Four club meeting helpers (deadlines and nominations window, 2026-10-18) were created without a fixed search_path. Every function in public and
-- private carries one (the Pack 24 follow-ups gate checks it); these are pinned the same way. Additive: no behaviour change, nothing in flight affected.
alter function private.club_nominations_close_at(public.club_meetings) set search_path = '';
alter function private.club_nominations_open(public.club_meetings) set search_path = '';
alter function private.club_topics_close_at(public.club_meetings) set search_path = '';
alter function private.club_when_text(timestamptz, text) set search_path = '';
