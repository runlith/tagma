import { performOver } from '../../platform/contract/service/perform.js';
import type { ChannelDoor } from './door.js';

export const performThrough = (door: ChannelDoor) => performOver((request) => door.ask((client) => client.operations.perform(request)));

export type Perform = ReturnType<typeof performThrough>;
