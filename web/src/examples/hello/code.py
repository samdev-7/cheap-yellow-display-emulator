# Hello, CYD!
# Shows text on the screen and counts up once a second.
# This file runs the same way here and on a real Cheap Yellow Display.
# The greeting comes from settings.toml.

import os
import time

import board
import displayio
import terminalio
from adafruit_display_text import label

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
title.anchored_position = (display.width // 2, display.height // 2 - 20)
screen.append(title)

counter = label.Label(terminalio.FONT, text="", color=0xFFFFFF, scale=2)
counter.anchor_point = (0.5, 0.5)
counter.anchored_position = (display.width // 2, display.height // 2 + 30)
screen.append(counter)

count = 0
while True:
    counter.text = "Count: {}".format(count)
    print("count", count)
    count += 1
    time.sleep(1)
