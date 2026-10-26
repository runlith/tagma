import { Data } from 'effect';

export type ToolGrantSource = {
  readonly source: string;
  readonly tools?: readonly string[];
  readonly narrowable?: true;
  readonly standing?: true | readonly string[];
};

export type ToolGrant = {
  readonly sources: readonly ToolGrantSource[];
  readonly deny?: readonly string[];
};

export type CatalogDefinition = {
  readonly grant: ToolGrant;
};

export type CatalogProfile = {
  readonly sources?: readonly string[];
  readonly tools?: readonly string[];
};

export type StaticContribution<T> = {
  readonly source: string;
  readonly tools: Readonly<Record<string, T>>;
};

export type DerivedContribution<T> = {
  readonly source: string;
  derive(admitted: Readonly<Record<string, T>>): Readonly<Record<string, T>>;
};

export type DeclinedContribution = {
  readonly source: string;
  readonly declined: readonly string[];
};

export type CatalogContribution<T> = StaticContribution<T> | DerivedContribution<T> | DeclinedContribution;

export type CatalogSupply<T> = {
  readonly contributions: readonly CatalogContribution<T>[];
  readonly profile: CatalogProfile;
};

export type CatalogDenial = { readonly rule: string };

export type CatalogVerdicts = (name: string) => CatalogDenial | null;

export type WithheldReason = 'denied' | 'denied-by-policy' | 'not-granted' | 'not-in-profile';

export type Withheld = {
  readonly name: string;
  readonly reason: WithheldReason;
};

export type ResolvedCatalog<T> = {
  readonly catalog: Readonly<Record<string, T>>;
  readonly withheld: readonly Withheld[];
};

export class CatalogNameCollision extends Data.TaggedError('CatalogNameCollision')<{
  readonly message: string;
  readonly tool: string;
  readonly first: string;
  readonly second: string;
}> {
  constructor(tool: string, first: string, second: string) {
    super({ message: `Duplicate agent tool: ${tool}, offered by both ${first} and ${second}.`, tool, first, second });
    this.name = 'CatalogNameCollision';
  }
}

export const noVerdicts: CatalogVerdicts = () => null;

export function offeredSources(definition: CatalogDefinition, profile: CatalogProfile): ReadonlySet<string> {
  const narrowing = profile.sources === undefined ? undefined : new Set(profile.sources);
  const offered = new Set<string>();
  for (const entry of definition.grant.sources) {
    if (!narrowedOut(entry, narrowing)) offered.add(entry.source);
  }
  return offered;
}

export function admits(definition: CatalogDefinition, profile: CatalogProfile, source: string, name: string): boolean {
  return gateOf(definition, profile, noVerdicts)(source, name, false) === null;
}

function narrowedOut(entry: ToolGrantSource, narrowing: ReadonlySet<string> | undefined): boolean {
  return entry.narrowable === true && narrowing !== undefined && !narrowing.has(entry.source);
}

type GrantEntry = {
  readonly entry: ToolGrantSource;
  readonly names: ReadonlySet<string> | undefined;
  readonly standing: true | ReadonlySet<string> | undefined;
};

function gateOf(
  definition: CatalogDefinition,
  profile: CatalogProfile,
  verdicts: CatalogVerdicts,
): (source: string, name: string, derived: boolean) => WithheldReason | null {
  const denied = new Set(definition.grant.deny ?? []);
  const narrowing = profile.sources === undefined ? undefined : new Set(profile.sources);
  const named = profile.tools === undefined ? undefined : new Set(profile.tools);
  const entries = new Map<string, GrantEntry[]>();
  for (const entry of definition.grant.sources) {
    const held = entries.get(entry.source) ?? [];
    held.push({
      entry,
      names: entry.tools === undefined ? undefined : new Set(entry.tools),
      standing: entry.standing === undefined || entry.standing === true ? entry.standing : new Set(entry.standing),
    });
    entries.set(entry.source, held);
  }
  return (source, name, derived) => {
    if (denied.has(name)) return 'denied';
    if (verdicts(name) !== null) return 'denied-by-policy';
    const granted = entries.get(source)?.find((held) => held.names === undefined || held.names.has(name));
    if (granted === undefined) return 'not-granted';
    if (narrowedOut(granted.entry, narrowing)) return 'not-in-profile';
    const exempt = granted.standing === true || granted.standing?.has(name) === true;
    if (!derived && !exempt && named !== undefined && !named.has(name)) return 'not-in-profile';
    return null;
  };
}

export function resolveCatalog<T>(
  definition: CatalogDefinition,
  profile: CatalogProfile,
  contributions: readonly CatalogContribution<T>[],
  verdicts: CatalogVerdicts = noVerdicts,
): ResolvedCatalog<T> {
  const gate = gateOf(definition, profile, verdicts);
  const catalog: Record<string, T> = {};
  const owners = new Map<string, string>();
  const withheld: Withheld[] = [];
  const offer = (source: string, tools: Readonly<Record<string, T>>, derived: boolean): void => {
    for (const [name, tool] of Object.entries(tools)) {
      const reason = gate(source, name, derived);
      if (reason !== null) {
        withheld.push({ name, reason });
        continue;
      }
      const owner = owners.get(name);
      if (owner !== undefined) throw new CatalogNameCollision(name, owner, source);
      owners.set(name, source);
      catalog[name] = tool;
    }
  };
  const pool: Record<string, T> = {};
  for (const contribution of contributions) {
    if ('declined' in contribution) {
      for (const name of contribution.declined) {
        const reason = gate(contribution.source, name, false);
        if (reason !== null) withheld.push({ name, reason });
      }
    } else if ('tools' in contribution) {
      offer(contribution.source, contribution.tools, false);
      Object.assign(pool, contribution.tools);
    }
  }
  for (const contribution of contributions) {
    if (!('derive' in contribution)) continue;
    const derived = contribution.derive({ ...catalog });
    offer(contribution.source, derived, true);
    if (Object.keys(derived).length > 0) continue;
    for (const name of Object.keys(contribution.derive(pool))) {
      const reason = gate(contribution.source, name, true);
      if (reason !== null) withheld.push({ name, reason });
    }
  }
  return { catalog: Object.freeze(catalog), withheld };
}
