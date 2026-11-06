import { Writable } from 'node:stream';

const write = process.stdout.write.bind(process.stdout);

const toStderr = (...parts: unknown[]) => console.error(...parts);
console.log = toStderr;
console.info = toStderr;
console.debug = toStderr;
process.stdout.write = process.stderr.write.bind(process.stderr) as typeof process.stdout.write;

export const protocolOut = new Writable({
  write: (chunk: Buffer, encoding, done) => {
    write(chunk, encoding, done);
  },
});
