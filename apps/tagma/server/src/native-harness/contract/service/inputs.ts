import { Context, type Effect } from 'effect';
import type { AgentSkill } from '@runlith/agent/AgentSkill';
import type { ContextFile } from '@runlith/agent-sources/ContextFiles';
import type { ThreadContextUse } from '@runlith/agent/thread/agents/ThreadAgent';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { TargetAt } from '../../../workspace/contract/wire/place.js';
import type { SkillScope } from '../wire/sourceSettings.js';

export type SkillInventoryEntry = {
  readonly name: string;
  readonly description: string;
  readonly path: string | null;
  readonly directory: string | null;
  readonly scope: SkillScope;
  readonly enabled: boolean;
  readonly own: boolean;
  readonly replacedBy: SkillScope | null;
};

export type WorkspaceInputSet = {
  readonly contextFiles: readonly ContextFile[];
  readonly shipped: readonly AgentSkill<unknown>[];
  readonly skills: readonly AgentSkill<unknown>[];
  readonly disabledSkills: ReadonlySet<string>;
  readonly inventory: readonly SkillInventoryEntry[];
  readonly rejected: readonly { readonly path: string; readonly reason: string }[];
};

export type WorkspaceInputAim = {
  threadId: string;
  projectId: number;
  root: string;
};

export class WorkspaceInputs extends Context.Service<
  WorkspaceInputs,
  {
    resolve(input: WorkspaceInputAim, use: ThreadContextUse, at: TargetAt): Effect.Effect<WorkspaceInputSet, StoreFailure | GateRefusal>;
    preview(input: WorkspaceInputAim): Effect.Effect<WorkspaceInputSet, StoreFailure | GateRefusal>;
    walk(projectId: number, root: string): Effect.Effect<WorkspaceInputSet, StoreFailure | GateRefusal<'source-unreadable'>>;
    snapshot(threadId: string, runId: string): Effect.Effect<WorkspaceInputSet | undefined>;
    release(at: TargetAt): Effect.Effect<void>;
    releaseRun(threadId: string, runId: string): Effect.Effect<void>;
    forget(threadId: string): Effect.Effect<void>;
    invalidate(input: { threadId?: string; projectId?: number }): Effect.Effect<void>;
  }
>()('tagma/native-harness/WorkspaceInputs') {}
