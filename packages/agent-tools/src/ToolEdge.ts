import { Tool, ToolFailed } from '@runlith/agent/tool';
import { SpawnAnnotation, type SpawnObservation } from '@runlith/executions/executionSpawner';
import { Data, Effect, Layer } from 'effect';
import type { FileSystem, PlatformError } from 'effect';
import type { ChildProcessSpawner } from 'effect/process';
import type { Refusal } from './refusals';

export class WorkspaceRefused extends Data.TaggedError('WorkspaceRefused')<{
  readonly attempted: string;
  readonly root: string;
}> {
  override get message(): string {
    return `Path escapes workspace root: ${this.attempted} (root: ${this.root})`;
  }
}

export type ToolEdgeFailure = ToolFailed | WorkspaceRefused | PlatformError.PlatformError;

export type ToolServices = FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner;

export type ToolEffect<R = never> = Effect.Effect<string | Tool.ToolAnswer, ToolEdgeFailure, R>;

export function foreignCause(error: unknown): ToolFailed {
  return new ToolFailed({ reason: error instanceof Error ? error.message : String(error) });
}

const supportLabel = (command: SpawnObservation['command']): string => [command.program, ...command.args].join(' ');

const supporting = (call: Tool.ToolCallDispatchOptions, links: Set<() => void>): ((spawn: SpawnObservation) => void) | undefined => {
  const progress = call.progress;
  if (progress === undefined) return undefined;
  return (spawn) => {
    links.add(
      progress.link({
        execution: spawn.execution,
        operation: spawn.operation,
        kind: 'support',
        label: supportLabel(spawn.command),
      }),
    );
  };
};

const underCall = <A, E, R>(
  call: Tool.ToolCallDispatchOptions | undefined,
  links: Set<() => void>,
  body: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> => {
  if (call === undefined) return body;
  const observed = supporting(call, links);
  return Effect.flatMap(SpawnAnnotation, (inherited) =>
    Effect.provideService(body, SpawnAnnotation, {
      ...inherited,
      correlation: call.toolCallId,
      stop: call.progress ?? inherited?.stop,
      observed: observed ?? inherited?.observed,
    }),
  );
};

const releaseLinks = (links: Set<() => void>): void => {
  for (const release of links) release();
  links.clear();
};

export function unboundTool(tool: string, resource: string): Effect.Effect<never, ToolFailed> {
  return Effect.fail(new ToolFailed({ reason: renderFailure(tool, `this world binds no ${resource}`) }));
}

export function runToolEffect<A, E, R>(
  tool: string,
  services: Layer.Layer<R>,
  body: Effect.Effect<A, E, R>,
  call?: Tool.ToolCallDispatchOptions,
): Effect.Effect<A, ToolFailed> {
  const failed = (value: unknown) =>
    value instanceof ToolFailed
      ? new ToolFailed({
          reason: renderFailure(tool, value.reason),
          code: value.code,
          unblock: value.unblock,
        })
      : value instanceof WorkspaceRefused
        ? new ToolFailed({ reason: renderFailure(tool, value.message), code: 'outside-workspace' satisfies Refusal })
        : new ToolFailed({ reason: renderFailure(tool, failureText(value)) });
  return Effect.acquireUseRelease(
    Effect.sync(() => new Set<() => void>()),
    (links) => underCall(call, links, body.pipe(Effect.provide(services))),
    (links) => Effect.sync(() => releaseLinks(links)),
  ).pipe(Effect.mapError(failed), Effect.catchDefect(failed));
}

export function prepareToolEffect<A, E, R>(services: Layer.Layer<R>, body: Effect.Effect<A, E, R>): Effect.Effect<A, E> {
  return Effect.flatMap(SpawnAnnotation, (inherited) =>
    body.pipe(Effect.provide(services), Effect.provideService(SpawnAnnotation, { ...inherited })),
  );
}

function renderFailure(tool: string, message: string): string {
  return `[${tool}] error: ${message}`;
}

function failureText(value: unknown): string {
  if (value instanceof Error && 'cause' in value && value.cause instanceof Error && isPlatformShaped(value)) {
    return value.cause.message;
  }
  return value instanceof Error ? value.message : String(value);
}

function isPlatformShaped(error: Error): boolean {
  return '_tag' in error && 'module' in error && 'method' in error;
}
