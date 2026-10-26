import { Layer } from '../../Layer.js';
import { Config, probe, Search, type SearchPort } from './deferred-fixtures.js';

probe.loaded += 1;

class Engine implements SearchPort {
  readonly serial: number;

  constructor(private readonly config: Config) {
    probe.built += 1;
    this.serial = probe.built;
  }

  find(query: string): string {
    return `${this.config.prefix}:${query}#${this.serial}`;
  }
}

export default Layer.provide(Search, function* () {
  return new Engine(yield* Config);
});
