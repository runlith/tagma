import { Context } from 'effect';
import { CLAUDE_CODE_PROVIDER } from '@runlith/adapter-anthropic/models/anthropic';
import { OPERATOR_PRINCIPAL } from '../../../platform/contract/wire/actor.js';
import { ThreadHarness } from '../../../threads/contract/service/engine.js';
import type { DoorFixture } from '../doorFixture.js';

export const hostedChild = (world: DoorFixture['Service'], parent: string, task: string) =>
  Context.get(world.runtime.owners, ThreadHarness).collaboration.spawn({
    parentThreadId: parent,
    ownerId: OPERATOR_PRINCIPAL,
    requestId: crypto.randomUUID(),
    agentId: 'tagma',
    task,
    model: { provider: CLAUDE_CODE_PROVIDER },
  });
