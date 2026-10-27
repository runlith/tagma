import { realpathSync } from 'node:fs';

type Entry = { readonly section: 'uncommitted' | 'unproven' | 'outside'; readonly path: string; readonly from: string | null };
type Checkout = {
  readonly checkout: string;
  readonly root: string;
  readonly state: { readonly kind: string };
  readonly entries: readonly Entry[];
};
type Page = {
  readonly status: string;
  readonly subject?: string;
  readonly checkouts?: readonly Checkout[];
  readonly unattributed?: readonly { readonly checkout: string; readonly path: string }[];
  readonly next?: string | null;
};

export const inSession = (): boolean => process.env['TAGMA_SESSION_GRANT'] !== undefined;

const real = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

export const sessionPaths = (root: string): { readonly session: string; readonly paths: readonly string[] } => {
  const here = real(root);
  const named = '\nName the change instead: --paths-from <file>, --commit <ref> or --base <ref>.';
  const paths = new Set<string>();
  const ids = new Set<string>();
  const unattributed: { readonly checkout: string; readonly path: string }[] = [];
  let session = '';
  let cursor: string | undefined;
  for (;;) {
    const input = cursor === undefined ? { limit: 211 } : { cursor };
    const ran = Bun.spawnSync(['tagma', 'op', 'read_changes', JSON.stringify(input), '--json'], {
      cwd: root,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const said = `${ran.stdout.toString()}${ran.stderr.toString()}`.trim();
    if (ran.exitCode !== 0)
      throw new Error(`check:change reads this session's change from Tagma (tagma op read_changes) and could not: ${said}${named}`);
    const page = JSON.parse(ran.stdout.toString()) as Page;
    if (page.status !== 'ok') throw new Error(`tagma op read_changes answered ${said}${named}`);
    session = page.subject ?? session;
    for (const checkout of page.checkouts ?? []) {
      if (real(checkout.root) !== here) continue;
      if (checkout.state.kind !== 'current')
        throw new Error(
          `Tagma has not finished judging which lines this session holds in ${root} (${JSON.stringify(checkout.state)}), so its change is not known yet; run again once it has.${named}`,
        );
      ids.add(checkout.checkout);
      for (const entry of checkout.entries)
        if (entry.section !== 'outside') {
          paths.add(entry.path);
          if (entry.from !== null) paths.add(entry.from);
        }
    }
    unattributed.push(...(page.unattributed ?? []));
    if (page.next === null || page.next === undefined) break;
    cursor = page.next;
  }
  for (const row of unattributed) if (ids.size === 0 || ids.has(row.checkout)) paths.add(row.path);
  return { session, paths: [...paths].sort() };
};
