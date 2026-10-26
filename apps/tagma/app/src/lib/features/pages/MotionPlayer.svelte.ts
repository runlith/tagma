import { frameAt, frameCount, frameTime, type Timeline } from '@tagma/server/artifacts/contract/wire/timeline';
import type { FrameLink } from '../views/Frame.svelte';
import { TimelineBridge } from './TimelineBridge.js';

export class MotionPlayer {
  at = $state(0);
  playing = $state(false);
  loop = $state(false);
  ready = $state(false);
  failure = $state<{ readonly k: number; readonly reason: string } | null>(null);
  readonly frames: number;
  private bridge: TimelineBridge | null = null;
  private origin = 0;
  private ticking: number | undefined;
  private wanted: boolean;

  constructor(
    readonly timeline: Timeline,
    autoplay: boolean,
  ) {
    this.frames = frameCount(timeline);
    this.wanted = autoplay;
  }

  get seconds(): number {
    return frameTime(this.timeline, this.at);
  }

  get length(): number {
    return this.frames / this.timeline.fps;
  }

  attach(target: HTMLIFrameElement): FrameLink {
    const bridge = new TimelineBridge(
      { source: () => target.contentWindow, post: (message) => target.contentWindow?.postMessage(message, '*') },
      {
        ready: () => {
          this.ready = true;
          if (this.wanted) this.play();
        },
        drawn: (k, failure) => {
          this.failure = failure === null ? null : { k, reason: failure };
        },
      },
    );
    this.bridge = bridge;
    bridge.seek(this.at);
    return {
      receive: (event) => bridge.receive(event),
      loaded: () => {
        this.ready = false;
        this.halt();
        bridge.hello();
      },
      dispose: () => {
        if (this.bridge !== bridge) return;
        this.bridge = null;
        this.ready = false;
        this.halt();
      },
    };
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  play(): void {
    this.wanted = true;
    if (!this.ready) return;
    if (this.at >= this.frames - 1) this.show(0);
    this.origin = performance.now() - this.seconds * 1000;
    this.playing = true;
    this.halt();
    this.ticking = requestAnimationFrame(this.tick);
  }

  pause(): void {
    this.wanted = false;
    this.playing = false;
    this.halt();
  }

  step(direction: -1 | 1): void {
    this.pause();
    this.seek(this.at + direction);
  }

  seek(k: number): void {
    this.show(Math.min(this.frames - 1, Math.max(0, Math.round(k))));
    if (this.playing) this.origin = performance.now() - this.seconds * 1000;
  }

  repeat(): void {
    this.loop = !this.loop;
  }

  close(): void {
    this.pause();
    this.bridge = null;
  }

  private show(k: number): void {
    this.at = k;
    this.bridge?.seek(k);
  }

  private halt(): void {
    if (this.ticking !== undefined) cancelAnimationFrame(this.ticking);
    this.ticking = undefined;
    if (!this.ready) this.playing = false;
  }

  private readonly tick = (now: number): void => {
    let elapsed = (now - this.origin) / 1000;
    if (elapsed >= this.length) {
      if (!this.loop) {
        this.show(this.frames - 1);
        this.pause();
        return;
      }
      elapsed %= this.length;
      this.origin = now - elapsed * 1000;
    }
    const k = frameAt(this.timeline, elapsed);
    if (k !== this.at) this.show(k);
    this.ticking = requestAnimationFrame(this.tick);
  };
}
