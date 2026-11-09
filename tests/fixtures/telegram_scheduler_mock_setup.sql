-- Disposable local fixture only; pg_cron here is a SQL-only mock with no scheduler worker.
CREATE SCHEMA IF NOT EXISTS cron;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA cron;
