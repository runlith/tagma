import { Data, Schema } from 'effect';

export const PageException = Schema.Struct({ name: Schema.String, message: Schema.String, stack: Schema.String });
export class PageFailed extends Data.TaggedError('PageFailed')<{ readonly message: string }> {}
export type PageException = typeof PageException.Type;
export const pageFailure = (error: PageException): PageFailed => {
  const message = `${error.name}: ${error.message}`;
  return new PageFailed({ message: error.stack.startsWith(message) ? error.stack : [message, error.stack].filter(Boolean).join('\n') });
};

export const errorScript = (send: string): string => `(() => {
  if (globalThis.__runlithE2eErrors) return;
  const pending = [];
  let failed;
  globalThis.__runlithE2eErrors = {
    flush: async () => { await Promise.all(pending); if (failed) throw failed; }
  };
  const send = ${send};
  const report = (error) => {
    if (!(error instanceof Error)) return;
    const value = { name: error.name, message: error.message, stack: error.stack ?? '' };
    try { pending.push(Promise.resolve(send(value)).catch(error => { failed = error; })); }
    catch (error) { failed = error; }
  };
  addEventListener('error', event => report(event.error));
  addEventListener('unhandledrejection', event => report(event.reason));
})()`;

export const flushErrors = 'globalThis.__runlithE2eErrors.flush()';
