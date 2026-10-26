import { Schema } from 'effect';
import { Background } from '../../contract/wire/extensions.js';
import { handled, type Noticing } from './declaration.js';

const decodeBackground = Schema.decodeUnknownResult(Background);

export const background: Noticing = {
  noticed: (row, event) => {
    const read = decodeBackground(event.params);
    return handled(read._tag === 'Success' && read.success.running !== row.background ? { ...row, background: read.success.running } : row);
  },
};
