-- Removes the six test accounts made by test_logins.sql, and so their roles, notifications and profile rows (which follow the account).
-- Only these exact addresses; any other @buhurtos.ca account is left alone.
delete from auth.users where email in ('fighter@buhurtos.ca', 'captain@buhurtos.ca', 'organizer@buhurtos.ca', 'orgadmin@buhurtos.ca', 'scorekeeper@buhurtos.ca', 'newuser@buhurtos.ca');
select count(*) as test_accounts_left from auth.users where email in ('fighter@buhurtos.ca', 'captain@buhurtos.ca', 'organizer@buhurtos.ca', 'orgadmin@buhurtos.ca', 'scorekeeper@buhurtos.ca', 'newuser@buhurtos.ca');
