import { Context } from 'effect';

export class McpSignInDoor extends Context.Service<McpSignInDoor, { readonly origin: () => string | null }>()('tagma/mcp/McpSignInDoor') {}
