'use client';

import Link from 'next/link';

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-black text-white">
      <div className="max-w-4xl mx-auto px-6 py-16">
        <Link href="/" className="inline-flex items-center gap-2 mb-8 text-slate-400 hover:text-white transition-colors">
          ← Back to CinexVideo
        </Link>
        
        <h1 className="text-4xl font-bold mb-8">Privacy Policy</h1>
        
        <div className="prose prose-invert prose-lg max-w-none">
          <p className="text-slate-400">Last updated: September 3, 2026</p>
          
          <h2>1. Information We Collect</h2>
          <p>We collect information you provide directly to us, including your name, email address, and payment information when you create an account or make a purchase.</p>
          
          <h2>2. How We Use Information</h2>
          <p>We use the information we collect to provide, maintain, and improve our services, to process transactions, and to send you related information including confirmations and invoices.</p>
          
          <h2>3. Information Sharing</h2>
          <p>We do not sell your personal information. We may share your information with service providers who perform services on our behalf, in response to legal requests, or to protect our rights.</p>
          
          <h2>4. Data Security</h2>
          <p>We take reasonable measures to help protect your personal information from loss, theft, misuse, unauthorized access, disclosure, alteration, and destruction.</p>
          
          <h2>5. Cookies and Analytics</h2>
          <p>We use cookies and similar technologies to collect information about your browsing activities. You can control cookies through your browser settings.</p>
          
          <h2>6. Your Choices</h2>
          <p>You may update, correct, or delete your account information at any time. You may also opt out of receiving promotional emails from us.</p>
          
          <h2>7. Children's Privacy</h2>
          <p>Our services are not intended for children under 13. We do not knowingly collect personal information from children under 13.</p>
          
          <h2>8. International Data Transfers</h2>
          <p>Your information may be transferred to and processed in countries other than your country of residence.</p>
          
          <h2>9. Changes to Privacy Policy</h2>
          <p>We may update this privacy policy from time to time. We will notify you of any changes by posting the new policy on this page.</p>
          
          <h2>10. Contact Us</h2>
          <p>If you have any questions about this Privacy Policy, please contact us through our support channels.</p>
        </div>
      </div>
    </div>
  );
}
