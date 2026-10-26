import { GateRefusal } from '../../platform/contract/wire/refusal.js';

export type Said = { readonly message: string };

export const recordRefusal = (failure: Said): GateRefusal<'record-unread'> =>
  new GateRefusal('record-unread', `${failure.message}; nothing was written`, ['retry once the change record answers']);

export const writeRefusal = (path: string, failure: Said): GateRefusal<'file-write-failed'> =>
  new GateRefusal('file-write-failed', `${path} could not be written: ${failure.message}`, [
    'read the reason, fix the disk or the path, and retry',
  ]);

export const refusalOf = <Code extends string>(failure: GateRefusal<Code> | Said): GateRefusal<Code | 'record-unread'> =>
  failure instanceof GateRefusal ? failure : recordRefusal(failure);
