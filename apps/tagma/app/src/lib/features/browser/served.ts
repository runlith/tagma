import { Service } from '@runlith/layer/key';

export type ServedAddress = { readonly url: string; readonly label: string };

export type Served = { readonly addresses: readonly ServedAddress[] };

export class ServedAddresses extends Service<Served>()('BrowserServedAddresses', { tier: 'project' }) {}
