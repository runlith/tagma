export type Seat = { readonly active: string };

export class SeatWorld {
  constructor(readonly settles: boolean) {}

  open = $state(true);
  seat = $state<Seat | null>(null);
  tick = $state(0);
  readonly failures: unknown[] = [];
}
