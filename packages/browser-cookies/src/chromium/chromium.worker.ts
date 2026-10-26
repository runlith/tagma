import { serve } from '../worker.js';
import { readChromium } from './read.js';

serve(readChromium, (cause) => ({
  message: `the cookie database could not be read: ${String(cause)}`,
  unblock: ['import again; if the browser is writing its database right now, close it first'],
}));
