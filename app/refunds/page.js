import Link from 'next/link';
import CinexRoutePage from '@/components/CinexRoutePage';

export const metadata = { title: 'Refund and Credit Policy — CineXVideo' };

export default function RefundsPage() {
  return (
    <CinexRoutePage
      eyebrow="Refund and Credit Policy"
      title="Credits, refunds and cancellations"
      description="How credits work, when they are returned automatically, and how to ask for a refund."
    >
      <div className="cinex-legal">
        <p><strong>Last updated: October 19, 2026.</strong> Read with our <Link href="/terms">Terms of Service</Link>.</p>
          
          <h2>1. Credits Are Non-Refundable</h2>
          <p>Purchased credits are non-refundable except as required by applicable law. Once credits are added to your account, they cannot be exchanged for cash or refunded.</p>
          
          <h2>2. Credit Expiration</h2>
          <p>Credits do not expire as long as your account remains active. If your account is closed for a serious breach of our Terms of Service, remaining credits are forfeited where the law allows.</p>
          
          <h2>3. Subscription Cancellations</h2>
          <p>If you cancel a monthly plan, it stays active until the end of the current billing period and then does not renew. Credits you already received stay in your account while it is active. Partial months are not refunded, except where the law requires.</p>
          
          <h2>4. Service Failures</h2>
          <p>If a still, take or export fails, or is withheld by our safety checks after it was made, the credits for it are returned to your account automatically. You are only charged for what is delivered to you. If credits were not returned, email <a href="mailto:support@cinexvideo.app">support@cinexvideo.app</a>.</p>
          
          <h2>5. Disputed Charges</h2>
          <p>If you dispute a charge through your payment provider, we may suspend or terminate your account pending resolution. False disputes may result in permanent account termination.</p>
          
          <h2>6. Refund Requests</h2>
          <p>In exceptional circumstances, refund requests may be considered at our sole discretion. Email support@cinexvideo.app with your request and reason.</p>
          
          <h2>7. Promotional Credits</h2>
          <p>Promotional or bonus credits provided through promotions, referrals, or other means may have additional terms and conditions and may expire according to those terms.</p>
          
          <h2>8. Price Changes</h2>
          <p>We reserve the right to change credit pricing at any time. Price changes will not affect credits already purchased.</p>
          
          <h2>9. Contact</h2>
          <p>For questions about this Refund and Credit Policy, email <a href="mailto:support@cinexvideo.app">support@cinexvideo.app</a>. Nothing in this policy limits refund rights you have under consumer protection law where you live.</p>
      </div>
    </CinexRoutePage>
  );
}
