# Wi-Fi and the internet: joins the network in settings.toml, sets the clock
# over NTP, then fetches CircuitPython's GitHub stars every minute.
# On a real board, put your network's name and password in settings.toml.

import os
import time

import adafruit_requests
import board
import displayio
import rtc
import socketpool
import ssl
import terminalio
import wifi
from adafruit_display_text import label

display = board.DISPLAY
screen = displayio.Group()
display.root_group = screen
lines = label.Label(terminalio.FONT, text="Joining Wi-Fi...", color=0xFFFFFF, scale=2, x=10, y=20, line_spacing=1.1)
screen.append(lines)


def show(text):
    lines.text = text
    print(text.replace("\n", " | "))


# The board joins the network in settings.toml when it starts. If it
# couldn't, try again here so the error says why.
if not wifi.radio.connected:
    ssid = os.getenv("CIRCUITPY_WIFI_SSID")
    if not ssid:
        show("Add CIRCUITPY_WIFI_SSID\nto settings.toml")
        while True:
            time.sleep(1)
    try:
        wifi.radio.connect(ssid, os.getenv("CIRCUITPY_WIFI_PASSWORD"))
    except ConnectionError as error:
        show("Can't join Wi-Fi:\n" + str(error))
        while True:
            time.sleep(1)

show("Joined " + wifi.radio.ap_info.ssid + "\n" + str(wifi.radio.ipv4_address))
pool = socketpool.SocketPool(wifi.radio)


# Set the clock from an NTP server: a 48-byte question, the time in the reply.
def set_clock():
    packet = bytearray(48)
    packet[0] = 0x1B
    with pool.socket(pool.AF_INET, pool.SOCK_DGRAM) as sock:
        sock.settimeout(5)
        sock.sendto(packet, ("pool.ntp.org", 123))
        sock.recv_into(packet)
    seconds = int.from_bytes(packet[40:44], "big") - 2208988800
    rtc.RTC().datetime = time.localtime(seconds)


try:
    set_clock()
except OSError as error:
    print("No time from NTP:", error)

requests = adafruit_requests.Session(pool, ssl.create_default_context())

while True:
    now = time.localtime()
    clock = "{:02}:{:02} UTC".format(now.tm_hour, now.tm_min)
    try:
        with requests.get("https://api.github.com/repos/adafruit/circuitpython") as response:
            stars = response.json()["stargazers_count"]
        show("CircuitPython has\n{:,} stars\non GitHub\n\n".format(stars) + clock)
    except (OSError, RuntimeError, ValueError) as error:
        show("Couldn't fetch:\n" + str(error) + "\n\n" + clock)
    time.sleep(60)
