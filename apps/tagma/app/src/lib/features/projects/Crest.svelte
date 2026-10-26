<script lang="ts">
  import { inStep } from '@runlith/chat-ui/inStep';
</script>

<svg
  class="pointer-events-none absolute -inset-2 size-12 text-status-in-work"
  viewBox="-8 -8 48 48"
  fill="currentColor"
  aria-hidden="true"
  data-crest
  {@attach inStep}
>
  <rect class="animate-march" x="-2" y="-2" width="4" height="4" transform="translate(21.85 -4)" />
  <rect class="animate-march" x="-2" y="-2" width="4" height="4" transform="translate(27.84 -3.83) rotate(10.6)" />
  <rect class="animate-march" x="-2" y="-2" width="4" height="4" transform="translate(33.07 -1.07) rotate(45)" />
  <rect class="animate-march" x="-2" y="-2" width="4" height="4" transform="translate(35.83 4.16) rotate(79.4)" />
  <rect class="animate-march" x="-2" y="-2" width="4" height="4" transform="translate(36 10.15)" />
</svg>

<style>
  svg {
    --march-floor: 0.45;
  }

  rect:nth-child(2) {
    animation-delay: calc(var(--beat) / 10);
  }

  rect:nth-child(3) {
    animation-delay: calc(var(--beat) / 5);
  }

  rect:nth-child(4) {
    animation-delay: calc(var(--beat) * 0.3);
  }

  rect:nth-child(5) {
    animation-delay: calc(var(--beat) * 0.4);
  }
</style>
