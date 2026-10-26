import type { HeldScope, MountedApp } from '@runlith/layer/App';
import type { KeyClass } from '@runlith/layer/key';
import type { Scope } from '@runlith/layer/Scope';
import { ThreadRung } from '$lib/features/workspace/ThreadRung.js';

export class ThreadLease {
  private readonly held: HeldScope;

  constructor(
    private readonly app: MountedApp,
    readonly threadId: string,
    slot: Scope,
  ) {
    this.held = app.hold(ThreadRung, { id: threadId }, slot);
  }

  get<Self>(key: KeyClass<string, Self>): Self {
    return this.app.resolve(key, this.held.scope);
  }

  find<Self>(key: KeyClass<string, Self>): Self | undefined {
    return this.app.find(key, this.held.scope) as Self | undefined;
  }

  release(): void {
    this.held.release();
  }
}
