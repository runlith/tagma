import { Service } from '@runlith/layer/key';
import type { Act } from '$lib/wire/told.js';

export interface OfferPort {
  readonly code: string;
  readonly act: Act;
}

export class Offer extends Service<OfferPort>()('Offer', { tier: 'app' }) {}

export const offeredAct = (offer: OfferPort | undefined, code: string): Act | undefined => (offer?.code === code ? offer.act : undefined);
