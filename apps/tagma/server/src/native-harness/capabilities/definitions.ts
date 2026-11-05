import { COLLABORATION_SOURCE } from '@runlith/agent/collaboration/CollaborationConfig';
import { ANSWER_SOURCE, ANSWER_TOOL } from '@runlith/agent/collaboration/askVerbs';
import { READ_MODELS } from '@runlith/agent/collaboration/CollaborationTools';
import { AgentDefinitions } from '@runlith/agent/thread/agents/AgentDefinitions';
import { FINAL_ANSWER_TOOL } from '@runlith/agent/transcript/parts';
import { Effect } from 'effect';
import type { DeclaredCapability } from '../contract/service/capabilities.js';
import type { ThreadContext } from '../turns/context.js';
import type { Capability, CapabilityBehaviour } from './contract.js';
import { files } from './files.js';
import { graph } from './graph.js';
import { mcp } from './mcp.js';
import { shell } from './shell.js';
import { skills } from './skills.js';
import { tagmaApps } from './tagmaApps.js';
import { web } from './web.js';

const BEHAVIOURS: Readonly<Record<string, CapabilityBehaviour>> = { files, shell, web, mcp, apps: tagmaApps, skills, graph };

export type CapabilityDefinitions = AgentDefinitions<ThreadContext, Capability>;

export const capabilityDefinitions = Effect.fnUntraced(function* (declared: readonly DeclaredCapability[]) {
  const definitions: CapabilityDefinitions = new AgentDefinitions(
    (source) => (source === COLLABORATION_SOURCE ? [FINAL_ANSWER_TOOL, READ_MODELS] : undefined),
    [{ source: ANSWER_SOURCE, tools: [ANSWER_TOOL], standing: true }],
  );
  const ids = new Set(declared.map(({ declaration }) => declaration.id));
  const orphaned = Object.keys(BEHAVIOURS).filter((id) => !ids.has(id));
  if (orphaned.length > 0) {
    return yield* Effect.die(new Error(`behaviours without a capability declaration: ${orphaned.join(', ')}`));
  }
  for (const { owner, declaration } of declared) {
    yield* Effect.orDie(definitions.register(owner, { ...declaration, ...BEHAVIOURS[declaration.id] }));
  }
  return definitions;
});
