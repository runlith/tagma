import { Context, type Effect } from 'effect';
import type { ToolShown } from '@runlith/agent/tool';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { WriterRef } from '../../../platform/contract/service/writers.js';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { SessionRef } from '../../../platform/contract/wire/session.js';
import type { InstructionDiff, InstructionSet } from '../wire/instructions.js';
import type { LawReach } from '../wire/tags/law.js';
import type { Tag } from '../wire/tags/declaration.js';
import type { ActState } from './transaction.js';
import type { BlockRecord } from './acts.js';

export type TagPrompt = Pick<Tag, 'id' | 'name' | 'prompt'> & { readonly identity: string; readonly aliases?: readonly string[] };

export class Orientation extends Context.Service<
  Orientation,
  {
    render(input: { projectId: number; scopeId?: number; law?: InstructionSet }): Effect.Effect<string, StoreFailure | GateRefusal>;
    law(input?: { projectId?: number }): Effect.Effect<string, StoreFailure | GateRefusal>;
    rules(projectId: number): Effect.Effect<readonly BlockRecord[], StoreFailure | GateRefusal<'no-root'>>;
    rulesOff(projectId: number): Effect.Effect<readonly BlockRecord[], StoreFailure | GateRefusal<'no-root'>>;
    ruleReach(projectId: number): Effect.Effect<LawReach, StoreFailure>;
    instructions(input: {
      projectId: number;
      audience: InstructionSet['audience'];
    }): Effect.Effect<InstructionSet, StoreFailure | GateRefusal>;
    changes(input: {
      projectId: number;
      audience: InstructionSet['audience'];
      previous: InstructionSet | undefined;
    }): Effect.Effect<InstructionDiff, StoreFailure | GateRefusal>;
  }
>()('tagma/graph/Orientation') {}

export type FileTouch = {
  writer: WriterRef;
  agentName: string | null;
  task: { id: number; name: string; title: string };
  wrote: boolean;
  touchedAt: Date;
};

export type TouchText = {
  readonly name: string;
  readonly identity: string;
  readonly revision: string;
  readonly title: string;
  readonly body: string;
};

export type TouchRule = TouchText & { readonly reach: string };

export type TouchBrief = {
  readonly place: string;
  readonly as: ToolShown['as'];
  readonly rules: readonly TouchRule[];
  readonly explanations: readonly TouchText[];
  readonly tagPrompts: readonly TagPrompt[];
  readonly touches: readonly {
    writer: WriterRef;
    agentName: string | null;
    task: { name: string; title: string };
    wrote: boolean;
  }[];
};

export class Touches extends Context.Service<
  Touches,
  {
    of(input: { projectId: number; place: string }): Effect.Effect<FileTouch[], StoreFailure>;
    touch(input: { projectId: number; shown: readonly ToolShown[] }): Effect.Effect<readonly TouchBrief[], StoreFailure | GateRefusal>;
    retire(taskId: number): Effect.Effect<void, StoreFailure, ActState>;
  }
>()('tagma/graph/Touches') {}

export type GraphDigest = {
  readonly text: string | null;
  readonly throughEventId: number;
};

export type DigestReader = {
  readonly session: SessionRef;
  readonly written: readonly string[];
};

export class Digest extends Context.Service<
  Digest,
  {
    digest(input: {
      projectId: number;
      scopeId?: number;
      sinceEventId: number;
      reader?: DigestReader;
    }): Effect.Effect<GraphDigest, StoreFailure | GateRefusal>;
  }
>()('tagma/graph/Digest') {}

export class SessionNames extends Context.Service<
  SessionNames,
  {
    of(
      projectId: number,
      threadIds: readonly string[],
    ): Effect.Effect<ReadonlyMap<string, { title: string; name: string | null; ended: boolean }>, StoreFailure>;
  }
>()('tagma/graph/SessionNames') {}
