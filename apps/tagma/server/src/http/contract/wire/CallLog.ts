import { HttpApiMiddleware } from 'effect/http-api';

export class CallLog extends HttpApiMiddleware.Service<CallLog>()('tagma/http/CallLog') {}
