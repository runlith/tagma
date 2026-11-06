import { Context, type Effect, type Scope, type Stream } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { Emulation, Viewport } from '../wire/emulation.js';
import type { PageId } from '../wire/ids.js';
import type { ActionRun } from '../wire/pageOperations.js';
import type { Glance } from '../wire/page.js';
import type { Picked } from '../wire/pick.js';
import type { ConsoleEntry, ConsoleLevel, NetworkEntry } from '../wire/rows.js';
import type { Navigation } from '../wire/host.js';
import type { PageRefusal } from './pages.js';
import type { HeapCaptured } from '../wire/heap.js';
import type { Audited } from '../wire/audit.js';

export type Aim = { readonly ref: string } | { readonly x: number; readonly y: number };

export type Action =
  | { readonly kind: 'click' | 'double-click' | 'hover' | 'focus' | 'check' | 'uncheck'; readonly aim: Aim }
  | { readonly kind: 'fill'; readonly aim: Aim | null; readonly text: string }
  | { readonly kind: 'type'; readonly aim: Aim | null; readonly text: string }
  | { readonly kind: 'press'; readonly aim: Aim | null; readonly key: string }
  | { readonly kind: 'select'; readonly aim: Aim; readonly values: readonly string[] }
  | { readonly kind: 'scroll'; readonly aim: Aim | null; readonly dx: number; readonly dy: number }
  | { readonly kind: 'drag'; readonly aim: Aim; readonly to: Aim }
  | { readonly kind: 'upload'; readonly aim: Aim; readonly files: readonly string[] };

export type PlannedAction = Action | GateRefusal<'action-shape'>;

export type DriveRefusal =
  | PageRefusal
  | 'page-unresponsive'
  | 'page-crashed'
  | 'devtools-open'
  | 'dialog-open'
  | 'action-failed'
  | 'input-mode';

export type Drive<Extra extends string = never> = StoreFailure | GateRefusal<DriveRefusal | Extra>;

export type EmulationChange = {
  readonly viewport: Viewport | undefined;
  readonly device: Emulation['device'] | undefined;
  readonly scheme: Emulation['scheme'] | undefined;
  readonly cpu?: Emulation['cpu'];
  readonly network?: Emulation['network'];
  readonly geolocation?: Emulation['geolocation'];
  readonly conditions?: boolean;
  readonly clear: boolean;
};

export type CaptureKind = 'viewport' | 'full' | 'element' | 'pdf';

export type Captured = {
  readonly page: Glance;
  readonly path: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
  readonly width: number | null;
  readonly height: number | null;
};

export type Evaluated =
  | { readonly page: Glance; readonly value: string; readonly cut: boolean }
  | { readonly page: Glance; readonly exception: string };

export type Until = { readonly kind: 'load' } | { readonly kind: 'text' | 'url' | 'element'; readonly value: string };

export type ConsoleQuery = {
  readonly level: ConsoleLevel | undefined;
  readonly match: string | undefined;
  readonly after: number | undefined;
  readonly limit: number;
  readonly seq: number | undefined;
  readonly stack: boolean;
};

export type ConsoleRead = {
  readonly entries: readonly ConsoleEntry[];
  readonly total: number;
  readonly dropped: number;
  readonly capturing: boolean;
};

export type NetworkQuery = {
  readonly match: string | undefined;
  readonly failed: boolean;
  readonly after: number | undefined;
  readonly limit: number;
};

export type NetworkRead = { readonly entries: readonly NetworkEntry[]; readonly total: number; readonly dropped: number };

export type Body = { readonly body: string; readonly base64: boolean; readonly cut: boolean };

export type Snapshotted = { readonly page: Glance; readonly text: string; readonly shown: number; readonly more: boolean };

export type AuditQuery = { readonly within: string | undefined; readonly tags: readonly string[] | undefined; readonly limit: number };

export class Automation extends Context.Service<
  Automation,
  {
    navigate(
      page: PageId,
      to: Navigation,
      thread: string | null,
      agent?: boolean,
    ): Effect.Effect<Glance, Drive<'navigation-failed' | 'operator-input'>>;
    snapshot(
      page: PageId,
      options: { readonly within: string | undefined; readonly limit: number },
      thread: string | null,
    ): Effect.Effect<Snapshotted, Drive<'stale-ref'>>;
    act(
      page: PageId,
      steps: readonly PlannedAction[],
      thread: string | null,
      agent?: boolean,
    ): Effect.Effect<ActionRun, Drive<'stale-ref' | 'element-obscured' | 'action-shape' | 'operator-input'>>;
    emulate(
      page: PageId,
      change: EmulationChange,
      thread: string | null,
    ): Effect.Effect<{ readonly page: Glance; readonly emulation: Emulation }, Drive<'operator-input'>>;
    capture(
      page: PageId,
      kind: CaptureKind,
      ref: string | undefined,
      thread: string | null,
    ): Effect.Effect<Captured, Drive<'stale-ref' | 'action-shape'>>;
    heap(page: PageId, limit: number, thread: string | null): Effect.Effect<HeapCaptured, Drive<'heap-failed'>>;
    audit(page: PageId, query: AuditQuery, thread: string | null): Effect.Effect<Audited, Drive<'stale-ref' | 'audit-failed'>>;
    picture(path: string): Effect.Effect<Uint8Array>;
    evaluate(page: PageId, expression: string, thread: string | null, agent?: boolean): Effect.Effect<Evaluated, Drive<'operator-input'>>;
    wait(
      page: PageId,
      until: Until,
      timeoutMs: number,
      thread: string | null,
    ): Effect.Effect<{ readonly page: Glance; readonly waitedMs: number }, Drive<'wait-unmet'>>;
    console(page: PageId, query: ConsoleQuery, thread: string | null): Effect.Effect<ConsoleRead, Drive<'console-off'>>;
    network(
      page: PageId,
      query: NetworkQuery,
    ): Effect.Effect<NetworkRead, StoreFailure | GateRefusal<'page-unknown' | 'profile-unknown' | 'input-mode'>>;
    body(page: PageId, request: string, thread: string | null): Effect.Effect<Body, Drive<'body-unavailable'>>;
    answer(page: PageId, accept: boolean, text: string | undefined, thread: string | null): Effect.Effect<Glance, Drive<'no-dialog'>>;
    pick(page: PageId, projectId: number): Effect.Effect<Stream.Stream<Picked, Drive<'stale-ref'>>, Drive, Scope.Scope>;
  }
>()('tagma/browser/Automation') {}
