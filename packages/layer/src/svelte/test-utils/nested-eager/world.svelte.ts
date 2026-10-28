export class EagerWorld {
  open = $state(true);
  closing = $state(false);
  ticks = $state(0);
  seen = 0;
}
