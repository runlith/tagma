import { Schema } from 'effect';

export const Absent = Schema.Array(Schema.String).annotate({
  description:
    'Paths the judged tree lacks, each of which ends the violation by appearing alone: its import then resolves to that path, and the inspection finds no crossing at the site. Two of them appearing together promise nothing.',
});
export type Absent = typeof Absent.Type;

export const Site = Schema.Struct({
  line: Schema.Int,
  specifier: Schema.optional(Schema.String),
  chain: Schema.optional(Schema.Array(Schema.String)),
  message: Schema.optional(Schema.String),
  fix: Schema.optional(Schema.String),
});
export type Site = typeof Site.Type;

export const Violation = Schema.Struct({
  fingerprint: Schema.String,
  file: Schema.String,
  line: Schema.Int,
  specifier: Schema.optional(Schema.String),
  chain: Schema.optional(Schema.Array(Schema.String)),
  absent: Schema.optional(Absent),
  message: Schema.optional(
    Schema.String.annotate({
      description:
        'What is wrong at this place, one phrase opening with its verb and without the file (`loads @example/ui`); every reader prints it after the place.',
    }),
  ),
  fix: Schema.optional(
    Schema.String.annotate({
      description:
        "How to remove this one violation, built from the inspection's own data — the door to load instead, the allowance to declare. Absent, readers fall back to the general way out of the function that describes it.",
    }),
  ),
  value: Schema.optional(Schema.Finite),
  sites: Schema.optional(Schema.Array(Site)),
});
export type Violation = typeof Violation.Type;

export const Unjudged = Schema.Struct({
  file: Schema.String,
  line: Schema.Int,
  specifier: Schema.String,
});
export type Unjudged = typeof Unjudged.Type;

export type Debt = { readonly fingerprint: string; readonly count?: number; readonly held?: true };

type Counted = { readonly fingerprint: string; readonly file: string };

type Held = { readonly count: number; readonly held?: true };

export const valuedDuplicate = (violations: readonly { readonly fingerprint: string; readonly value?: number }[]): string | undefined => {
  const seen = new Map<string, boolean>();
  for (const { fingerprint, value } of violations) {
    const was = seen.get(fingerprint);
    if (was === undefined) seen.set(fingerprint, value !== undefined);
    else if (was || value !== undefined) return fingerprint;
  }
  return undefined;
};

export const unitsOf = (sites: readonly Violation[]): readonly Violation[] => {
  const repeated = valuedDuplicate(sites);
  if (repeated !== undefined) throw new Error(`\`${repeated}\` is reported more than once with a value, and a measured key must be unique`);
  const grouped = new Map<string, Violation[]>();
  for (const one of sites) {
    const group = grouped.get(one.fingerprint);
    if (group === undefined) grouped.set(one.fingerprint, [one]);
    else group.push(one);
  }
  return [...grouped.values()].map((group) => {
    const [first, ...rest] = group as [Violation, ...Violation[]];
    if (rest.length === 0) return first;
    const placed = ({ line, specifier, chain, message, fix }: Violation): Site => ({ line, specifier, chain, message, fix });
    return { ...first, sites: group.map(placed) };
  });
};

type Sited = {
  readonly fingerprint: string;
  readonly line?: number;
  readonly specifier?: string;
  readonly chain?: readonly string[];
  readonly message?: string;
  readonly fix?: string;
  readonly sites?: readonly Site[];
};

export const siteRows = <V extends Sited>(units: readonly V[]): readonly V[] =>
  units.flatMap((unit) =>
    unit.sites === undefined
      ? [unit]
      : unit.sites.map(({ line, specifier, chain, message, fix }) => {
          const row: { -readonly [K in keyof V]: V[K] } = { ...unit };
          delete row.sites;
          delete row.specifier;
          delete row.chain;
          return Object.assign(
            row,
            { line },
            specifier === undefined ? {} : { specifier },
            chain === undefined ? {} : { chain },
            message === undefined ? {} : { message },
            fix === undefined ? {} : { fix },
          );
        }),
  );

const heldBy = (violations: readonly Counted[]): ReadonlyMap<string, Held> => {
  const held = new Map<string, Held>();
  for (const { fingerprint } of violations) held.set(fingerprint, { count: (held.get(fingerprint)?.count ?? 0) + 1 });
  return held;
};

const owedBy = (debt: readonly (string | Debt)[]): ReadonlyMap<string, Held> =>
  new Map(
    debt.map((one): [string, Held] =>
      typeof one === 'string' ? [one, { count: 1 }] : [one.fingerprint, { count: one.count ?? 1, held: one.held }],
    ),
  );

const NOTHING_HELD: Held = { count: 0 };

export type Counting<V> = { readonly violations: readonly V[]; readonly occurrences: readonly V[]; readonly standing: readonly V[] };

export const newViolations = <V extends Counted>(
  built: readonly V[],
  base: readonly V[],
  debt: readonly (string | Debt)[],
  how: { readonly covers?: (file: string) => boolean } = {},
): Counting<V> => {
  const standing = heldBy(base);
  const owed = owedBy(debt);
  const met = new Map<string, number>();
  const over = new Set<string>();
  const violations = built.filter((one) => {
    const nth = (met.get(one.fingerprint) ?? 0) + 1;
    met.set(one.fingerprint, nth);
    const owing = owed.get(one.fingerprint);
    const allowed = standing.get(one.fingerprint) ?? (owing?.held !== true && how.covers?.(one.file) === true ? NOTHING_HELD : owing);
    if (allowed === undefined) return true;
    if (nth <= allowed.count) return false;
    if (allowed.count > 0) over.add(one.fingerprint);
    return true;
  });
  const counted = (one: V): boolean => over.has(one.fingerprint);
  return { violations, occurrences: over.size === 0 ? [] : built.filter(counted), standing: over.size === 0 ? [] : base.filter(counted) };
};

export const Followed = Schema.Struct({ from: Schema.String, to: Schema.String });
export type Followed = typeof Followed.Type;

export const Verdict = Schema.Struct({
  violations: Schema.Array(Violation),
  unjudged: Schema.Array(Unjudged),
  followed: Schema.optional(Schema.Array(Followed)),
  occurrences: Schema.optional(Schema.Array(Violation)),
  baseOccurrences: Schema.optional(Schema.Array(Violation)),
});
export type Verdict = typeof Verdict.Type;
