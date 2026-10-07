import CinexRoutePage from '@/components/CinexRoutePage';
import PayoutSetup from '@/components/payouts/PayoutSetup';

export const metadata = { title: 'Payouts — CineXVideo' };

export default function PayoutsPage() {
  return (
    <CinexRoutePage
      eyebrow="Revenue partners"
      title="Get paid"
      description="Connect a Stripe Express account once and your earnings are sent to your bank in your local currency. Stripe handles your identity and bank details; CineXVideo never sees them."
    >
      <PayoutSetup />
    </CinexRoutePage>
  );
}
