#include <errno.h>
#include <fcntl.h>
#include <libproc.h>
#include <stdarg.h>
#include <stdio.h>
#include <string.h>
#include <time.h>
#include <unistd.h>
#include <sys/stat.h>

static int tracked(const char *text) {
  return text != NULL && (strstr(text, "extension-core-") || strstr(text, "extension-root-") || strstr(text, "marketplace-restart-"));
}

static void record(const char *call, const char *where, const char *name, int result, int code) {
  char who[256] = {0};
  proc_name(getpid(), who, sizeof(who));
  struct timespec now;
  clock_gettime(CLOCK_REALTIME, &now);
  char line[9000];
  int n = snprintf(line, sizeof(line), "TRACE %ld.%09ld pid=%d ppid=%d %s %s %s / %s => %d errno=%d\n", (long)now.tv_sec, now.tv_nsec, getpid(),
                   getppid(), who, call, where, name, result, code);
  int out = open("/tmp/fs-trace.log", O_WRONLY | O_APPEND | O_CREAT, 0644);
  if (out >= 0) {
    write(out, line, n);
    close(out);
  }
}

static void observe(const char *call, int fd, const char *path, int result, int code) {
  char parent[4096] = {0};
  if (fd != AT_FDCWD && fd >= 0) fcntl(fd, F_GETPATH, parent);
  if (tracked(parent) || tracked(path)) record(call, parent, path, result, code);
}

static int traced_unlinkat(int fd, const char *path, int flags) {
  int result = unlinkat(fd, path, flags), code = errno;
  observe(flags & AT_REMOVEDIR ? "rmdirat" : "unlinkat", fd, path, result, code);
  errno = code;
  return result;
}

static int traced_unlink(const char *path) {
  int result = unlink(path), code = errno;
  observe("unlink", AT_FDCWD, path, result, code);
  errno = code;
  return result;
}

static int traced_rmdir(const char *path) {
  int result = rmdir(path), code = errno;
  observe("rmdir", AT_FDCWD, path, result, code);
  errno = code;
  return result;
}

static int traced_rename(const char *from, const char *to) {
  int result = rename(from, to), code = errno;
  if (tracked(from) || tracked(to)) {
    char both[8200];
    snprintf(both, sizeof(both), "%s -> %s", from, to);
    record("rename", "", both, result, code);
  }
  errno = code;
  return result;
}

__attribute__((used)) static struct { const void *replacement; const void *original; } interposes[] __attribute__((section("__DATA,__interpose"))) = {
  { (const void *)traced_unlinkat, (const void *)unlinkat },
  { (const void *)traced_unlink, (const void *)unlink },
  { (const void *)traced_rmdir, (const void *)rmdir },
  { (const void *)traced_rename, (const void *)rename }
};
