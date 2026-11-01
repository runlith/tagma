import { Service } from '@runlith/layer/key';
import { KeyedClaims } from '$lib/shared/Claims.svelte.js';
import type { Terminals } from '../worktrees/Terminals.svelte.js';

export class TerminalTabs extends Service<TerminalTabs>()('TerminalTabs', { tier: 'app' }) {
  static make(): TerminalTabs {
    return new TerminalTabs();
  }

  private readonly projects = new KeyedClaims<number, Terminals>();

  attach(projectId: number, terminals: Terminals): () => void {
    return this.projects.take(projectId, terminals);
  }

  get all(): readonly Terminals[] {
    return [...this.projects.entries()].map(([, terminals]) => terminals);
  }

  of(projectId: number): Terminals | undefined {
    return this.projects.get(projectId);
  }
}
