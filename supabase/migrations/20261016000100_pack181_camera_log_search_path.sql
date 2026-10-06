-- Pack 18.1 follow-up: pin the search_path of the camera log's append-only trigger function. ADDITIVE.
--
-- The Supabase security advisor flagged private.camera_log_append_only (20261015000200) as "function_search_path_mutable". It is the only Pack 18.1
-- function created without `set search_path`; every other one, and the earlier append-only triggers (private.lyst_append_only), use `set search_path = ''`.
-- The body only raises an exception and refers to no object, so an empty search_path cannot change what it does. ALTER keeps the function, its owner,
-- its (revoked) grants and the trigger event_camera_log_no_change exactly as they are.
alter function private.camera_log_append_only() set search_path = '';
