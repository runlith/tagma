import type { Cell } from './cell.js';

export function reactiveCell<T>(): Cell<T> {
  let value = $state.raw<T | undefined>(undefined);
  return {
    get current() {
      return value;
    },
    set current(next) {
      value = next;
    },
  };
}
