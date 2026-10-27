import { Context, type Effect } from 'effect';

export class McpPlaces extends Context.Service<
  McpPlaces,
  {
    of(projectId: number): Effect.Effect<readonly string[]>;
    onMoved(listener: (projectId: number) => void): () => void;
  }
>()('tagma/mcp/McpPlaces') {}
