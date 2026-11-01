<script lang="ts">
  import type { CreationFieldProps } from './creation.js';

  let { draft }: CreationFieldProps = $props();
</script>

<p data-testid="creation-offer">Sealed marks for {draft.name || 'a project'} come with warmth.</p>
