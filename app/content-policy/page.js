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
      title="What can premiere on CineXVideo"
      description="CineX Premieres is open to everyone, including younger viewers. These rules apply to every episode, poster, thumbnail, title and description. When in doubt, it is held for a person to review before anyone sees it."
    >
      <div className="cinex-legal">
        <p><strong>Version {POLICY_VERSION}.</strong> CineX Premieres is coming soon. This policy will be reviewed by legal counsel before launch and may change; creators will be told about any change before it takes effect.</p>

        <h2>Never allowed, or held for review</h2>
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

        <h2>How review works</h2>
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
