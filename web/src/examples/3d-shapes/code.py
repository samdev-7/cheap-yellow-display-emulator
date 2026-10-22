# 3D shapes: solid, lit 3D shapes, worked out in Python every frame.
#   Drag to spin the shape; let go and it keeps spinning. Tap to change shape.
#   Each face is shaded by how directly the light falls on it, and faces
#   turned away from you aren't drawn. The RGB LED glows the colour of the
#   face pointing at you, and covering the light sensor dims the light.

import math
import time

import analogio
import board
import displayio
import pwmio
import terminalio
import vectorio
from adafruit_display_text import label

import cyd_touch

WIDTH = 320
HEIGHT = 240
SIZE = 70  # pixels from the centre to a vertex, roughly
DISTANCE = 5.0  # how far the camera is from the shape; nearer is more perspective
LIGHT = (-0.45, 0.6, -0.66)  # where the light comes from: upper left, in front

display = board.DISPLAY
display.auto_refresh = False
touch = cyd_touch.Touch()
sensor = analogio.AnalogIn(board.LDR)
leds = [pwmio.PWMOut(pin, frequency=5000) for pin in (board.LED_RED, board.LED_GREEN, board.LED_BLUE)]


def shape(name, colour, vertices, faces):
    # Order each face's corners so its normal points outwards.
    ordered = []
    for face in faces:
        a, b, c = (vertices[i] for i in face[:3])
        normal = cross(sub(b, a), sub(c, a))
        centre = [sum(vertices[i][k] for i in face) / len(face) for k in range(3)]
        ordered.append(face if dot(normal, centre) > 0 else tuple(reversed(face)))
    scale = 1 / max(math.sqrt(dot(v, v)) for v in vertices)
    return name, colour, [tuple(c * scale for c in v) for v in vertices], ordered


def sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def triangles(vertices, edge):
    # Every three vertices that are all one edge apart make a face.
    near = lambda i, j: abs(math.sqrt(dot(sub(vertices[i], vertices[j]), sub(vertices[i], vertices[j]))) - edge) < 0.01
    count = len(vertices)
    return [(i, j, k) for i in range(count) for j in range(i + 1, count) for k in range(j + 1, count) if near(i, j) and near(j, k) and near(i, k)]


PHI = (1 + math.sqrt(5)) / 2
cube_vertices = [(x, y, z) for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)]
octahedron_vertices = [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)]
icosahedron_vertices = [(0, s1, s2 * PHI) for s1 in (-1, 1) for s2 in (-1, 1)]
icosahedron_vertices += [(s1, s2 * PHI, 0) for s1 in (-1, 1) for s2 in (-1, 1)]
icosahedron_vertices += [(s2 * PHI, 0, s1) for s1 in (-1, 1) for s2 in (-1, 1)]
SHAPES = [
    shape("cube", (0x2E, 0xC4, 0xB6), cube_vertices,
          [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]),
    shape("octahedron", (0xFF, 0xB0, 0x20), octahedron_vertices, triangles(octahedron_vertices, math.sqrt(2))),
    shape("icosahedron", (0x9B, 0x7B, 0xFF), icosahedron_vertices, triangles(icosahedron_vertices, 2)),
]

# One filled polygon per face, for the shape with the most faces.
screen = displayio.Group()
background = displayio.Palette(1)
background[0] = 0x0B1026
screen.append(vectorio.Rectangle(pixel_shader=background, width=WIDTH, height=HEIGHT, x=0, y=0))
faces = []
for _ in range(max(len(s[3]) for s in SHAPES)):
    palette = displayio.Palette(1)
    polygon = vectorio.Polygon(pixel_shader=palette, points=[(0, 0), (1, 0), (0, 1)], x=0, y=0)
    polygon.hidden = True
    screen.append(polygon)
    faces.append((polygon, palette))
title = label.Label(terminalio.FONT, text="", color=0x8DA9C4, x=6, y=8)
fps_label = label.Label(terminalio.FONT, text="", color=0x5C6A99, x=262, y=8)
hint = label.Label(terminalio.FONT, text="drag to spin  tap for a new shape", color=0x5C6A99, x=6, y=230)
for item in (title, fps_label, hint):
    screen.append(item)
display.root_group = screen

light_length = math.sqrt(dot(LIGHT, LIGHT))
LIGHT = tuple(c / light_length for c in LIGHT)


