import { Api } from '@tagma/server/api';
import { ThreadEntryKinds, type ThreadEntryReader } from '@runlith/agent/transcript/kinds';
import { wireEntries, WireEntryKinds } from './WireEntryKinds.js';
import { CONTRACT_HEADER } from '@tagma/server/invocation/contract/wire/headers';
import type { EndpointDeclaration } from '@tagma/server/platform/contract/wire/operation';
import { faultBody } from '@tagma/server/platform/contract/wire/refusal';
import { Platform, type PlatformFetch } from '@runlith/layer/Platform';
import { Router } from '@runlith/layer/Router';
import { Service } from '@runlith/layer/key';
import { Effect, Result, Schema, SchemaIssue } from 'effect';
import { FetchHttpClient, HttpClient, HttpClientError } from 'effect/http';
import { HttpApiClient } from 'effect/http-api';
import { OperationTable, type HttpOperationId, type OperationAnswer, type OperationInput } from './operation.js';
import { AccessHint, type AccessHintShape } from './access.js';
import { Refusal, refusalOf } from './refusal.js';
import { ServerOrigin } from './ServerOrigin.svelte.js';

const bind = (baseUrl: string, heard: (contract: string) => void) =>
  Effect.provide(
    HttpApiClient.make(Api, {
      baseUrl,
      transformClient: (client) =>
        HttpClient.tap(client, (response) =>
          Effect.sync(() => {
            const contract = response.headers[CONTRACT_HEADER];
            if (contract !== undefined) heard(contract);
          }),
        ),
    }),
    FetchHttpClient.layer,
  );

export type Routes = HttpApiClient.UrlBuilder<typeof Api>;
const formatSchemaIssue = SchemaIssue.makeFormatterDefault();

function readableDefect(value: unknown): unknown {
  if (!(value instanceof Error) || !SchemaIssue.isIssue(value.cause)) return value;
  return new Error(`${value.message}\n${formatSchemaIssue(value.cause)}`, { cause: value });
}

const apart = (id: string, issue: unknown, reload: () => void): Refusal =>
  new Refusal({
    gate: false,
    code: 'contract-apart',
    reason: `the server answered ${id} in a shape this window does not read: the running server was built from other source than this window`,
    unblock: [
      'tagma web — open the window the running server serves',
      'end the old server once, so the installation that stands takes its place',
    ],
    words: { text: 'Tagma was updated while this window was open. Reload the window to continue.' },
    act: { label: 'Reload', run: reload },
    cause: issue,
  });

export type ApiClient = Effect.Success<ReturnType<typeof bind>>;

const lensParams = (lens: Lens): [string, string][] =>
  Object.entries(lens).filter((entry): entry is [string, string] => entry[1] !== undefined);

export const KEEPALIVE_BYTES = 60_000;

export function utf8Bytes(text: string): number {
  let bytes = 0;
  for (let at = 0; at < text.length; at += 1) {
    const code = text.charCodeAt(at);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      at += 1;
    } else bytes += 3;
  }
  return bytes;
}

const fitsKeepalive = (payload: unknown): boolean => utf8Bytes(JSON.stringify(payload) ?? '') <= KEEPALIVE_BYTES;

export type AskOptions = { readonly signal?: AbortSignal; readonly keepalive?: boolean };

export type Lens = { readonly project?: string; readonly branch?: string; readonly scope?: string };

const serverFault = Effect.fn(function* <E>(failure: E) {
  if (HttpClientError.isHttpClientError(failure) && failure.reason._tag === 'TransportError') {
    return new Refusal({ gate: false, code: 'transport', reason: failure.message, unblock: [], cause: failure.reason.cause });
  }
  const response = HttpClientError.isHttpClientError(failure) ? failure.response : undefined;
  if (response === undefined) return refusalOf(failure);
  const text = yield* Effect.catchTag(response.text, 'HttpClientError', () => Effect.succeed(''));
  const body = faultBody(text);
  return body === undefined
    ? refusalOf(failure)
    : new Refusal({ gate: false, code: body.code, reason: body.reason, unblock: body.unblock, words: body.words });
});

export class Door extends Service<Door>()('Door', { tier: 'app' }) {
  static *make() {
    const platform = yield* Platform;
    const operations = yield* OperationTable;
    const kinds = yield* WireEntryKinds.optional();
    const hints = yield* AccessHint.optional();
    return new Door(platform.fetch, yield* ServerOrigin, yield* Router, operations, wireEntries(kinds), hints);
  }

  private client: ApiClient | null = null;
  private routes: Routes | null = null;
  private leaving = false;
  private contract: string | null = null;
  private asking = 0;
  contractMoved = false;

  constructor(
    private readonly fetch: PlatformFetch,
    private readonly origin: ServerOrigin,
    private readonly router: Router,
    private readonly operations: OperationTable,
    private readonly entries: ThreadEntryReader = wireEntries(undefined),
    private readonly hints: AccessHintShape | undefined = undefined,
  ) {
    super();
  }

