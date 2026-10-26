export const ROOT_REFUSALS = ['root-missing', 'root-unavailable', 'root-replaced', 'root-inconclusive'] as const;

export type RootRefusal = (typeof ROOT_REFUSALS)[number];

export const COVERAGE_REFUSALS = ['coverage-unestablished', 'coverage-moved', 'coverage-registry', 'coverage-foreign-namespace'] as const;

export const REPOSITORY_REFUSALS = [
  'repository-missing',
  'repository-moved',
  'repository-replaced',
  'repository-inconclusive',
  'repository-unavailable',
  'repository-unborn',
] as const;

export const PLACE_REFUSALS = ['not-found', ...COVERAGE_REFUSALS, ...ROOT_REFUSALS, ...REPOSITORY_REFUSALS] as const;

export type PlaceRefusal = (typeof PLACE_REFUSALS)[number];
