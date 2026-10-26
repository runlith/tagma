import type { LiveDeclaration } from '../../../platform/contract/service/manifest.js';
import type { CHECKOUT_FEED } from '../wire/checkout.js';
import type { CheckoutPlaces, CheckoutRows } from './checkouts.js';

export type CheckoutLive = LiveDeclaration<readonly [typeof CHECKOUT_FEED], CheckoutPlaces | CheckoutRows>;
