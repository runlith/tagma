export function reactiveValue<T>(initial: T): { value: T } {
  let current = $state(initial);

  return {
    get value() {
      return current;
    },
    set value(next: T) {
      current = next;
    },
  };
}
