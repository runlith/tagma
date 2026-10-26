import { RpcMiddleware } from 'effect/rpc';

export const TAGMA_SOCKET_PATH = '/api/ws';

export class CallLog extends RpcMiddleware.Service<CallLog>()('tagma/socket/CallLog') {}
