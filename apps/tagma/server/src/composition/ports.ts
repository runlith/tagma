import { Context, Effect, Option } from 'effect';
import { CarrierAdmission } from '../change-record/contract/service/carriers.js';
import { ChangeRecord } from '../change-record/contract/service/record.js';
import { HeldFeed } from '../change-record/contract/service/held.js';
import { TerminalAdopters } from '../executions/contract/service/adopters.js';
import { Merges, PendingMerges } from '../landing/contract/service/merges.js';
import { HarnessRegistry } from '../threads/contract/service/harness.js';
import { PreservationCommit } from '../worktrees/contract/service/preservation.js';
import { WorktreeRetirement } from '../worktrees/contract/service/retirement.js';
import { Worktrees } from '../worktrees/contract/service/creation.js';
import { ThreadLineage } from '../workspace/contract/service/assignments.js';
import { CommitOverlay } from '../workspace/contract/service/checkouts.js';
import { EnvironmentBackends } from '../workspace/contract/service/environments.js';
import { RootPublished } from '../workspace/contract/service/roots.js';
import { FileWatcher } from '../platform/contract/service/watch.js';
import { Access, type NamedRight } from '../platform/contract/service/access.js';
import { AssemblyInvalid } from './start.js';

type Port = readonly [name: string, tag: Context.Service<any, any>];

export const admitPorts = (context: Context.Context<never>, ports: readonly Port[]): Effect.Effect<void, AssemblyInvalid> =>
  Effect.suspend(() => {
    const unbound = ports.filter(([, tag]) => Option.isNone(Context.getOption(context, tag))).map(([name]) => name);
    return unbound.length === 0 ? Effect.void : new AssemblyInvalid({ unregistered: [], ports: unbound });
  });

export const admitRights = (rights: readonly NamedRight[], context: Context.Context<never>): Effect.Effect<void, AssemblyInvalid> =>
  rights.length === 0
    ? Effect.void
    : admitPorts(context, [[`Access (asked by ${rights.map(({ key, by }) => `${by} for "${key}"`).join(', ')})`, Access]]);

export type AssembledPorts =
  | EnvironmentBackends
  | RootPublished
  | PreservationCommit
  | ThreadLineage
  | HarnessRegistry
  | Worktrees
  | WorktreeRetirement
  | Merges
  | PendingMerges
  | CommitOverlay
  | HeldFeed
  | ChangeRecord
  | CarrierAdmission
  | TerminalAdopters
  | FileWatcher;

export const admitAssembled = (context: Context.Context<AssembledPorts>): Effect.Effect<void, AssemblyInvalid> =>
  admitPorts(context, [
    ['EnvironmentBackends', EnvironmentBackends],
    ['RootPublished', RootPublished],
    ['PreservationCommit', PreservationCommit],
    ['ThreadLineage', ThreadLineage],
    ['HarnessRegistry', HarnessRegistry],
    ['Worktrees', Worktrees],
    ['WorktreeRetirement', WorktreeRetirement],
    ['Merges', Merges],
    ['PendingMerges', PendingMerges],
    ['CommitOverlay', CommitOverlay],
    ['HeldFeed', HeldFeed],
    ['ChangeRecord', ChangeRecord],
    ['CarrierAdmission', CarrierAdmission],
    ['TerminalAdopters', TerminalAdopters],
    ['FileWatcher', FileWatcher],
  ]);
