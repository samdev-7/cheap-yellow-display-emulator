# Touch paint: draw on the screen with your finger (or the mouse).
# Tap a colour at the top to change brushes. Tap the black box to clear.

import bitmaptools
import board
import displayio

import cyd_touch

display = board.DISPLAY
touch = cyd_touch.Touch()

COLOURS = [0x000000, 0xFFFFFF, 0xFF0000, 0xFFA500, 0xFFFF00, 0x00FF00, 0x00AAFF, 0xAA00FF]
SWATCH = display.width // len(COLOURS)
TOP = 30

palette = displayio.Palette(len(COLOURS))
for i, colour in enumerate(COLOURS):
    palette[i] = colour

canvas = displayio.Bitmap(display.width, display.height, len(COLOURS))
for i in range(len(COLOURS)):
    bitmaptools.fill_region(canvas, i * SWATCH, 0, (i + 1) * SWATCH, TOP - 2, i)

screen = displayio.Group()
screen.append(displayio.TileGrid(canvas, pixel_shader=palette))
display.root_group = screen

brush = 1
last = None
while True:
    point = touch.read()
    if point is None:
        last = None
        continue
    x, y = point
    if y < TOP:
        brush = x // SWATCH
        if brush == 0:
            bitmaptools.fill_region(canvas, 0, TOP, display.width, display.height, 0)
        last = None
        continue
    if last is not None:
        bitmaptools.draw_line(canvas, last[0], last[1], x, y, brush)
    bitmaptools.draw_circle(canvas, x, y, 2, brush)
    last = (x, y)
