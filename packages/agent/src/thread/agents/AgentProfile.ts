import { Data, Schema } from 'effect';
import type { CatalogProfile } from '../../catalog/resolveCatalog';

const sectionId = Schema.String.check(Schema.isMinLength(1));

export const sectionEditSchema = Schema.Union([
  Schema.Struct({ drop: sectionId }),
  Schema.Struct({ replace: sectionId, text: Schema.String }),
  Schema.Struct({ add: sectionId, before: sectionId, text: Schema.String }),
  Schema.Struct({ add: sectionId, after: sectionId, text: Schema.String }),
  Schema.Struct({ edit: sectionId, find: Schema.String.check(Schema.isMinLength(1)), with: Schema.String }),
]);
export type SectionEdit = typeof sectionEditSchema.Type;

export type AgentProfile = {
  readonly id: string;
  readonly baseAgentId: string;
  readonly description: string;
  readonly instructions?: string;
  readonly tools?: readonly string[];
  readonly model?: { readonly provider?: string; readonly model?: string | null; readonly reasoning?: string | null };
  readonly prompt?: string;
  readonly sections?: readonly SectionEdit[];
  readonly capabilities?: readonly string[];
  readonly runtimeSources?: readonly string[];
};

export const agentProfileSchema = Schema.Struct({
  baseAgentId: Schema.String.check(Schema.isMinLength(1)),
  description: Schema.optional(Schema.String),
  instructions: Schema.optional(Schema.String),
  tools: Schema.optional(Schema.Array(Schema.String)),
  model: Schema.optional(
    Schema.Struct({
      provider: Schema.optional(Schema.String),
      model: Schema.optional(Schema.NullOr(Schema.String)),
      reasoning: Schema.optional(Schema.NullOr(Schema.String)),
    }),
  ),
  prompt: Schema.optional(Schema.String),
  sections: Schema.optional(Schema.Array(sectionEditSchema)),
  capabilities: Schema.optional(Schema.Array(Schema.String)),
  runtimeSources: Schema.optional(Schema.Array(Schema.String)),
});

export type ThreadProfileBirth = {
  readonly id: string;
  readonly overlay: AgentProfile;
};

export type ThreadDefinition = {
  readonly agentId: string;
  readonly profile: ThreadProfileBirth | null;
};

export type AgentProfileGrant = {
  readonly profile: AgentProfile;
  readonly floor: string;
  readonly revision: string;
};

export function agentTypeId(agentId: string, profileId: string | null, hosted: string | null): string {
  return profileId ?? hosted ?? agentId;
}

export function catalogProfileOf(profile: ThreadProfileBirth | null): CatalogProfile {
  const overlay = profile?.overlay;
  return {
    sources: overlay?.runtimeSources,
    tools: overlay?.tools,
  };
}

export class AgentProfileUnknownError extends Data.TaggedError('AgentProfileUnknown')<{
  readonly message: string;
  readonly reason: string;
  readonly typeId: string;
  readonly offered?: readonly string[];
}> {
  constructor(typeId: string, offered?: readonly string[]) {
    const reason =
      `no agent or profile is offered here as ${typeId}.` +
      (offered === undefined
        ? ''
        : offered.length === 0
          ? ' This caller is offered no type at all.'
          : ` Offered right now: ${[...offered].join(', ')}.`);
    super({ message: `unknown-type: ${reason}`, reason, typeId, offered });
    this.name = 'AgentProfileUnknownError';
  }
}
