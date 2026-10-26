import { Context, type Effect } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { FarTarget, Phase } from '../wire/far.js';
import type { ContractId } from '../wire/tags/behaviour.js';

export type FarProject = { readonly id: number; readonly name: string };

export type FarState =
  | {
      readonly kind: 'here';
      readonly project: FarProject;
      readonly title: string;
      readonly trashed: boolean;
      readonly superseded: boolean;
      readonly phase: Phase | null;
    }
  | { readonly kind: 'absent'; readonly reason: 'project' | 'block' | 'unreadable'; readonly detail: string | null }
  | { readonly kind: 'ambiguous'; readonly projects: readonly FarProject[] };

export type FarPointer = {
  readonly project: FarProject;
  readonly from: string;
  readonly title: string;
  readonly kind: string;
  readonly graph: string;
  readonly to: string;
  readonly at: number;
  readonly superseded: boolean;
  readonly phase: Phase | null;
};

export type FarPointing = {
  readonly pointers: readonly FarPointer[];
  readonly unread: readonly FarProject[];
};

export type GraphRoot =
  | { readonly kind: 'root'; readonly uuid: string }
  | { readonly kind: 'none' }
  | { readonly kind: 'unread'; readonly project: FarProject };

export type FarStep = { readonly from: string; readonly graph: string; readonly to: string };

export type FarHeld = {
  readonly id: number;
  readonly uuid: string;
  readonly kind: string;
  readonly target: FarTarget;
  readonly state: Exclude<FarState, { readonly kind: 'here' }>;
};

export type FarMarks = {
  readonly blocked: ReadonlySet<number>;
  readonly held: readonly FarHeld[];
};

export const ReadFarMarks = Context.Reference<Map<number, FarMarks> | null>('tagma/graph/ReadFarMarks', {
  defaultValue: () => null,
});

export type ForeignBlocks = {
  farStates(targets: readonly FarTarget[], contract: ContractId): Effect.Effect<ReadonlyMap<string, FarState>, StoreFailure>;
  farPointing(input: {
    readonly graph: string;
    readonly uuids: readonly string[] | null;
    readonly contract: ContractId;
    readonly excluding: number;
  }): Effect.Effect<FarPointing, StoreFailure>;
  farOutgoing(graph: string, uuids: readonly string[], kind: string): Effect.Effect<readonly FarStep[], StoreFailure>;
  farWork(input: {
    readonly graph: string;
    readonly uuids: readonly string[];
    readonly kinds: readonly string[];
    readonly contract: ContractId;
  }): Effect.Effect<ReadonlyMap<string, boolean | null>, StoreFailure>;
  graphRootOf(projectId: number): Effect.Effect<GraphRoot, StoreFailure>;
};
