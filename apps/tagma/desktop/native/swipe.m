#import <AppKit/AppKit.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct napi_env__ *napi_env;
typedef struct napi_value__ *napi_value;
typedef struct napi_callback_info__ *napi_callback_info;
typedef struct napi_threadsafe_function__ *napi_threadsafe_function;
typedef int napi_status;
typedef napi_value (*napi_callback)(napi_env, napi_callback_info);
typedef void (*napi_finalize)(napi_env, void *, void *);
typedef void (*napi_threadsafe_function_call_js)(napi_env, napi_value, void *, void *);

enum { NONBLOCKING = 0 };

extern napi_status napi_get_cb_info(napi_env, napi_callback_info, size_t *, napi_value *, napi_value *, void **);
extern napi_status napi_create_string_utf8(napi_env, const char *, size_t, napi_value *);
extern napi_status napi_get_boolean(napi_env, bool, napi_value *);
extern napi_status napi_get_undefined(napi_env, napi_value *);
extern napi_status napi_call_function(napi_env, napi_value, napi_value, size_t, const napi_value *, napi_value *);
extern napi_status napi_create_function(napi_env, const char *, size_t, napi_callback, void *, napi_value *);
extern napi_status napi_set_named_property(napi_env, napi_value, const char *, napi_value);
extern napi_status napi_throw_error(napi_env, const char *, const char *);
extern napi_status napi_create_threadsafe_function(napi_env, napi_value, napi_value, napi_value, size_t, size_t, void *, napi_finalize, void *,
                                                   napi_threadsafe_function_call_js, napi_threadsafe_function *);
extern napi_status napi_call_threadsafe_function(napi_threadsafe_function, void *, int);
extern napi_status napi_unref_threadsafe_function(napi_env, napi_threadsafe_function);

static napi_threadsafe_function heard = NULL;
static id monitor = nil;

static const char *phase_of(NSEventPhase phase) {
  if (phase == NSEventPhaseBegan) return "began";
  if (phase == NSEventPhaseEnded) return "ended";
  if (phase == NSEventPhaseCancelled) return "cancelled";
  return NULL;
}

static void deliver(napi_env env, napi_value listener, void *context, void *data) {
  if (env == NULL || listener == NULL) return;
  napi_value phase, receiver;
  napi_create_string_utf8(env, data, SIZE_MAX, &phase);
  napi_get_undefined(env, &receiver);
  napi_call_function(env, receiver, listener, 1, &phase, NULL);
}

static napi_value watch(napi_env env, napi_callback_info info) {
  size_t count = 1;
  napi_value listener = NULL;
  napi_get_cb_info(env, info, &count, &listener, NULL, NULL);
  if (count < 1 || listener == NULL) {
    napi_throw_error(env, NULL, "watch takes the listener of the scroll phases");
    return NULL;
  }
  if (monitor != nil) {
    napi_throw_error(env, NULL, "the scroll phases are watched already");
    return NULL;
  }
  napi_value name;
  napi_create_string_utf8(env, "swipe.phase", SIZE_MAX, &name);
  if (napi_create_threadsafe_function(env, listener, NULL, name, 0, 1, NULL, NULL, NULL, deliver, &heard) != 0) {
    napi_throw_error(env, NULL, "the listener of the scroll phases could not be held");
    return NULL;
  }
  napi_unref_threadsafe_function(env, heard);
  monitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskScrollWheel
                                                  handler:^NSEvent *(NSEvent *event) {
                                                    const char *phase = phase_of(event.phase);
                                                    if (phase != NULL) napi_call_threadsafe_function(heard, (void *)phase, NONBLOCKING);
                                                    return event;
                                                  }];
  return NULL;
}

static napi_value enabled(napi_env env, napi_callback_info info) {
  napi_value answer;
  napi_get_boolean(env, [NSEvent isSwipeTrackingFromScrollEventsEnabled], &answer);
  return answer;
}

napi_value napi_register_module_v1(napi_env env, napi_value exports) {
  napi_value watching, asking;
  napi_create_function(env, "watch", 5, watch, NULL, &watching);
  napi_set_named_property(env, exports, "watch", watching);
  napi_create_function(env, "enabled", 7, enabled, NULL, &asking);
  napi_set_named_property(env, exports, "enabled", asking);
  return exports;
}
