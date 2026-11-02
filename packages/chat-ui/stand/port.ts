import type { MeasuredControl, Recording, Scrollbar, Targets } from './recording';
import type { DisclosurePosition } from './scenario';

export type Point = { x: number; y: number };

export type StandPort = {
  ready: boolean;
  timing?(): void;
  remount(): Promise<void>;
  point(): Point;
  targets(): Targets;
  scrollbar(): Scrollbar;
  position(top: number): Promise<void>;
  approach(distance: number): Promise<void>;
  positionDisclosure(side: DisclosurePosition): Promise<void>;
  disclosurePoint(): Point;
  warm(reach?: number): Promise<MeasuredControl>;
  start(name: string): void;
  beginDrag(distance: number, speed: number, preventFling: boolean, quantum?: number): void;
  endDrag(): void;
  beginWheel(): void;
  endWheel(): void;
  pressed(): Promise<void>;
  released(): Promise<void>;
  landed(): Promise<void>;
  stop(): Recording;
  frames(count?: number): Promise<void>;
  frameTime(): number;
  stream(chunks?: number): Promise<void>;
  loadOlder(): Promise<boolean>;
  reachOlder(): Promise<boolean>;
  pageLatency(ms: number): void;
  holdPages(): void;
  releasePages(): void;
  paging(): { requested: number; landed: number; latency: number; requestedAt?: number | null; landedAt?: number | null };
  resize(width: number, height: number): Promise<void>;
  changed(): void;
  state(): { top: number; height: number; viewport: number };
};

export type StandGlobal = { feedStand?: StandPort };

export interface ComposerStandPort extends StandPort {
  send(): Promise<boolean>;
  sending(): boolean;
}

export type ComposerStandGlobal = { feedStand?: ComposerStandPort };
