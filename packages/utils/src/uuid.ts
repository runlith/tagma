import { v4 as createV4Uuid } from 'uuid';

export function createUuid(): string {
  return createV4Uuid();
}
