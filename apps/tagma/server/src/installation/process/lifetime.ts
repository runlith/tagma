import { closeSync } from 'node:fs';
import { dlopen } from 'bun:ffi';

type Libc = { readonly names: readonly string[]; readonly closeOnExec: number };

const LIBC: Partial<Record<NodeJS.Platform, Libc>> = {
  darwin: { names: ['libc.dylib'], closeOnExec: 0x2000_6601 },
  linux: { names: ['libc.so.6', `libc.musl-${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}.so.1`], closeOnExec: 0x5451 },
};

const opened = (libc: Libc) => {
  for (const name of libc.names) {
    try {
      return dlopen(name, {
        pipe: { args: ['ptr'], returns: 'i32' },
        ioctl: { args: ['i32', 'u64'], returns: 'i32' },
      }).symbols;
    } catch (cause) {
      if (name === libc.names.at(-1)) throw cause;
    }
  }
  throw new Error('no C library was named');
};

export class LaunchLifetime {
  private ended = false;

  private constructor(
    readonly reader: number,
    private readonly writer: number,
  ) {}

  static open(): LaunchLifetime {
    const libc = LIBC[process.platform];
    if (libc === undefined) throw new Error(`a launch cannot hold a lifetime pipe on ${process.platform}`);
    const symbols = opened(libc);
    const ends = new Int32Array(2);
    if (symbols.pipe(ends) !== 0) throw new Error('the lifetime pipe of the launch could not be made');
    const [reader, writer] = [ends[0]!, ends[1]!];
    if (symbols.ioctl(reader, libc.closeOnExec) !== 0 || symbols.ioctl(writer, libc.closeOnExec) !== 0) {
      closeSync(reader);
      closeSync(writer);
      throw new Error('the lifetime pipe of the launch could not be kept from children');
    }
    return new LaunchLifetime(reader, writer);
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    closeSync(this.writer);
    closeSync(this.reader);
  }
}
