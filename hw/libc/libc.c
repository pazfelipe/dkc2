/* Minimal freestanding libc for the wasm hardware module.
 * First-fit allocator with a free list so repeated save/load states do not grow memory. */
#include <stddef.h>
#include <stdint.h>
extern unsigned char __heap_base;
static uintptr_t heap_top = 0;
typedef struct Blk { size_t size; struct Blk* next; } Blk;   /* header, 16 bytes reserved */
static Blk* free_list = 0;

void* malloc(size_t n) {
  n = (n + 15) & ~(size_t)15;
  Blk** pp = &free_list;
  while (*pp) {
    if ((*pp)->size >= n) { Blk* b = *pp; *pp = b->next; return (void*)((uintptr_t)b + 16); }
    pp = &(*pp)->next;
  }
  if (!heap_top) heap_top = ((uintptr_t)&__heap_base + 15) & ~(uintptr_t)15;
  uintptr_t p = heap_top;
  uintptr_t end = p + 16 + n;
  size_t have = __builtin_wasm_memory_size(0) * 65536;
  if (end > have) {
    size_t pages = (end - have + 65535) / 65536;
    if (__builtin_wasm_memory_grow(0, pages) == (size_t)-1) return 0;
  }
  Blk* b = (Blk*)p; b->size = n; b->next = 0;
  heap_top = end;
  return (void*)(p + 16);
}
void free(void* p) {
  if (!p) return;
  Blk* b = (Blk*)((uintptr_t)p - 16);
  b->next = free_list; free_list = b;
}
void* memset(void* d, int c, size_t n) { unsigned char* p = d; while (n--) *p++ = (unsigned char)c; return d; }
void* memcpy(void* d, const void* s, size_t n) { unsigned char* a = d; const unsigned char* b = s; while (n--) *a++ = *b++; return d; }
void* memmove(void* d, const void* s, size_t n) {
  unsigned char* a = d; const unsigned char* b = s;
  if (a < b) { while (n--) *a++ = *b++; } else { a += n; b += n; while (n--) *--a = *--b; }
  return d;
}
void* realloc(void* p, size_t n) {
  if (!p) return malloc(n);
  Blk* h = (Blk*)((uintptr_t)p - 16);
  if (h->size >= n) return p;
  void* q = malloc(n); memcpy(q, p, h->size); free(p); return q;
}
