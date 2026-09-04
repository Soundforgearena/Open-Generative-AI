import { NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
});

export async function POST(req) {
  try {
    const supabase = createRouteHandlerClient({ cookies: req.cookies });
    const { data: { session } } = await supabase.auth.getSession();

    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { email, partnerId } = await req.json();

    if (!email || !partnerId) {
      return NextResponse.json(
        { error: 'email and partnerId are required' },
        { status: 400 }
      );
    }

    // Verify caller is admin or the partner themselves
    const { data: partner } = await supabase
      .from('revenue_partners')
      .select('user_id, email, share_percent, active')
      .eq('id', partnerId)
      .single();

    if (!partner) {
      return NextResponse.json({ error: 'Partner not found' }, { status: 404 });
    }

    // Check admin status
    const { data: adminCheck } = await supabase
      .from('admin_members')
      .select('role')
      .eq('user_id', session.user.id)
      .single();

    const isAdmin = !!adminCheck;
    const isSelf = partner.user_id === session.user.id;

    if (!isAdmin && !isSelf) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Check if already has a Stripe account
    if (partner.stripe_account_id) {
      return NextResponse.json(
        { error: 'Partner already has a Stripe account' },
        { status: 400 }
      );
    }

    // Create Express account
    const account = await stripe.accounts.create({
      type: 'express',
      email: partner.email || email,
      capabilities: {
        transfers: { requested: true },
      },
      metadata: {
        cinexvideo_partner_id: partnerId,
        partner_email: partner.email || email,
      },
    });

    // Create onboarding link
    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: `${process.env.NEXT_PUBLIC_APP_URL}/billing/connect?refresh=true`,
      return_url: `${process.env.NEXT_PUBLIC_APP_URL}/billing/connect?success=true`,
      type: 'account_onboarding',
    });

    // Update partner record
    await supabase
      .from('revenue_partners')
      .update({
        stripe_account_id: account.id,
        onboarding_status: 'onboarding_in_progress',
        updated_at: new Date().toISOString(),
      })
      .eq('id', partnerId);

    return NextResponse.json({
      accountId: account.id,
      onboardingUrl: accountLink.url,
    });
  } catch (err) {
    console.error('Stripe Connect onboarding error:', err);
    return NextResponse.json(
      { error: 'Failed to create onboarding link' },
      { status: 500 }
    );
  }
}
