-- Applied to production as version 20260902200731 (cinexvideo_export_credit_protection).
-- Content exported verbatim from supabase_migrations.schema_migrations.

create table if not exists public.export_cost_rules (id uuid primary key default gen_random_uuid(), export_type text not null, resolution text not null, format text not null, provider_cost_cents numeric(12,4) not null default 0, fixed_overhead_cents numeric(12,4) not null default 0.25, variable_overhead_percent numeric(5,2) not null default 5, payment_fee_percent numeric(5,2) not null default 3.5, payment_fee_fixed_cents numeric(12,4) not null default 0.30, target_margin_percent numeric(5,2) not null default 45, minimum_customer_price_cents numeric(12,4) not null default 5, credits integer not null, active boolean not null default true, customer_label text not null default 'Final export', unique(export_type,resolution,format));
create table if not exists public.export_jobs (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, project_id uuid, export_type text not null, resolution text not null, format text not null, credits_reserved integer not null, status text not null default 'queued' check(status in ('queued','rendering','completed','failed','cancelled','expired')), output_path text, signed_url_expires_at timestamptz, created_at timestamptz not null default now(), completed_at timestamptz);
create table if not exists public.preview_access_events (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete set null, project_id uuid, asset_id uuid, access_type text not null check(access_type in ('preview','export','download','screenshot_signal')), watermark_token text, ip_hash text, user_agent_hash text, created_at timestamptz not null default now());

insert into public.export_cost_rules(export_type,resolution,format,provider_cost_cents,credits,customer_label) values
 ('storyboard_preview','720p','mp4',0,10,'Storyboard preview'),
 ('episode_export','1080p','mp4',5,80,'Episode export'),
 ('episode_export','4k','mp4',15,180,'Episode export'),
 ('music_video_export','1080p','mp4',5,80,'Music video export'),
 ('music_video_export','4k','mp4',15,180,'Music video export'),
 ('social_export','1080p','mp4',2,35,'Social export')
on conflict(export_type,resolution,format) do update set provider_cost_cents=excluded.provider_cost_cents,credits=excluded.credits,active=true;

alter table public.export_cost_rules enable row level security;
alter table public.export_jobs enable row level security;
alter table public.preview_access_events enable row level security;

create or replace function public.customer_export_quote(p_export_type text,p_resolution text,p_format text)
returns table(approved boolean,credits integer,customer_label text,reason_code text)
language plpgsql security definer set search_path=public as $$ declare r public.export_cost_rules; price numeric; total_cost numeric; margin numeric; begin select * into r from public.export_cost_rules where export_type=p_export_type and resolution=p_resolution and format=p_format and active=true limit 1; if not found then return query select false,null::integer,'Final export'::text,'UNAVAILABLE'; return; end if; total_cost:=r.provider_cost_cents+r.fixed_overhead_cents+(r.provider_cost_cents*r.variable_overhead_percent/100.0); price:=greatest(r.minimum_customer_price_cents,round((total_cost+r.payment_fee_fixed_cents)/greatest(0.01,1-r.target_margin_percent/100.0-r.payment_fee_percent/100.0),2)); margin:=((price-total_cost-r.payment_fee_fixed_cents-price*r.payment_fee_percent/100.0)/greatest(0.01,price))*100.0; if margin<r.target_margin_percent then return query select false,null::integer,r.customer_label,'TEMPORARILY_UNAVAILABLE'; return; end if; return query select true,greatest(r.credits,ceil(price))::integer,r.customer_label,'APPROVED'; end; $$;
revoke all on function public.customer_export_quote(text,text,text) from public;
grant execute on function public.customer_export_quote(text,text,text) to service_role;
