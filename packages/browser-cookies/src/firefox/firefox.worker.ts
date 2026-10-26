import { serve } from '../worker.js';
import { readFirefox } from './read.js';

serve(readFirefox, (cause) => ({
  message: `the Firefox cookie database could not be read: ${String(cause)}`,
  unblock: ['import again; if Firefox is writing its database right now, close it first'],
}));
