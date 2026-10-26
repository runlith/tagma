#include "Realtime.h"

#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>

struct rt_ring {
  _Atomic uint64_t write;
  char write_line[56];
  _Atomic uint64_t read;
  char read_line[56];
  uint8_t *data;
  uint64_t capacity;
  uint64_t mask;
  uint32_t channels;
  double ticks_per_frame;
  _Atomic int fault;
  uint64_t fault_host;
  uint64_t fault_until;
  int dropping;
  uint32_t drop_frames;
  uint64_t drop_host;
  uint64_t drop_until;
};

static uint64_t power_of_two(uint64_t value) {
  uint64_t size = 1;
  while (size < value) size <<= 1;
  return size;
}

rt_ring *rt_ring_create(uint32_t channels, uint32_t capacity_frames, double ticks_per_frame) {
  if (channels == 0 || capacity_frames == 0) return NULL;
  uint64_t samples = (uint64_t)capacity_frames * channels * sizeof(float);
  uint64_t capacity = power_of_two(samples + samples / 8 + 64 * sizeof(rt_record));
  rt_ring *ring = calloc(1, sizeof(rt_ring));
  if (ring == NULL) return NULL;
  ring->data = calloc(1, capacity);
  if (ring->data == NULL) {
    free(ring);
    return NULL;
  }
  ring->capacity = capacity;
  ring->mask = capacity - 1;
  ring->channels = channels;
  ring->ticks_per_frame = ticks_per_frame;
  atomic_init(&ring->write, 0);
  atomic_init(&ring->read, 0);
  atomic_init(&ring->fault, 0);
  return ring;
}

void rt_ring_destroy(rt_ring *ring) {
  free(ring->data);
  free(ring);
}

uint32_t rt_ring_channels(const rt_ring *ring) { return ring->channels; }

uint32_t rt_ring_largest_record(const rt_ring *ring) {
  return (uint32_t)((ring->capacity - 2 * sizeof(rt_record)) / (ring->channels * sizeof(float)));
}

int rt_ring_faulted(const rt_ring *ring) { return atomic_load_explicit(&ring->fault, memory_order_acquire); }

static void put(rt_ring *ring, uint64_t at, const void *source, uint64_t size) {
  uint64_t offset = at & ring->mask;
  uint64_t first = ring->capacity - offset;
  if (first >= size) {
    memcpy(ring->data + offset, source, size);
  } else {
    memcpy(ring->data + offset, source, first);
    memcpy(ring->data, (const uint8_t *)source + first, size - first);
  }
}

static void get(const rt_ring *ring, uint64_t at, void *target, uint64_t size) {
  uint64_t offset = at & ring->mask;
  uint64_t first = ring->capacity - offset;
  if (first >= size) {
    memcpy(target, ring->data + offset, size);
  } else {
    memcpy(target, ring->data + offset, first);
    memcpy((uint8_t *)target + first, ring->data, size - first);
  }
}

static uint64_t span(const rt_ring *ring, uint32_t frames) {
  return (uint64_t)(frames * ring->ticks_per_frame + 0.5);
}

static int matches(const rt_ring *ring, const AudioBufferList *list, uint32_t frames) {
  uint32_t channels = 0;
  for (uint32_t index = 0; index < list->mNumberBuffers; index++) {
    const AudioBuffer *buffer = &list->mBuffers[index];
    if (buffer->mData == NULL) return 0;
    if (buffer->mDataByteSize != (uint64_t)frames * buffer->mNumberChannels * sizeof(float)) return 0;
    channels += buffer->mNumberChannels;
  }
  return channels == ring->channels;
}

static void put_frames(rt_ring *ring, uint64_t at, const AudioBufferList *list, uint32_t frames) {
  if (list->mNumberBuffers == 1) {
    put(ring, at, list->mBuffers[0].mData, (uint64_t)frames * ring->channels * sizeof(float));
    return;
  }
  uint64_t stride = (uint64_t)ring->channels * sizeof(float);
  uint64_t lane = 0;
  for (uint32_t index = 0; index < list->mNumberBuffers; index++) {
    const AudioBuffer *buffer = &list->mBuffers[index];
    const float *samples = buffer->mData;
    uint32_t width = buffer->mNumberChannels;
    for (uint32_t channel = 0; channel < width; channel++) {
      uint64_t offset = (at + (lane + channel) * sizeof(float)) & ring->mask;
      for (uint32_t frame = 0; frame < frames; frame++) {
        *(float *)(ring->data + offset) = samples[frame * width + channel];
        offset += stride;
        if (offset >= ring->capacity) offset -= ring->capacity;
      }
    }
    lane += width;
  }
}

