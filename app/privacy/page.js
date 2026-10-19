import Link from 'next/link';
import CinexRoutePage from '@/components/CinexRoutePage';
import { LEGAL } from '@/lib/legal';

export const metadata = { title: 'Privacy Policy — CineXVideo' };

const mail = (a) => <a href={`mailto:${a}`}>{a}</a>;

export default function PrivacyPage() {
  return (
    <CinexRoutePage
      eyebrow="Privacy Policy"
      title="How CineXVideo handles your information"
      description="What we collect, why, who helps us run the service, how long we keep it, and the choices and rights you have."
    >
      <div className="cinex-legal">
        <p><strong>Last updated: {LEGAL.updated}.</strong> {LEGAL.entity} (“{LEGAL.service}”, “we”), based in {LEGAL.location}, is responsible for your personal information. We follow Canada’s Personal Information Protection and Electronic Documents Act (PIPEDA) and, where they apply to you, Quebec’s Law 25, the EU and UK General Data Protection Regulation (GDPR) and California’s Consumer Privacy Act (CCPA/CPRA). Questions or requests: {mail(LEGAL.privacy)}.</p>

        <h2>1. What we collect</h2>
        <ul>
          <li><strong>Account details:</strong> your name, email address and profile picture from Google sign-in, and your account settings.</li>
          <li><strong>What you create:</strong> project titles, ideas, scripts, prompts, AI Director requests, lyrics, songs you upload, and the stills, takes and final cuts made for you.</li>
          <li><strong>Face photos:</strong> photos of real people you upload so the AI can keep their likeness, with the consent you confirm for each one. These photos are biometric-adjacent information; we use them only to make your videos and to check that faces stay accurate.</li>
          <li><strong>Payments:</strong> purchases, plans and credit history. Card details are collected and held by Stripe; we never see or store your full card number.</li>
          <li><strong>Safety records:</strong> the results of our content checks, and any content that was blocked (see section 4).</li>
          <li><strong>Technical data:</strong> sign-in sessions, IP address, device and browser type, and error logs, to keep the service secure and working.</li>
        </ul>
        <p>CineXVideo is for adults ({LEGAL.minimumAge}+). We do not knowingly collect information from anyone under {LEGAL.minimumAge}, and we delete it if we learn we have.</p>

        <h2>2. Why we use it</h2>
        <ul>
          <li>To run your account and private studio and make the videos you ask for (our contract with you).</li>
          <li>To take payments, keep accurate credit balances, and meet tax and accounting rules (legal obligation).</li>
          <li>To keep CineXVideo safe: blocking prohibited content, preventing fraud and abuse, and reporting child sexual exploitation as the law requires (legal obligation and legitimate interests).</li>
          <li>To answer you, fix problems and improve how the service works (legitimate interests).</li>
          <li>To send service messages, such as receipts and important changes. We only send marketing if you agree, and you can opt out at any time.</li>
        </ul>
        <p>We do not sell or rent your personal information, we do not share it for targeted advertising, and we do not use your songs, photos or videos to train AI models.</p>

        <h2>3. Who helps us run CineXVideo</h2>
        <p>We use trusted service providers that process information for us under contract, only for the purposes above:</p>
        <ul>
          <li><strong>Google:</strong> sign-in.</li>
          <li><strong>Stripe:</strong> payments and billing.</li>
          <li><strong>Supabase:</strong> our database, sign-in sessions and storage for uploaded songs and face photos.</li>
          <li><strong>Cloudflare (R2):</strong> private storage for your stills, takes and final cuts.</li>
          <li><strong>Railway:</strong> hosting for the app.</li>
          <li><strong>OpenAI:</strong> the AI Director, lyric timing, face and quality checks, and content moderation. Information sent through OpenAI’s API is not used to train their models.</li>
          <li><strong>AI image and video generation providers:</strong> they receive the prompt, the approved still or face photo and, for sung scenes, the matching slice of your song, only to make that still or take.</li>
        </ul>
        <p>We may also disclose information when the law requires it (for example a court order, or a mandatory report to Cybertip.ca, the RCMP or NCMEC), to protect people’s safety, or as part of a sale or merger of the business, in which case this policy continues to apply.</p>

        <h2>4. Content checks</h2>
        <p>Every prompt, face photo, AI Director request, still and a sample of frames from every take is checked automatically before you see the result. Blocked items are kept in a private quarantine area that only CineXVideo’s super administrator can open. Previews stay blurred unless a reviewer needs to see them to decide. See the <Link href="/content-policy">Content Policy</Link> for how review and appeals work.</p>

        <h2>5. How long we keep it</h2>
        <ul>
          <li><strong>Projects, uploads, takes and final cuts:</strong> until you delete them or close your account. After you close your account, they are deleted within 30 days, apart from backups that expire within a further 30 days.</li>
          <li><strong>Payment and credit records:</strong> for at least six years, as Canadian tax law requires.</li>
          <li><strong>Blocked content and moderation records:</strong> up to 12 months after review, so decisions and appeals can be checked.</li>
          <li><strong>Child-safety cases:</strong> preserved as the law requires (in Canada and the US this can be a year or more), and longer if the police ask us to.</li>
          <li><strong>Security logs:</strong> up to 12 months.</li>
        </ul>

        <h2>6. Security</h2>
        <p>Your studio is private to your account. Files are stored in private storage and are only reachable through short-lived signed links (15 minutes) created for you. Connections are encrypted, access by our staff is limited and logged, and payment card data is handled only by Stripe. No system is perfectly secure; if a breach puts you at real risk of significant harm, we will tell you and the regulators as the law requires.</p>

        <h2>7. Where your information is processed</h2>
        <p>We are based in Canada, and our service providers may process information in Canada, the United States and other countries. When information leaves your country, we use contractual and other safeguards (such as the EU Standard Contractual Clauses where they apply) so it stays protected to the standard of this policy.</p>

        <h2>8. Your rights and choices</h2>
        <ul>
          <li>Ask for a copy of your personal information, or have it corrected.</li>
          <li>Ask us to delete your information or close your account (some records must be kept by law, as above).</li>
          <li>Withdraw consent, for example for a face photo, by deleting it from your project. This does not affect what was made before.</li>
          <li>Object to or restrict some uses, and receive your information in a portable format, where the GDPR applies.</li>
          <li>Californians: know, delete, correct and opt out of sale or sharing (we do neither), without being treated differently for using these rights.</li>
          <li>Complain to a regulator: in Canada, the Office of the Privacy Commissioner of Canada (or the Commission d’accès à l’information in Quebec); in the EU or UK, your local data protection authority.</li>
        </ul>
        <p>Send requests to {mail(LEGAL.privacy)}. We answer within 30 days and may need to confirm your identity first.</p>

        <h2>9. Cookies</h2>
        <p>We use only the cookies needed to keep you signed in and keep the service secure. We do not use advertising or cross-site tracking cookies. If that changes, we will update this policy and ask for your consent where required.</p>

        <h2>10. Changes</h2>
        <p>We will post any update here with a new date, and tell you by email or in the app before important changes take effect.</p>

        <h2>11. Contact</h2>
        <p>Privacy officer, {LEGAL.entity}: {mail(LEGAL.privacy)}. For account help, write to {mail(LEGAL.support)}.</p>
      </div>
    </CinexRoutePage>
  );
}
