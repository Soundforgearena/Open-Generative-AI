import Link from 'next/link';
import CinexRoutePage from '@/components/CinexRoutePage';
import { LEGAL } from '@/lib/legal';

export const metadata = { title: 'Terms of Service — CineXVideo' };

const mail = (a) => <a href={`mailto:${a}`}>{a}</a>;

export default function TermsPage() {
  return (
    <CinexRoutePage
      eyebrow="Terms of Service"
      title="The rules for using CineXVideo"
      description="Plain-language terms for making music videos and episodes with CineXVideo. Please read them: by creating an account or using the service you agree to them."
    >
      <div className="cinex-legal">
        <p><strong>Last updated: {LEGAL.updated}.</strong> These terms are an agreement between you and {LEGAL.entity} (“{LEGAL.service}”, “we”, “us”), based in {LEGAL.location}. They work together with our <Link href="/privacy">Privacy Policy</Link>, <Link href="/content-policy">Content Policy</Link> and <Link href="/refunds">Refund and Credit Policy</Link>, which form part of these terms.</p>

        <h2>1. Who can use CineXVideo</h2>
        <ul>
          <li>You must be at least {LEGAL.minimumAge} years old, or the age of majority where you live if that is higher. CineXVideo is not for children and we do not knowingly allow accounts for anyone under {LEGAL.minimumAge}.</li>
          <li>If you use CineXVideo for a company or band, you confirm you are allowed to accept these terms for them.</li>
          <li>You may not use CineXVideo if you are barred from doing so by law, or if we previously closed your account for breaking these terms.</li>
        </ul>

        <h2>2. Your account</h2>
        <ul>
          <li>You sign in with Google. Keep that account secure; you are responsible for everything done through your CineXVideo account.</li>
          <li>One person per account. Do not share, sell or transfer your account.</li>
          <li>Each account has its own private studio. Your projects, takes and final cuts are visible only to you, and to our staff when needed to run the service, keep it safe or meet a legal obligation.</li>
          <li>Tell us right away at {mail(LEGAL.support)} if you think someone else has used your account.</li>
        </ul>

        <h2>3. What CineXVideo does, and AI-generated content</h2>
        <ul>
          <li>CineXVideo plans, generates and edits video with artificial intelligence (AI). The AI Director plans scenes; AI models make stills, takes and lip sync; the Studio joins them into a finished video.</li>
          <li>Everything the AI makes is synthetic. It can be imperfect, may not match what you asked for, and similar results may be made for other people. You review every still and take before you approve it.</li>
          <li><strong>Labelling.</strong> Where the law or a platform requires it (for example the EU AI Act, or the rules of YouTube, TikTok, Instagram and others), you must label realistic AI-generated or AI-altered video as AI-generated when you publish it. Free downloads carry a CineXVideo watermark; do not remove it except by buying the no-watermark version.</li>
          <li>Never present AI-generated video as real footage of a real event, or as something a real person actually said or did, in a way that could mislead people.</li>
          <li>We may change, add or remove features and AI models to keep quality high and costs fair. We will not reduce what you already paid for without offering a fair alternative or refund where the law requires.</li>
        </ul>

        <h2>4. Credits, plans and payments</h2>
        <ul>
          <li>Making things uses credits. One credit is worth US$0.01. Before anything paid is made you see the exact credit price and must confirm it; you are never charged more than the price you confirmed.</li>
          <li>Credits are reserved when a job starts and only spent when it is delivered. If a job fails, or is blocked by our safety checks after it was made, its credits are returned automatically.</li>
          <li>Some features, including the AI Director and no-watermark exports, can only be paid with purchased credits. The price window always says which credits are used.</li>
          <li>Monthly plans renew automatically until you cancel in your account. Plan credits roll over while your account is active. Cancelling stops future renewals; it does not refund the current period, except where the law requires.</li>
          <li>Payments are handled by Stripe. Prices are in US dollars and may include taxes where required. We may change prices for the future; credits you already hold keep their value.</li>
          <li>Purchased credits are not refundable or exchangeable for cash, except as set out in the <Link href="/refunds">Refund and Credit Policy</Link> or required by law (including consumer protection law in your province, state or country). Credits are not money, have no cash value and cannot be transferred.</li>
          <li>If an account is closed for a serious breach of these terms, unused credits are forfeited where the law allows.</li>
        </ul>

        <h2>5. Your content and who owns it</h2>
        <ul>
          <li><strong>Your inputs.</strong> You keep ownership of what you upload or write: songs, lyrics, photos, scripts and prompts.</li>
          <li><strong>Your outputs.</strong> As between you and us, you own the stills, takes and videos made for you, to the extent the law allows ownership of AI-generated material. Copyright protection for AI-generated material varies by country and is not guaranteed.</li>
          <li><strong>Licence to us.</strong> You give us a worldwide, non-exclusive, royalty-free licence to host, store, copy, process, transmit and display your inputs and outputs only as needed to run CineXVideo for you, keep it safe (including moderation) and meet our legal obligations. This licence ends when your content is deleted, except for copies we must keep by law (for example evidence in child-safety cases) and backups that expire on their normal schedule.</li>
          <li>We do not sell your content, we do not use your songs, photos or videos to train our own AI models, and we do not give them to anyone else to train theirs.</li>
          <li><strong>Your promises.</strong> You confirm you own, or have permission to use, everything you upload, including the music. If a song belongs to a label, publisher or other artist, you need their permission. You are responsible for clearing rights before you publish.</li>
        </ul>

        <h2>6. Real people and faces</h2>
        <ul>
          <li>You may only upload a photo of a real person, or make a video that looks like a real person, if that person is an adult who has given you clear permission, or it is you.</li>
          <li>You must tick the consent box for every real face. We may ask you to show that consent, and we may remove content if the person objects.</li>
          <li>Do not make videos that impersonate, humiliate, sexualise or defame a real person, or that put words in a public figure’s mouth to mislead people.</li>
          <li>Never upload a photo of a child. Do not use CineXVideo to depict minors in any way that is sexual, suggestive or harmful.</li>
        </ul>

        <h2>7. Content that is never allowed</h2>
        <p>The full rules are in our <Link href="/content-policy">Content Policy</Link>. In short, you may not use CineXVideo to make, upload or ask for:</p>
        <ul>
          <li>Anything that sexualises minors. Zero tolerance: the account is closed and the case is reported to the authorities.</li>
          <li>Nudity, sexual content or sexually suggestive content of anyone, real or fictional, including “artistic” or “implied” nudity.</li>
          <li>Hate speech, harassment, threats, or content that promotes violence against people or groups.</li>
          <li>Graphic gore, cruelty, self-harm encouragement or instructions, or terrorist and violent extremist content.</li>
          <li>Non-consensual likenesses, deceptive deepfakes, fraud, scams, or impersonation.</li>
          <li>Content that infringes someone else’s copyright, trademark, privacy or publicity rights.</li>
          <li>Anything else that is illegal where you live or in {LEGAL.location}.</li>
        </ul>
        <p>Fictional action, drama, strong emotion and explicit song lyrics are allowed; the pictures must still follow these rules.</p>

        <h2>8. Moderation and safety checks</h2>
        <ul>
          <li>We check prompts, uploaded face photos and AI Director requests before anything is made, and we check every still and frames from every take before you see them. These checks are automated, using an AI moderation service.</li>
          <li>If something is blocked before it is made, nothing is charged. If something is blocked after it is made, it is withheld, never shown to you, and your credits are returned.</li>
          <li>Blocked items go to a private review queue, where a trained reviewer at CineXVideo may look at them. Previews stay blurred unless the reviewer needs to see them to make a decision.</li>
          <li>Automated checks are not perfect. If you think something was blocked by mistake, email {mail(LEGAL.safety)} and a person will review it; we will tell you the outcome and the reason.</li>
          <li>Content that may involve child sexual exploitation is preserved, the account is suspended, and we report it as the law requires. That includes reports to the Canadian Centre for Child Protection (Cybertip.ca) and the RCMP under Canada’s mandatory reporting law, and to the National Center for Missing &amp; Exploited Children (NCMEC) in the United States.</li>
        </ul>

        <h2>9. Suspension and closing accounts</h2>
        <ul>
          <li>We may limit, suspend or close an account, and remove content, if you break these terms or the law, if you put other people or CineXVideo at risk, if a payment is reversed or disputed, or if a court or authority requires it.</li>
          <li>Where it is safe and lawful, we will tell you why and give you a chance to respond. Repeated or serious breaches, and anything involving minors, can lead to an immediate, permanent ban.</li>
          <li>You can close your account at any time by contacting {mail(LEGAL.support)}. Download any videos you want to keep first.</li>
          <li>Sections 5 (licence for legally required copies), 10, 11, 12, 13 and 14 survive when an account is closed.</li>
        </ul>

        <h2>10. Copyright complaints</h2>
        <p>If you believe content on CineXVideo infringes your copyright, send a notice to {mail(LEGAL.legal)} with: your contact details; the work you own; where the content is; a statement that you believe in good faith the use is not authorised; and a statement that your notice is accurate and you are the owner or authorised to act for them. We respond to notices under Canada’s notice-and-notice regime and, where it applies, the US Digital Millennium Copyright Act. We close the accounts of repeat infringers. If your content was removed and you believe it was a mistake, you can send a counter-notice to the same address.</p>

        <h2>11. Disclaimers</h2>
        <p>CineXVideo is provided “as is” and “as available”. To the extent the law allows, we do not promise that the service will be uninterrupted or error-free, that AI results will meet your expectations, or that results can be protected by copyright. Nothing in these terms limits rights you have under consumer protection law that cannot be waived, including under Ontario’s Consumer Protection Act, 2002 and the laws of Quebec, the EU or the UK where they apply to you.</p>

        <h2>12. Limits on our liability</h2>
        <p>To the extent the law allows, CineXVideo is not liable for indirect, incidental, special, consequential or punitive damages, or for lost profits, revenue, data or goodwill. Our total liability for any claim about the service is limited to the greater of (a) what you paid us in the 12 months before the claim and (b) US$100. These limits do not apply to liability that cannot be limited by law, such as for fraud, gross negligence, or death or personal injury caused by negligence.</p>

        <h2>13. Your responsibility to us</h2>
        <p>If someone makes a claim against us because of content you uploaded or published, your breach of these terms, or your violation of someone else’s rights, you agree to cover our reasonable losses and costs, including legal fees, to the extent the law allows. We will tell you about the claim and let you take part in the defence.</p>

        <h2>14. Governing law and disputes</h2>
        <p>These terms are governed by the laws of {LEGAL.governingLaw}, without regard to conflict-of-law rules. Disputes go to {LEGAL.courts}, unless the law where you live gives you the right to bring a claim in your local courts or under your local law. Before starting a claim, please contact {mail(LEGAL.legal)} so we can try to fix it together; most issues are resolved this way.</p>

        <h2>15. Changes to these terms</h2>
        <p>We may update these terms as the service and the law change. For important changes we will give you at least 14 days’ notice by email or in the app before they take effect, unless a change is needed sooner for legal or safety reasons. If you keep using CineXVideo after the change takes effect, the new terms apply. If you do not agree, you can stop using the service and close your account.</p>

        <h2>16. General</h2>
        <ul>
          <li>If any part of these terms cannot be enforced, the rest still applies.</li>
          <li>If we do not enforce a term right away, we can still enforce it later.</li>
          <li>You may not transfer these terms. We may transfer them to a company that takes over CineXVideo, and we will tell you if that happens.</li>
          <li>These terms, together with the policies linked above, are the whole agreement between you and us about CineXVideo.</li>
          <li>If there is a conflict between a translation and this English version, the English version applies, unless the law says otherwise.</li>
        </ul>

        <h2>17. Contact</h2>
        <p>{LEGAL.entity}, operating as {LEGAL.service}, {LEGAL.location}. For account help, billing and credits, safety reports and moderation appeals, privacy requests, legal notices and copyright complaints, email {mail(LEGAL.support)}. Please put the topic in the subject line (for example “Safety report” or “Copyright notice”) so it reaches the right person quickly.</p>
      </div>
    </CinexRoutePage>
  );
}
