<script lang="ts">
  import { Router } from '@runlith/layer/Router';
  import { MainWindow } from '$lib/shared/desktop/MainWindow.js';

  const main = MainWindow.find();
  const router = Router.use();

  $effect(() => main?.onReveal((path) => void router.goto(path)));
</script>
