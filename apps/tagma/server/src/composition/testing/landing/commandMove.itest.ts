import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import { Effect } from 'effect';
import { call, MINE } from '../checkoutFixture.js';
import { base, commandLayer, commandWorld } from '../change-record/commandWorld.js';

layer(commandLayer, { excludeTestServices: true })('submitted moves', (it) => {
  it.effect('a git mv and an edit in one command land as one move when paths names only the destination', () =>
    Effect.gen(function* () {
      const s = yield* commandWorld();
      yield* call(s.mine.bash, {
        command: `mkdir -p lib && git mv src/a.ts lib/a.ts && printf 'const six = 6;\\n' >> lib/a.ts`,
        description: 'Move and extend a file',
      });
      yield* s.decided(MINE);

      const landed = yield* s.w.submit(MINE, { commands: s.commands, paths: ['lib/a.ts'] });
      expect(landed).toMatchObject({ status: 'landed', committed: ['lib/a.ts', 'src/a.ts'] });
      expect(yield* s.w.run(['status', '--porcelain'])).toBe('');
      expect(yield* s.w.run(['show', 'HEAD:lib/a.ts'])).toBe(`${base}const six = 6;`);
    }),
  );

  it.effect('a git mv followed by a rewrite of the destination lands the whole rewritten text when its directory is selected', () =>
    Effect.gen(function* () {
      const s = yield* commandWorld();
      const old = 'routes/[app]/[view]/+page.svelte';
      const page = 'routes/[...path]/+page.svelte';
      const before = `<script lang="ts">\n  import { Router } from '@runlith/layer/Router';\n  const router = Router.use();\n</script>\n\n<SectionPage view={router.params.view} />\n`;
      const text = `<script lang="ts">\n  import SurfacePage from '$lib/app/SurfacePage.svelte';\n</script>\n\n<SurfacePage />\n`;
      yield* s.w.based({ [old]: before });
      yield* call(s.mine.bash, {
        command: `cd routes && git mv '[app]' '[...path]' && git mv '[...path]/[view]/+page.svelte' '[...path]/+page.svelte'`,
        description: 'Move the page to the rest route',
      });
      yield* call(s.mine.write, { path: join(s.w.root, page), content: text });
      yield* s.decided(MINE);

      const landed = yield* s.w.submit(MINE, { commands: s.commands, paths: ['routes'] });
      expect(landed).toMatchObject({ status: 'landed' });
      expect(yield* s.w.run(['show', `HEAD:${page}`])).toBe(text.trimEnd());
      expect(yield* s.w.run(['status', '--porcelain'])).toBe('');
    }),
  );
});
