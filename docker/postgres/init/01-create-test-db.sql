-- Separate database for integration tests (DATABASE_URL_TEST). Dev data in `crm` is never touched by tests.
CREATE DATABASE crm_test OWNER crm;
