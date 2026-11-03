export type ManifestRevision = { readonly root: string; readonly key: string };

type Held<Value> = { readonly key: string; readonly value: Value };

export const makeVersionWindow = <Value>() => {
  const versions = new Map<string, Held<Value>>();
  const retain = (revision: ManifestRevision, held: Held<Value>): void => {
    versions.delete(revision.root);
    versions.set(revision.root, held);
    if (versions.size > 2) versions.delete(versions.keys().next().value!);
  };
  return {
    get: (revision: ManifestRevision): Value | undefined => {
      const held = versions.get(revision.root);
      if (held === undefined) return undefined;
      if (held.key !== revision.key) {
        versions.delete(revision.root);
        return undefined;
      }
      retain(revision, held);
      return held.value;
    },
    set: (revision: ManifestRevision, value: Value): void => retain(revision, { key: revision.key, value }),
  };
};
