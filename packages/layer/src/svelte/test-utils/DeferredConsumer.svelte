<script lang="ts">
  import { Search } from './deferred-fixtures.js';

  const engine = await Search.use();
</script>

<p data-testid="found">{engine.find('book')}</p>
