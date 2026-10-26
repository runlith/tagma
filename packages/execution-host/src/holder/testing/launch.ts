import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect, type Layer } from 'effect';
import { Adapter, PIPES, PTY, cleanup, drain, finished, launch, pipes, request, terminal, using } from './Adapter';
import { Holder, type HeldLaunch } from '../Holder';

export const launchContracts = (name: string, services: Layer.Layer<Adapter | Holder, unknown>) =>
  layer(services, { excludeTestServices: true })(`${name} launch contracts`, (it) => {
    const refusal = Effect.fnUntraced(function* (holder: Holder['Service'], spec: HeldLaunch) {
      const outcome = yield* Effect.result(holder.launch(spec));
      if (outcome._tag === 'Success') yield* cleanup(outcome.success);
      expect(outcome._tag === 'Failure' ? outcome.failure : undefined).toMatchObject({ _tag: 'HolderRefused', act: 'launch' });
      return outcome._tag === 'Failure' && outcome.failure._tag === 'HolderRefused' ? outcome.failure : undefined;
    });

    for (const transport of [PTY, PIPES]) {
      const tag = transport._tag;
      const output = (child: Effect.Success<ReturnType<Holder['Service']['launch']>>) =>
        drain(child.channels._tag === 'pty' ? terminal(child) : pipes(child).stdout);

      it.effect(`${tag}: passes an empty environment exactly`, () =>
        Effect.gen(function* () {
          const adapter = yield* Adapter;
          const holder = yield* Holder;
          const child = yield* holder.launch(request(adapter, adapter.environment, transport));
          yield* using(
            child,
            Effect.gen(function* () {
              expect((yield* output(child)).toString()).toBe('');
              expect((yield* finished(child)).exit).toEqual({ _tag: 'Code', code: 0 });
            }),
          );
        }),
      );

      it.effect(`${tag}: passes the named environment exactly without substituting SHELL`, () =>
        Effect.gen(function* () {
          const adapter = yield* Adapter;
          const holder = yield* Holder;
          const env = [
            { name: 'CONTRACT_VALUE', value: 'λ spaces = value' },
            { name: 'HOME', value: adapter.home },
            { name: 'SHELL', value: adapter.missing },
          ];
          const child = yield* holder.launch({ ...request(adapter, adapter.environment, transport), env });
          yield* using(
            child,
            Effect.gen(function* () {
              const lines = (yield* output(child)).toString().replaceAll('\r', '').trim().split('\n').sort();
              expect(lines).toEqual(env.map(({ name, value }) => `${name}=${value}`).sort());
              yield* finished(child);
            }),
          );
        }),
      );

      it.effect(`${tag}: runs in the explicit cwd`, () =>
        Effect.gen(function* () {
          const adapter = yield* Adapter;
          const holder = yield* Holder;
          const child = yield* holder.launch({ ...request(adapter, adapter.cwd, transport), cwd: adapter.home });
          yield* using(
            child,
            Effect.gen(function* () {
              expect((yield* output(child)).toString().trim()).toBe(adapter.home);
              yield* finished(child);
            }),
          );
        }),
      );

      it.effect(`${tag}: uses only the supplied HOME when cwd is omitted`, () =>
        Effect.gen(function* () {
          const adapter = yield* Adapter;
          const holder = yield* Holder;
          const child = yield* holder.launch({
            ...request(adapter, adapter.cwd, transport),
            cwd: undefined,
            env: [{ name: 'HOME', value: adapter.home }],
          });
          yield* using(
            child,
            Effect.gen(function* () {
              expect((yield* output(child)).toString().trim()).toBe(adapter.home);
              yield* finished(child);
            }),
          );
        }),
      );

      it.effect(`${tag}: uses the OS user home when cwd and HOME are omitted`, () =>
        Effect.gen(function* () {
          const adapter = yield* Adapter;
          const holder = yield* Holder;
          yield* Effect.acquireRelease(
            Effect.sync(() => {
              const before = process.env.HOME;
              process.env.HOME = adapter.home;
              return before;
            }),
            (before) =>
              Effect.sync(() => {
                if (before === undefined) delete process.env.HOME;
                else process.env.HOME = before;
              }),
          );
          const child = yield* holder.launch({ ...request(adapter, adapter.cwd, transport), cwd: undefined });
          yield* using(
            child,
            Effect.gen(function* () {
              expect((yield* output(child)).toString().trim()).toBe(adapter.userHome);
              yield* finished(child);
            }),
          );
        }),
      );

      it.effect(`${tag}: refuses a cwd that is a file even with valid HOME`, () =>
        Effect.gen(function* () {
          const adapter = yield* Adapter;
          yield* refusal(yield* Holder, {
            ...request(adapter, adapter.cwd, transport),
            cwd: adapter.file,
            env: [{ name: 'HOME', value: adapter.home }],
          });
        }),
      );

      it.effect(`${tag}: refuses a relative cwd`, () =>
        Effect.gen(function* () {
          const adapter = yield* Adapter;
          yield* refusal(yield* Holder, { ...request(adapter, adapter.cwd, transport), cwd: '.' });
        }),
      );

      it.effect(`${tag}: resolves a bare program by the supplied relative PATH at cwd`, () =>
        Effect.gen(function* () {
          const adapter = yield* Adapter;
          const holder = yield* Holder;
          const child = yield* holder.launch({
            ...request(adapter, { path: adapter.pathName, args: [] }, transport),
            env: [{ name: 'PATH', value: adapter.relativeSearchPath }],
          });
          yield* using(
            child,
            Effect.gen(function* () {
              expect((yield* output(child)).toString()).toBe('path-only');
              yield* finished(child);
            }),
          );
        }),
      );

      it.effect(`${tag}: refuses a bare program without PATH instead of inheriting the host PATH`, () =>
        Effect.gen(function* () {
          const adapter = yield* Adapter;
          yield* refusal(yield* Holder, request(adapter, { path: adapter.pathName, args: [] }, transport));
        }),
      );

      it.effect(`${tag}: refuses a NUL in an environment value`, () =>
        Effect.gen(function* () {
          const adapter = yield* Adapter;
          yield* refusal(yield* Holder, {
            ...request(adapter, adapter.environment, transport),
            env: [{ name: 'A', value: 'x\u0000B=y' }],
          });
        }),
      );

      it.effect(`${tag}: refuses an environment name containing equals`, () =>
        Effect.gen(function* () {
          const adapter = yield* Adapter;
          yield* refusal(yield* Holder, {
            ...request(adapter, adapter.environment, transport),
            env: [{ name: 'A=B', value: 'x' }],
          });
        }),
      );

      for (const pace of ['full', 'low', 'lowest'] as const) {
        it.effect(`${tag}: refuses a missing executable at ${pace}`, () =>
          Effect.gen(function* () {
            const adapter = yield* Adapter;
            const failed = yield* refusal(yield* Holder, { ...request(adapter, { path: adapter.missing, args: [] }, transport), pace });
            expect(failed?.reason).toBe('not-found');
          }),
        );
      }

      it.effect(`${tag}: refuses a launch without retaining holder or logic descriptors`, () =>
        Effect.gen(function* () {
          const adapter = yield* Adapter;
          const holder = yield* Holder;
          const before = yield* adapter.descriptors(holder.pid);
          yield* refusal(holder, request(adapter, { path: adapter.missing, args: [] }, transport));
          expect(yield* adapter.descriptors(holder.pid)).toEqual(before);
        }),
      );

      it.effect(`${tag}: gives the child no unrelated descriptors`, () =>
        Effect.gen(function* () {
          const child = yield* launch(transport, 'handles');
          yield* using(
            child,
            Effect.gen(function* () {
              expect((yield* output(child)).toString()).toBe('');
              expect((yield* finished(child)).exit).toEqual({ _tag: 'Code', code: 0 });
            }),
          );
        }),
      );

      it.effect(`${tag}: inherits the launcher soft limits rather than the holder descriptor reserve`, () =>
        Effect.gen(function* () {
          const adapter = yield* Adapter;
          const expected = yield* adapter.softLimits;
          const child = yield* launch(transport, 'limits');
          yield* using(
            child,
            Effect.gen(function* () {
              expect((yield* output(child)).toString().replaceAll('\r', '')).toBe(expected);
              expect((yield* finished(child)).exit).toEqual({ _tag: 'Code', code: 0 });
            }),
          );
        }),
      );
    }
  });
