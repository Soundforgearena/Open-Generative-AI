-- Applied to production as version 20261016122210 (real_faces).
-- Content exported verbatim from supabase_migrations.schema_migrations.

-- Real faces for music videos and episodes. Additive only; safe to apply
-- before the code that uses it is deployed.

-- A character photo may only drive generation once the uploader confirms
-- they have the pictured person's permission.
alter table public.project_assets add column if not exists likeness_consent boolean not null default false;
alter table public.project_assets add column if not exists likeness_consent_at timestamptz;

-- Which character's face a scene shows.
alter table public.scenes add column if not exists character_asset_id uuid
  references public.project_assets(id) on delete set null;
create index if not exists scenes_character_asset_idx on public.scenes (character_asset_id)
  where character_asset_id is not null;

-- Image-to-video used for real-face scenes. Billed per second by resolution
-- in code (same rates as text-to-video); the first-frame cost is added on top.
-- Chosen by the server, never shown as a separate menu option.
insert into public.model_cost_rules (
  provider, model, operation, provider_cost_cents,
  target_margin_percent, payment_fee_percent, payment_fee_fixed_cents,
  fixed_overhead_cents, variable_overhead_percent, minimum_customer_price_cents,
  max_duration_seconds, max_references, max_resolution, customer_visible, customer_label, active
) values (
  'muapi', 'pixverse-v6-i2v', 'video', 3.3,
  65, 3.5, 0.3, 0.25, 5, 2,
  10, 1, null, false, 'Real-face video', true
)
on conflict (provider, model, operation) do nothing;
