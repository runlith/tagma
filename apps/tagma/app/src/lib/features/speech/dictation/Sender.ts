import { SENT_FRAME_SAMPLES, SENT_HEADER_BYTES } from '@tagma/server/speech/contract/wire/listening';
import type { SoundChannel } from '$lib/wire/SoundChannel.js';

const SENT_RATE = 16_000;
const BACKLOG_MS = 10_000;
const HELD_FRAMES = Math.ceil((BACKLOG_MS * SENT_RATE) / 1000 / SENT_FRAME_SAMPLES);
const BACKLOG_BYTES = HELD_FRAMES * (SENT_HEADER_BYTES + SENT_FRAME_SAMPLES * 2);
const POLICY_CLOSE = 1008;
const REVOKED_CLOSE = 4401;
const LAST_FRAME_MS = 300;

const FRAMES_WORKLET = `
class Frames extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / ${SENT_RATE};
    this.reach = 0;
    this.sum = 0;
    this.count = 0;
    this.frame = new Int16Array(${SENT_FRAME_SAMPLES});
    this.filled = 0;
    this.done = false;
    this.port.onmessage = () => {
      this.done = true;
      this.port.postMessage('end');
    };
  }
  process(inputs) {
    const samples = inputs[0] && inputs[0][0];
    if (samples) {
      for (let i = 0; i < samples.length; i++) {
        this.sum += samples[i];
        this.count += 1;
        this.reach += 1;
        if (this.reach < this.step) continue;
        this.reach -= this.step;
        const mean = Math.max(-1, Math.min(1, this.sum / this.count));
        this.sum = 0;
        this.count = 0;
        this.frame[this.filled++] = Math.round(mean * 32767);
        if (this.filled < this.frame.length) continue;
        this.port.postMessage(this.frame.buffer, [this.frame.buffer]);
        this.frame = new Int16Array(${SENT_FRAME_SAMPLES});
        this.filled = 0;
      }
    }
    return !this.done;
  }
}
registerProcessor('sent-frames', Frames);
`;

export type SenderFailure = { readonly code: string; readonly reason: string; readonly unblock: readonly string[] };

class Silent extends Error {}

export function microphoneMissing(): SenderFailure | null {
  if (window.isSecureContext && navigator.mediaDevices?.getUserMedia !== undefined && 'AudioWorkletNode' in window) return null;
  return {
    code: 'browser-mic-missing',
    reason: 'This browser does not offer its microphone to this page.',
    unblock: ['Open Tagma over HTTPS in a current Safari or Chrome.'],
  };
}

export class Sender {
  private socket: WebSocket | null = null;
  private media: MediaStream | null = null;
  private audio: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private held: Uint8Array<ArrayBuffer>[] = [];
  private seq = 0;
  private stopped = false;
  private ending = false;
  private marked = false;
  private finished = false;
  private shed = 0;
  private unacknowledged = false;
  private readonly hidden = () => {
    if (document.visibilityState === 'hidden') {
      this.lose({
        code: 'dictation-hidden',
        reason: 'Recording stopped: the page went to the background.',
        unblock: ['Keep Tagma open while you dictate.'],
      });
    }
  };

  constructor(
    private readonly channel: SoundChannel,
    private readonly id: string,
    private readonly failed: (failure: SenderFailure) => void,
  ) {}

  async start(): Promise<boolean> {
    document.addEventListener('visibilitychange', this.hidden);
    try {
      await this.capture();
    } catch (error: unknown) {
      this.lose(refusedBy(error));
      return false;
    }
    return !this.stopped;
  }

  connect(): void {
    if (this.stopped) return;
    const socket = this.channel.open(this.id, 'mic');
    this.socket = socket;
    socket.onopen = () => {
      for (const frame of this.held) socket.send(frame);
      this.held = [];
      if (this.marked) socket.send(this.last());
    };
    socket.onclose = (event) => {
      if (this.ending && event.code === 1000) this.finished = event.reason === 'finished';
      if (this.stopped || (this.ending && event.code === 1000)) return this.stop();
      this.lose(closedBy(event));
    };
  }

  get clean(): boolean {
    return this.finished && this.whole;
  }

  get whole(): boolean {
    return this.shed === 0 && !this.unacknowledged;
  }

  end(): void {
    if (this.stopped || this.ending) return;
    this.ending = true;
    if (this.node === null) return this.mark();
    this.node.port.postMessage('end');
    setTimeout(() => {
      if (this.marked) return;
      this.unacknowledged = true;
      this.mark();
    }, LAST_FRAME_MS);
  }

