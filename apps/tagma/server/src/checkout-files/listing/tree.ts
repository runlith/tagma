import type { CheckoutShift } from '../../workspace/contract/service/watch.js';
import type { TreeFrame } from '../contract/wire/directory.js';

const parentOf = (path: string): string => {
  const at = path.lastIndexOf('/');
  return at === -1 ? '' : path.slice(0, at);
};

export const framesOf = (shift: CheckoutShift, graphDirectory: string): TreeFrame | null => {
  if (shift.rescan !== null) return { kind: 'rescan', reason: shift.rescan };
  const dirs = new Set<string>();
  for (const [path, move] of shift.paths) {
    if (move !== 'rename') continue;
    if (path === graphDirectory || path.startsWith(`${graphDirectory}/`)) continue;
    dirs.add(parentOf(path));
  }
  return dirs.size === 0 ? null : { kind: 'dirs', dirs: [...dirs] };
};
