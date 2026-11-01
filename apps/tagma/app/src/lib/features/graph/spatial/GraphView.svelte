<script lang="ts">
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import Maximize from '@lucide/svelte/icons/maximize';
  import Minus from '@lucide/svelte/icons/minus';
  import Plus from '@lucide/svelte/icons/plus';
  import { Platform } from '@runlith/layer/Platform';
  import type { Edge, Ref, TreeBlock } from '@tagma/server/graph/contract/wire/rows';
  import FilterBar from '$lib/features/graph/FilterBar.svelte';
  import NodeCard from '$lib/features/graph/spatial/NodeCard.svelte';
  import { GraphSelection } from '$lib/features/graph/GraphSelection.svelte.js';
  import { branchRadii, radiusOf, restFor, type SimLink, type SimNode, seedAround, tick } from '$lib/features/graph/spatial/graphsim.js';
  import { Notices } from '$lib/features/notices/Service.svelte.js';
  import { BlocksRepo } from '$lib/features/graph/BlocksRepo.js';
  import { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';
  import type { TreeScreen } from '$lib/features/graph/TreeScreen.svelte.js';
  import { cn } from '$lib/shared/utils.js';
  import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
  import Tooltip from '$lib/shared/ui/tooltip/Tooltip.svelte';

  let { store }: { store: TreeScreen } = $props();

  const notices = Notices.use();
  const workspace = Workspace.use();
  const blocks = BlocksRepo.use();
  const tags = TagCatalog.use();
  const storage = Platform.use().storage.local;

  let canvas = $state<HTMLCanvasElement | null>(null);
  let container = $state<HTMLDivElement | null>(null);

  const FIT_MARGIN = 48;
  const CLICK_SLOP = 4;
  let scale = 1;
  let tx = 0;
  let ty = 0;
  let width = 0;
  let height = 0;
  let dpr = 1;

  $effect(() => {
    const host = container;
    const surface = canvas;
    if (!host || !surface) return;
    const observer = new ResizeObserver(() => {
      dpr = window.devicePixelRatio;
      width = host.clientWidth;
      height = host.clientHeight;
      surface.width = Math.round(width * dpr);
      surface.height = Math.round(height * dpr);
      maybeInitialFit();
    });
    observer.observe(host);
    return () => observer.disconnect();
  });

  const typedEdges = $derived<readonly Edge[]>(blocks.edges.data ?? []);
  const refPairs = $derived<readonly Ref[]>(blocks.refs.data ?? []);

  $effect(() => {
    const error = blocks.edges.error ?? blocks.refs.error;
    if (error) notices.background(error);
  });

  const depthOf = $derived.by(() => {
    const depths = new Map<string, number>();
    if (store.rootName === null) return depths;
    const walk = (name: string, depth: number): void => {
      depths.set(name, depth);
      for (const child of store.children(name)) {
        const block = store.block(child);
        if (block !== undefined && !tags.standsInOutline(block)) continue;
        walk(child, depth + 1);
      }
    };
    walk(store.rootName, 0);
    return depths;
  });

  let nodes: SimNode[] = [];
  let links: SimLink[] = [];
  let nodeByName = new Map<string, SimNode>();
  let neighbors = new Map<string, Set<string>>();
  let kindByPair = new Map<string, Edge['kind']>();
  let alpha = 0;
  let fitted = false;

  const rememberedAt = new Map<string, { x: number; y: number }>();

  $effect(() => {
    const depths = depthOf;
    const currentEdges = typedEdges;
    const currentRefs = refPairs;
    const previous = nodeByName;
    const nextByName = new Map<string, SimNode>();
    const childrenOf = new Map<string, SimNode[]>();
    const fresh: { node: SimNode; parentName: string | null; index: number }[] = [];

    const filtering = store.readingLens.active;
    const ordered = [...depths.entries()].sort((a, b) => a[1] - b[1]);
    for (const [name, depth] of ordered) {
      if (filtering && !store.matchesFilter(name) && name !== store.rootName) continue;
      const block = store.block(name);
      if (!block) continue;
      let node = previous.get(name);
      if (node) {
        node.depth = depth;
        node.r = radiusOf(depth);
      } else {
        node = { name, depth, r: radiusOf(depth), x: 0, y: 0, vx: 0, vy: 0, fx: null, fy: null };
        fresh.push({ node, parentName: block.parentIdentity, index: childrenOf.get(block.parentIdentity ?? '')?.length ?? 0 });
      }
      nextByName.set(name, node);
      if (block.parentIdentity !== null) {
        const list = childrenOf.get(block.parentIdentity) ?? [];
        list.push(node);
        childrenOf.set(block.parentIdentity, list);
      }
    }

    const branches = branchRadii(
      store.rootName,
      (name) => store.children(name),
      (name) => radiusOf(depths.get(name) ?? 0),
    );
    for (const entry of fresh) {
      const remembered = rememberedAt.get(entry.node.name);
      if (remembered) {
        entry.node.x = remembered.x;
        entry.node.y = remembered.y;
        continue;
      }
      const parent = entry.parentName === null ? undefined : nextByName.get(entry.parentName);
      const rest = parent ? restFor(parent, branches.get(entry.node.name) ?? entry.node.r) : 0;
      const seed = seedAround(parent, entry.index, rest);
      entry.node.x = seed.x;
      entry.node.y = seed.y;
    }

    const nextLinks: SimLink[] = [];
    const linkedPairs = new Set<string>();
    const pair = (a: string, b: string) => (a < b ? `${a}-${b}` : `${b}-${a}`);
    for (const [parentName, children] of childrenOf) {
      const parent = nextByName.get(parentName);
      if (!parent) continue;
      for (const child of children) {
        nextLinks.push({
          from: parent,
          to: child,
          kind: 'tree',
          rest: restFor(parent, branches.get(child.name) ?? child.r),
        });
        linkedPairs.add(pair(parent.name, child.name));
      }
    }
    kindByPair = new Map();
    for (const edge of currentEdges) {
      const from = edge.fromIdentity === null ? undefined : nextByName.get(edge.fromIdentity);
      const to = edge.toIdentity === null ? undefined : nextByName.get(edge.toIdentity);
      if (!from || !to) continue;
      kindByPair.set(pair(from.name, to.name), edge.kind);
      if (linkedPairs.has(pair(from.name, to.name))) continue;
      linkedPairs.add(pair(from.name, to.name));
      nextLinks.push({ from, to, kind: 'edge', rest: 240 });
    }
    for (const refPair of currentRefs) {
      if (refPair.fromIdentity === refPair.toIdentity) continue;
      const from = nextByName.get(refPair.fromIdentity);
      const to = nextByName.get(refPair.toIdentity);
      if (!from || !to || linkedPairs.has(pair(from.name, to.name))) continue;
      linkedPairs.add(pair(from.name, to.name));
      nextLinks.push({ from, to, kind: 'ref', rest: 280 });
    }

    neighbors = new Map();
    const addNeighbor = (a: string, b: string) => {
      const set = neighbors.get(a) ?? new Set<string>();
      set.add(b);
      neighbors.set(a, set);
    };
    for (const link of nextLinks) {
      addNeighbor(link.from.name, link.to.name);
      addNeighbor(link.to.name, link.from.name);
    }

    nodes = [...nextByName.values()];
    links = nextLinks;
    nodeByName = nextByName;
    for (const node of nodes) rememberedAt.set(node.name, node);

    if (!fitted && nodes.length > 0) {
      for (let i = 0; i < 400; i += 1) tick(nodes, links, Math.max(1 - i / 300, 0.03));
    }
    maybeInitialFit();

    const signature = filtering ? `${[...store.readingLens.tags].sort().join(',')}|${[...store.readingLens.states].sort().join(',')}` : '';
    if (signature !== filterSignature) {
      filterSignature = signature;
      if (fitted && nodes.length > 0) {
        for (let i = 0; i < 200; i += 1) tick(nodes, links, Math.max(0.6 - i / 300, 0.05));
        const world = boundsOf();
        if (world) tweenCamera(cameraFor(world));
      }
    }
    alpha = Math.max(alpha, 0.5);
  });

  let filterSignature = '';

  function maybeInitialFit(): void {
    if (fitted || nodes.length === 0 || width === 0 || height === 0) return;
    fitCamera();
    fitted = true;
  }

  const SMOOTHING = 0.22;
  const anim = new Map<string, { presence: number; hover: number }>();

  let hoveredName: string | null = null;
  const selection = GraphSelection.use();
  const selected = $derived(selection.name === null ? undefined : store.block(selection.name));

  function presenceTarget(node: SimNode): number {
    let target = Math.max(0, Math.min(node.r * scale - 1, 1));
    const block = store.block(node.name);
    if (block && tags.isResting(block)) target *= 0.45;
    if (hoveredName !== null && node.name !== hoveredName && !neighbors.get(hoveredName)?.has(node.name)) target *= 0.1;
    return target;
  }

  function stateOf(node: SimNode): { presence: number; hover: number } {
    let state = anim.get(node.name);
    if (!state) {
      state = { presence: 0, hover: 0 };
      anim.set(node.name, state);
    }
    return state;
  }

  function ringColor(block: TreeBlock, css: CSSStyleDeclaration): string {
    return css.getPropertyValue(tags.statusVar(block).slice(4, -1)).trim();
  }

  const TAG_PROP: Record<string, string> = {
    module: '--tag-module',
    spec: '--tag-spec',
    task: '--tag-task',
    rule: '--tag-rule',
    idea: '--tag-idea',
  };

  type Palette = {
    background: string;
    border: string;
    muted: string;
    foreground: string;
    brand: string;
    css: CSSStyleDeclaration;
    tag: Record<string, string>;
    verified: string;
    lie: string;
    decided: string;
    family: string;
  };

  function readPalette(): Palette {
    const css = getComputedStyle(document.documentElement);
    const tag: Record<string, string> = {};
    for (const [name, prop] of Object.entries(TAG_PROP)) tag[name] = css.getPropertyValue(prop).trim();
    return {
      background: css.getPropertyValue('--background').trim(),
      border: css.getPropertyValue('--border').trim(),
      muted: css.getPropertyValue('--muted-foreground').trim(),
      foreground: css.getPropertyValue('--foreground').trim(),
      brand: css.getPropertyValue('--brand').trim(),
      css,
      tag,
      verified: css.getPropertyValue('--status-verified').trim(),
      lie: css.getPropertyValue('--severity-lie').trim(),
      decided: css.getPropertyValue('--status-open').trim(),
      family: css.getPropertyValue('--font-sans').trim() || 'sans-serif',
    };
  }

  function edgeColor(link: SimLink, palette: Palette): string {
    if (link.kind !== 'edge') return palette.muted;
    const key = link.from.name < link.to.name ? `${link.from.name}-${link.to.name}` : `${link.to.name}-${link.from.name}`;
    const kind = kindByPair.get(key);
    if (kind === 'implements') return palette.verified;
    if (kind === 'waits-on') return palette.lie;
    if (kind === 'validates') return palette.decided;
    return palette.muted;
  }

  const LABEL_WORLD = (r: number) => r * 0.9;
  const TITLE_MAX_CHARS = 28;
  const measureCache = new Map<string, number>();

  function measure(ctx: CanvasRenderingContext2D, text: string, font: string): number {
    const key = `${font}|${text}`;
    const hit = measureCache.get(key);
    if (hit !== undefined) return hit;
    ctx.font = font;
    const width = ctx.measureText(text).width;
    measureCache.set(key, width);
    return width;
  }

  function titleOf(name: string): string {
    const title = store.block(name)?.title.trim() ?? '';
    return title.length > TITLE_MAX_CHARS ? `${title.slice(0, TITLE_MAX_CHARS - 1)}…` : title || 'Untitled';
  }

  let frame = 0;
  let dragging: SimNode | null = null;

  $effect(() => {
    const surface = canvas;
    if (!surface) return;
    const ctx = surface.getContext('2d');
    if (!ctx) return;
    let live = true;
    const remeasure = (): void => measureCache.clear();
    document.fonts.addEventListener('loadingdone', remeasure);

    const render = (): void => {
      if (!live) return;
      if (alpha > 0.02 || dragging) {
        tick(nodes, links, Math.max(alpha, dragging ? 0.3 : 0));
        alpha *= 0.96;
      }
      draw(ctx);
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    return () => {
      live = false;
      document.fonts.removeEventListener('loadingdone', remeasure);
      cancelAnimationFrame(frame);
      cancelAnimationFrame(tweenFrame);
    };
  });

  function draw(ctx: CanvasRenderingContext2D): void {
    const palette = readPalette();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    for (const node of nodes) {
      const state = stateOf(node);
      state.presence += (presenceTarget(node) - state.presence) * SMOOTHING;
      state.hover += ((node.name === hoveredName ? 1 : 0) - state.hover) * SMOOTHING;
    }

    ctx.save();
    ctx.translate(tx, ty);
    ctx.scale(scale, scale);
    ctx.lineWidth = 1 / scale;
    for (const link of links) {
      const fromState = stateOf(link.from);
      const toState = stateOf(link.to);
      const touched = hoveredName !== null && (link.from.name === hoveredName || link.to.name === hoveredName);
      const ends = Math.min(fromState.presence, toState.presence);
      const base = link.kind === 'tree' ? 0.32 : link.kind === 'edge' ? 0.26 : 0.16;
      const alpha_ = touched ? Math.min(ends + 0.55, 0.9) : hoveredName !== null ? base * ends * 0.25 : base * ends;
      if (alpha_ < 0.01) continue;
      ctx.globalAlpha = alpha_;
      ctx.strokeStyle = touched ? edgeColor(link, palette) : link.kind === 'tree' ? palette.border : palette.muted;
      ctx.setLineDash(link.kind === 'ref' ? [4 / scale, 6 / scale] : []);
      ctx.beginPath();
      ctx.moveTo(link.from.x, link.from.y);
      ctx.lineTo(link.to.x, link.to.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    for (const node of nodes) {
      const state = stateOf(node);
      if (state.presence < 0.01) continue;
      const block = store.block(node.name);
      if (!block) continue;
      const r = node.r * (1 + state.hover * 0.18);
      ctx.globalAlpha = state.presence;
      if (node.name === store.rootName) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 3.5, 0, Math.PI * 2);
        ctx.strokeStyle = palette.brand;
        ctx.lineWidth = 1.5 / scale + 0.4;
        ctx.stroke();
      }
      if (node.name === selection.name || state.hover > 0.02) {
        ctx.globalAlpha = state.presence * (node.name === selection.name ? 0.5 : state.hover * 0.5);
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 5 / scale, 0, Math.PI * 2);
        ctx.strokeStyle = ringColor(block, palette.css) || palette.muted;
        ctx.lineWidth = 1.5 / scale;
        ctx.stroke();
        ctx.globalAlpha = state.presence;
      }
      const tag = tags.tagOf(block);
      const fill = tag === null ? palette.brand : (palette.tag[tag] ?? palette.muted);
      drawBody(ctx, tag ?? '', node.x, node.y, r, fill, palette.background);
    }
    ctx.restore();

    const ranked = [...nodes].sort((a, b) => {
      const rank = (n: SimNode): number =>
        n.name === hoveredName
          ? 0
          : hoveredName !== null && neighbors.get(hoveredName)?.has(n.name)
            ? 1
            : n.name === selection.name
              ? 2
              : 3;
      return rank(a) - rank(b) || a.depth - b.depth || a.name.localeCompare(b.name);
    });
    const placed: { left: number; top: number; right: number; bottom: number }[] = [];
    const placedIds = new Set<string>();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineJoin = 'round';
    for (const node of ranked) {
      const state = stateOf(node);
      const focus = node.name === hoveredName || node.name === selection.name;
      if (!focus && state.presence < 0.35) continue;
      const parentName = store.block(node.name)?.parentIdentity;
      if (!focus && parentName != null && nodeByName.has(parentName) && !placedIds.has(parentName)) continue;
      const cap = node.depth === 0 ? 20 : node.depth === 1 ? 14 : 12;
      let screenFont = Math.min(LABEL_WORLD(node.r) * scale, cap);
      if (focus) screenFont = Math.max(screenFont, 11);
      const fade = Math.max(0, Math.min((screenFont - 7) / 4, 1));
      if (fade < 0.03) continue;
      const size = Math.round(screenFont * 4) / 4;
      const weight = node.depth === 0 ? 700 : node.depth === 1 ? 600 : 500;
      const font = `${weight} ${size}px ${palette.family}`;
      const text = titleOf(node.name);
      const textWidth = measure(ctx, text, font) + size * 1.4;
      const sx = node.x * scale + tx;
      const sy = node.y * scale + ty + node.r * scale + size * 0.35;
      const rect = {
        left: sx - textWidth / 2,
        top: sy - size * 0.35,
        right: sx + textWidth / 2,
        bottom: sy + size * 1.65,
      };
      if (rect.right < 0 || rect.left > width || rect.bottom < 0 || rect.top > height) continue;
      let collides = false;
      for (const other of placed) {
        if (rect.left < other.right && rect.right > other.left && rect.top < other.bottom && rect.bottom > other.top) {
          collides = true;
          break;
        }
      }
      if (collides && !focus) continue;
      placed.push(rect);
      placedIds.add(node.name);
      ctx.font = font;
      ctx.globalAlpha = focus ? 1 : Math.min(state.presence, 1) * fade;
      ctx.strokeStyle = palette.background;
      ctx.lineWidth = Math.max(size / 3.5, 2);
      ctx.strokeText(text, sx, sy);
      ctx.fillStyle = node.depth <= 1 ? palette.foreground : palette.muted;
      ctx.fillText(text, sx, sy);
    }
    ctx.globalAlpha = 1;
  }

  function drawBody(ctx: CanvasRenderingContext2D, tag: string, x: number, y: number, r: number, fill: string, background: string): void {
    ctx.fillStyle = fill;
    if (tag === 'task') {
      const half = (r * Math.sqrt(Math.PI)) / 2;
      ctx.fillRect(x - half, y - half, half * 2, half * 2);
      return;
    }
    if (tag === 'idea') {
      const half = (r * Math.sqrt(Math.PI)) / 2;
      ctx.beginPath();
      ctx.moveTo(x, y - half * 1.3);
      ctx.lineTo(x + half * 1.3, y);
      ctx.lineTo(x, y + half * 1.3);
      ctx.lineTo(x - half * 1.3, y);
      ctx.closePath();
      ctx.fill();
      return;
    }
    if (tag === 'rule') {
      ctx.beginPath();
      for (let i = 0; i < 6; i += 1) {
        const angle = (Math.PI / 3) * i - Math.PI / 6;
        const px = x + Math.cos(angle) * r * 1.1;
        const py = y + Math.sin(angle) * r * 1.1;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      return;
    }
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    if (tag === 'module') {
      ctx.beginPath();
      ctx.arc(x, y, r * 0.55, 0, Math.PI * 2);
      ctx.fillStyle = background;
      ctx.fill();
    }
  }

  let panning = false;
  let panDistance = 0;
  let lastX = 0;
  let lastY = 0;
  let hoverCursor = $state(false);

  function localPoint(event: PointerEvent | MouseEvent | WheelEvent): { x: number; y: number } {
    const box = canvas?.getBoundingClientRect();
    return { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) };
  }

  function hitNode(px: number, py: number): SimNode | null {
    const wx = (px - tx) / scale;
    const wy = (py - ty) / scale;
    let best: SimNode | null = null;
    let bestD = Infinity;
    for (const node of nodes) {
      if (stateOf(node).presence < 0.05) continue;
      const dx = node.x - wx;
      const dy = node.y - wy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < node.r + 6 / scale && d < bestD) {
        bestD = d;
        best = node;
      }
    }
    return best;
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    const point = localPoint(event);
    const node = hitNode(point.x, point.y);
    panDistance = 0;
    lastX = event.clientX;
    lastY = event.clientY;
    if (node) {
      dragging = node;
    } else {
      panning = true;
    }
  }

  function onPointerMove(event: PointerEvent): void {
    const point = localPoint(event);
    if (dragging) {
      dragging.fx = (point.x - tx) / scale;
      dragging.fy = (point.y - ty) / scale;
      panDistance += Math.abs(event.clientX - lastX) + Math.abs(event.clientY - lastY);
      lastX = event.clientX;
      lastY = event.clientY;
      alpha = Math.max(alpha, 0.3);
      return;
    }
    if (panning) {
      panDistance += Math.abs(event.clientX - lastX) + Math.abs(event.clientY - lastY);
      tx += event.clientX - lastX;
      ty += event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
      return;
    }
    const node = hitNode(point.x, point.y);
    hoveredName = node?.name ?? null;
    hoverCursor = node !== null;
  }

  function onPointerUp(event: PointerEvent): void {
    if (dragging) {
      const grabbed = dragging;
      grabbed.fx = null;
      grabbed.fy = null;
      dragging = null;
      alpha = Math.max(alpha, 0.25);
      if (panDistance <= CLICK_SLOP) selection.name = grabbed.name;
      return;
    }
    if (panning && panDistance <= CLICK_SLOP) {
      const point = localPoint(event);
      if (!hitNode(point.x, point.y)) selection.name = null;
    }
    panning = false;
  }

  function onDblClick(event: MouseEvent): void {
    const point = localPoint(event);
    const node = hitNode(point.x, point.y);
    if (node) dive(node);
  }

  function onWheel(event: WheelEvent): void {
    event.preventDefault();
    const point = localPoint(event);
    zoomAt(point.x, point.y, Math.exp(-event.deltaY * 0.002));
  }

  function zoomAt(px: number, py: number, factor: number): void {
    const next = Math.min(Math.max(scale * factor, 0.1), 4);
    tx = px - ((px - tx) / scale) * next;
    ty = py - ((py - ty) / scale) * next;
    scale = next;
  }

  function zoomBy(factor: number): void {
    zoomAt(width / 2, height / 2, factor);
  }

  function boundsOf(names?: Set<string>): { x: number; y: number; width: number; height: number } | null {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let any = false;
    for (const node of nodes) {
      if (names && !names.has(node.name)) continue;
      any = true;
      minX = Math.min(minX, node.x - node.r);
      minY = Math.min(minY, node.y - node.r);
      maxX = Math.max(maxX, node.x + node.r);
      maxY = Math.max(maxY, node.y + node.r);
    }
    if (!any) return null;
    return { x: minX, y: minY, width: Math.max(maxX - minX, 1), height: Math.max(maxY - minY, 1) };
  }

  function cameraFor(world: { x: number; y: number; width: number; height: number }) {
    const k = Math.min((width - FIT_MARGIN * 2) / world.width, (height - FIT_MARGIN * 2) / world.height, 1.5);
    const next = k > 0 ? k : 1;
    return {
      scale: next,
      tx: (width - world.width * next) / 2 - world.x * next,
      ty: (height - world.height * next) / 2 - world.y * next,
    };
  }

  function fitCamera(): void {
    const world = boundsOf();
    if (!world) return;
    const camera = cameraFor(world);
    scale = camera.scale;
    tx = camera.tx;
    ty = camera.ty;
  }

  function dive(node: SimNode): void {
    const names = new Set<string>([node.name]);
    const walk = (name: string): void => {
      for (const child of store.children(name)) {
        names.add(child);
        walk(child);
      }
    };
    walk(node.name);
    const world = boundsOf(names);
    if (world) tweenCamera(cameraFor(world));
  }

  let tweenFrame = 0;

  function tweenCamera(target: { scale: number; tx: number; ty: number }): void {
    cancelAnimationFrame(tweenFrame);
    const from = { scale, tx, ty };
    const start = performance.now();
    const DURATION = 320;
    const stepTween = (now: number): void => {
      const t = Math.min((now - start) / DURATION, 1);
      const eased = 1 - (1 - t) ** 3;
      scale = from.scale + (target.scale - from.scale) * eased;
      tx = from.tx + (target.tx - from.tx) * eased;
      ty = from.ty + (target.ty - from.ty) * eased;
      if (t < 1) tweenFrame = requestAnimationFrame(stepTween);
    };
    tweenFrame = requestAnimationFrame(stepTween);
  }

  const LEGEND_KEY = 'tagma.graphLegend';
  let legendOpen = $state(storage.getItem(LEGEND_KEY) !== 'off');

  function toggleLegend(): void {
    legendOpen = !legendOpen;
    storage.setItem(LEGEND_KEY, legendOpen ? 'on' : 'off');
  }

  const EDGE_LEGEND = [
    { label: 'tree', color: 'var(--border)', dashed: false },
    { label: 'implements', color: 'var(--status-verified)', dashed: false },
    { label: 'waits-on', color: 'var(--severity-lie)', dashed: false },
    { label: 'validates', color: 'var(--status-open)', dashed: false },
    { label: '[[ref]]', color: 'var(--muted-foreground)', dashed: true },
  ];

  const TAG_GLYPHS = [
    { label: 'module', glyph: '○', color: 'var(--tag-module)' },
    { label: 'spec', glyph: '●', color: 'var(--tag-spec)' },
    { label: 'task', glyph: '■', color: 'var(--tag-task)' },
    { label: 'idea', glyph: '◆', color: 'var(--tag-idea)' },
    { label: 'rule', glyph: '⬡', color: 'var(--tag-rule)' },
  ];
  const tagLegend = $derived(TAG_GLYPHS.filter((entry) => tags.declared.includes(entry.label)));