void rt_ring_write(rt_ring *ring, const AudioBufferList *list, uint32_t frames, uint64_t host) {
  if (frames == 0) return;
  if (atomic_load_explicit(&ring->fault, memory_order_relaxed)) {
    ring->fault_until = host + span(ring, frames);
    return;
  }
  if (!matches(ring, list, frames)) {
    ring->fault_host = host;
    ring->fault_until = host + span(ring, frames);
    atomic_store_explicit(&ring->fault, 1, memory_order_release);
    return;
  }
  uint64_t write = atomic_load_explicit(&ring->write, memory_order_relaxed);
  uint64_t read = atomic_load_explicit(&ring->read, memory_order_acquire);
  uint64_t body = (uint64_t)frames * ring->channels * sizeof(float);
  uint64_t need = sizeof(rt_record) + body + (ring->dropping ? sizeof(rt_record) : 0);
  if (need > ring->capacity - (write - read)) {
    if (!ring->dropping) {
      ring->dropping = 1;
      ring->drop_frames = 0;
      ring->drop_host = host;
    }
    ring->drop_frames += frames;
    ring->drop_until = host + span(ring, frames);
    return;
  }
  if (ring->dropping) {
    rt_record drop = {RT_RECORD_DROP, ring->drop_frames, ring->drop_host, host};
    put(ring, write, &drop, sizeof drop);
    write += sizeof drop;
    ring->dropping = 0;
  }
  rt_record record = {RT_RECORD_FRAMES, frames, host, host + span(ring, frames)};
  put(ring, write, &record, sizeof record);
  put_frames(ring, write + sizeof record, list, frames);
  atomic_store_explicit(&ring->write, write + sizeof record + body, memory_order_release);
}

uint32_t rt_ring_read(rt_ring *ring, rt_record *record, float *samples, uint32_t capacity_frames) {
  uint64_t read = atomic_load_explicit(&ring->read, memory_order_relaxed);
  uint64_t write = atomic_load_explicit(&ring->write, memory_order_acquire);
  if (write == read) {
    record->kind = RT_RECORD_NONE;
    return RT_RECORD_NONE;
  }
  get(ring, read, record, sizeof *record);
  read += sizeof *record;
  if (record->kind == RT_RECORD_FRAMES) {
    uint64_t body = (uint64_t)record->frames * ring->channels * sizeof(float);
    if (record->frames <= capacity_frames) get(ring, read, samples, body);
    else record->kind = RT_RECORD_DROP;
    read += body;
  }
  atomic_store_explicit(&ring->read, read, memory_order_release);
  return record->kind;
}

int rt_ring_take_drop(rt_ring *ring, rt_record *record) {
  if (!ring->dropping) return 0;
  record->kind = RT_RECORD_DROP;
  record->frames = ring->drop_frames;
  record->host = ring->drop_host;
  record->until = ring->drop_until;
  ring->dropping = 0;
  return 1;
}

int rt_ring_take_fault(rt_ring *ring, rt_record *record) {
  if (!atomic_load_explicit(&ring->fault, memory_order_acquire)) return 0;
  record->kind = RT_RECORD_DROP;
  record->frames = 0;
  record->host = ring->fault_host;
  record->until = ring->fault_until;
  return 1;
}

OSStatus rt_ring_ioproc(AudioObjectID device, const AudioTimeStamp *now, const AudioBufferList *input,
                        const AudioTimeStamp *input_time, AudioBufferList *output,
                        const AudioTimeStamp *output_time, void *client) {
  (void)device;
  (void)now;
  (void)output;
  (void)output_time;
  if (client == NULL || input->mNumberBuffers == 0) return noErr;
  rt_ring *ring = client;
  const AudioBuffer *first = &input->mBuffers[0];
  if (first->mNumberChannels == 0) return noErr;
  uint32_t frames = first->mDataByteSize / (first->mNumberChannels * sizeof(float));
  rt_ring_write(ring, input, frames, input_time->mHostTime);
  return noErr;
}
