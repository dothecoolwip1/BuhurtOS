-- Pack 24 follow-up: pin the search_path of the result revision log's append-only trigger function. ADDITIVE.
--
-- The Supabase security advisor flags private.result_revisions_append_only (Pack 02, 20261003000200) as "function_search_path_mutable". It is the last
-- public/private function without a fixed search_path. Same fix as Pack 18.1's private.camera_log_append_only (20261016000100): the body only raises an
-- exception and refers to no object, so an empty search_path cannot change what it does. ALTER keeps the function, its owner, its grants and the trigger
-- result_revisions_no_change exactly as they are.
alter function private.result_revisions_append_only() set search_path = '';