  private readonly hinted = (refusal: Refusal): Refusal =>
    this.hints === undefined || refusal.right === undefined ? refusal : refusal.hinted(this.hints.hint(refusal.right));

  private readonly reload = (): void => this.router.reload();

  markLeaving(): void {
    this.leaving = true;
  }

  get idle(): boolean {
    return this.asking === 0;
  }

  private readonly heard = (contract: string): void => {
    if (this.contract === null) this.contract = contract;
    else if (contract !== this.contract) this.contractMoved = true;
  };

  perform<Id extends HttpOperationId>(id: Id, input: OperationInput<Id>, lens: Lens, options?: AskOptions): Promise<OperationAnswer<Id>> {
    const asked = this.leaving || options?.keepalive === true;
    return this.run(
      (api) =>
        Effect.flatMap(this.operations.of(id), (codec) =>
          Effect.flatMap(codec.payload(input), (payload) => {
            const call = Effect.flatMap(api.operations.perform({ params: { id }, query: lens, headers: {}, payload }), (answered) =>
              Effect.mapError(codec.answer(answered), (issue) => apart(id, issue, this.reload)),
            );
            return asked && fitsKeepalive(payload) ? Effect.provideService(call, FetchHttpClient.RequestInit, { keepalive: true }) : call;
          }),
        ),
      options?.signal,
    );
  }

  ask<A, E>(call: (api: ApiClient) => Effect.Effect<A, E>, options?: AskOptions): Promise<A> {
    return this.run(call, options?.signal, this.leaving || options?.keepalive === true);
  }

  address(route: (routes: Routes) => string): string;
  address(path: string, lens: Lens): string;
  address(route: ((routes: Routes) => string) | string, lens: Lens = {}): string {
    if (typeof route === 'function') return route((this.routes ??= HttpApiClient.urlBuilder(Api, { baseUrl: this.origin.http })));
    if (!route.startsWith('/')) return route;
    const url = new URL(route, this.origin.http);
    for (const [key, value] of lensParams(lens)) url.searchParams.set(key, value);
    return url.toString();
  }

  bytes(address: string, options?: AskOptions): Promise<Blob> {
    return this.answered(address, { signal: options?.signal }, (response) => response.blob());
  }

  async exchange<A>(endpoint: EndpointDeclaration, payload: unknown, answer: Schema.Codec<A, unknown>, options?: AskOptions): Promise<A> {
    const text = await this.answered(
      new URL(endpoint.path, this.origin.http).toString(),
      { method: endpoint.method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: options?.signal },
      (response) => response.text(),
    );
    const decoded = Schema.decodeUnknownResult(Schema.fromJsonString(answer))(text);
    if (Result.isFailure(decoded)) throw apart(endpoint.id, decoded.failure, this.reload);
    return decoded.success;
  }

  private async answered<A>(address: string, init: RequestInit, read: (response: Response) => Promise<A>): Promise<A> {
    const lost = (caught: unknown): Refusal =>
      new Refusal({
        gate: false,
        code: 'transport',
        reason: caught instanceof Error ? caught.message : String(caught),
        unblock: [],
        cause: caught,
      });
    let answer: Response;
    try {
      answer = await this.fetch(address, init);
    } catch (caught) {
      throw lost(caught);
    }
    if (!answer.ok) {
      const body = faultBody(await answer.text().catch(() => ''));
      throw body === undefined
        ? refusalOf(new Error(`${answer.status} ${answer.statusText}`))
        : new Refusal({
            gate: answer.status < 500 && body.code !== 'not-found',
            code: body.code,
            reason: body.reason,
            unblock: body.unblock,
            words: body.words,
          });
    }
    try {
      return await read(answer);
    } catch (caught) {
      throw lost(caught);
    }
  }

  private run<A, E>(call: (api: ApiClient) => Effect.Effect<A, E>, signal: AbortSignal | undefined, keepalive = false): Promise<A> {
    const work = Effect.suspend(() =>
      this.client === null
        ? Effect.flatMap(bind(this.origin.http, this.heard), (client) => {
            this.client = client;
            return call(client);
          })
        : call(this.client),
    ).pipe(
      Effect.catch((error) => Effect.flatMap(serverFault(error), (refusal) => Effect.fail(this.hinted(refusal)))),
      Effect.catchDefect((defect) => Effect.fail(refusalOf(readableDefect(defect)))),
      Effect.provideService(FetchHttpClient.Fetch, this.fetch),
      Effect.provideService(ThreadEntryKinds, this.entries),
    );
    this.asking += 1;
    return Effect.runPromise(
      keepalive ? Effect.provideService(work, FetchHttpClient.RequestInit, { keepalive: true }) : work,
      this.leaving || signal === undefined ? undefined : { signal },
    ).finally(() => {
      this.asking -= 1;
    });
  }
}
