import { getSetting } from '../cinexvideo-server';
import { PAYMENT_MODE_SETTING, resolvePaymentMode } from './payment-mode.js';

/** Current customer payment mode ('test' sandbox or 'live'). */
export async function currentPaymentMode() {
  return resolvePaymentMode(await getSetting(PAYMENT_MODE_SETTING));
}
