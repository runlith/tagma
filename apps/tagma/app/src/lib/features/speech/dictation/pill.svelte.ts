import type { DesktopDictation } from '@tagma/desktop/bridge';
import type { Target, Unplaced } from './target.js';

export class PillTarget implements Target {
  pasting = $state('');
  missed = $state(false);

  constructor(private readonly desktop: DesktopDictation) {}

  begin(): boolean {
    this.missed = false;
    return true;
  }

  show(): boolean {
    return true;
  }

  async commit(text: string): Promise<Unplaced> {
    if (text === '') return '';
    this.pasting = text;
    try {
      const pasted = await this.desktop.paste(text);
      this.missed = !pasted;
      return pasted ? '' : text;
    } finally {
      this.pasting = '';
    }
  }

  revert(): boolean {
    return true;
  }

  leave(): void {}
}
