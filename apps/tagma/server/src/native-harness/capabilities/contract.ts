import type { AgentRule } from '@runlith/agent/AgentRuntimePolicy';
import type { PackedWorldStateSection } from '@runlith/agent/WorldState';
import type { ToolCatalog } from '@runlith/agent/catalog';
import { Data, type Effect } from 'effect';
import type { SectionId } from '../../threads/doctrine/registry.js';
import type { CapabilityDeclaration, CapabilityId } from '../../platform/contract/wire/capability.js';
import type { ThreadContext } from '../turns/context.js';
import type { WorldFacts } from '../../executions/contract/service/worlds.js';

export class CapabilityUnavailable extends Data.TaggedError('CapabilityUnavailable')<{
  readonly capability: CapabilityId;
  readonly reason: string;
}> {
  override get message(): string {
    return `${this.capability} is unavailable: ${this.reason}`;
  }
}

export type CapabilitySource = {
  readonly id: string;
  readonly names: readonly string[];
  tools(ctx: ThreadContext): ToolCatalog;
};

export type CapabilityCatalog = {
  revision(ctx: ThreadContext): string;
  notice(ctx: ThreadContext): string;
};

export type CapabilityBehaviour = {
  readonly catalog?: CapabilityCatalog;
  readonly factSections?: (facts: WorldFacts) => readonly SectionId[];
  readonly toolNames?: readonly string[];
  readonly workspaceTools?: Readonly<Record<string, 'eager' | 'deferred'>>;
  readonly tools?: (ctx: ThreadContext) => ToolCatalog;
  readonly deferredTools?: (ctx: ThreadContext) => ToolCatalog;
  readonly rules?: readonly AgentRule<ThreadContext>[];
  readonly source?: CapabilitySource;
  readonly explicit?: true;
  readonly prepare?: (ctx: ThreadContext) => Effect.Effect<void, CapabilityUnavailable>;
  readonly turnNote?: (ctx: ThreadContext) => readonly PackedWorldStateSection[];
};

export type CapabilitySettings = {
  enabled(id: string): boolean;
  revision(): string;
  readonly initial: string;
};

export type Capability = CapabilityDeclaration & CapabilityBehaviour;

export function capabilitySections(capability: Capability, facts: WorldFacts): readonly SectionId[] {
  return [...capability.sections, ...(capability.factSections?.(facts) ?? [])];
}
