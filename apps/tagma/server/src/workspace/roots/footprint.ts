import type { IdentityWitness } from '@runlith/files/namespace';
import type { DirectoryFact } from '../contract/service/roots.js';
import type { FileRoot, RootOverlap } from '../contract/wire/roots.js';

type LocatedRoot = { readonly root: FileRoot; readonly fact: DirectoryFact };
type RootsByIdentity = Map<string, Map<string, LocatedRoot>>;

const witnessKey = (witness: IdentityWitness): string => JSON.stringify([witness.provider, witness.format, witness.token]);

export class FootprintIndex {
  private readonly roots = new Map<string, LocatedRoot>();
  private readonly witnesses: RootsByIdentity = new Map();
  private readonly identities: RootsByIdentity = new Map();
  private readonly ancestors: RootsByIdentity = new Map();

  constructor(public revision: number) {}

  add(root: FileRoot, fact: DirectoryFact): void {
    this.remove(root.rootId);
    const located = { root, fact };
    this.roots.set(root.rootId, located);
    this.put(this.witnesses, witnessKey(fact.witness), located);
    this.put(this.identities, fact.key, located);
    for (const ancestor of fact.ancestors) this.put(this.ancestors, ancestor, located);
  }

  remove(rootId: string): void {
    const found = this.roots.get(rootId);
    if (found === undefined) return;
    this.roots.delete(rootId);
    this.drop(this.witnesses, witnessKey(found.fact.witness), rootId);
    this.drop(this.identities, found.fact.key, rootId);
    for (const ancestor of found.fact.ancestors) this.drop(this.ancestors, ancestor, rootId);
  }

  overlaps(fact: DirectoryFact): RootOverlap[] {
    const overlaps = new Map<string, RootOverlap>();
    const add = (rows: Iterable<LocatedRoot>, relation: RootOverlap['relation']): void => {
      for (const { root, fact } of rows) {
        if (!overlaps.has(root.rootId))
          overlaps.set(root.rootId, {
            root,
            resource: { namespaceId: root.namespaceId, path: fact.path },
            relation,
          });
      }
    };
    add(this.witnesses.get(witnessKey(fact.witness))?.values() ?? [], 'equal');
    for (const ancestor of fact.ancestors) add(this.identities.get(ancestor)?.values() ?? [], 'ancestor');
    add(this.ancestors.get(fact.key)?.values() ?? [], 'descendant');
    return [...overlaps.values()].sort((left, right) => (left.root.rootId < right.root.rootId ? -1 : 1));
  }

  private put(index: RootsByIdentity, key: string, root: LocatedRoot): void {
    let standing = index.get(key);
    if (standing === undefined) {
      standing = new Map();
      index.set(key, standing);
    }
    standing.set(root.root.rootId, root);
  }

  private drop(index: RootsByIdentity, key: string, rootId: string): void {
    const standing = index.get(key);
    if (standing === undefined) return;
    standing.delete(rootId);
    if (standing.size === 0) index.delete(key);
  }
}
