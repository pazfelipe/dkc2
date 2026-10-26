
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <stdbool.h>

#include "cart.h"
#include "snes.h"
#include "statehandler.h"

static uint8_t cart_readLorom(Cart* cart, uint8_t bank, uint16_t adr);
static void cart_writeLorom(Cart* cart, uint8_t bank, uint16_t adr, uint8_t val);
static uint8_t cart_readHirom(Cart* cart, uint8_t bank, uint16_t adr);
static uint8_t cart_readExHirom(Cart* cart, uint8_t bank, uint16_t adr);
static void cart_writeHirom(Cart* cart, uint8_t bank, uint16_t adr, uint8_t val);

Cart* cart_init(Snes* snes) {
  Cart* cart = malloc(sizeof(Cart));
  cart->snes = snes;
  cart->type = 0;
  cart->rom = NULL;
  cart->romSize = 0;
  cart->ram = NULL;
  cart->ramSize = 0;
  return cart;
}

void cart_free(Cart* cart) {
  if(cart->rom != NULL) free(cart->rom);
  if(cart->ram != NULL) free(cart->ram);
  free(cart);
}

void cart_reset(Cart* cart) {
  // do not reset ram, assumed to be battery backed
}

bool cart_handleTypeState(Cart* cart, StateHandler* sh) {
  // when loading, return if values match
  if(sh->saving) {
    sh_handleBytes(sh, &cart->type, NULL);
    sh_handleInts(sh, &cart->romSize, &cart->ramSize, NULL);
    return true;
  } else {
    uint8_t type = 0;
    uint32_t romSize = 0;
    uint32_t ramSize = 0;
    sh_handleBytes(sh, &type, NULL);
    sh_handleInts(sh, &romSize, &ramSize, NULL);
    return !(type != cart->type || romSize != cart->romSize || ramSize != cart->ramSize);
  }
}

void cart_handleState(Cart* cart, StateHandler* sh) {
  if(cart->ram != NULL) sh_handleByteArray(sh, cart->ram, cart->ramSize);
}

void cart_load(Cart* cart, int type, uint8_t* rom, int romSize, int ramSize) {
  cart->type = type;
  if(cart->rom != NULL) free(cart->rom);
  if(cart->ram != NULL) free(cart->ram);
  cart->rom = malloc(romSize);
  cart->romSize = romSize;
  if(ramSize > 0) {
    cart->ram = malloc(ramSize);
    memset(cart->ram, 0, ramSize);
  } else {
    cart->ram = NULL;
  }
  cart->ramSize = ramSize;
  memcpy(cart->rom, rom, romSize);
}

bool cart_handleBattery(Cart* cart, bool save, uint8_t* data, int* size) {
  if(save) {
    *size = cart->ramSize;
    if(data == NULL) return true;
    // assumes data is correct size
    if(cart->ram != NULL) memcpy(data, cart->ram, cart->ramSize);
    return true;
  } else {
    if(*size != cart->ramSize) return false;
    if(cart->ram != NULL) memcpy(cart->ram, data, cart->ramSize);
    return true;
  }
}

uint8_t cart_read(Cart* cart, uint8_t bank, uint16_t adr) {
  switch(cart->type) {
    case 0: return cart->snes->openBus;
    case 1: return cart_readLorom(cart, bank, adr);
    case 2: return cart_readHirom(cart, bank, adr);
    case 3: return cart_readExHirom(cart, bank, adr);
  }
  return cart->snes->openBus;
}

void cart_write(Cart* cart, uint8_t bank, uint16_t adr, uint8_t val) {
  switch(cart->type) {
    case 0: break;
    case 1: cart_writeLorom(cart, bank, adr, val); break;
    case 2: cart_writeHirom(cart, bank, adr, val); break;
    case 3: cart_writeHirom(cart, bank, adr, val); break;
  }
}

static uint8_t cart_readLorom(Cart* cart, uint8_t bank, uint16_t adr) {
  if(((bank >= 0x70 && bank < 0x7e) || bank >= 0xf0) && adr < 0x8000 && cart->ramSize > 0) {
    // banks 70-7e and f0-ff, adr 0000-7fff
    return cart->ram[(((bank & 0xf) << 15) | adr) & (cart->ramSize - 1)];
  }
  bank &= 0x7f;
  if(adr >= 0x8000 || bank >= 0x40) {
    // adr 8000-ffff in all banks or all addresses in banks 40-7f and c0-ff
    return cart->rom[((bank << 15) | (adr & 0x7fff)) & (cart->romSize - 1)];
  }
  return cart->snes->openBus;
}

