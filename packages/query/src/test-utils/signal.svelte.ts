export type Signal<T> = {
  get(): T;
  set(next: T): void;
  update(updater: (prev: T) => T): void;
};

export function createSignal<T>(initial: T): Signal<T> {
  let value = $state(initial);

  return {
    get() {
      return value;
    },
    set(next) {
      value = next;
    },
    update(updater) {
      value = updater(value);
    },
  };
}
