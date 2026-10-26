import { Data, type Effect, type Schema } from 'effect';
import type { HttpExecutor } from '../llm/route/executor';
import type { LLMError } from '../llm/schema/errors';
import type { LLMResponse } from '../llm/schema/events';
import type { JsonSchema } from '../llm/schema/ids';
import type { Message, VendorWire } from '../llm/schema/messages';

export class WebRefused extends Data.TaggedError('WebRefused')<{ readonly reason: string }> {
  override get message(): string {
    return this.reason;
  }
}

export type PageRequest = {
  readonly headers: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
};

export type WebPages = {
  fetch(url: URL, request: PageRequest): Promise<Response>;
  markdown(html: string): Promise<string>;
};

export type WebMemory = {
  page(url: string): string | undefined;
  keep(url: string, content: string): void;
  allowed(host: string): boolean;
  allow(host: string): void;
};

export type WebLifetimes = {
  readonly pageMs: number;
  readonly domainMs: number;
};

export type WebPageCall = {
  readonly pages: WebPages;
  readonly memory: WebMemory;
};

export type ErrandRead<A> = { readonly value: A; readonly response: LLMResponse };

export type ErrandMeasure = <A, E, R>(model: string, work: Effect.Effect<ErrandRead<A>, E, R>) => Effect.Effect<A, E, R>;

export type WebWire = {
  readonly vendor: VendorWire;
  readonly description: string;
  readonly inputSchema: JsonSchema;
};

export type WebTargets = {
  readonly queries: readonly string[];
  readonly pages: readonly string[];
};

export type WebTool<C, R> = {
  readonly wire: WebWire;
  readonly input: Schema.Codec<unknown, unknown>;
  reads(input: unknown): boolean;
  targets(input: unknown): WebTargets;
  run(input: unknown, call: C): Effect.Effect<string, LLMError | WebRefused, R>;
};

export type WebTools<T> = { readonly websearch: T; readonly webfetch?: T } | { readonly websearch?: undefined; readonly webfetch: T };

export type WebToolName = 'websearch' | 'webfetch';

export const mapWebTools = <A, B>(tools: WebTools<A>, map: (tool: A) => B): WebTools<B> => {
  const webfetch = tools.webfetch === undefined ? undefined : map(tools.webfetch);
  if (tools.websearch !== undefined) return { websearch: map(tools.websearch), webfetch };
  if (webfetch !== undefined) return { webfetch };
  throw new Error('A vendor web declares at least one of websearch and webfetch.');
};

export type ServedWebCall = { readonly messages: readonly Message[] };

export type VendorWebCall = ServedWebCall & { readonly measure: ErrandMeasure };

export type VendorWeb =
  | { readonly lifetimes?: undefined; readonly tools: WebTools<WebTool<VendorWebCall, HttpExecutor>> }
  | { readonly lifetimes: WebLifetimes; readonly tools: WebTools<WebTool<VendorWebCall & WebPageCall, HttpExecutor>> };

export type ServedWeb =
  | { readonly lifetimes?: undefined; readonly tools: WebTools<WebTool<ServedWebCall, never>> }
  | { readonly lifetimes: WebLifetimes; readonly tools: WebTools<WebTool<ServedWebCall & WebPageCall, never>> };