static void cart_writeLorom(Cart* cart, uint8_t bank, uint16_t adr, uint8_t val) {
  if(((bank >= 0x70 && bank < 0x7e) || bank > 0xf0) && adr < 0x8000 && cart->ramSize > 0) {
    // banks 70-7e and f0-ff, adr 0000-7fff
    cart->ram[(((bank & 0xf) << 15) | adr) & (cart->ramSize - 1)] = val;
  }
}

/* ROM-free guard (DKC2 port): one byte per ROM byte, nonzero where the original had 65816 code.
 * Every bus read of such a byte (CPU fetch or DMA source) is counted and the first ones logged. */
uint8_t* cart_guard_map = NULL;
uint32_t cart_guard_count = 0;
uint32_t cart_guard_log[256];
bool cart_guard_dummy = false; /* set by the HDMA for fetches whose value is never used */
bool cart_guard_data_only = false; /* oracle use: ignore the CPU's own instruction fetches */
uint8_t cart_guard_hitmap[0x400000 / 8]; /* every code byte read, one bit each */
extern bool cpu_in_fetch;
extern uint32_t cpu_insn_adr;
/* the CPU fetching its current instruction's bytes (opcode, operands, immediates) */
static bool cart_is_fetch(Cart* cart, uint32_t off) {
  if(cpu_in_fetch) return true;
  uint32_t io = ((((cpu_insn_adr >> 16) & 0x3f) << 16) | (cpu_insn_adr & 0xffff)) & (cart->romSize - 1);
  return off - io < 4;
}

static uint8_t cart_readHirom(Cart* cart, uint8_t bank, uint16_t adr) {
  bank &= 0x7f;
  if(bank < 0x40 && adr >= 0x6000 && adr < 0x8000 && cart->ramSize > 0) {
    // banks 00-3f and 80-bf, adr 6000-7fff
    return cart->ram[(((bank & 0x3f) << 13) | (adr & 0x1fff)) & (cart->ramSize - 1)];
  }
  if(adr >= 0x8000 || bank >= 0x40) {
    // adr 8000-ffff in all banks or all addresses in banks 40-7f and c0-ff
    uint32_t off = (((bank & 0x3f) << 16) | adr) & (cart->romSize - 1);
    if(cart_guard_map && cart_guard_map[off] && !cart_guard_dummy && !(cart_guard_data_only && cart_is_fetch(cart, off))) {
      if(cart_guard_count < 256) cart_guard_log[cart_guard_count] = off;
      cart_guard_count++;
      cart_guard_hitmap[off >> 3] |= 1 << (off & 7);
    }
    return cart->rom[off];
  }
  return cart->snes->openBus;
}

static uint8_t cart_readExHirom(Cart* cart, uint8_t bank, uint16_t adr) {
  if((bank & 0x7f) < 0x40 && adr >= 0x6000 && adr < 0x8000 && cart->ramSize > 0) {
    // banks 00-3f and 80-bf, adr 6000-7fff
    return cart->ram[(((bank & 0x3f) << 13) | (adr & 0x1fff)) & (cart->ramSize - 1)];
  }
  bool secondHalf = bank < 0x80;
  bank &= 0x7f;
  if(adr >= 0x8000 || bank >= 0x40) {
    // adr 8000-ffff in all banks or all addresses in banks 40-7f and c0-ff
    return cart->rom[(((bank & 0x3f) << 16) | (secondHalf ? 0x400000 : 0) | adr) & (cart->romSize - 1)];
  }
  return cart->snes->openBus;
}

static void cart_writeHirom(Cart* cart, uint8_t bank, uint16_t adr, uint8_t val) {
  bank &= 0x7f;
  if(bank < 0x40 && adr >= 0x6000 && adr < 0x8000 && cart->ramSize > 0) {
    // banks 00-3f and 80-bf, adr 6000-7fff
    cart->ram[(((bank & 0x3f) << 13) | (adr & 0x1fff)) & (cart->ramSize - 1)] = val;
  }
}
