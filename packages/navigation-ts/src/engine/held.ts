import { blobOf, cleanBlobsOf, type Hashing, headBlobsOf, LOCKS, type Moved, tracked } from './checkout';

export type Held = {
  readonly accept: (paths: readonly string[], head: string) => Promise<boolean>;
  readonly shift: (moved: Moved) => Promise<readonly string[]>;
  readonly move: (moved: Moved) => Promise<readonly string[]>;
};

export const makeHeld = (root: string, hashing: Hashing, dirty: readonly string[]): Held => {
  let blobs = new Map(dirty.filter(tracked).map((path) => [path, blobOf(root, path, hashing)] as const));

  const shifted = async (moved: Moved) => {
    const drift = new Set(moved.drift);
    const candidates = [...new Set([...blobs.keys(), ...moved.committed.keys(), ...moved.drift])].filter(tracked);
    const checkedOut = await cleanBlobsOf(
      root,
      candidates.filter((path) => !blobs.has(path) && moved.committed.has(path)),
    );
    const paths: string[] = [];
    const next = new Map<string, string | null>();
    for (const path of candidates) {
      const disk = blobOf(root, path, hashing);
      const changed = blobs.has(path)
        ? blobs.get(path) !== disk
        : !moved.committed.has(path) || moved.committed.get(path) !== checkedOut.get(path);
      if (changed) paths.push(path);
      if (drift.has(path)) next.set(path, disk);
    }
    return { paths, next };
  };

  return {
    accept: async (paths, head) => {
      const watched = paths.filter(tracked);
      const fresh = watched.filter((path) => LOCKS.includes(path) && !blobs.has(path));
      const [checkedOut, based] = await Promise.all([cleanBlobsOf(root, fresh), headBlobsOf(root, head, fresh)]);
      let relocked = false;
      for (const path of watched) {
        const disk = blobOf(root, path, hashing);
        if (LOCKS.includes(path)) relocked ||= blobs.has(path) ? blobs.get(path) !== disk : checkedOut.get(path) !== based.get(path);
        blobs.set(path, disk);
      }
      return relocked;
    },
    shift: async (moved) => (await shifted(moved)).paths,
    move: async (moved) => {
      const { paths, next } = await shifted(moved);
      blobs = next;
      return paths;
    },
  };
};
