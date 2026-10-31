import { Effect } from 'effect';
import { DEVELOPER } from '../developer/build.js';
import { PARTS } from '../developer/parts.js';
import { type Assembly, assemble } from '../manifest.js';
import { doorOf } from '../cli/door.js';
import { operationsCli } from '../cli/operations.js';
import { installationCli } from '../cli/installation.js';
import { doctrineText } from '../doctrine.js';

export const ASSEMBLY: Assembly = await assemble(PARTS);

export const COMPOSED = { assembly: ASSEMBLY, channel: DEVELOPER.channel };

export const MODULES = PARTS.modules;
export const ENTRY_KINDS = ASSEMBLY.entryKinds;
export const BEHAVIOUR_REGISTRY = ASSEMBLY.behaviours;
export const NATIVE_AGENT_RULES = ASSEMBLY.nativeRules;
export const CAPABILITIES = ASSEMBLY.capabilities;
export const PREPARATION = ASSEMBLY.preparation;
export const DRIVERS = ASSEMBLY.drivers;
export const COLLECTED_FEEDS = ASSEMBLY.feeds;
export const LiveRpc = ASSEMBLY.live;
export const SOCKET_VERBS = ASSEMBLY.socketVerbs;
export const ownerOf = ASSEMBLY.ownerOf;
export const checkSubjectOf = ASSEMBLY.subjectOf;
export const collectedOperations = Effect.succeed(ASSEMBLY.operations);

export const doctrine = Effect.succeed(doctrineText(ASSEMBLY));

const door = doorOf(DEVELOPER.channel);
export const OPERATIONS_CLI = operationsCli(DEVELOPER.channel, door, ASSEMBLY.registry);
export const INSTALLATION_CLI = installationCli(DEVELOPER.channel, door, doctrine);
