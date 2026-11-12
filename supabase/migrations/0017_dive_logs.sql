-- 0017_dive_logs.sql — opt-in account backup for a diver's own dive logs.
--
-- Dive logs live in the browser's local storage (src/lib/voice-logging/
-- storage.ts) and are lost when that storage is cleared. A signed-in diver
-- who turns backup on gets a private copy here. Private, owner-only data:
-- same RLS shape as dive_plans (0007), no public read, no moderation.
--
-- `entry` is the client's log record as jsonb rather than typed columns:
-- it is only ever read back whole by its owner, and the client validates
-- its shape on restore. The raw voice transcript is never uploaded.

create table dive_logs (
  user_id uuid not null references profiles (id) on delete cascade,
  -- The id the browser generated for the entry; makes re-uploads idempotent.
  client_id text not null check (char_length(client_id) between 1 and 100),
  logged_at timestamptz not null,
  entry jsonb not null check (jsonb_typeof(entry) = 'object' and octet_length(entry::text) <= 16384),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, client_id)
);

comment on table dive_logs is
  'Opt-in backup of a diver''s own logbook entries. Private per-user data: '
  'RLS restricts every operation to auth.uid() = user_id. Deleted with the '
  'account (on delete cascade).';

create trigger dive_logs_set_updated_at
  before update on dive_logs
  for each row execute procedure public.set_updated_at();

-- A hard per-account ceiling so one account can't grow the table without bound.
create or replace function public.enforce_dive_logs_cap()
returns trigger
language plpgsql
as $$
begin
  -- Re-uploading an existing entry (an upsert) is never blocked by the cap.
  if not exists (select 1 from dive_logs where user_id = new.user_id and client_id = new.client_id)
     and (select count(*) from dive_logs where user_id = new.user_id) >= 1000 then
    raise exception 'dive log limit reached for this account'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger dive_logs_cap
  before insert on dive_logs
  for each row execute procedure public.enforce_dive_logs_cap();

alter table dive_logs enable row level security;

grant select, insert, update, delete on dive_logs to authenticated;

create policy dive_logs_select_own
  on dive_logs for select
  to authenticated
  using (auth.uid() = user_id);

create policy dive_logs_insert_own
  on dive_logs for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy dive_logs_update_own
  on dive_logs for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy dive_logs_delete_own
  on dive_logs for delete
  to authenticated
  using (auth.uid() = user_id);
