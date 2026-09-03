'use client';

import Link from 'next/link';

export default function RefundsPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-black text-white">
      <div className="max-w-4xl mx-auto px-6 py-16">
        <Link href="/" className="inline-flex items-center gap-2 mb-8 text-slate-400 hover:text-white transition-colors">
          ← Back to CinexVideo
        </Link>
        
        <h1 className="text-4xl font-bold mb-8">Refund and Credit Policy</h1>
        
        <div className="prose prose-invert prose-lg max-w-none">
          <p className="text-slate-400">Last updated: September 3, 2026</p>
          
          <h2>1. Credits Are Non-Refundable</h2>
          <p>Purchased credits are non-refundable except as required by applicable law. Once credits are added to your account, they cannot be exchanged for cash or refunded.</p>
          
          <h2>2. Credit Expiration</h2>
          <p>Credits do not expire as long as your account remains active. If your account is terminated for violation of our Terms of Service, any remaining credits will be forfeited.</p>
          
          <h2>3. Subscription Cancellations</h2>
          <p>If you cancel a subscription, you will retain access to your remaining credits until the end of your current billing period. No refunds will be provided for partial months.</p>
          
          <h2>4. Service Failures</h2>
          <p>If a video generation fails due to a technical error on our end, the credits used will be automatically restored to your account. If restoration is not possible, contact our support team.</p>
          
          <h2>5. Disputed Charges</h2>
          <p>If you dispute a charge through your payment provider, we may suspend or terminate your account pending resolution. False disputes may result in permanent account termination.</p>
          
          <h2>6. Refund Requests</h2>
          <p>In exceptional circumstances, refund requests may be considered at our sole discretion. Contact our support team with your request and reason.</p>
          
          <h2>7. Promotional Credits</h2>
          <p>Promotional or bonus credits provided through promotions, referrals, or other means may have additional terms and conditions and may expire according to those terms.</p>
          
          <h2>8. Price Changes</h2>
          <p>We reserve the right to change credit pricing at any time. Price changes will not affect credits already purchased.</p>
          
          <h2>9. Contact</h2>
          <p>For questions about this Refund and Credit Policy, please contact our support team.</p>
        </div>
      </div>
    </div>
  );
}
