# This file is part of the CircuitPython project: https://circuitpython.org
#
# SPDX-License-Identifier: MIT

BOARD ?= sunton_esp32_2432S028
CROSS_COMPILE =

include ../../py/circuitpy_mkenv.mk

CC = emcc
CPP = emcc -E
AR = emar
SIZE = true

INC += \
	-I. \
	-I../.. \
	-I../../lib/mp-readline \
	-I../../lib/tinyusb/src \
	-I../../supervisor/shared/usb \
	-Iesp_shim \
	-Iboards/$(BOARD) \
	-I$(BUILD) \
	-I$(BUILD)/genhdr

SRC_C += \
	background.c \
	boards/$(BOARD)/board.c \
	boards/$(BOARD)/pins.c \
	mphalport.c \
	peripherals/pins.c \
	shared/runtime/gchelper_generic.c

ifeq ($(DEBUG),1)
COPT = -O1 -g
else
COPT = -O2
endif

CLANG_CFLAGS = $(filter-out -fsingle-precision-constant -Wimplicit-fallthrough=2 --param max-inline-insns-single=500 -Wno-endif-labels,$(BASE_CFLAGS))

CFLAGS += $(INC) -std=gnu11 $(CLANG_CFLAGS) $(COPT)
CFLAGS += -DMICROPY_GCREGS_SETJMP=1
CFLAGS += -sSUPPORT_LONGJMP=wasm
CFLAGS += \
	-Wno-unused-parameter \
	-Wno-sign-compare \
	-Wno-cast-align \
	-Wno-missing-field-initializers \
	-Wno-gnu-variable-sized-type-not-at-end \
	-Wno-unknown-warning-option \
	-Wno-ignored-optimization-argument \
	-Wno-unused-command-line-argument \
	-Wno-expansion-to-defined \
	-Wno-unreachable-code

JSFLAGS += \
	-sSUPPORT_LONGJMP=wasm \
	-sSTACK_SIZE=262144 \
	-sINITIAL_MEMORY=16777216 \
	-sALLOW_MEMORY_GROWTH=0 \
	-sMODULARIZE=1 \
	-sEXPORT_ES6=1 \
	-sEXPORT_NAME=createCircuitPython \
	-sENVIRONMENT=worker,node \
	-sEXIT_RUNTIME=0 \
	-sINVOKE_RUN=0 \
	-sEXPORTED_FUNCTIONS=_main \
	-sEXPORTED_RUNTIME_METHODS=HEAPU8,UTF8ToString,stringToUTF8 \
	--js-library library.js

OBJ += $(PY_O) $(SUPERVISOR_O) $(addprefix $(BUILD)/, $(SRC_C:.c=.o))
OBJ += $(addprefix $(BUILD)/, $(SRC_COMMON_HAL_SHARED_MODULE_EXPANDED:.c=.o))
OBJ += $(addprefix $(BUILD)/, $(SRC_CIRCUITPY_COMMON:.c=.o))
OBJ += $(addprefix $(BUILD)/, $(SRC_MOD:.c=.o))

SRC_QSTR += $(SRC_C) $(SRC_SUPERVISOR) $(SRC_CIRCUITPY_COMMON) \
	$(SRC_COMMON_HAL_SHARED_MODULE_EXPANDED) $(SRC_MOD)
SRC_QSTR_PREPROCESSOR +=

all: $(BUILD)/circuitpython.mjs

WASM_OPT = $(shell em-config BINARYEN_ROOT)/bin/wasm-opt
WASM_FEATURES = --enable-bulk-memory --enable-exception-handling --enable-sign-ext \
	--enable-mutable-globals --enable-nontrapping-float-to-int --enable-reference-types \
	--enable-multivalue

$(BUILD)/circuitpython.mjs: $(OBJ) library.js
	$(STEPECHO) "LINK $@"
	$(Q)echo $(OBJ) > $(BUILD)/firmware.objs
	$(Q)$(CC) -o $@ $(COPT) -g --profiling-funcs -Wno-limited-postlink-optimizations $(JSFLAGS) @$(BUILD)/firmware.objs -lm
	$(STEPECHO) "WASM-OPT $(BUILD)/circuitpython.wasm"
	$(Q)$(WASM_OPT) $(WASM_FEATURES) --spill-pointers -O3 -g --strip-dwarf --strip-producers \
		$(BUILD)/circuitpython.wasm -o $(BUILD)/circuitpython.wasm

include $(TOP)/py/mkrules.mk
