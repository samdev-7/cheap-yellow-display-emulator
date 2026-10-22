# Weather: the current temperature in Burlington, Vermont, from the US
# National Weather Service (api.weather.gov, no API key needed). It reads the
# latest observation from Burlington International Airport (station KBTV)
# every ten minutes.
# On a real board, put your network's name and password in settings.toml.

import time

import adafruit_requests
import board
import displayio
import socketpool
import ssl
import terminalio
import wifi
from adafruit_display_text import label

STATION = "KBTV"
URL = "https://api.weather.gov/stations/" + STATION + "/observations/latest"
# The Weather Service asks every app to say who it is.
HEADERS = {"User-Agent": "(CYD weather demo)", "Accept": "application/geo+json"}

display = board.DISPLAY
screen = displayio.Group()
display.root_group = screen

background = displayio.Bitmap(display.width, display.height, 1)
palette = displayio.Palette(1)
palette[0] = 0x0B2545
screen.append(displayio.TileGrid(background, pixel_shader=palette))

place = label.Label(terminalio.FONT, text="Burlington, VT", color=0x8DA9C4, scale=2, x=12, y=18)
temperature = label.Label(terminalio.FONT, text="--", color=0xFFFFFF, scale=6, x=12, y=80)
details = label.Label(terminalio.FONT, text="Joining Wi-Fi...", color=0xEEF4ED, scale=2, x=12, y=150, line_spacing=1.1)
for item in (place, temperature, details):
    screen.append(item)

pool = socketpool.SocketPool(wifi.radio)
requests = adafruit_requests.Session(pool, ssl.create_default_context())


def fetch():
    with requests.get(URL, headers=HEADERS) as response:
        if response.status_code != 200:
            raise RuntimeError("HTTP {}".format(response.status_code))
        return response.json()["properties"]


while True:
    if not wifi.radio.connected:
        details.text = "No Wi-Fi.\nCheck settings.toml."
        time.sleep(10)
        continue
    try:
        weather = fetch()
        celsius = weather["temperature"]["value"]
        if celsius is None:
            temperature.text = "--"
        else:
            temperature.text = "{:.0f}F".format(celsius * 9 / 5 + 32)
        humidity = weather["relativeHumidity"]["value"]
        observed = weather["timestamp"][11:16]
        details.text = "{}\n{}Humidity {}%\nAt {} UTC".format(
            weather["textDescription"] or "",
            "" if celsius is None else "{:.0f}C  ".format(celsius),
            "--" if humidity is None else round(humidity),
            observed,
        )
        print(STATION, temperature.text, details.text.replace("\n", " | "))
    except (OSError, RuntimeError, ValueError, KeyError) as error:
        details.text = "Couldn't fetch:\n" + str(error)
        print("Couldn't fetch:", error)
    time.sleep(600)
