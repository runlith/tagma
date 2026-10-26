import { Service } from '@runlith/layer/key';

export interface Entry {
  readonly project: string;
}

export class EntryProject extends Service<Entry>()('EntryProject', { tier: 'app' }) {}
