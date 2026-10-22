-- Applied to production as version 20260907075632 (generation_provider_contract_fix).
-- Content exported verbatim from supabase_migrations.schema_migrations.

begin;

update public.model_cost_rules
set model = 'pixverse-v6-t2v',
    customer_label = coalesce(customer_label, 'Cinematic video')
where provider = 'muapi'
  and model = 'pixverse-v6'
  and operation = 'video'
  and not exists (
    select 1
    from public.model_cost_rules existing
    where existing.provider = 'muapi'
      and existing.model = 'pixverse-v6-t2v'
      and existing.operation = 'video'
  );

update public.model_cost_rules
set active = false,
    customer_visible = false
where provider = 'muapi'
  and model in ('pixverse-v6', 'wan-video')
  and operation = 'video';

commit;
