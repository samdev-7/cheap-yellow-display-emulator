# Hello, CYD!
# Shows a greeting, counts taps on the touchscreen, and fades the RGB LED on
# the back of the board through the colour wheel.
# This file runs the same way here and on a real Cheap Yellow Display.
# The greeting comes from settings.toml.

import os
import time

import board
import displayio
import pwmio
import rainbowio
import terminalio
from adafruit_display_text import label

import cyd_touch

display = board.DISPLAY
screen = displayio.Group()
display.root_group = screen

# Fill the background with one colour.
background = displayio.Bitmap(display.width, display.height, 1)
palette = displayio.Palette(1)
palette[0] = 0x002244
screen.append(displayio.TileGrid(background, pixel_shader=palette))

title = label.Label(terminalio.FONT, text=os.getenv("GREETING", "Hello, CYD!"), color=0xFFFF00, scale=3)
title.anchor_point = (0.5, 0.5)
title.anchored_position = (display.width // 2, display.height // 2 - 24)
screen.append(title)

message = label.Label(terminalio.FONT, text="Tap the screen", color=0xFFFFFF, scale=2)
message.anchor_point = (0.5, 0.5)
message.anchored_position = (display.width // 2, display.height // 2 + 28)
screen.append(message)

touch = cyd_touch.Touch()

# The RGB LED is "common anode": a colour is brightest when its pin is LOW,
# so the duty cycle is inverted.
leds = [pwmio.PWMOut(pin, frequency=5000) for pin in (board.LED_RED, board.LED_GREEN, board.LED_BLUE)]


def show_colour(colour):
    levels = ((colour >> 16) & 0xFF, (colour >> 8) & 0xFF, colour & 0xFF)
    for led, level in zip(leds, levels):
        led.duty_cycle = 65535 - level * 257


def taps_text(count):
    return "{} tap{}".format(count, "" if count == 1 else "s")


taps = 0
was_touched = False
position = 0
while True:
    # Count a tap when a touch starts, not for as long as it lasts.
    touched = touch.touched
    if touched and not was_touched:
        taps += 1
        message.text = taps_text(taps)
        print(message.text)
    was_touched = touched

    show_colour(rainbowio.colorwheel(position))
    position = (position + 1) % 256
    time.sleep(0.01)
