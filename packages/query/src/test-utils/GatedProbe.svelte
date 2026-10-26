<script lang="ts">
  type Gate = {
    readonly data: unknown;
    readonly isDisabled: boolean;
    readonly isLoading: boolean;
  };

  type Props = {
    gate: Gate;
  };

  let { gate }: Props = $props();

  let data = $derived(gate.data);
  let disabled = $derived(gate.isDisabled);
</script>

<div data-testid="gated-probe">{String(data)}:{String(disabled)}</div>
