import { paymentFeeCents } from '@/lib/billing/payment-fee-model';
import { MARGIN_POLICY } from '@/lib/billing/margin-policy';

const money = (cents) => `$${(Number(cents || 0) / 100).toFixed(2)}`;

/**
 * Credit packs on sale (from the database) and what each one really nets
 * after Stripe's standard card fee. "Max AI cost per credit" is the most a
 * credit's generation can cost the platform while still clearing the margin
 * floor; pricing must stay under it.
 */
export default function CreditPackSimulator({ packs = [], floorPercent = 65 }) {
  const fee = MARGIN_POLICY.paymentFeeModel;
  return (
    <section className="cinex-economics-section" aria-labelledby="packs-title">
      <h2 id="packs-title">Credit packs: what each sale nets</h2>
      <p>Estimated with Stripe&rsquo;s standard card fee ({fee.variableRateBps / 100}% + {fee.fixedFeeCents}¢). International cards and currency conversion cost more.</p>
      {packs.length ? (
        <div className="cinex-admin-table-wrap">
          <table className="cinex-admin-table">
            <thead>
              <tr>
                <th scope="col">Pack</th>
                <th scope="col">Price</th>
                <th scope="col">Credits</th>
                <th scope="col">Stripe fee</th>
                <th scope="col">Net to platform</th>
                <th scope="col">Net per credit</th>
                <th scope="col">Max AI cost per credit</th>
              </tr>
            </thead>
            <tbody>
              {packs.map((pack) => {
                const feeCents = paymentFeeCents(pack.price_cents, fee);
                const net = pack.price_cents - feeCents;
                const perCredit = pack.credits ? net / pack.credits : 0;
                const maxCost = perCredit * (1 - floorPercent / 100);
                return (
                  <tr key={pack.code}>
                    <td>{pack.name}</td>
                    <td>{money(pack.price_cents)}</td>
                    <td>{Number(pack.credits).toLocaleString()}</td>
                    <td>{money(feeCents)}</td>
                    <td>{money(net)}</td>
                    <td>{perCredit.toFixed(3)}¢</td>
                    <td>{maxCost.toFixed(3)}¢</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p>No credit packs are on sale.</p>
      )}
    </section>
  );
}
