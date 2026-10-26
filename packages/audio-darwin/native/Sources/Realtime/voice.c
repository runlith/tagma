#include "Realtime.h"

#include <stdatomic.h>
#include <stdlib.h>
#include <sched.h>

struct rt_voice {
  AudioUnit unit;
  AudioBufferList list;
  uint32_t capacity;
  _Atomic uint32_t failures;
  _Atomic uint32_t readers;
  _Atomic(rt_ring *) rings[RT_SLOTS];
};

rt_voice *rt_voice_create(uint32_t max_frames) {
  rt_voice *voice = calloc(1, sizeof(rt_voice));
  if (voice == NULL) return NULL;
  voice->list.mNumberBuffers = 1;
  voice->list.mBuffers[0].mNumberChannels = 1;
  voice->list.mBuffers[0].mData = calloc(max_frames, sizeof(float));
  if (voice->list.mBuffers[0].mData == NULL) { free(voice); return NULL; }
  voice->capacity = max_frames;
  return voice;
}

void rt_voice_destroy(rt_voice *voice) {
  free(voice->list.mBuffers[0].mData);
  free(voice);
}

void rt_voice_bind(rt_voice *voice, AudioUnit unit) { voice->unit = unit; }

int rt_voice_attach(rt_voice *voice, rt_ring *ring) {
  for (int i = 0; i < RT_SLOTS; i++) {
    rt_ring *empty = NULL;
    if (atomic_compare_exchange_strong(&voice->rings[i], &empty, ring)) return 1;
  }
  return 0;
}

void rt_voice_detach(rt_voice *voice, rt_ring *ring) {
  for (int i = 0; i < RT_SLOTS; i++) {
    rt_ring *expected = ring;
    atomic_compare_exchange_strong(&voice->rings[i], &expected, NULL);
  }
  while (atomic_load(&voice->readers) != 0) sched_yield();
}

uint32_t rt_voice_failures(const rt_voice *voice) { return atomic_load(&voice->failures); }

OSStatus rt_voice_input(void *context, AudioUnitRenderActionFlags *flags,
                        const AudioTimeStamp *time, UInt32 bus, UInt32 frames, AudioBufferList *data) {
  (void)bus; (void)data;
  rt_voice *voice = context;
  if (frames > voice->capacity) { atomic_fetch_add(&voice->failures, 1); return noErr; }
  voice->list.mBuffers[0].mDataByteSize = frames * sizeof(float);
  OSStatus status = AudioUnitRender(voice->unit, flags, time, 1, frames, &voice->list);
  if (status != noErr) { atomic_fetch_add(&voice->failures, 1); return status; }
  atomic_fetch_add(&voice->readers, 1);
  for (int i = 0; i < RT_SLOTS; i++) {
    rt_ring *ring = atomic_load(&voice->rings[i]);
    if (ring != NULL) rt_ring_write(ring, &voice->list, frames, time->mHostTime);
  }
  atomic_fetch_sub(&voice->readers, 1);
  return noErr;
}
