import { McpSignInDoor } from '../../mcp/contract/service/door.js';
import type { Access } from '../../remote/contract/service/access.js';

export const localSignInDoor = (origin: string | undefined) => McpSignInDoor.of({ origin: () => origin ?? null });

export const remoteSignInDoor = (access: Access['Service']) => McpSignInDoor.of({ origin: () => access.parentOrigin });
