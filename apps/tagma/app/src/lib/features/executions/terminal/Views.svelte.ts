import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { TerminalAppearance } from '../appearance/Settings.svelte.js';
import { Terminals } from '../worktrees/Terminals.svelte.js';
import type { TerminalAct } from './Keymap.js';
import { TerminalPane, type PaneGround, type PaneSource } from './Pane.svelte.js';
import { paneAct } from './paneActs.js';
import type { ExecutionAddress } from '../Repo.js';

export type ViewBirth = {
  readonly projectId: number;
  readonly root: string;
  readonly address: ExecutionAddress;
  readonly program: string;
  readonly source?: PaneSource;
};

export type ViewLease = {
  readonly pane: TerminalPane;
  release(): void;
};

const HELD = 6;

type Held = {
  readonly pane: TerminalPane;
  readonly scope: Scope;
  shownAt: number;
  holders: number;
};

export class TerminalViews extends Service<TerminalViews>()('TerminalViews', { tier: 'project' }) {
  static *make() {
    const terminals = yield* Terminals;
    return new TerminalViews(yield* Scope, yield* TerminalAppearance, () => terminals.toggle());
  }

  private readonly held = new Map<string, Held>();
  private clock = 0;

  constructor(
    private readonly scope: Scope,
    private readonly appearance: TerminalAppearance,
    private readonly toggle: () => void,
  ) {
    super();
  }

  pane(key: string): TerminalPane | null {
    return this.held.get(key)?.pane ?? null;
  }

  lease(key: string, birth: ViewBirth): ViewLease {
    const standing = this.held.get(key);
    if (standing !== undefined) return this.hold(standing);
    this.evict(HELD - 1);
    const scope = this.scope.child(`TerminalView:${key}`);
    const pane = TerminalPane.start(scope, { id: key, ground: this.ground(key, birth), program: birth.program });
    const entry: Held = { pane, scope, shownAt: 0, holders: 0 };
    this.held.set(key, entry);
    pane.bind(birth.address, { source: birth.source });
    return this.hold(entry);
  }

  holding(key: string): ViewLease | null {
    const standing = this.held.get(key);
    return standing === undefined ? null : this.hold(standing);
  }

  forget(key: string): void {
    const standing = this.held.get(key);
    if (standing === undefined) return;
    this.held.delete(key);
    void standing.scope.close();
  }

  private hold(entry: Held): ViewLease {
    entry.shownAt = ++this.clock;
    entry.holders += 1;
    let released = false;
    return {
      pane: entry.pane,
      release: () => {
        if (released) return;
        released = true;
        entry.holders -= 1;
        queueMicrotask(() => this.evict(HELD));
      },
    };
  }

  private evict(limit: number): void {
    while (this.held.size > limit) {
      let oldest: string | null = null;
      let at = Number.POSITIVE_INFINITY;
      for (const [key, entry] of this.held) {
        if (entry.holders > 0 || entry.pane.shown || entry.shownAt >= at) continue;
        oldest = key;
        at = entry.shownAt;
      }
      if (oldest === null) return;
      this.forget(oldest);
    }
  }

  private ground(key: string, birth: ViewBirth): PaneGround {
    return {
      projectId: birth.projectId,
      root: birth.root,
      visible: () => this.held.get(key)?.pane.visible ?? false,
      focused: (paneId) => {
        const pane = this.held.get(paneId)?.pane ?? null;
        return pane !== null && pane.chrome().contains(document.activeElement);
      },
      ceiling: () => null,
      noteBell: () => undefined,
      close: () => this.held.get(key)?.pane.dismissEnding(),
      perform: (act, pane) => this.perform(act, pane),
    };
  }

  private perform(act: TerminalAct, pane: TerminalPane): boolean {
    if (paneAct(act, pane, this.appearance)) return true;
    switch (act._tag) {
      case 'toggle-terminals':
        this.toggle();
        return true;
      case 'focus-next':
      case 'focus-previous':
        return false;
      default:
        return true;
    }
  }
}
