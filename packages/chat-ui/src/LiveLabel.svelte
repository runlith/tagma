<script lang="ts">
  import { inStep } from './inStep';

  let { active = false, text }: { active?: boolean; text: string } = $props();
</script>

<span class:active
  >{text}{#if active}<span class="clip" aria-hidden="true" {@attach inStep}><span class="lens"><span class="copy">{text}</span></span></span
    >{/if}</span
>

<style>
  .active {
    position: relative;
    display: inline-block;
    color: var(--muted-foreground);
  }
  .clip {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }
  .lens {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 300%;
    -webkit-mask-image: linear-gradient(90deg, transparent 37%, var(--foreground) 50%, transparent 63%);
    mask-image: linear-gradient(90deg, transparent 37%, var(--foreground) 50%, transparent 63%);
    animation: lens var(--beat) linear infinite;
  }
  .copy {
    position: absolute;
    top: 0;
    left: 0;
    width: calc(100% / 3);
    color: var(--foreground);
    animation: copy var(--beat) linear infinite;
  }
  @keyframes lens {
    from {
      transform: translateX(calc(-200% / 3));
    }
    to {
      transform: translateX(0);
    }
  }
  @keyframes copy {
    from {
      transform: translateX(200%);
    }
    to {
      transform: translateX(0);
    }
  }
</style>