</script>

<div bind:this={container} class="survey-ground relative h-full overflow-hidden" role="group" aria-label="Project graph">
  <canvas
    bind:this={canvas}
    class="absolute inset-0 h-full w-full touch-none select-none"
    class:cursor-grab={!hoverCursor}
    class:cursor-pointer={hoverCursor}
    aria-label={`Graph of ${workspace.active?.name ?? 'project'}`}
    onwheel={onWheel}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
    ondblclick={onDblClick}
    onpointerleave={() => {
      hoveredName = null;
      hoverCursor = false;
      onPointerUp(new PointerEvent('pointerup'));
    }}
  ></canvas>

  <div class="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4">
    <div class="pointer-events-auto rounded-lg border bg-popover/85 px-2 py-1.5 shadow-raised backdrop-blur-md">
      <FilterBar lens={store.readingLens} sort={false} />
    </div>
  </div>

  <div class="absolute bottom-4 left-4 overflow-hidden rounded-lg border bg-popover/85 shadow-raised backdrop-blur-md">
    <button
      type="button"
      class="flex w-full items-center gap-2 px-3 py-1.5 transition-colors hover:bg-hover"
      aria-expanded={legendOpen}
      onclick={toggleLegend}
    >
      <span class="eyebrow text-muted-foreground">Legend</span>
      <ChevronDown
        class={cn('size-3 text-muted-foreground transition-transform duration-150 ease-instrument', !legendOpen && '-rotate-90')}
      />
    </button>
    {#if legendOpen}
      <div class="grid gap-2 border-t px-3 py-2 text-small leading-4 text-muted-foreground">
        <div class="grid gap-1">
          {#each EDGE_LEGEND as entry (entry.label)}
            <div class="flex items-center gap-2">
              {#if entry.dashed}
                <span class="inline-block w-5 border-t border-dashed" style:border-color={entry.color}></span>
              {:else}
                <span class="inline-block h-px w-5" style:background={entry.color}></span>
              {/if}
              {entry.label}
            </div>
          {/each}
        </div>
        {#if tagLegend.length > 0}
          <div class="grid grid-cols-2 gap-x-3 gap-y-1 border-t pt-2">
            {#each tagLegend as entry (entry.label)}
              <div class="flex items-center gap-2">
                <span class="w-5 text-center" style:color={entry.color}>{entry.glyph}</span>
                {entry.label}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <div class="absolute right-4 bottom-4 grid overflow-hidden rounded-lg border bg-popover/85 shadow-raised backdrop-blur-md">
    <Tooltip text="Zoom in">
      <button
        type="button"
        class="grid size-8 place-items-center text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
        onclick={() => zoomBy(1.25)}
        aria-label="Zoom in"
      >
        <Plus class="size-4" />
      </button>
    </Tooltip>
    <Tooltip text="Zoom out">
      <button
        type="button"
        class="grid size-8 place-items-center text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
        onclick={() => zoomBy(0.8)}
        aria-label="Zoom out"
      >
        <Minus class="size-4" />
      </button>
    </Tooltip>
    <Tooltip text="Fit graph">
      <button
        type="button"
        class="grid size-8 place-items-center text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
        onclick={fitCamera}
        aria-label="Fit graph"
      >
        <Maximize class="size-4" />
      </button>
    </Tooltip>
  </div>

  {#if selected}
    <NodeCard block={selected} {store} onClose={() => (selection.name = null)} />
  {/if}
</div>
