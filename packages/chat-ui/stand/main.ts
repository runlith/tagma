import { Effect } from 'effect';
import { mount, unmount } from 'svelte';
import Stand from './Stand.svelte';
import { makeRig } from './rig.svelte';
import './tokens.css';

const target = document.getElementById('stand')!;
const parameters = new URL(location.href).searchParams;
const loaded = Number(parameters.get('loaded') ?? 120);
const touch = parameters.get('touch') === '1';
const controller = new AbortController();
window.addEventListener('pagehide', () => controller.abort(), { once: true });
void Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const rig = yield* makeRig(loaded);
      if (touch) {
        const viewport = window.visualViewport;
        let height = -1;
        let top = -1;
        const measure = () => {
          if ((viewport?.scale ?? 1) !== 1) return;
          const nextHeight = viewport?.height ?? window.innerHeight;
          const nextTop = viewport?.offsetTop ?? 0;
          if (height === nextHeight && top === nextTop) return;
          height = nextHeight;
          top = nextTop;
          target.style.position = 'absolute';
          target.style.height = `${height}px`;
          target.style.top = `${top}px`;
        };
        measure();
        viewport?.addEventListener('resize', measure);
        viewport?.addEventListener('scroll', measure);
        window.addEventListener('resize', measure);
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            viewport?.removeEventListener('resize', measure);
            viewport?.removeEventListener('scroll', measure);
            window.removeEventListener('resize', measure);
          }),
        );
      }
      const component = mount(Stand, { target, props: { rig, touch } });
      yield* Effect.addFinalizer(() => Effect.promise(() => unmount(component)));
      yield* Effect.never;
    }),
  ),
  { signal: controller.signal },
).catch((error: unknown) => {
  if (controller.signal.aborted) return;
  target.textContent = String(error);
  target.dataset.failure = String(error);
  console.error(error);
});
