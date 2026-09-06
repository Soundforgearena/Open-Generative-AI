'use client';

import Link from 'next/link';

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-black text-white">
      <div className="max-w-4xl mx-auto px-6 py-16">
        <Link href="/" className="inline-flex items-center gap-2 mb-8 text-slate-400 hover:text-white transition-colors">
          ← Back to CinexVideo
        </Link>
        
        <h1 className="text-4xl font-bold mb-8">Terms of Service</h1>
        
        <div className="prose prose-invert prose-lg max-w-none">
          <p className="text-slate-400">Last updated: September 3, 2026</p>
          
          <h2>1. Acceptance of Terms</h2>
          <p>By accessing or using CinexVideo, you agree to be bound by these Terms of Service and all applicable laws and regulations.</p>
          
          <h2>2. Description of Service</h2>
          <p>CinexVideo provides AI-powered video generation services. Users can create videos using text descriptions, templates, and AI-assisted storytelling tools.</p>
          
          <h2>3. User Accounts</h2>
          <p>You must create an account to use our services. You are responsible for maintaining the security of your account and for all activities that occur under your account.</p>
          
          <h2>4. Credits and Payments</h2>
          <p>Video generation requires credits. Credits are purchased through our platform and are subject to the terms outlined in our Refund and Credit Policy.</p>
          
          <h2>5. Content Ownership</h2>
          <p>You retain ownership of content you create using CinexVideo. By using our service, you grant us a license to use your content solely for the purpose of providing and improving our services.</p>
          
          <h2>6. Prohibited Uses</h2>
          <p>You agree not to use CinexVideo to create content that is illegal, harmful, threatening, abusive, harassing, defamatory, vulgar, obscene, or otherwise objectionable.</p>
          
          <h2>7. Disclaimer of Warranties</h2>
          <p>CinexVideo is provided &quot;as is&quot; without any warranties, express or implied. We do not warrant that the service will be uninterrupted, error-free, or completely secure.</p>
          
          <h2>8. Limitation of Liability</h2>
          <p>To the maximum extent permitted by law, CinexVideo shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of the service.</p>
          
          <h2>9. Changes to Terms</h2>
          <p>We reserve the right to modify these terms at any time. Continued use of the service after changes constitutes acceptance of the new terms.</p>
          
          <h2>10. Contact</h2>
          <p>For questions about these Terms of Service, please contact us through our support channels.</p>
        </div>
      </div>
    </div>
  );
}
