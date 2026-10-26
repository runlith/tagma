import type { Effect } from 'effect';
import type { HttpClient } from 'effect/http';

export type Signer = { readonly harness: string; readonly variable?: string | undefined };

export type ServerWire<Door, Health> = {
  readonly connect: (baseUrl: string, transformClient: (client: HttpClient.HttpClient) => HttpClient.HttpClient) => Effect.Effect<Door>;
  readonly readHealth: (body: unknown) => Health | null;
  readonly defaultPort: number;
  readonly command: string;
  readonly signers: readonly Signer[];
  readonly elsewhere: (env: NodeJS.ProcessEnv) => { readonly reason: string; readonly unblock: string[] } | null;
};
