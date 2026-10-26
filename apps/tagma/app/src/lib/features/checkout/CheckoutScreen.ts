import { Service } from '@runlith/layer/key';

export type ScreenFocus = { readonly mainFocused: boolean };

export class CheckoutScreen extends Service<ScreenFocus>()('CheckoutScreen', { tier: 'app' }) {}