def rotate(matrix, ax, ay):
    # Turn the shape about the screen's x and y axes.
    cx, sx, cy, sy = math.cos(ax), math.sin(ax), math.cos(ay), math.sin(ay)
    turn = ((cy, 0, sy), (sx * sy, cx, -sx * cy), (-cx * sy, sx, cx * cy))
    return [[sum(turn[r][k] * matrix[k][c] for k in range(3)) for c in range(3)] for r in range(3)]


def tidy(matrix):
    # Rounding errors slowly skew a matrix turned many times; straighten it.
    x = matrix[0]
    length = math.sqrt(dot(x, x))
    x = [c / length for c in x]
    y = matrix[1]
    along = dot(x, y)
    y = [y[i] - along * x[i] for i in range(3)]
    length = math.sqrt(dot(y, y))
    y = [c / length for c in y]
    return [x, y, list(cross(x, y))]


def show_led(colour, level):
    for led, value in zip(leds, colour):
        led.duty_cycle = 65535 - int(value * level * 257)


def draw(current, matrix, brightness):
    name, colour, vertices, shape_faces = current
    rotated = [[dot(row, v) for row in matrix] for v in vertices]
    projected = []
    for x, y, z in rotated:
        scale = SIZE * DISTANCE / (DISTANCE + z)
        projected.append((int(WIDTH / 2 + x * scale), int(HEIGHT / 2 - y * scale)))
    best = -1
    best_colour = colour
    for index, (polygon, palette) in enumerate(faces):
        if index >= len(shape_faces):
            polygon.hidden = True
            continue
        face = shape_faces[index]
        a, b, c = (rotated[i] for i in face[:3])
        normal = cross(sub(b, a), sub(c, a))
        length = math.sqrt(dot(normal, normal))
        normal = (normal[0] / length, normal[1] / length, normal[2] / length)
        centre = [sum(rotated[i][k] for i in face) / len(face) for k in range(3)]
        # Facing the camera, which sits on the -z side?
        toward = dot(normal, (-centre[0], -centre[1], -DISTANCE - centre[2]))
        if toward <= 0:
            polygon.hidden = True
            continue
        lit = brightness * (0.22 + 0.78 * max(0, dot(normal, LIGHT)))
        shade = tuple(min(255, int(c * lit)) for c in colour)
        palette[0] = (shade[0] << 16) | (shade[1] << 8) | shade[2]
        polygon.points = [projected[i] for i in face]
        polygon.hidden = False
        if -normal[2] > best:
            best = -normal[2]
            best_colour = shade
    show_led(best_colour, 0.6)


matrix = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
spin_x, spin_y = 0.4, 0.7  # radians per second
which = 0
title.text = SHAPES[which][0]
held = None  # (x, y, time, moved) while touched
frames = 0
fps_at = last = time.monotonic()
while True:
    now = time.monotonic()
    dt = min(0.1, now - last)
    last = now

    point = touch.read()
    if point:
        x, y = point
        if held is None:
            held = (x, y, now, False)
        else:
            px, py, pt, moved = held
            step = max(0.001, now - pt)
            # The side facing you follows your finger.
            spin_y = -(x - px) / step * 0.01
            spin_x = -(y - py) / step * 0.01
            held = (x, y, now, moved or abs(x - px) + abs(y - py) > 3)
    elif held is not None:
        if not held[3]:
            # A tap: the next shape.
            which = (which + 1) % len(SHAPES)
            title.text = SHAPES[which][0]
        held = None
    elif abs(spin_x) + abs(spin_y) < 0.3:
        # Left alone, it settles into a slow spin.
        spin_x += (0.3 - spin_x) * dt
        spin_y += (0.5 - spin_y) * dt

    matrix = rotate(matrix, spin_x * dt, spin_y * dt)
    if frames % 50 == 0:
        matrix = tidy(matrix)
    if held is None:
        spin_x *= 1 - 0.6 * dt
        spin_y *= 1 - 0.6 * dt

    # The room's light on the sensor: covered, the scene dims.
    brightness = 1.0 if sensor.value < 4000 else max(0.25, 1 - (sensor.value - 4000) / 16000)
    draw(SHAPES[which], matrix, brightness)
    display.refresh(target_frames_per_second=30, minimum_frames_per_second=0)

    frames += 1
    if now - fps_at >= 1:
        fps_label.text = "{} fps".format(frames)
        frames = 0
        fps_at = now
