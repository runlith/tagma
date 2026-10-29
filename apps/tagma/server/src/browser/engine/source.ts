import { Component, COMPONENT } from '@runlith/cdp/describe';
import { Effect, FileSystem, Path, Schema } from 'effect';
import { ServedRoots } from '../contract/service/sources.js';
import type { Rendered } from '../contract/wire/pick.js';
import { CheckoutPaths } from '../../workspace/contract/service/checkoutPaths.js';
import type { Attached } from './drive.js';
import { actionFailed, type Located } from './target.js';

const candidateOf = Effect.fnUntraced(function* (file: string, page: string) {
  const path = yield* Path.Path;
  if (path.isAbsolute(file) || !URL.canParse(file)) return file;
  const address = new URL(file);
  if (address.protocol === 'file:') {
    return yield* path.fromFileUrl(address).pipe(Effect.catchTag('BadArgument', () => Effect.succeed(null)));
  }
  if (!URL.canParse(page) || address.origin !== new URL(page).origin || !/^https?:$/.test(address.protocol)) return null;
  try {
    const pathname = decodeURIComponent(address.pathname);
    if (!pathname.startsWith('/@fs/')) return `.${pathname}`;
    const absolute = pathname.slice(5);
    return path.isAbsolute(absolute) ? absolute : `/${absolute}`;
  } catch {
    return null;
  }
});

export const componentOf = Effect.fn('Automation.component')(function* (
  attached: Attached,
  located: Located,
  projectId: number,
  url: string,
) {
  const described = yield* Effect.acquireUseRelease(
    attached.session.send(
      'DOM.resolveNode',
      { backendNodeId: located.anchor.node, objectGroup: `${attached.group}:component` },
      located.child,
    ),
    (resolved) =>
      Effect.gen(function* () {
        if (resolved.object.objectId === undefined) return null;
        const prepared = yield* attached.session.send(
          'Runtime.callFunctionOn',
          {
            objectId: resolved.object.objectId,
            functionDeclaration: COMPONENT,
            throwOnSideEffect: true,
          },
          located.child,
        );
        if (prepared.exceptionDetails !== undefined || prepared.result.objectId === undefined) {
          yield* Effect.logInfo(
            `browser: component metadata was unavailable for ${located.ref}: ${prepared.exceptionDetails?.text ?? 'no reader was returned'}`,
          );
          return null;
        }
        const reply = yield* attached.session.send(
          'Runtime.callFunctionOn',
          {
            objectId: prepared.result.objectId,
            functionDeclaration: 'function () { return this(); }',
            returnByValue: true,
          },
          located.child,
        );
        if (reply.exceptionDetails !== undefined) {
          yield* Effect.logInfo(
            `browser: component metadata was unavailable for ${located.ref}: ${reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text}`,
          );
          return null;
        }
        return yield* Schema.decodeUnknownEffect(Schema.NullOr(Component))(reply.result.value).pipe(
          Effect.mapError((failure) => actionFailed(`component metadata could not be read: ${failure.message}`)),
        );
      }),
    () => Effect.orDie(attached.session.send('Runtime.releaseObjectGroup', { objectGroup: `${attached.group}:component` }, located.child)),
  );
  const component: Rendered | undefined =
    described === null
      ? undefined
      : {
          ...described,
          source: described.source === null ? null : { ...described.source, resolved: false, checkout: null },
        };
  if (component?.source == null) return component;
  let candidate = yield* candidateOf(component.source.file, url);
  if (candidate === null) return component;
  const path = yield* Path.Path;
  if (!path.isAbsolute(candidate)) {
    if (!URL.canParse(url)) return component;
    const page = new URL(url);
    const root = yield* (yield* ServedRoots).root(projectId, page.origin);
    if (root === null) return component;
    candidate = path.resolve(root, candidate);
  }
  const files = yield* FileSystem.FileSystem;
  if (!(yield* files.exists(candidate))) return component;
  const physical = yield* files.realPath(candidate);
  if ((yield* files.stat(physical)).type !== 'File') return component;
  const place = yield* (yield* CheckoutPaths).placeOf(projectId, physical);
  if (place === null) return component;
  return { ...component, source: { ...component.source, file: physical, resolved: true, checkout: place.root } };
});
