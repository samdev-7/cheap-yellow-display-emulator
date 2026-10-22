# Fades the RGB LED on the back of the board through the colour wheel.
# The LED is "common anode": a colour is brightest when its pin is LOW,
# so the duty cycle is inverted.

import time

import board
import pwmio
import rainbowio

red = pwmio.PWMOut(board.LED_RED, frequency=5000)
green = pwmio.PWMOut(board.LED_GREEN, frequency=5000)
blue = pwmio.PWMOut(board.LED_BLUE, frequency=5000)


def show(colour):
    for led, level in ((red, colour >> 16), (green, (colour >> 8) & 0xFF), (blue, colour & 0xFF)):
        led.duty_cycle = 65535 - level * 257


position = 0
while True:
    show(rainbowio.colorwheel(position))
    position = (position + 1) % 256
    time.sleep(0.02)
