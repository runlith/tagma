import { HOST_MESSAGES, PAGE_MESSAGES, TIMELINE_ELEMENT } from './timeline.js';

export const STAGE_ELEMENT = 'stage';

export const TIMELINE_DECLARATION = `<script type="application/json" id="${TIMELINE_ELEMENT}">{"v":1,"duration":6,"fps":30,"width":1920,"height":1080}</script>`;

export const TIMELINE_FRAGMENT = `<script>
(() => {
  const declared = JSON.parse(document.getElementById('${TIMELINE_ELEMENT}').textContent);
  const fps = declared.fps;
  const frames = Math.round(declared.duration * fps);
  const stage = document.getElementById('${STAGE_ELEMENT}');
  if (stage === null) throw new Error('the page has no #${STAGE_ELEMENT} element to scale');
  document.documentElement.style.cssText += ';height:100%;overflow:hidden';
  document.body.style.cssText += ';margin:0;height:100%;overflow:hidden';
  stage.style.cssText += ';position:absolute;left:0;top:0;overflow:hidden;transform-origin:0 0;width:' + declared.width + 'px;height:' + declared.height + 'px';
  const fit = () => {
    const scale = Math.min(innerWidth / declared.width, innerHeight / declared.height);
    stage.style.transform = 'translate(' + (innerWidth - declared.width * scale) / 2 + 'px,' + (innerHeight - declared.height * scale) / 2 + 'px) scale(' + scale + ')';
  };
  fit();
  addEventListener('resize', fit);

  let chain = Promise.resolve();
  const draw = (t) => {
    const drawn = chain.then(async () => {
      if (typeof window.render === 'function') await window.render(t);
      for (const animation of document.getAnimations()) {
        if (typeof CSSTransition === 'function' && animation instanceof CSSTransition) animation.finish();
        else {
          animation.pause();
          animation.currentTime = t * 1000;
        }
      }
    });
    chain = drawn.catch(() => undefined);
    return drawn;
  };

  let external = false;
  const timeline = (window.tagmaTimeline = {
    ready: false,
    prepared: null,
    seek(t) {
      external = true;
      return draw(t);
    },
  });
  const tell = (message) => {
    if (parent !== window) parent.postMessage(message, '*');
  };
  addEventListener('message', (event) => {
    if (parent === window || event.source !== parent) return;
    const message = event.data;
    if (message && message.type === '${HOST_MESSAGES.hello}') {
      if (timeline.ready) tell({ type: '${PAGE_MESSAGES.ready}' });
    } else if (message && message.type === '${HOST_MESSAGES.seek}' && Number.isInteger(message.k)) {
      const k = message.k;
      timeline.seek(Math.min(frames - 1, Math.max(0, k)) / fps).then(
        () => tell({ type: '${PAGE_MESSAGES.frame}', k }),
        (failure) => tell({ type: '${PAGE_MESSAGES.frame}', k, error: String((failure && failure.message) || failure) }),
      );
    }
  });

  let started = null;
  let shown = -1;
  let drawing = false;
  const drawn = () => {
    drawing = false;
  };
  const own = (now) => {
    if (external) return;
    started ??= now;
    const k = Math.floor(((now - started) / 1000) * fps) % frames;
    if (!drawing && k !== shown) {
      shown = k;
      drawing = true;
      draw(k / fps).then(drawn, drawn);
    }
    requestAnimationFrame(own);
  };
  const loaded = document.readyState === 'complete' ? Promise.resolve() : new Promise((done) => addEventListener('load', done, { once: true }));
  timeline.prepared = loaded.then(async () => {
    await Promise.all([...document.fonts].map((face) => face.load()));
    await Promise.all([...document.images].filter((image) => image.currentSrc || image.src).map((image) => image.decode()));
    await draw(0);
    timeline.ready = true;
    tell({ type: '${PAGE_MESSAGES.ready}' });
    requestAnimationFrame(own);
  });
})();
</script>`;
