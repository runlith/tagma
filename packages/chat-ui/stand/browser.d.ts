import type { StandPort } from './port';

declare global {
  interface Window {
    feedStand?: StandPort;
  }
}
