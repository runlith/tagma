import type { Tree } from '@runlith/code-facts/tree';
import { type BuiltinId, PACKS, type PackId, packOf, used } from './builtins';
import type { ImplementationsOf } from './core/node/reading';
import { register } from './core/node/registry';
import { projectFacts } from './core/node/usage';

type PackOf<K extends PackId> = Extract<(typeof PACKS)[number], { readonly id: K }>;

type Door<K extends PackId> = () => Promise<{ readonly implementations: ImplementationsOf<PackOf<K>> }>;

const DOORS: { readonly [K in PackId]: Door<K> } = {
  architecture: () => import('./packs/architecture/implementations'),
  js: () => import('./packs/js/implementations'),
  effect: () => import('./packs/effect/implementations'),
};

const loading = new Map<PackId, Promise<void>>();

const load = <K extends PackId>(id: K): Promise<void> => {
  const pack = PACKS.find((one) => one.id === id) as PackOf<K>;
  return (DOORS[id] as Door<K>)().then(({ implementations }) => register(pack, implementations));
};

export const ready = (id: BuiltinId): Promise<void> => {
  const pack = packOf(id);
  const held = loading.get(pack);
  if (held !== undefined) return held;
  const loaded = load(pack).catch((error: unknown) => {
    loading.delete(pack);
    throw error;
  });
  loading.set(pack, loaded);
  return loaded;
};

export const usedPacks = (tree: Tree): readonly PackId[] => used(projectFacts(tree));
