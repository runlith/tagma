import { Schema } from 'effect';
import { Said } from '@runlith/hosted-runner/wire/extensions';
import { handled, type Noticing } from './declaration.js';

const decodeSaid = Schema.decodeUnknownResult(Said);

export const said: Noticing = {
  noticed: (row, event) => {
    const read = decodeSaid(event.params);
    return { ...handled(row), sealed: { _tag: 'Sealed', said: read._tag === 'Success' ? read.success : null } };
  },
};
