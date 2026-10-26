const KIB = 1024;

const FOOTPRINT = /phys_footprint:\s+(\d+) B/g;

const output = async (command: readonly string[]): Promise<string> => {
  const child = Bun.spawn([...command], { stdout: 'pipe', stderr: 'ignore' });
  const [out, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  if (code !== 0) throw new Error(`${command[0]} exited with ${code}`);
  return out;
};

const treeOf = (listing: string, root: number): ReadonlyMap<number, number> => {
  const children = new Map<number, number[]>();
  const sizes = new Map<number, number>();
  for (const line of listing.split('\n')) {
    const [pid, parent, rss] = line.trim().split(/\s+/).map(Number);
    if (pid === undefined || parent === undefined || rss === undefined || ![pid, parent, rss].every(Number.isFinite)) continue;
    sizes.set(pid, rss * KIB);
    children.set(parent, [...(children.get(parent) ?? []), pid]);
  }
  const tree = new Map<number, number>();
  const walk = [root];
  while (walk.length > 0) {
    const pid = walk.pop() ?? root;
    tree.set(pid, sizes.get(pid) ?? 0);
    walk.push(...(children.get(pid) ?? []));
  }
  return tree;
};

const footprint = process.platform === 'darwin' ? Bun.which('footprint') : null;

export const memoryOf = async (root: number): Promise<number> => {
  const tree = treeOf(await output(['ps', '-A', '-o', 'pid=,ppid=,rss=']), root);
  if (footprint !== null) {
    const charged = await output([footprint, '-f', 'bytes', '--noCategories', ...[...tree.keys()].flatMap((pid) => ['-p', String(pid)])]);
    const found = [...charged.matchAll(FOOTPRINT)].map((match) => Number(match[1]));
    if (found.length > 0) return found.reduce((sum, bytes) => sum + bytes, 0);
  }
  return [...tree.values()].reduce((sum, bytes) => sum + bytes, 0);
};
