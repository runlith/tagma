import { describe, expect, test } from 'bun:test';
import { createEventEmitter, createKeyedEventEmitter } from './event.js';

describe('@runlith/utils event emitter', () => {
  test('fans out events and unsubscribes listeners independently', () => {
    const emitter = createEventEmitter<[string, number]>(() => {});
    const events: string[] = [];
    const unsubscribeFirst = emitter.subscribe((label, value) => events.push(`first:${label}:${value}`));
    emitter.subscribe((label, value) => events.push(`second:${label}:${value}`));

    expect(emitter.size).toBe(2);
    emitter.emit('run', 1);
    unsubscribeFirst();
    emitter.emit('run', 2);

    expect(events).toEqual(['first:run:1', 'second:run:1', 'second:run:2']);
    expect(emitter.size).toBe(1);
  });

  test('a failing listener is reported and the others still receive the event', () => {
    const failures: unknown[] = [];
    const emitter = createKeyedEventEmitter<string, [string]>((error) => failures.push(error));
    const events: string[] = [];
    const broken = new Error('listener failed');
    emitter.subscribe('thread', () => {
      throw broken;
    });
    emitter.subscribe('thread', (value) => events.push(value));

    emitter.emit('thread', 'delivered');

    expect(events).toEqual(['delivered']);
    expect(failures).toEqual([broken]);
  });
});

describe('@runlith/utils keyed event emitter', () => {
  test('fans out only to listeners for the emitted key', () => {
    const emitter = createKeyedEventEmitter<string, [number]>(() => {});
    const events: string[] = [];
    const unsubscribeA = emitter.subscribe('a', (value) => events.push(`a:${value}`));
    emitter.subscribe('b', (value) => events.push(`b:${value}`));

    expect(emitter.size).toBe(2);
    emitter.emit('a', 1);
    unsubscribeA();
    emitter.emit('a', 2);
    emitter.emit('b', 3);

    expect(events).toEqual(['a:1', 'b:3']);
    expect(emitter.size).toBe(1);
  });

  test('does not let stale unsubscribe clear newer listeners for the same key', () => {
    const emitter = createKeyedEventEmitter<string, [string]>(() => {});
    const events: string[] = [];
    const unsubscribeOld = emitter.subscribe('scope', (value) => events.push(`old:${value}`));

    emitter.clear();
    emitter.subscribe('scope', (value) => events.push(`new:${value}`));
    unsubscribeOld();
    emitter.emit('scope', 'event');

    expect(events).toEqual(['new:event']);
  });
});
