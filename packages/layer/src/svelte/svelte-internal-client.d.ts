declare module 'svelte/internal/client' {
  export function without_reactive_context<T>(fn: () => T): T;
}
