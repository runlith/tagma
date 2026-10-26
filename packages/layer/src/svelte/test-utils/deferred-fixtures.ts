import { Service } from '../../key.js';
import { Layer } from '../../Layer.js';

export const probe = { loaded: 0, built: 0 };

export interface SearchPort {
  find(query: string): string;
}

export class Search extends Service<SearchPort>()('Search', { tier: 'visitor', deferred: true }) {}

export const SearchLive = Layer.load(Search, () => import('./deferred-heavy.js'));

export class Config extends Service<Config>()('Config', { tier: 'app' }) {
  constructor(readonly prefix: string) {
    super();
  }
}
