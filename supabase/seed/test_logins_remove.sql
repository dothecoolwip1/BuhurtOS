-- Removes every test account made by test_logins.sql (and so their roles, notifications and profile rows, which follow the account).
-- If a test account made a registration that does not cascade, the delete stops with a message naming it; remove that registration first.
delete from auth.users where email like '%@buhurtos-test.example';
select count(*) as test_accounts_left from auth.users where email like '%@buhurtos-test.example';
