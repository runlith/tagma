import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import type { AgentProfile } from '@runlith/agent/thread/agents/AgentProfile';
import { Effect } from 'effect';
import type { AgentFile } from '../../../threads/contract/wire/agentLibrary.js';
import type { AgentFiles } from '../../../threads/contract/service/library.js';
import type { CapabilityDefinitions } from '../../capabilities/definitions.js';
import { DECLARED_BASE_ID } from './base.js';
import { discoverAgentFiles } from './files.js';

export function profileOf(capabilities: CapabilityDefinitions, file: AgentFile): AgentProfile {
  return {
    id: file.id,
    baseAgentId: file.extends ?? DECLARED_BASE_ID,
    description: file.description,
    ...(file.extends === undefined ? { prompt: file.body } : { instructions: file.body }),
    ...(file.capabilities === undefined ? {} : capabilities.narrowing(file.capabilities)),
    tools: file.tools,
    model: file.model,
    sections: file.sections,
  };
}

export function namable(capabilities: CapabilityDefinitions): readonly string[] {
  return capabilities
    .list()
    .filter((capability) => capability.explicit !== true)
    .map((capability) => capability.id);
}

export function agentFilesOf(capabilities: CapabilityDefinitions): AgentFiles {
  return {
    baseId: DECLARED_BASE_ID,
    discover: (floors) => discoverAgentFiles(floors, namable(capabilities)).pipe(Effect.provide(BunFileSystem.layer)),
    profileOf: (file) => profileOf(capabilities, file),
  };
}