  private mark(): void {
    if (this.stopped || this.marked) return;
    this.marked = true;
    this.release();
    const socket = this.socket;
    if (socket !== null && socket.readyState === socket.OPEN) socket.send(this.last());
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    document.removeEventListener('visibilitychange', this.hidden);
    this.release();
    if (this.socket !== null && this.socket.readyState <= this.socket.OPEN) this.socket.close(1000, 'stopped');
    this.held = [];
  }

  private lose(failure: SenderFailure): void {
    if (this.stopped) return;
    this.stop();
    this.failed(failure);
  }

  private release(): void {
    this.node?.port.postMessage('stop');
    this.node?.disconnect();
    this.node = null;
    for (const track of this.media?.getTracks() ?? []) track.stop();
    this.media = null;
    void this.audio?.close();
    this.audio = null;
  }

  private last(): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(SENT_HEADER_BYTES);
    new DataView(bytes.buffer).setUint32(0, this.seq, true);
    return bytes;
  }

  private async capture(): Promise<void> {
    const media = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.media = media;
    if (this.stopped) return this.release();
    const audio = new AudioContext();
    this.audio = audio;
    const module = URL.createObjectURL(new Blob([FRAMES_WORKLET], { type: 'text/javascript' }));
    try {
      await audio.audioWorklet.addModule(module);
    } finally {
      URL.revokeObjectURL(module);
    }
    if (this.stopped) return this.release();
    const node = new AudioWorkletNode(audio, 'sent-frames');
    this.node = node;
    node.port.onmessage = (event: MessageEvent<ArrayBuffer | 'end'>) =>
      event.data === 'end' ? this.mark() : this.frame(new Int16Array(event.data));
    audio.createMediaStreamSource(media).connect(node);
    if (audio.state === 'suspended') await audio.resume();
    if (this.stopped) return this.release();
    if (audio.state !== 'running') throw new Silent();
  }

  private frame(pcm: Int16Array): void {
    if (this.stopped || this.marked) return;
    const bytes = new Uint8Array(SENT_HEADER_BYTES + pcm.byteLength);
    new DataView(bytes.buffer).setUint32(0, this.seq++, true);
    bytes.set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), SENT_HEADER_BYTES);
    const socket = this.socket;
    if (socket !== null && socket.readyState === socket.OPEN) {
      if (socket.bufferedAmount < BACKLOG_BYTES) socket.send(bytes);
      else this.shed += 1;
      return;
    }
    if (this.held.length >= HELD_FRAMES) {
      this.held.shift();
      this.shed += 1;
    }
    this.held.push(bytes);
  }
}

function closedBy(event: CloseEvent): SenderFailure {
  if (event.code === POLICY_CLOSE) {
    return {
      code: 'sender-refused',
      reason: `The server refused the sound of this dictation: ${event.reason || 'no reason given'}.`,
      unblock: ['Start the dictation again.'],
    };
  }
  if (event.code === REVOKED_CLOSE) {
    return {
      code: 'device-revoked',
      reason: 'This device was removed from the server, so its microphone stopped.',
      unblock: ['Pair this device again.'],
    };
  }
  return {
    code: 'sender-lost',
    reason: 'The connection carrying the microphone dropped.',
    unblock: ['Check the network, then dictate again.'],
  };
}

function refusedBy(error: unknown): SenderFailure {
  if (error instanceof Silent) {
    return {
      code: 'browser-audio-suspended',
      reason: 'The browser did not start audio for this page.',
      unblock: ['Tap the microphone again.'],
    };
  }
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return {
      code: 'browser-mic-denied',
      reason: 'The browser refused the microphone to this page.',
      unblock: ['Allow the microphone for this site in the browser settings (on iPhone: Settings → Apps → Safari → Microphone).'],
    };
  }
  if (name === 'NotReadableError') {
    return {
      code: 'browser-mic-busy',
      reason: 'Another app or a call holds the microphone.',
      unblock: ['End the call or close the app using the microphone, then try again.'],
    };
  }
  if (name === 'AbortError')
    return { code: 'browser-mic-interrupted', reason: 'The microphone request was interrupted.', unblock: ['Tap the microphone again.'] };
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return { code: 'browser-mic-missing', reason: 'This device has no microphone the browser can open.', unblock: [] };
  }
  return {
    code: 'browser-mic-failed',
    reason: `The microphone could not start: ${error instanceof Error ? error.message : String(error)}`,
    unblock: ['Tap the microphone again.'],
  };
}
