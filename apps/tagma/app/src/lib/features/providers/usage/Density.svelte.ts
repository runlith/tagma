import { Platform, type PlatformStorage } from '@runlith/layer/Platform';
import { Service } from '@runlith/layer/key';

export type RosterDensity = 'detailed' | 'compact';

export const ROSTER_DENSITIES: readonly RosterDensity[] = ['detailed', 'compact'];

export function isRosterDensity(value: unknown): value is RosterDensity {
  return value === 'detailed' || value === 'compact';
}

const USAGE_DENSITY_KEY = 'tagma.usageDensity';

export class UsageDensity extends Service<UsageDensity>()('UsageDensity', { tier: 'app' }) {
  static *make() {
    const platform = yield* Platform;
    return new UsageDensity(platform.storage.local);
  }

  density = $state<RosterDensity>('detailed');

  constructor(private readonly storage: PlatformStorage) {
    super();
    const stored = storage.getItem(USAGE_DENSITY_KEY);
    this.density = isRosterDensity(stored) ? stored : 'detailed';
  }

  set(density: RosterDensity): void {
    this.density = density;
    this.storage.setItem(USAGE_DENSITY_KEY, density);
  }
}
