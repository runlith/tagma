import { performOver } from '../../platform/contract/service/perform.js';
import { door } from './door.js';

export const perform = performOver((request) => door.ask((client) => client.operations.perform(request)));
