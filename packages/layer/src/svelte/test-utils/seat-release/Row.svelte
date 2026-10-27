<script lang="ts">
  let { active, tick }: { active: string; tick: number } = $props();
</script>

<b data-testid="row" class={active === 'one' ? 'on' : 'off'}>{tick}</b>
