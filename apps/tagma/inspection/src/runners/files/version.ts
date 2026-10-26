export const versionProblem = (tool: string, found: string, minimum: string): string | null =>
  Bun.semver.satisfies(found, found) && Bun.semver.order(found, minimum) >= 0
    ? null
    : `${tool} requires version ${minimum} or newer; found ${found}`;
