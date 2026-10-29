export type Grip = { readonly size: number };

export class GuardWorld {
  grip = $state<Grip | null>({ size: 1 });
  holding = $state(true);
  third = $state(true);
  readonly failures: unknown[] = [];
}
