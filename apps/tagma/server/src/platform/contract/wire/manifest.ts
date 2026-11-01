import type { FeedDeclaration, OperationDeclaration } from './operation.js';

export type RefusalWords = Readonly<Record<string, string>>;

export type OperationSet = {
  readonly declarations: Readonly<Record<string, OperationDeclaration>>;
  readonly journaled?: readonly string[];
  readonly refusals?: RefusalWords;
};

export type WireModule = {
  readonly id: string;
  readonly title?: string;
  readonly journaled?: true;
  readonly operations?: () => Promise<OperationSet>;
  readonly feeds?: readonly FeedDeclaration[];
};

export const journaledOf = (journaled: true | undefined, set: OperationSet): ReadonlySet<string> =>
  new Set(journaled === true ? Object.keys(set.declarations) : (set.journaled ?? []));

type Declarations<Modules extends readonly WireModule[]> = Modules[number] extends infer Module
  ? Module extends { readonly operations: () => Promise<infer Set extends OperationSet> }
    ? Set['declarations']
    : never
  : never;
type Keys<Union> = Union extends unknown ? keyof Union : never;
type Value<Union, Key extends PropertyKey> = Union extends unknown ? (Key extends keyof Union ? Union[Key] : never) : never;

export type MergedDeclarations<Groups extends readonly Readonly<Record<string, OperationDeclaration>>[]> = {
  readonly [Key in Keys<Groups[number]>]: Value<Groups[number], Key>;
};

export class OperationGroupConflict extends Error {
  constructor(readonly id: string) {
    super(`The operation ${id} is declared by more than one group.`);
    this.name = 'OperationGroupConflict';
  }
}

export const mergeOperations = <const Groups extends readonly Readonly<Record<string, OperationDeclaration>>[]>(
  ...groups: Groups
): MergedDeclarations<Groups> => {
  const declarations: Record<string, OperationDeclaration> = {};
  const ids = new Set<string>();
  for (const group of groups) {
    for (const [key, declaration] of Object.entries(group)) {
      if (ids.has(declaration.id)) throw new OperationGroupConflict(declaration.id);
      ids.add(declaration.id);
      declarations[key] = declaration;
    }
  }
  return declarations as MergedDeclarations<Groups>;
};

export type CollectedDeclarations<Modules extends readonly WireModule[]> = {
  readonly [Key in Keys<Declarations<Modules>>]: Value<Declarations<Modules>, Key>;
};

export type FeedOf<Modules extends readonly WireModule[]> = Modules[number] extends infer Module
  ? Module extends { readonly feeds: readonly (infer Feed extends FeedDeclaration)[] }
    ? Feed
    : never
  : never;

export type CollectedFeeds<Modules extends readonly WireModule[]> = {
  readonly [Feed in FeedOf<Modules> as Feed['id']]: Feed;
};

export type DeclaredCatalog<Modules extends readonly WireModule[]> = {
  readonly declarations: CollectedDeclarations<Modules>;
  readonly ownedBy: (module: Modules[number]['id']) => readonly string[];
};

const NO_OPERATIONS: OperationSet = { declarations: {} };

export const declarationsOf = <const Modules extends readonly WireModule[]>(modules: Modules): Promise<DeclaredCatalog<Modules>> =>
  Promise.all(
    modules.map(async (module) => ({ module, set: module.operations === undefined ? NO_OPERATIONS : await module.operations() })),
  ).then((loaded) => {
    const owned = new Map<string, string[]>();
    const owners = new Map<string, string>();
    for (const { module, set } of loaded) {
      const ids = Object.keys(set.declarations);
      for (const id of ids) {
        const owner = owners.get(id);
        if (owner !== undefined) throw new Error(`The operation ${id} is declared by both ${owner} and ${module.id}.`);
        owners.set(id, module.id);
      }
      owned.set(module.id, ids);
    }
    return {
      declarations: Object.assign({}, ...loaded.map(({ set }) => set.declarations)) as CollectedDeclarations<Modules>,
      ownedBy: (module) => owned.get(module) ?? [],
    };
  });
