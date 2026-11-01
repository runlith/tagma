<script lang="ts">
  import type { CreationFieldProps } from './creation.js';

  let { draft, value, put, refused }: CreationFieldProps = $props();
</script>

<label data-testid="creation-field" data-storage={draft.storage}>
  <input
    aria-label="Mark"
    value={typeof value === 'string' ? value : ''}
    oninput={(event) => put(event.currentTarget.value === '' ? undefined : event.currentTarget.value)}
  />
  {#if refused !== null}
    <span data-testid="creation-field-refused">{refused.text}</span>
  {/if}
</label>
