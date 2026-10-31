<script lang="ts">
  import { provideErrorBoundaryConfig } from '@runlith/error-boundary/error-boundary-config.svelte';

  import type { Point } from '../../../Point.js';
  import type { Shown } from '../../payload.js';
  import PointView from '../../PointView.svelte';

  type Panel = Shown<{ label: string }> & { readonly id: string };

  let { point }: { point: Point<Panel> } = $props();

  provideErrorBoundaryConfig({ policy: { reportingEnabled: false } });
</script>

<PointView {point} props={{ label: 'owner' }} />
