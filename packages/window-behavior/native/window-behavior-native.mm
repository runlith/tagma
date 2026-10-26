#include <napi.h>
#import <Cocoa/Cocoa.h>
#import <objc/message.h>

Napi::Value SetPreventsActivation(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 2 || !info[0].IsBuffer() || !info[1].IsBoolean()) {
    return Napi::Boolean::New(env, false);
  }

  Napi::Buffer<uint8_t> buffer = info[0].As<Napi::Buffer<uint8_t>>();
  if (buffer.Length() < sizeof(void*)) {
    return Napi::Boolean::New(env, false);
  }

  void* ptr = *reinterpret_cast<void* const*>(buffer.Data());
  NSView* view = (__bridge NSView*)ptr;
  if (!view) {
    return Napi::Boolean::New(env, false);
  }

  NSWindow* window = [view window];
  if (!window) {
    return Napi::Boolean::New(env, false);
  }

  BOOL prevent = info[1].As<Napi::Boolean>().Value();
  SEL selector = NSSelectorFromString(@"_setPreventsActivation:");
  if (![window respondsToSelector:selector]) {
    return Napi::Boolean::New(env, false);
  }

  ((void (*)(id, SEL, BOOL))objc_msgSend)(window, selector, prevent);
  return Napi::Boolean::New(env, true);
}

Napi::Object Initialize(Napi::Env env, Napi::Object exports) {
  exports.Set("setPreventsActivation", Napi::Function::New(env, SetPreventsActivation));
  return exports;
}

NODE_API_MODULE(window_behavior_native, Initialize)
