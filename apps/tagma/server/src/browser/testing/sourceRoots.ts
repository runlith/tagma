import { Context, Effect, Layer } from 'effect';
import { join } from 'node:path';
import { ServedRoots } from '../contract/service/sources.js';

export class ServedOrigins extends Context.Service<ServedOrigins, { readonly roots: Map<string, string> }>()('testing/ServedOrigins') {}

export const sourceRoots = (home: string) =>
  Layer.effectContext(
    Effect.sync(() => {
      const roots = new Map<string, string>();
      return Context.make(ServedOrigins, { roots }).pipe(
        Context.add(ServedRoots, {
          root: (_project, origin) => Effect.succeed(roots.get(origin) ?? join(home, 'dev')),
        }),
      );
    }),
  );
