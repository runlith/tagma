import { Context, type Effect } from 'effect';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';

export class McpSignInDoor extends Context.Service<
  McpSignInDoor,
  { readonly origin: Effect.Effect<string, GateRefusal<'mcp-sign-in-unserved'>> }
>()('tagma/mcp/McpSignInDoor') {}
