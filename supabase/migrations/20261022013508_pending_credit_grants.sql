-- Applied to production as version 20261022013508 (pending_credit_grants).
-- Content exported verbatim from supabase_migrations.schema_migrations.

create table if not exists public.pending_credit_grants (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  credits integer not null check (credits > 0),
  note text,
  created_at timestamptz not null default now(),
  granted_at timestamptz,
  granted_user_id uuid references auth.users(id) on delete set null
);
create unique index if not exists pending_credit_grants_open_email
  on public.pending_credit_grants (public.cinex_normalize_email(email)) where granted_at is null;
alter table public.pending_credit_grants enable row level security;
revoke all on public.pending_credit_grants from public, anon, authenticated;

create or replace function public.cinex_apply_pending_grants()
returns trigger
language plpgsql security definer set search_path = public as $$
declare g record; v_ref text;
begin
  if new.email_confirmed_at is null then return new; end if;
  for g in
    select * from public.pending_credit_grants
     where granted_at is null
       and public.cinex_normalize_email(email) = public.cinex_normalize_email(new.email)
     for update skip locked
  loop
    v_ref := 'comp-' || gen_random_uuid();
    insert into public.credit_wallets(user_id, balance) values (new.id, 0)
      on conflict (user_id) do nothing;
    insert into public.payment_records (user_id, provider, provider_payment_id, amount_cents, credits, status,
      currency, settled_amount_cents, settled_currency, fee_cents, refunded_credits, disputed_credits,
      refund_target_credits, dispute_target_credits, available_credits)
    values (new.id, 'comp', v_ref, 0, g.credits, 'completed', 'usd', 0, 'usd', 0, 0, 0, 0, 0, g.credits);
    update public.credit_wallets set balance = balance + g.credits, updated_at = now() where user_id = new.id;
    insert into public.credit_ledger (user_id, amount, entry_type, reference_id, description)
    values (new.id, g.credits, 'grant', v_ref,
      coalesce(g.note, 'Complimentary credits from owner (usable for AI Director and video generation)'));
    update public.pending_credit_grants set granted_at = now(), granted_user_id = new.id where id = g.id;
  end loop;
  return new;
end;
$$;
revoke all on function public.cinex_apply_pending_grants() from public, anon, authenticated;

drop trigger if exists zz_cinex_pending_grants on auth.users;
create trigger zz_cinex_pending_grants
  after insert or update of email_confirmed_at on auth.users
  for each row execute function public.cinex_apply_pending_grants();

insert into public.pending_credit_grants (email, credits, note) values
  ('kingbeatexclusive@gmail.com', 50000, 'Complimentary credits from owner (usable for AI Director and video generation)'),
  ('allygreene82@gmail.com', 100000, 'Complimentary credits from owner (usable for AI Director and video generation)')
on conflict do nothing;
