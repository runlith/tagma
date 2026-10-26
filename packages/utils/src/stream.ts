import { isRecord } from './object.js';

export function isAsyncIterable<T = unknown>(value: unknown): value is AsyncIterable<T> {
  if (value === null || value === undefined) {
    return false;
  }

  return Symbol.asyncIterator in Object(value) && typeof Object(value)[Symbol.asyncIterator] === 'function';
}

export function isReadableStream<T = Uint8Array>(value: unknown): value is ReadableStream<T> {
  return isRecord(value) && 'getReader' in value && typeof value.getReader === 'function';
}

export function readableStreamFromAsyncIterable<T>(iterable: AsyncIterable<T>): ReadableStream<T> {
  const iterator = iterable[Symbol.asyncIterator]();

  return new ReadableStream<T>({
    async pull(controller) {
      const { done, value } = await iterator.next();
      if (done) {
        controller.close();
        return;
      }

      controller.enqueue(value);
    },
    async cancel(reason) {
      if (typeof iterator.return === 'function') {
        await iterator.return(reason);
      }
    },
  });
}
