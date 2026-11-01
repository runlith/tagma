import { DoorAddress } from '../../platform/contract/service/door.js';
import type { Access } from '../../remote/contract/service/access.js';

export const localAddress = (origin: string | undefined) => DoorAddress.of({ origin: () => origin ?? null });

export const remoteAddress = (access: Access['Service']) => DoorAddress.of({ origin: () => access.parentOrigin });
