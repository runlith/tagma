<script lang="ts">
  import { ModelFields, type ModelFieldProps } from '$lib/features/settings/controls/modelField.js';

  let props: ModelFieldProps = $props();

  const Field = ModelFields.use().field;
</script>

<Field {...props} />
