import { Service } from '@runlith/layer/key';

export type StandingRun = {
  readonly key: string;
  readonly kind: 'terminal' | 'command';
  readonly what: string;
  readonly holder: string | null;
};

export type StandingInPlace = { readonly runs: readonly StandingRun[]; readonly idle: number };

export const NOTHING_STANDS: StandingInPlace = { runs: [], idle: 0 };

export const stands = (standing: StandingInPlace): boolean => standing.runs.length > 0 || standing.idle > 0;

export const unseen = (seen: StandingInPlace, now: StandingInPlace): boolean => {
  if (stands(now) && !stands(seen)) return true;
  const shown = new Set(seen.runs.map((run) => run.key));
  return now.runs.some((run) => !shown.has(run.key));
};

export class PlaceStanding extends Service<PlaceStanding>()('PlaceStanding', { tier: 'project' }) {
  static make(): PlaceStanding {
    return new PlaceStanding(() => Promise.resolve(NOTHING_STANDS));
  }

  constructor(private readonly reading: (rootId: string) => Promise<StandingInPlace>) {
    super();
  }

  read(rootId: string): Promise<StandingInPlace> {
    return this.reading(rootId);
  }
}
