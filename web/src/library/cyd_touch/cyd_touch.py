# Touchscreen driver for the Cheap Yellow Display's XPT2046 controller.
#   import cyd_touch
#   touch = cyd_touch.Touch()

import board
import busio
import digitalio

X_MIN = 200
X_MAX = 3700
Y_MIN = 240
Y_MAX = 3800

_READ_X = 0x90  # Channel that follows the screen's x axis on the CYD.
_READ_Y = 0xD0  # Channel that follows the screen's y axis on the CYD.
_READ_Z1 = 0xB0
_READ_Z2 = 0xC0

class Touch:
    def __init__(self, width=320, height=240, pressure=100):
        self.width = width
        self.height = height
        self.pressure = pressure
        self._spi = busio.SPI(board.TOUCH_SCK, MOSI=board.TOUCH_MOSI, MISO=board.TOUCH_MISO)
        while not self._spi.try_lock():
            pass
        self._spi.configure(baudrate=2_000_000)
        self._spi.unlock()
        self._cs = digitalio.DigitalInOut(board.TOUCH_CS)
        self._cs.switch_to_output(True)
        self._irq = digitalio.DigitalInOut(board.TOUCH_INT)
        self._out = bytearray(3)
        self._in = bytearray(3)

    def _read(self, command):
        self._out[0] = command
        while not self._spi.try_lock():
            pass
        self._cs.value = False
        self._spi.write_readinto(self._out, self._in)
        self._cs.value = True
        self._spi.unlock()
        return ((self._in[1] << 8) | self._in[2]) >> 3

    @property
    def touched(self):
        """True while something presses the screen."""
        return not self._irq.value

    def read_raw(self):
        """Raw (x, y, z) readings, averaged over a few samples."""
        z = self._read(_READ_Z1) + 4095 - self._read(_READ_Z2)
        x = sum(self._read(_READ_X) for _ in range(4)) // 4
        y = sum(self._read(_READ_Y) for _ in range(4)) // 4
        return x, y, z

    def read(self):
        """The touched point in screen pixels, or None."""
        if not self.touched:
            return None
        x, y, z = self.read_raw()
        if z < self.pressure:
            return None
        sx = (x - X_MIN) * (self.width - 1) // (X_MAX - X_MIN)
        sy = (y - Y_MIN) * (self.height - 1) // (Y_MAX - Y_MIN)
        return (min(max(sx, 0), self.width - 1), min(max(sy, 0), self.height - 1))
