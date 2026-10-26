import { Data, Schema } from 'effect';

export const RefusalCode = Schema.Literals([
  'permission-denied',
  'device-missing',
  'unsupported',
  'helper-mismatch',
  'unavailable',
  'device-failed',
]);
export type RefusalCode = Schema.Schema.Type<typeof RefusalCode>;

export class DeviceRefused extends Data.TaggedError('DeviceRefused')<{
  readonly code: RefusalCode;
  readonly message: string;
  readonly unblock: ReadonlyArray<string>;
}> {}

export const rebuildHost = 'rebuild and reinstall the host application';
