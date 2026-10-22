# Unapplied migrations

Files here were never applied to the production Supabase project and are kept
only for history. They are outside `supabase/migrations/` so Supabase Preview
branches and `supabase db push` ignore them.

- `20260906_contractor_monthly_payouts.sql` — superseded by the partner split in
  `20261007071615_partner_split_one_account.sql`. Its columns
  (`contractor_key`, `payout_units`, `raw_share_cents`) do not exist in
  production and nothing in the app references them.
