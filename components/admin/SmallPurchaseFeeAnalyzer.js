import { smallPurchaseAnalysis } from '@/lib/billing/payment-fee-model';
import { MARGIN_POLICY } from '@/lib/billing/margin-policy';

const money = (cents) => `$${(Number(cents || 0) / 100).toFixed(2)}`;

/** How Stripe's fixed 30¢ eats into small purchases. Estimate, standard card fee. */
export default function SmallPurchaseFeeAnalyzer() {
  const rows = smallPurchaseAnalysis(undefined, MARGIN_POLICY.paymentFeeModel);
  return (
    <section className="cinex-economics-section" aria-labelledby="fee-drag-title">
      <h2 id="fee-drag-title">Small purchases and Stripe fees</h2>
      <p>The fixed part of the card fee makes small top-ups expensive. This is why the smallest pack is $10.</p>
      <div className="cinex-admin-table-wrap">
        <table className="cinex-admin-table">
          <thead>
            <tr><th scope="col">Purchase</th><th scope="col">Estimated fee</th><th scope="col">Fee rate</th><th scope="col">Platform receives</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.grossCents}>
                <td>{money(row.grossCents)}</td>
                <td>{money(row.feeCents)}</td>
                <td>{(row.feeBps / 100).toFixed(1)}%</td>
                <td>{money(row.netCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
