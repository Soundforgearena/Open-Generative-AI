import Link from 'next/link';
import CinexRoutePage from '@/components/CinexRoutePage';
import { CATEGORIES, POLICY_VERSION, REVIEW_OUTCOMES } from '@/lib/premieres/content-policy';

export const metadata = { title: 'Content policy — CineXVideo' };

const ACTION_LABEL = {
  reject_and_report: 'Removed, reported, account closed',
  reject: 'Not allowed',
  review: 'Held for human review',
};

export default function ContentPolicyPage() {
  return (
    <CinexRoutePage
      eyebrow="Content policy"
      title="What you can make and share on CineXVideo"
      description="These rules apply to everything made in the Studio (prompts, face photos, AI Director requests, stills, takes and finished videos) and to everything shared on CineX Premieres. There is no explicit content on CineXVideo."
    >
      <div className="cinex-legal">
        <h2>Making videos in the Studio</h2>
        <p>CineXVideo is a clean, all-audiences creative tool. Fictional action, drama, heartbreak, anger, power and explicit song lyrics are all fine. The pictures must always stay within these rules:</p>
        <ul>
          <li><strong>No nudity or sexual content of anyone, ever.</strong> That includes partial or implied nudity, sexual acts, see-through or lingerie-only outfits, and sexualised poses or camera angles. Every visual prompt we send to the AI also tells it that everyone is fully clothed.</li>
          <li><strong>Nothing that sexualises or endangers minors.</strong> Never upload a photo of a child.</li>
          <li><strong>No hate, harassment or threats</strong> against any person or group.</li>
          <li><strong>No graphic gore,</strong> cruelty, or content that encourages or explains self-harm.</li>
          <li><strong>Real faces only with consent</strong> from an adult who agreed, or yourself. No deceptive deepfakes or impersonation.</li>
          <li><strong>Only music and material you have the rights to.</strong></li>
        </ul>
        <h2>How we keep explicit content out</h2>
        <ol>
          <li><strong>Before anything is made:</strong> every prompt, face photo and AI Director request is checked automatically. If it breaks the rules, it is refused and nothing is charged.</li>
          <li><strong>After it is made:</strong> every still, and frames from the start, middle and end of every take, are checked before you see them. Anything that breaks the rules is withheld (never shown to you or put in your project or downloads) and your credits are returned.</li>
          <li><strong>Private review:</strong> blocked items go to a review queue only CineXVideo’s super administrator can open. Previews stay heavily blurred until the reviewer chooses to look, so nobody is exposed to harmful material without need.</li>
          <li><strong>Appeals:</strong> automated checks can make mistakes. Email <a href="mailto:safety@cinexvideo.app">safety@cinexvideo.app</a> and a person will review the decision and tell you the reason.</li>
          <li><strong>Child safety:</strong> anything that may sexualise a minor suspends the account immediately, the evidence is preserved, and it is reported to the authorities (see below).</li>
        </ol>
        <p>Repeated attempts to make content that breaks these rules can lead to the account being closed. See our <Link href="/terms">Terms of Service</Link>.</p>
        <h2>CineX Premieres (coming soon)</h2>
        <p>CineX Premieres will be open to everyone, including younger viewers, so it adds stricter rules for every episode, poster, thumbnail, title and description: when in doubt, it is held for a person to review before anyone sees it. Premieres policy version {POLICY_VERSION}; creators will be told about any change before it takes effect.</p>

        <h2>Premieres: never allowed, or held for review</h2>
        <div className="cinex-admin-table-wrap">
          <table className="cinex-admin-table">
            <thead><tr><th>Content</th><th>What happens</th></tr></thead>
            <tbody>
              {CATEGORIES.map((c) => (
                <tr key={c.key}><td>{c.label}{c.note ? <><br /><small>{c.note}</small></> : null}</td><td>{ACTION_LABEL[c.action]}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>AI-generated content follows exactly the same rules as filmed content. Prompting a model to create nudity, sexual content or revealing imagery is a breach of this policy, even if it is fictional or animated.</p>

        <h2>Premieres: how review works</h2>
        <ol>
          <li><strong>Upload.</strong> You confirm you own or have the rights to everything in the episode and that it follows this policy.</li>
          <li><strong>Automatic scan.</strong> Frames, audio, thumbnails and text are checked for nudity, sexual or suggestive content, violence, hate and signs that a minor may be shown. The thresholds are deliberately strict.</li>
          <li><strong>Human review.</strong> Anything flagged is held. Nothing flagged becomes public until a trained reviewer decides.</li>
          <li><strong>Decision.</strong> The reviewer chooses one of: {REVIEW_OUTCOMES.map((o) => o.label).join('; ')}. You always get a written statement of reasons.</li>
          <li><strong>Appeal.</strong> You can appeal any rejection once. A different reviewer handles it.</li>
        </ol>

        <h2>Reports from viewers</h2>
        <p>Every episode has a Report button. Reports about child safety are handled first, around the clock. Other reports are reviewed as quickly as possible, and the episode may be hidden while it is checked.</p>

        <h2>Strikes</h2>
        <p>Serious or repeated breaches add a strike to the channel. Three strikes close the channel, and earnings from removed episodes are not paid out. Anything sexualising minors closes the account immediately.</p>

        <h2>Child safety</h2>
        <p>We have zero tolerance for child sexual abuse material or any sexualised depiction of minors, real or generated. It is removed immediately, the account is closed, evidence is preserved as the law requires, and it is reported to the appropriate authorities. These include the National Center for Missing &amp; Exploited Children (NCMEC) in the United States and the Canadian Centre for Child Protection (Cybertip.ca) in Canada.</p>

        <h2>Built to meet global rules</h2>
        <p>This policy and the review process are designed around notice-and-action, statements of reasons, appeals and transparency reporting. That includes the EU Digital Services Act, the UK Online Safety Act 2023, Australia’s Online Safety Act 2021, Canada’s law on mandatory reporting of child sexual abuse material, and US federal reporting requirements. Personal data is handled under our <Link href="/privacy">privacy policy</Link>.</p>

        <p>Questions about this policy: <a href="mailto:safety@cinexvideo.app">safety@cinexvideo.app</a></p>
      </div>
    </CinexRoutePage>
  );
}
