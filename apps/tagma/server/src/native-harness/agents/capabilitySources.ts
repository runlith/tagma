import { capabilityHolds } from '@runlith/agent/thread/agents/AgentDefinitions';
import type { ThreadToolSourceRegistry } from '@runlith/agent/thread/ThreadPorts';
import { Effect, type Scope } from 'effect';
import { NATIVE_HARNESS } from '../../platform/contract/wire/session.js';
import type { Capability, CapabilitySource } from '../capabilities/contract.js';
import type { CapabilityDefinitions } from '../capabilities/definitions.js';
import type { AgentDeclaration } from './declaration.js';
import type { ThreadContext } from '../turns/context.js';

export function capabilityEnabled(capability: Capability, ctx: ThreadContext): boolean {
  return ctx.capabilitySettings?.enabled(capability.id) ?? capability.enabledBy?.fallback ?? true;
}

export function capabilityHeld(capability: Capability, ctx: ThreadContext): boolean {
  return (
    capabilityEnabled(capability, ctx) &&
    capabilityHolds(ctx.thread.profile?.overlay, capability) &&
    !ctx.unavailableCapabilities.some((loss) => loss.capability === capability.id)
  );
}

export function heldCapabilities(
  declaration: AgentDeclaration,
  definitions: CapabilityDefinitions,
  ctx: ThreadContext,
): readonly Capability[] {
  return definitions.effective(declaration).held.filter((capability) => capabilityHeld(capability, ctx));
}

export function capabilitySource(capability: Capability, source: CapabilitySource): Parameters<ThreadToolSourceRegistry['register']>[0] {
  return {
    id: source.id,
    owner: NATIVE_HARNESS,
    names: source.names,
    offer: (request) =>
      Effect.sync(() => {
        const ctx = request.context as ThreadContext;
        return capabilityHeld(capability, ctx) ? { id: source.id, tools: source.tools(ctx) } : null;
      }),
  };
}

export function capabilitySources(
  registry: ThreadToolSourceRegistry,
  capabilities: CapabilityDefinitions,
): Effect.Effect<void, never, Scope.Scope> {
  return Effect.forEach(
    capabilities.list().flatMap((capability) => (capability.source === undefined ? [] : [{ capability, source: capability.source }])),
    ({ capability, source }) => Effect.orDie(registry.hold(capabilitySource(capability, source))),
    { discard: true },
  );
}
