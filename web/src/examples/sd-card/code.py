# microSD card: mounts the card, adds a line to a log file on it every time
# the board starts, and lists what's on it.
# Put a card in first: the ... button under the board, then "Insert card".

import os

import board
import busio
import sdcardio
import storage

spi = busio.SPI(board.SD_SCK, MOSI=board.SD_MOSI, MISO=board.SD_MISO)


def mount():
    try:
        card = sdcardio.SDCard(spi, board.SD_CS)
    except OSError as error:
        print("No card to use:", error)
        return False
    try:
        storage.mount(storage.VfsFat(card), "/sd")
    except OSError as error:
        print("The card isn't formatted (FAT32):", error)
        return False
    return True


if mount():
    stats = os.statvfs("/sd")
    total = stats[0] * stats[2] // 1_000_000
    free = stats[0] * stats[3] // 1_000_000
    print("Card mounted at /sd: {} MB, {} MB free".format(total, free))

    with open("/sd/boots.txt", "a") as log:
        log.write("Board started\n")
    with open("/sd/boots.txt") as log:
        print("This card has seen", len(log.readlines()), "board starts")

    print("Files on the card:", os.listdir("/sd"))
