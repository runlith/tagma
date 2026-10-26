import { unthreadedCaller } from './testing/caller';
import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Cause, Deferred, Effect, Exit, Fiber } from 'effect';
import { Tool, ToolAnswer, ToolFailed, toolExecute } from '@runlith/agent/tool';
import { createWebfetchTool } from './webfetch';
import { machineWorld } from './world/machine';
import type { Egress } from './world';

function fetching(egress: Egress): Tool {
  return createWebfetchTool({ egress });
}

const runOf = (tool: Tool) => Effect.fromNullishOr(toolExecute(tool)).pipe(Effect.orDie);

describe('webfetch body and cancellation', () => {
  it.effect('cancels a streaming response as soon as it exceeds the byte limit', () =>
    Effect.gen(function* () {
      let cancelled = false;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(3 * 1024 * 1024));
          controller.enqueue(new Uint8Array(3 * 1024 * 1024));
        },
        cancel() {
          cancelled = true;
        },
      });
      const tool = fetching({
        ...machineWorld.egress,
        fetch: (async () => new Response(stream, { status: 200 })) as unknown as typeof fetch,
      });

      const result = yield* execute(tool, { url: 'https://public.example/large' });

      expect(result).toContain('Response too large');
      expect(cancelled).toBe(true);
    }),
  );

  it.effect('cancels an in-flight response body when the call is interrupted', () =>
    Effect.gen(function* () {
      const cancelled = Deferred.makeUnsafe<void>();
      const started = Deferred.makeUnsafe<void>();
      const stream = new ReadableStream<Uint8Array>(
        {
          pull() {
            Deferred.doneUnsafe(started, Exit.void);
            return new Promise<void>(() => undefined);
          },
          cancel() {
            Deferred.doneUnsafe(cancelled, Exit.void);
          },
        },
        { highWaterMark: 0 },
      );
      const tool = fetching({
        ...machineWorld.egress,
        fetch: (async () => new Response(stream, { status: 200 })) as unknown as typeof fetch,
      });

      const run = yield* runOf(tool);
      const pending = yield* Effect.forkChild(
        run({ url: 'https://public.example/stream' }, { toolCallId: 'call-1', caller: unthreadedCaller, messages: [] }),
      );
      yield* Deferred.await(started);
      const ended = yield* Fiber.interrupt(pending).pipe(Effect.andThen(Fiber.await(pending)));

      expect(Exit.isFailure(ended) && Cause.hasInterruptsOnly(ended.cause)).toBe(true);
      yield* Deferred.await(cancelled);
    }),
  );

  it.live('reports its own timeout distinctly and cancels the response body', () =>
    Effect.gen(function* () {
      let cancelled = false;
      const stream = new ReadableStream<Uint8Array>({
        pull() {
          return new Promise<void>(() => undefined);
        },
        cancel() {
          cancelled = true;
        },
      });
      const tool = fetching({
        ...machineWorld.egress,
        fetch: (async () => new Response(stream, { status: 200 })) as unknown as typeof fetch,
      });

      const result = yield* execute(tool, { url: 'https://public.example/stream', timeout: 0.01 });

      expect(result).toContain('Request timed out');
      expect(cancelled).toBe(true);
    }),
  );
});

describe('webfetch pictures', () => {
  it.effect('an image answer hands its bytes to the door as a picture under its type', () =>
    Effect.gen(function* () {
      const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
      const tool = fetching({
        ...machineWorld.egress,
        fetch: (async () => new Response(bytes, { status: 200, headers: { 'content-type': 'image/png' } })) as unknown as typeof fetch,
      });
      const run = yield* runOf(tool);

      const settled = yield* run(
        { url: 'https://public.example/shot.png' },
        { toolCallId: 'call-1', caller: unthreadedCaller, messages: [] },
      ) as Effect.Effect<unknown, ToolFailed>;

      if (!(settled instanceof ToolAnswer)) return yield* Effect.die(new Error('an image must answer'));
      expect(settled.media.map((medium) => [medium.mediaType, [...medium.bytes]])).toEqual([['image/png', [...bytes]]]);
    }),
  );
});

