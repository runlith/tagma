import type { LanguageId } from '@runlith/code-facts/languages';
import { idsOf } from './languages';
import {
  type Applied,
  type Envelope,
  type ModuleMap,
  type List,
  type Pack,
  type ProjectFacts,
  relocated,
  type Rule,
  type Showing,
  usedBy,
} from './rule';

type RuleIn<Packs extends readonly Pack[]> = Packs[number]['rules'][number];

type ParamsOf<R> = R extends { readonly params: { readonly Type: infer P } } ? P : never;

type EncodedParamsOf<R> = R extends { readonly params: { readonly Encoded: infer P } } ? P : never;

export type RunOf<R> = R extends { readonly map: (...args: never) => unknown } ? ParamsOf<R> & { readonly map: ModuleMap } : ParamsOf<R>;

export type RulesOf<Packs extends readonly Pack[]> = { readonly [R in RuleIn<Packs> as R['id']]: R };

export type InspectionOf<Packs extends readonly Pack[]> = {
  readonly [R in RuleIn<Packs> as R['id']]: { readonly builtin: R['id']; readonly params: ParamsOf<R> };
}[RuleIn<Packs>['id']];

export type EncodedInspectionOf<Packs extends readonly Pack[]> = {
  readonly [R in RuleIn<Packs> as R['id']]: { readonly builtin: R['id']; readonly params: EncodedParamsOf<R> };
}[RuleIn<Packs>['id']];

export type AssembledOf<Packs extends readonly Pack[]> = {
  readonly [R in RuleIn<Packs> as R['id']]: { readonly builtin: R['id']; readonly params: RunOf<R> };
}[RuleIn<Packs>['id']];

export class UnknownRule extends Error {
  constructor(readonly id: string) {
    super(`no pack declares the rule ${id}`);
    this.name = 'UnknownRule';
  }
}

export const catalogOf = <const Packs extends readonly Pack[]>(packs: Packs) => {
  type Id = RuleIn<Packs>['id'];
  type PackId = Packs[number]['id'];
  type Stored = InspectionOf<Packs> & Applied;
  type Run = AssembledOf<Packs> & Applied;
  const owners = new Map<string, { readonly rule: Rule; readonly pack: Pack }>();
  for (const pack of packs) {
    const missing = (pack.requires ?? []).find((required) => !packs.some((one) => one.id === required));
    if (missing !== undefined) throw new Error(`the pack ${pack.id} requires ${missing}, which this composition does not hold`);
    for (const rule of pack.rules) {
      const held = owners.get(rule.id);
      if (held !== undefined) throw new Error(`the rule ${rule.id} is declared by both ${held.pack.id} and ${pack.id}`);
      if (rule.sliced === true && (rule.envelope === undefined || rule.relevant === undefined)) {
        throw new Error(
          `the rule ${rule.id} is judged in slices, so it declares the envelope a slice is bounded by and which changed paths are relevant to it`,
        );
      }
      owners.set(rule.id, { rule, pack });
    }
  }
  const usedOf = (facts: ProjectFacts): ReadonlySet<string> => {
    const used = new Set<string>();
    const pending = packs.filter((pack) => usedBy(pack, facts)).map((pack) => pack.id);
    for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
      if (used.has(id)) continue;
      used.add(id);
      pending.push(...(packs.find((pack) => pack.id === id)?.requires ?? []));
    }
    return used;
  };
  const ownerOf = (id: string) => {
    const held = owners.get(id);
    if (held === undefined) throw new UnknownRule(id);
    return held;
  };
  const declared = (id: string): Rule<unknown, unknown> => ownerOf(id).rule as unknown as Rule<unknown, unknown>;
  return {
    packs,
    ids: [...owners.keys()] as readonly Id[],
    rules: Object.fromEntries([...owners].map(([id, { rule }]) => [id, rule])) as RulesOf<Packs>,
    packOf: (id: Id): PackId => ownerOf(id).pack.id as PackId,
    listsOf: (id: Id): readonly List[] => ownerOf(id).rule.lists ?? [],
    describe: (inspection: Stored): string => declared(inspection.builtin).describe(inspection.params),
    takesMap: (inspection: Stored): boolean => ownerOf(inspection.builtin).rule.map !== undefined,
    mapProblem: (inspection: Stored, map: ModuleMap): string | undefined => declared(inspection.builtin).map?.(inspection.params, map),
    assembled: (inspection: Stored, map: ModuleMap): Run =>
      (ownerOf(inspection.builtin).rule.map === undefined
        ? inspection
        : { builtin: inspection.builtin, params: { ...inspection.params, map } }) as Run,
    shows: (inspection: Run): Showing => {
      const rule = declared(inspection.builtin);
      const shown = rule.shows(inspection.params);
      return { concern: shown.concern ?? rule.concern, figures: shown.figures };
    },
    relevant: (inspection: Run, path: string): boolean => declared(inspection.builtin).relevant?.(inspection.params, path) ?? false,
    follows: (inspection: Run, fingerprint: string): boolean =>
      declared(inspection.builtin).follows?.(inspection.params, fingerprint) ?? false,
    relocated: (inspection: Run, fingerprint: string, from: string, to: string): string | undefined =>
      relocated(inspection, fingerprint, from, to),
    modulesRenamed: (inspection: Run, fingerprint: string, renamed: ReadonlyMap<string, string>): string | undefined =>
      ownerOf(inspection.builtin).rule.modulesRenamed?.(fingerprint, renamed),
    sliceable: (inspection: Run): boolean => ownerOf(inspection.builtin).rule.sliced === true,
    languagesOf: (id: Id): readonly LanguageId[] => idsOf(ownerOf(id).rule.languages),
    envelopeOf: (id: Id): Envelope | undefined => ownerOf(id).rule.envelope,
    used: (facts: ProjectFacts): readonly PackId[] => {
      const used = usedOf(facts);
      return packs.filter((pack) => used.has(pack.id)).map((pack) => pack.id as PackId);
    },
  };
};
