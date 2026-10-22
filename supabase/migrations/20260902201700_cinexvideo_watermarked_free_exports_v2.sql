-- Applied to production as version 20260902201700 (cinexvideo_watermarked_free_exports_v2).
-- Content exported verbatim from supabase_migrations.schema_migrations.

alter table public.export_cost_rules add column if not exists watermark_required boolean not null default true; alter table public.export_cost_rules add column if not exists export_class text not null default 'final_media';
update public.export_cost_rules set export_class='storyboard', watermark_required=true, credits=case when resolution='720p' then 25 else credits end where export_type='storyboard_preview';
update public.export_cost_rules set export_class='final_media', watermark_required=true, credits=0 where export_type in ('episode_export','music_video_export','social_export');
insert into public.export_cost_rules(export_type,resolution,format,provider_cost_cents,credits,customer_label,watermark_required,export_class) values
 ('episode_clean_export','1080p','mp4',5,80,'Watermark-free export',false,'clean_export'),
 ('episode_clean_export','4k','mp4',15,180,'Watermark-free export',false,'clean_export'),
 ('music_video_clean_export','1080p','mp4',5,80,'Watermark-free export',false,'clean_export'),
 ('music_video_clean_export','4k','mp4',15,180,'Watermark-free export',false,'clean_export'),
 ('social_clean_export','1080p','mp4',2,35,'Watermark-free export',false,'clean_export')
on conflict(export_type,resolution,format) do update set provider_cost_cents=excluded.provider_cost_cents,credits=excluded.credits,watermark_required=excluded.watermark_required,export_class=excluded.export_class,active=true;

drop function if exists public.customer_export_quote(text,text,text);
create function public.customer_export_quote(p_export_type text,p_resolution text,p_format text)
returns table(approved boolean,credits integer,customer_label text,watermark_required boolean,reason_code text)
language plpgsql security definer set search_path=public as $$ declare r public.export_cost_rules; price numeric; total_cost numeric; margin numeric; begin select * into r from public.export_cost_rules where export_type=p_export_type and resolution=p_resolution and format=p_format and active=true limit 1; if not found then return query select false,null::integer,'Export'::text,true,'UNAVAILABLE'; return; end if; if r.credits=0 then return query select true,0,r.customer_label,r.watermark_required,'APPROVED'; return; end if; total_cost:=r.provider_cost_cents+r.fixed_overhead_cents+(r.provider_cost_cents*r.variable_overhead_percent/100.0); price:=greatest(r.minimum_customer_price_cents,round((total_cost+r.payment_fee_fixed_cents)/greatest(0.01,1-r.target_margin_percent/100.0-r.payment_fee_percent/100.0),2)); margin:=((price-total_cost-r.payment_fee_fixed_cents-price*r.payment_fee_percent/100.0)/greatest(0.01,price))*100.0; if margin<r.target_margin_percent then return query select false,null::integer,r.customer_label,r.watermark_required,'TEMPORARILY_UNAVAILABLE'; return; end if; return query select true,greatest(r.credits,ceil(price))::integer,r.customer_label,r.watermark_required,'APPROVED'; end; $$;
revoke all on function public.customer_export_quote(text,text,text) from public;
grant execute on function public.customer_export_quote(text,text,text) to service_role;