describe('webfetch redirects', () => {
  const chain = (pages: Record<string, Response>) => {
    const asked: string[] = [];
    return {
      asked,
      egress: {
        ...machineWorld.egress,
        fetch: (async (input: URL | string) => {
          const url = String(input);
          asked.push(url);
          const answer = pages[url];
          if (!answer) throw new Error(`nothing serves ${url}`);
          return answer;
        }) as unknown as typeof fetch,
      } satisfies Egress,
    };
  };

  const moved = (to: string) => new Response(null, { status: 302, headers: { location: to } });

  it.effect('a redirect inside the approved origin is the same reach and is followed', () =>
    Effect.gen(function* () {
      const { asked, egress } = chain({
        'https://public.example/doc': moved('/doc/'),
        'https://public.example/doc/': new Response('the page', { status: 200, headers: { 'content-type': 'text/plain' } }),
      });

      const result = yield* execute(fetching(egress), { url: 'https://public.example/doc' });

      expect(result).toContain('the page');
      expect(asked).toEqual(['https://public.example/doc', 'https://public.example/doc/']);
    }),
  );

  it.effect('a redirect between a site and its www name is the same reach and is followed', () =>
    Effect.gen(function* () {
      for (const [from, to] of [
        ['https://www.public.example/doc', 'https://public.example/doc'],
        ['https://public.example/doc', 'https://www.public.example/doc'],
      ] as const) {
        const { asked, egress } = chain({
          [from]: moved(to),
          [to]: new Response('the page', { status: 200, headers: { 'content-type': 'text/plain' } }),
        });

        const result = yield* execute(fetching(egress), { url: from });

        expect(result).toContain('the page');
        expect(asked).toEqual([from, to]);
      }
    }),
  );

  it.effect('a www redirect that changes scheme or port still refuses', () =>
    Effect.gen(function* () {
      for (const to of ['http://public.example/doc', 'https://public.example:8443/doc', 'https://www.other.example/doc']) {
        const { asked, egress } = chain({ 'https://www.public.example/doc': moved(to) });

        const result = yield* execute(fetching(egress), { url: 'https://www.public.example/doc' });

        expect(result).toContain('different origin');
        expect(asked).toEqual(['https://www.public.example/doc']);
      }
    }),
  );

  it.effect('a redirect that leaves the approved origin refuses and names where it would have gone', () =>
    Effect.gen(function* () {
      const { asked, egress } = chain({
        'https://public.example/out': moved('https://elsewhere.example/landed'),
        'https://elsewhere.example/landed': new Response('bytes nobody approved', { status: 200 }),
      });

      const result = yield* execute(fetching(egress), { url: 'https://public.example/out' });

      expect(result).toContain('https://elsewhere.example/landed');
      expect(result).toContain('different origin');
      expect(asked).toEqual(['https://public.example/out']);
    }),
  );

  it.effect('a chain that never settles inside the origin stops rather than following for ever', () =>
    Effect.gen(function* () {
      const { asked, egress } = chain({
        'https://public.example/loop': moved('https://public.example/loop'),
      });

      const result = yield* execute(fetching(egress), { url: 'https://public.example/loop' });

      expect(result).toContain('Too many redirects');
      expect(asked).toHaveLength(6);
    }),
  );

  it.effect('a crossing after a same-origin hop refuses and names the hop that moved', () =>
    Effect.gen(function* () {
      const { asked, egress } = chain({
        'https://public.example/a': moved('/b'),
        'https://public.example/b': moved('https://elsewhere.example/c'),
      });

      const result = yield* execute(fetching(egress), { url: 'https://public.example/a' });

      expect(result).toContain('https://public.example/b redirects to https://elsewhere.example/c');
      expect(asked).toEqual(['https://public.example/a', 'https://public.example/b']);
    }),
  );

  it.effect('a location that only looks like this origin is resolved before it is compared', () =>
    Effect.gen(function* () {
      for (const location of ['//elsewhere.example/x', '/\\elsewhere.example/x', 'https://public.example@elsewhere.example/x']) {
        const { asked, egress } = chain({ 'https://public.example/out': moved(location) });
        const result = yield* execute(fetching(egress), { url: 'https://public.example/out' });
        expect(result).toContain('elsewhere.example');
        expect(result).toContain('different origin');
        expect(asked).toEqual(['https://public.example/out']);
      }
    }),
  );

  it.effect('an egress that followed the redirect anyway is caught by where the answer says it came from', () =>
    Effect.gen(function* () {
      const followed = new Response('bytes nobody approved', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      });
      Object.defineProperty(followed, 'url', { value: 'https://elsewhere.example/landed' });
      const tool = fetching({ ...machineWorld.egress, fetch: (async () => followed) as unknown as typeof fetch });

      const result = yield* execute(tool, { url: 'https://public.example/out' });

      expect(result).toContain('different origin');
      expect(result).toContain('https://elsewhere.example/landed');
      expect(result).not.toContain('bytes nobody approved');
    }),
  );
});

const execute = Effect.fnUntraced(function* (entry: Tool, input: { url: string; timeout?: number }) {
  const run = yield* runOf(entry);
  const settled = yield* (
    run(input, { toolCallId: 'call-1', caller: unthreadedCaller, messages: [] }) as Effect.Effect<unknown, ToolFailed>
  ).pipe(Effect.catch((failure) => Effect.succeed(failure.reason)));
  return String(settled instanceof ToolAnswer ? settled.value : settled);
});
