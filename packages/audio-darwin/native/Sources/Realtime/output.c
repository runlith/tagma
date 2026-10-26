#include "Realtime.h"

#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>
#include <sched.h>

struct rt_player {
  _Atomic uint64_t write;
  _Atomic uint64_t read;
  _Atomic uint64_t clear_request;
  _Atomic uint64_t clear_ack;
  uint64_t clear_seen;
  uint64_t clear_target;
  uint64_t cleared_from;
  uint64_t cleared_to;
  uint32_t capacity;
  float *samples;
};

rt_player *rt_player_create(uint32_t capacity_frames) {
  rt_player *player = calloc(1, sizeof(rt_player));
  if (player == NULL) return NULL;
  player->samples = calloc(capacity_frames, sizeof(float));
  if (player->samples == NULL) {
    free(player);
    return NULL;
  }
  player->capacity = capacity_frames;
  return player;
}

void rt_player_destroy(rt_player *player) {
  free(player->samples);
  free(player);
}

uint32_t rt_player_space(const rt_player *player) {
  uint64_t write = atomic_load_explicit(&player->write, memory_order_relaxed);
  uint64_t read = atomic_load_explicit(&player->read, memory_order_acquire);
  return player->capacity - (uint32_t)(write - read);
}

uint32_t rt_player_write(rt_player *player, const float *samples, uint32_t frames) {
  uint32_t space = rt_player_space(player);
  if (frames > space) return 0;
  uint64_t write = atomic_load_explicit(&player->write, memory_order_relaxed);
  uint32_t offset = (uint32_t)(write % player->capacity);
  uint32_t first = player->capacity - offset;
  if (first > frames) first = frames;
  memcpy(player->samples + offset, samples, first * sizeof(float));
  memcpy(player->samples, samples + first, (frames - first) * sizeof(float));
  atomic_store_explicit(&player->write, write + frames, memory_order_release);
  return frames;
}

uint64_t rt_player_written(const rt_player *player) {
  return atomic_load_explicit(&player->write, memory_order_acquire);
}

uint64_t rt_player_position(const rt_player *player) {
  return atomic_load_explicit(&player->read, memory_order_acquire);
}

void rt_player_clear(rt_player *player, uint64_t target, uint64_t serial) {
  player->clear_target = target;
  atomic_store_explicit(&player->clear_request, serial, memory_order_release);
}

int rt_player_ack(const rt_player *player, uint64_t serial, uint64_t *from, uint64_t *to) {
  if (atomic_load_explicit(&player->clear_ack, memory_order_acquire) != serial) return 0;
  *from = player->cleared_from;
  *to = player->cleared_to;
  return 1;
}

struct rt_mixer {
  _Atomic(rt_player *) slots[RT_SLOTS];
  _Atomic uint32_t readers;
  _Atomic uint32_t changes;
};

rt_mixer *rt_mixer_create(uint32_t max_frames) {
  (void)max_frames;
  return calloc(1, sizeof(rt_mixer));
}

void rt_mixer_destroy(rt_mixer *mixer) { free(mixer); }

int rt_mixer_attach(rt_mixer *mixer, rt_player *player) {
  for (int i = 0; i < RT_SLOTS; i++) {
    rt_player *empty = NULL;
    if (atomic_compare_exchange_strong(&mixer->slots[i], &empty, player)) return 1;
  }
  return 0;
}

void rt_mixer_detach(rt_mixer *mixer, rt_player *player) {
  for (int i = 0; i < RT_SLOTS; i++) {
    rt_player *expected = player;
    atomic_compare_exchange_strong(&mixer->slots[i], &expected, NULL);
  }
  while (atomic_load(&mixer->readers) != 0) sched_yield();
}

void rt_mixer_render(rt_mixer *mixer, float *out, uint32_t frames) {
  memset(out, 0, frames * sizeof(float));
  atomic_fetch_add(&mixer->readers, 1);
  for (int slot = 0; slot < RT_SLOTS; slot++) {
    rt_player *player = atomic_load(&mixer->slots[slot]);
    if (player == NULL) continue;
    uint64_t read = atomic_load_explicit(&player->read, memory_order_relaxed);
    uint64_t request = atomic_load_explicit(&player->clear_request, memory_order_acquire);
    if (request != player->clear_seen) {
      uint64_t target = player->clear_target;
      player->cleared_from = read;
      if (target > read) read = target;
      player->cleared_to = read;
      player->clear_seen = request;
      atomic_store_explicit(&player->clear_ack, request, memory_order_release);
    }
    uint64_t write = atomic_load_explicit(&player->write, memory_order_acquire);
    uint32_t available = (uint32_t)(write - read);
    uint32_t count = available < frames ? available : frames;
    uint32_t offset = (uint32_t)(read % player->capacity);
    uint32_t first = player->capacity - offset;
    if (first > count) first = count;
    for (uint32_t i = 0; i < first; i++) out[i] += player->samples[offset + i];
    for (uint32_t i = first; i < count; i++) out[i] += player->samples[i - first];
    atomic_store_explicit(&player->read, read + count, memory_order_release);
  }
  atomic_fetch_sub(&mixer->readers, 1);
}

void rt_unit_changed(void *context, AudioUnit unit, AudioUnitPropertyID property, AudioUnitScope scope, AudioUnitElement element) {
  (void)unit; (void)property; (void)scope; (void)element;
  rt_mixer *mixer = context;
  atomic_fetch_add_explicit(&mixer->changes, 1, memory_order_release);
}

uint32_t rt_mixer_changes(rt_mixer *mixer) {
  return atomic_exchange_explicit(&mixer->changes, 0, memory_order_acquire);
}

OSStatus rt_mixer_output(void *mixer, AudioUnitRenderActionFlags *flags,
                         const AudioTimeStamp *time, UInt32 bus, UInt32 frames, AudioBufferList *data) {
  (void)flags; (void)time; (void)bus;
  if (data == NULL || data->mNumberBuffers == 0 || data->mBuffers[0].mData == NULL) return noErr;
  rt_mixer_render(mixer, data->mBuffers[0].mData, frames);
  return noErr;
}
