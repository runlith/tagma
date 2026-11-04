import { Abi } from '../ProcessAbi';
import { serveProcesses } from '../ProcessServer';
import { Sampler } from './Sampler';
import { NativeUsage } from './UsageAbi';
import { psUsage } from './ps';

serveProcesses((path) => {
  const processes = Abi.load(path);
  return { processes, sampler: new Sampler(NativeUsage.load(path), processes, psUsage) };
});
