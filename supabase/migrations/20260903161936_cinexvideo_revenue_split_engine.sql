-- Applied to production as version 20260903161936 (cinexvideo_revenue_split_engine).
-- Content exported verbatim from supabase_migrations.schema_migrations.

-- Records one revenue event and splits it. Returns the event id.
-- Idempotent on (source, reference_id): a retried webhook cannot double-pay.
create or replace function public.record_revenue(
  p_source text,
  p_reference_id text,
  p_user_id uuid,
  p_gross_cents integer,
  p_provider_cost_cents integer default 0,
  p_overhead_cents integer default 0,
  p_payment_fee_cents integer default 0
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_cfg jsonb;
  v_platform_percent numeric;
  v_basis text;
  v_net integer;
  v_base integer;
  v_platform integer;
  v_distributable integer;
  v_total_share numeric;
  v_assigned integer := 0;
  v_event_id uuid;
  r record;
  v_amount integer;
begin
  select id into v_event_id from public.revenue_events
   where source = p_source and reference_id = p_reference_id;
  if v_event_id is not null then
    return v_event_id;  -- already split
  end if;

  v_cfg := coalesce((select value from public.app_settings where key = 'revenue_split'),
                    '{"platform_percent": 50, "basis": "net"}'::jsonb);
  v_platform_percent := coalesce((v_cfg->>'platform_percent')::numeric, 50);
  v_basis := coalesce(v_cfg->>'basis', 'net');

  v_net := p_gross_cents - p_provider_cost_cents - p_overhead_cents - p_payment_fee_cents;
  v_base := case when v_basis = 'gross' then p_gross_cents else greatest(v_net, 0) end;

  v_platform := floor(v_base * v_platform_percent / 100.0)::integer;
  v_distributable := v_base - v_platform;

  select coalesce(sum(share_percent), 0) into v_total_share
    from public.revenue_partners where active;

  insert into public.revenue_events(
    source, reference_id, user_id, gross_cents, provider_cost_cents, overhead_cents,
    payment_fee_cents, net_cents, basis, base_cents, platform_percent, platform_cents, distributed_cents)
  values (p_source, p_reference_id, p_user_id, p_gross_cents, p_provider_cost_cents, p_overhead_cents,
    p_payment_fee_cents, v_net, v_basis, v_base, v_platform_percent, v_platform, 0)
  returning id into v_event_id;

  if v_distributable > 0 and v_total_share > 0 then
    for r in select id, share_percent from public.revenue_partners where active order by share_percent desc, email loop
      v_amount := floor(v_distributable * r.share_percent / v_total_share)::integer;
      if v_amount > 0 then
        insert into public.partner_earnings(partner_id, revenue_event_id, share_percent, amount_cents)
        values (r.id, v_event_id, r.share_percent, v_amount);
        v_assigned := v_assigned + v_amount;
      end if;
    end loop;
  end if;

  -- Rounding dust stays with the platform so cents never go missing.
  update public.revenue_events
     set platform_cents = v_platform + (v_distributable - v_assigned),
         distributed_cents = v_assigned
   where id = v_event_id;

  return v_event_id;
end;
$$;

revoke all on function public.record_revenue(text, text, uuid, integer, integer, integer, integer) from public, anon, authenticated;

-- Outstanding balance per partner.
create or replace view public.partner_balances as
select
  rp.id as partner_id,
  rp.email,
  rp.display_name,
  rp.share_percent,
  rp.active,
  rp.payout_provider,
  rp.payouts_enabled,
  rp.onboarding_status,
  coalesce(e.lifetime_cents, 0) as lifetime_earned_cents,
  coalesce(e.unpaid_cents, 0) as available_cents,
  coalesce(p.pending_cents, 0) as pending_payout_cents,
  coalesce(p.paid_cents, 0) as paid_out_cents
from public.revenue_partners rp
left join (
  select partner_id,
         sum(amount_cents) as lifetime_cents,
         sum(amount_cents) filter (where payout_id is null) as unpaid_cents
    from public.partner_earnings group by partner_id
) e on e.partner_id = rp.id
left join (
  select partner_id,
         sum(amount_cents) filter (where status = 'pending') as pending_cents,
         sum(amount_cents) filter (where status = 'paid') as paid_cents
    from public.partner_payouts group by partner_id
) p on p.partner_id = rp.id;

-- Opens a payout for everything a partner has earned but not yet been paid.
create or replace function public.open_partner_payout(
  p_partner_id uuid, p_provider text default null, p_note text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_amount integer; v_payout_id uuid; v_provider text;
begin
  if not public.is_cinex_super_admin(auth.uid()) then
    raise exception 'Only a super admin can open a payout';
  end if;

  select coalesce(sum(amount_cents), 0) into v_amount
    from public.partner_earnings where partner_id = p_partner_id and payout_id is null;
  if v_amount <= 0 then
    raise exception 'Nothing available to pay out';
  end if;

  select coalesce(p_provider, payout_provider) into v_provider
    from public.revenue_partners where id = p_partner_id;

  insert into public.partner_payouts(partner_id, amount_cents, provider, note, created_by)
  values (p_partner_id, v_amount, v_provider, p_note, auth.uid())
  returning id into v_payout_id;

  update public.partner_earnings set payout_id = v_payout_id
   where partner_id = p_partner_id and payout_id is null;

  return v_payout_id;
end;
$$;

-- Releases the earnings back to available if a payout fails or is cancelled.
create or replace function public.settle_partner_payout(
  p_payout_id uuid, p_status text, p_provider_transfer_id text default null
) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.partner_payouts
     set status = p_status,
         provider_transfer_id = coalesce(p_provider_transfer_id, provider_transfer_id),
         completed_at = case when p_status = 'paid' then now() else completed_at end
   where id = p_payout_id;

  if p_status in ('failed','cancelled') then
    update public.partner_earnings set payout_id = null where payout_id = p_payout_id;
  end if;
  return true;
end;
$$;
