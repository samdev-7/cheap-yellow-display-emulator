# Bouncy balls: a little physics playground.
#   Tap empty space to add a ball. Press a ball to grab it, drag, and let go
#   to throw it. Balls bounce off the walls and each other.
#   The RGB LED on the back flashes the colour of a ball that hits hard.
#   Cover the light sensor (drag its dial down) and gravity flips.
#   Press BOOT to start again.

import math
import time

import analogio
import board
import digitalio
import displayio
import pwmio
import terminalio
import vectorio
from adafruit_display_text import label

import cyd_touch

WIDTH = 320
HEIGHT = 240
RADIUS = 14
MAX_BALLS = 8
GRAVITY = 600  # pixels per second, per second
BOUNCE = 0.82  # share of speed kept after hitting a wall
DARK = 9000  # light sensor readings above this mean it's covered
COLOURS = (0xFF4D6D, 0xFFB000, 0x3DDC97, 0x4CC9F0, 0xB388FF, 0xFF7AC6, 0xF9F871, 0x7CFF6B)

display = board.DISPLAY
display.auto_refresh = False
touch = cyd_touch.Touch()
light = analogio.AnalogIn(board.LDR)
boot = digitalio.DigitalInOut(board.BUTTON)
boot.switch_to_input(pull=digitalio.Pull.UP)

# The LED is common anode: brightest when its pin is low.
leds = [pwmio.PWMOut(pin, frequency=5000) for pin in (board.LED_RED, board.LED_GREEN, board.LED_BLUE)]
flash = [0.0, 0.0, 0.0]


def show_led():
    for led, level in zip(leds, flash):
        led.duty_cycle = 65535 - int(min(1, level) * 65535)


screen = displayio.Group()
background = displayio.Palette(1)
background[0] = 0x0B1026
screen.append(vectorio.Rectangle(pixel_shader=background, width=WIDTH, height=HEIGHT, x=0, y=0))
hint = label.Label(terminalio.FONT, text="tap to add  drag to throw", color=0x5C6A99, x=6, y=8)
screen.append(hint)
display.root_group = screen


class Ball:
    def __init__(self, x, y, vx, vy, colour):
        self.x, self.y, self.vx, self.vy = x, y, vx, vy
        self.colour = colour
        palette = displayio.Palette(1)
        palette[0] = self.colour
        self.shape = vectorio.Circle(pixel_shader=palette, radius=RADIUS, x=int(x), y=int(y))
        screen.append(self.shape)

    def draw(self):
        self.shape.x = int(self.x)
        self.shape.y = int(self.y)


balls = []
added = 0


def add_ball(x, y, vx=0.0, vy=0.0):
    global added
    if len(balls) >= MAX_BALLS:
        oldest = balls.pop(0)
        screen.remove(oldest.shape)
    balls.append(Ball(x, y, vx, vy, COLOURS[added % len(COLOURS)]))
    added += 1


def reset():
    while balls:
        screen.remove(balls.pop().shape)
    for i in range(3):
        add_ball(80 + i * 80, 60 + i * 20, 90 - i * 90, 0)


def hit(ball, speed):
    # A hard hit lights the LED in the ball's colour.
    strength = min(1, speed / 700)
    if strength > 0.25:
        colour = ball.colour
        for i, shift in enumerate((16, 8, 0)):
            flash[i] = max(flash[i], strength * ((colour >> shift) & 0xFF) / 255)


reset()
held = None  # (ball, x, y, time) while a ball is held
last = time.monotonic()
while True:
    now = time.monotonic()
    dt = min(0.05, now - last)
    last = now

    if not boot.value:
        reset()
        while not boot.value:
            pass

    # Light on the sensor sets the way gravity pulls.
    gravity = -GRAVITY if light.value > DARK else GRAVITY

    point = touch.read()
    if point:
        x, y = point
        if held is None:
            grabbed = None
            for ball in balls:
                if (ball.x - x) ** 2 + (ball.y - y) ** 2 < (RADIUS * 2) ** 2:
                    grabbed = ball
            if grabbed:
                held = (grabbed, x, y, now)
            elif y > 16:
                add_ball(x, y)
                held = (balls[-1], x, y, now)
        else:
            ball, px, py, pt = held
            # The ball follows the finger, and takes its speed when let go.
            step = max(0.001, now - pt)
            ball.vx = (x - px) / step
            ball.vy = (y - py) / step
            ball.x, ball.y = x, y
            held = (ball, x, y, now)
    else:
        held = None

    for ball in balls:
        if held and ball is held[0]:
            continue
        ball.vy += gravity * dt
        ball.x += ball.vx * dt
        ball.y += ball.vy * dt
        if ball.x < RADIUS:
            ball.x = RADIUS
            hit(ball, abs(ball.vx))
            ball.vx = -ball.vx * BOUNCE
        elif ball.x > WIDTH - RADIUS:
            ball.x = WIDTH - RADIUS
            hit(ball, abs(ball.vx))
            ball.vx = -ball.vx * BOUNCE
        if ball.y < RADIUS:
            ball.y = RADIUS
            hit(ball, abs(ball.vy))
            ball.vy = -ball.vy * BOUNCE
        elif ball.y > HEIGHT - RADIUS:
            ball.y = HEIGHT - RADIUS
            hit(ball, abs(ball.vy))
            ball.vy = -ball.vy * BOUNCE
            ball.vx *= 0.99  # a little rolling friction

    # Balls that overlap push apart and swap speed along the line between them.
    for i in range(len(balls)):
        a = balls[i]
        for j in range(i + 1, len(balls)):
            b = balls[j]
            dx = b.x - a.x
            dy = b.y - a.y
            distance = math.sqrt(dx * dx + dy * dy)
            if 0 < distance < RADIUS * 2:
                nx, ny = dx / distance, dy / distance
                push = (RADIUS * 2 - distance) / 2
                a.x -= nx * push
                a.y -= ny * push
                b.x += nx * push
                b.y += ny * push
                closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny
                if closing > 0:
                    a.vx -= closing * nx
                    a.vy -= closing * ny
                    b.vx += closing * nx
                    b.vy += closing * ny
                    hit(a, closing)

    for ball in balls:
        ball.draw()
    for i in range(3):
        flash[i] *= 0.85
    show_led()
    display.refresh(target_frames_per_second=30, minimum_frames_per_second=0)
