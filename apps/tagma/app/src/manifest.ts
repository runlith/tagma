import type { runtime } from '$lib/app/runtime.js';

declare module '@runlith/layer/door' {
  interface Manifest {
    readonly app: typeof runtime;
  }
}
