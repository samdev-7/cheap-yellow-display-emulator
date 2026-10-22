# Hold the BOOT button to dim the screen; release it to brighten it again.

import time

import board
import digitalio

button = digitalio.DigitalInOut(board.BUTTON)
button.switch_to_input(pull=digitalio.Pull.UP)

display = board.DISPLAY
was_pressed = False
while True:
    pressed = not button.value
    if pressed != was_pressed:
        print("BOOT pressed" if pressed else "BOOT released")
        was_pressed = pressed
    target = 0.2 if pressed else 1.0
    display.brightness += (target - display.brightness) * 0.3
    time.sleep(0.05)
