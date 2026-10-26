#include <CoreFoundation/CoreFoundation.h>
#include <Security/Security.h>
#include <stdlib.h>
#include <string.h>

typedef struct napi_env__ *napi_env;
typedef struct napi_value__ *napi_value;
typedef struct napi_callback_info__ *napi_callback_info;
typedef struct napi_deferred__ *napi_deferred;
typedef struct napi_async_work__ *napi_async_work;
typedef int napi_status;
typedef napi_value (*napi_callback)(napi_env, napi_callback_info);
typedef void (*napi_async_execute_callback)(napi_env, void *);
typedef void (*napi_async_complete_callback)(napi_env, napi_status, void *);

extern napi_status napi_get_cb_info(napi_env, napi_callback_info, size_t *, napi_value *, napi_value *, void **);
extern napi_status napi_get_value_string_utf8(napi_env, napi_value, char *, size_t, size_t *);
extern napi_status napi_create_string_utf8(napi_env, const char *, size_t, napi_value *);
extern napi_status napi_create_int32(napi_env, int, napi_value *);
extern napi_status napi_create_object(napi_env, napi_value *);
extern napi_status napi_get_null(napi_env, napi_value *);
extern napi_status napi_set_named_property(napi_env, napi_value, const char *, napi_value);
extern napi_status napi_create_promise(napi_env, napi_deferred *, napi_value *);
extern napi_status napi_resolve_deferred(napi_env, napi_deferred, napi_value);
extern napi_status napi_create_async_work(napi_env, napi_value, napi_value, napi_async_execute_callback, napi_async_complete_callback, void *, napi_async_work *);
extern napi_status napi_queue_async_work(napi_env, napi_async_work);
extern napi_status napi_delete_async_work(napi_env, napi_async_work);
extern napi_status napi_create_function(napi_env, const char *, size_t, napi_callback, void *, napi_value *);
extern napi_status napi_throw_error(napi_env, const char *, const char *);

typedef struct {
  char *service;
  char *account;
  OSStatus status;
  char *secret;
  size_t length;
  napi_deferred deferred;
  napi_async_work work;
} Ask;

static char *text_of(napi_env env, napi_value value) {
  size_t length = 0;
  if (napi_get_value_string_utf8(env, value, NULL, 0, &length) != 0) return NULL;
  char *held = malloc(length + 1);
  if (held == NULL || napi_get_value_string_utf8(env, value, held, length + 1, &length) != 0) {
    free(held);
    return NULL;
  }
  return held;
}

static void execute(napi_env env, void *data) {
  Ask *ask = data;
  CFStringRef service = CFStringCreateWithCString(NULL, ask->service, kCFStringEncodingUTF8);
  CFStringRef account = CFStringCreateWithCString(NULL, ask->account, kCFStringEncodingUTF8);
  const void *keys[] = {kSecClass, kSecAttrService, kSecAttrAccount, kSecReturnData, kSecMatchLimit};
  const void *values[] = {kSecClassGenericPassword, service, account, kCFBooleanTrue, kSecMatchLimitOne};
  CFDictionaryRef query = CFDictionaryCreate(NULL, keys, values, 5, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
  CFTypeRef found = NULL;
  ask->status = SecItemCopyMatching(query, &found);
  if (ask->status == errSecSuccess && found != NULL && CFGetTypeID(found) == CFDataGetTypeID()) {
    CFIndex length = CFDataGetLength((CFDataRef)found);
    ask->secret = malloc((size_t)length);
    if (ask->secret != NULL) {
      memcpy(ask->secret, CFDataGetBytePtr((CFDataRef)found), (size_t)length);
      ask->length = (size_t)length;
    }
  }
  if (found != NULL) CFRelease(found);
  CFRelease(query);
  CFRelease(service);
  CFRelease(account);
}

static void complete(napi_env env, napi_status status, void *data) {
  Ask *ask = data;
  napi_value answer, code, secret;
  napi_create_object(env, &answer);
  napi_create_int32(env, (int)ask->status, &code);
  napi_set_named_property(env, answer, "status", code);
  if (ask->secret != NULL) {
    napi_create_string_utf8(env, ask->secret, ask->length, &secret);
    memset(ask->secret, 0, ask->length);
    free(ask->secret);
  } else {
    napi_get_null(env, &secret);
  }
  napi_set_named_property(env, answer, "secret", secret);
  napi_resolve_deferred(env, ask->deferred, answer);
  napi_delete_async_work(env, ask->work);
  free(ask->service);
  free(ask->account);
  free(ask);
}

static napi_value read_password(napi_env env, napi_callback_info info) {
  size_t count = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &count, args, NULL, NULL);
  Ask *ask = calloc(1, sizeof(Ask));
  if (ask == NULL || count < 2) {
    free(ask);
    napi_throw_error(env, NULL, "read takes a service and an account");
    return NULL;
  }
  ask->service = text_of(env, args[0]);
  ask->account = text_of(env, args[1]);
  if (ask->service == NULL || ask->account == NULL) {
    free(ask->service);
    free(ask->account);
    free(ask);
    napi_throw_error(env, NULL, "the service and the account are strings");
    return NULL;
  }
  napi_value promise, name;
  napi_create_promise(env, &ask->deferred, &promise);
  napi_create_string_utf8(env, "keychain.read", 13, &name);
  napi_create_async_work(env, NULL, name, execute, complete, ask, &ask->work);
  napi_queue_async_work(env, ask->work);
  return promise;
}

napi_value napi_register_module_v1(napi_env env, napi_value exports) {
  napi_value read;
  napi_create_function(env, "read", 4, read_password, NULL, &read);
  napi_set_named_property(env, exports, "read", read);
  return exports;
}
