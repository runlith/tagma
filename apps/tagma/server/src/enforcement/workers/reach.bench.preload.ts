let heap = 0;
const sample = () => {
  heap = Math.max(heap, process.memoryUsage().heapUsed);
};
sample();
const timer = setInterval(sample, 20);
timer.unref();
process.on('exit', () => {
  sample();
  console.error(JSON.stringify({ programHeapSampledPeak: heap }));
});
