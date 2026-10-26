<script lang="ts">
  interface Props {
    error: unknown;
  }

  let { error }: Props = $props();

  $effect(() => {
    throw error;
  });
</script>
