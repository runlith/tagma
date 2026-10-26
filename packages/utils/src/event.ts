export type EventEmitter<TArgs extends readonly unknown[] = []> = {
  readonly size: number;
  subscribe(listener: (...args: TArgs) => void): () => void;
  emit(...args: TArgs): void;
  clear(): void;
};

export type KeyedEventEmitter<TKey, TArgs extends readonly unknown[] = []> = {
  readonly size: number;
  keys(): TKey[];
  subscribe(key: TKey, listener: (...args: TArgs) => void): () => void;
  emit(key: TKey, ...args: TArgs): void;
  clear(): void;
};

export type ListenerFailed = (error: unknown) => void;

export function createEventEmitter<TArgs extends readonly unknown[] = []>(failed: ListenerFailed): EventEmitter<TArgs> {
  const listeners = new Set<(...args: TArgs) => void>();
  return {
    get size() {
      return listeners.size;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(...args) {
      for (const listener of listeners) {
        try {
          listener(...args);
        } catch (error) {
          failed(error);
        }
      }
    },
    clear() {
      listeners.clear();
    },
  };
}

export function createKeyedEventEmitter<TKey, TArgs extends readonly unknown[] = []>(
  failed: ListenerFailed,
): KeyedEventEmitter<TKey, TArgs> {
  const emitters = new Map<TKey, EventEmitter<TArgs>>();
  return {
    get size() {
      let count = 0;
      for (const emitter of emitters.values()) count += emitter.size;
      return count;
    },
    keys() {
      return [...emitters.keys()];
    },
    subscribe(key, listener) {
      let emitter = emitters.get(key);
      if (!emitter) {
        emitter = createEventEmitter<TArgs>(failed);
        emitters.set(key, emitter);
      }
      const unsubscribe = emitter.subscribe(listener);
      return () => {
        unsubscribe();
        if (emitter.size === 0 && emitters.get(key) === emitter) emitters.delete(key);
      };
    },
    emit(key, ...args) {
      emitters.get(key)?.emit(...args);
    },
    clear() {
      for (const emitter of emitters.values()) emitter.clear();
      emitters.clear();
    },
  };
}
