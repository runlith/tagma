import type { TreeMovement, TreeShift } from '../../platform/watch/tree.js';
import type { CheckoutShift, PathMove, ShiftRescan } from '../contract/service/watch.js';

export class Pending {
  private movements = new Set<TreeMovement>();

  private paths = new Map<string, PathMove>();

  private rescan: ShiftRescan | null = null;

  constructor(private readonly limit: number) {}

  add(shift: TreeShift): void {
    const rescan = 'rescan' in shift ? shift.rescan : null;
    if (rescan === 'opened') return;
    this.movements.add(shift.movement);
    if (rescan !== null && rescan !== 'rename') {
      this.widen(rescan);
      return;
    }
    if (shift.movement === 'tree') this.name(shift.paths ?? [], 'rescan' in shift ? 'rename' : 'change');
  }

  reopened(): void {
    this.movements.add('tree');
    this.widen('reopened');
  }

  take(): CheckoutShift | null {
    if (this.movements.size === 0) return null;
    const taken: CheckoutShift = { movements: [...this.movements], paths: this.paths, rescan: this.rescan };
    this.movements = new Set();
    this.paths = new Map();
    this.rescan = null;
    return taken;
  }

  get waiting(): boolean {
    return this.movements.size > 0;
  }

  private name(paths: readonly string[], move: PathMove): void {
    if (this.rescan !== null) return;
    for (const path of paths) if (move === 'rename' || this.paths.get(path) !== 'rename') this.paths.set(path, move);
    if (this.paths.size > this.limit) this.widen('overflow');
  }

  private widen(reason: ShiftRescan): void {
    this.rescan ??= reason;
    this.paths = new Map();
  }
}
