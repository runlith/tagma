import { Context, type Effect } from 'effect';
import type { WorkspaceChanges } from '@runlith/agent-tools/WorkspaceChanges';
import type {
  AgentDefinition,
  AgentPreview,
  AgentSave,
  AgentSkillAim,
  AgentSkillCatalog,
} from '../../../threads/contract/wire/agentLibrary.js';
import type { InstructionSet } from '../../../graph/contract/wire/instructions.js';
import type { HarnessFailure } from '../../../threads/contract/service/failure.js';
import type { GraphOrigin } from '../../../threads/contract/wire/target.js';

export class AgentSkills extends Context.Service<
  AgentSkills,
  {
    list(projectId: number, aim: AgentSkillAim): Effect.Effect<AgentSkillCatalog, HarnessFailure>;
  }
>()('tagma/native-harness/AgentSkills') {}

export class NativeAgentDefinitions extends Context.Service<
  NativeAgentDefinitions,
  {
    thread(projectId: number, threadId: string): Effect.Effect<AgentPreview, HarnessFailure>;
    instructions(
      projectId: number,
      threadId: string,
      graph: GraphOrigin,
    ): Effect.Effect<{ readonly delivered: InstructionSet | null; readonly current: InstructionSet }, HarnessFailure>;
    destination(projectId: number, name: string, scope: AgentSave['scope']): Effect.Effect<string, HarnessFailure>;
    save(projectId: number, input: AgentSave, changes?: WorkspaceChanges): Effect.Effect<AgentDefinition, HarnessFailure>;
  }
>()('tagma/native-harness/NativeAgentDefinitions') {}
