import { Service } from '@runlith/layer/key';
import type { Surface } from './surface.js';

interface EntryPlace {
  readonly surface: Surface;
  readonly place: string | null;
}

export interface Entry {
  readonly project: string;
  readonly at?: EntryPlace;
}

export class EntryProject extends Service<Entry>()('EntryProject', { tier: 'app' }) {}
