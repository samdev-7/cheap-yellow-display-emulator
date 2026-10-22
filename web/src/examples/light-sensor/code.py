# Reads the light sensor (LDR) on the front of the board and shows a bar.
# Not every CYD has the light sensor fitted.

import time

import analogio
import board
import displayio
import terminalio
import vectorio
from adafruit_display_text import label

display = board.DISPLAY
sensor = analogio.AnalogIn(board.LDR)

palette = displayio.Palette(2)
palette[0] = 0x101010
palette[1] = 0xFFCC00

screen = displayio.Group()
screen.append(vectorio.Rectangle(pixel_shader=palette, width=display.width, height=display.height, x=0, y=0, color_index=0))
bar = vectorio.Rectangle(pixel_shader=palette, width=1, height=40, x=20, y=120, color_index=1)
screen.append(bar)
reading = label.Label(terminalio.FONT, text="", color=0xFFFFFF, scale=2, x=20, y=60)
screen.append(reading)
display.root_group = screen

while True:
    value = sensor.value
    reading.text = "LDR: {}".format(value)
    bar.width = max(1, value * (display.width - 40) // 65535)
    print(value)
    time.sleep(0.2)
