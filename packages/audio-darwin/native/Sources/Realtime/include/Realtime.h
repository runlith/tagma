#pragma once

#include <AudioToolbox/AudioToolbox.h>
#include <CoreAudio/CoreAudio.h>
#include <stdint.h>

enum {
  RT_RECORD_NONE = 0,
  RT_RECORD_FRAMES = 1,
  RT_RECORD_DROP = 2,
};

typedef struct {
  uint32_t kind;
  uint32_t frames;
  uint64_t host;
  uint64_t until;
} rt_record;

typedef struct rt_ring rt_ring;

rt_ring *_Nullable rt_ring_create(uint32_t channels, uint32_t capacity_frames, double ticks_per_frame);
void rt_ring_destroy(rt_ring *_Nonnull ring);
uint32_t rt_ring_channels(const rt_ring *_Nonnull ring);
uint32_t rt_ring_largest_record(const rt_ring *_Nonnull ring);
void rt_ring_write(rt_ring *_Nonnull ring, const AudioBufferList *_Nonnull list, uint32_t frames, uint64_t host);
int rt_ring_faulted(const rt_ring *_Nonnull ring);
uint32_t rt_ring_read(rt_ring *_Nonnull ring, rt_record *_Nonnull record, float *_Nonnull samples, uint32_t capacity_frames);
int rt_ring_take_drop(rt_ring *_Nonnull ring, rt_record *_Nonnull record);
int rt_ring_take_fault(rt_ring *_Nonnull ring, rt_record *_Nonnull record);

OSStatus rt_ring_ioproc(AudioObjectID device, const AudioTimeStamp *_Nonnull now,
                        const AudioBufferList *_Nonnull input, const AudioTimeStamp *_Nonnull input_time,
                        AudioBufferList *_Nonnull output, const AudioTimeStamp *_Nonnull output_time,
                        void *_Nullable client);

typedef struct rt_player rt_player;

rt_player *_Nullable rt_player_create(uint32_t capacity_frames);
void rt_player_destroy(rt_player *_Nonnull player);
uint32_t rt_player_space(const rt_player *_Nonnull player);
uint32_t rt_player_write(rt_player *_Nonnull player, const float *_Nonnull samples, uint32_t frames);
uint64_t rt_player_written(const rt_player *_Nonnull player);
uint64_t rt_player_position(const rt_player *_Nonnull player);
void rt_player_clear(rt_player *_Nonnull player, uint64_t target, uint64_t serial);
int rt_player_ack(const rt_player *_Nonnull player, uint64_t serial, uint64_t *_Nonnull from, uint64_t *_Nonnull to);

#define RT_SLOTS 16

typedef struct rt_mixer rt_mixer;

rt_mixer *_Nullable rt_mixer_create(uint32_t max_frames);
void rt_mixer_destroy(rt_mixer *_Nonnull mixer);
int rt_mixer_attach(rt_mixer *_Nonnull mixer, rt_player *_Nonnull player);
void rt_mixer_detach(rt_mixer *_Nonnull mixer, rt_player *_Nonnull player);
void rt_mixer_render(rt_mixer *_Nonnull mixer, float *_Nonnull out, uint32_t frames);
void rt_unit_changed(void *_Nonnull context, AudioUnit _Nonnull unit, AudioUnitPropertyID property, AudioUnitScope scope, AudioUnitElement element);
uint32_t rt_mixer_changes(rt_mixer *_Nonnull mixer);
OSStatus rt_mixer_output(void *_Nonnull mixer, AudioUnitRenderActionFlags *_Nonnull flags,
                         const AudioTimeStamp *_Nonnull time, UInt32 bus, UInt32 frames,
                         AudioBufferList *_Nullable data);

typedef struct rt_voice rt_voice;

rt_voice *_Nullable rt_voice_create(uint32_t max_frames);
void rt_voice_destroy(rt_voice *_Nonnull voice);
void rt_voice_bind(rt_voice *_Nonnull voice, AudioUnit _Nullable unit);
int rt_voice_attach(rt_voice *_Nonnull voice, rt_ring *_Nonnull ring);
void rt_voice_detach(rt_voice *_Nonnull voice, rt_ring *_Nonnull ring);
uint32_t rt_voice_failures(const rt_voice *_Nonnull voice);
OSStatus rt_voice_input(void *_Nonnull voice, AudioUnitRenderActionFlags *_Nonnull flags,
                        const AudioTimeStamp *_Nonnull time, UInt32 bus, UInt32 frames,
                        AudioBufferList *_Nullable data);
