import { paymentFeeCents } from './payment-fee-model';

export function compareGateways(amounts = [500, 1000, 2500, 5000, 10000, 25000], gateways = []) {
  return gateways.map((gateway) => ({ ...gateway, amounts: amounts.map((grossCents) => { const feeCents = paymentFeeCents(grossCents, gateway); return { grossCents, feeCents, netCents: grossCents - feeCents, effectiveFeeBps: Math.round((feeCents * 10000) / grossCents) }; }) }));
}
