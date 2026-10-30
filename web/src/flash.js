const FIRMWARE = `${import.meta.env.BASE_URL}circuitpython/adafruit-circuitpython-sunton_esp32_2432S028-en_US-10.3.1.bin`;
// From the firmware's partition table: the app, and user_fs (the CIRCUITPY drive).
const APP = 0x10000;
const DRIVE = 0x2d0000;
const quiet = { clean() {}, write() {}, writeLine() {} };

// The drive up to its last used 4 KB sector. FAT ignores what's in free
// clusters, and CircuitPython erases a sector before writing it.
function used(drive) {
    let end = drive.length;
    while (end > 0 && drive[end - 1] === 0xff) end--;
    return drive.subarray(0, Math.ceil(end / 4096) * 4096);
}

async function firmware() {
    const response = await fetch(FIRMWARE);
    if (!response.ok) throw new Error("Couldn't download CircuitPython.");
    return new Uint8Array(await response.arrayBuffer());
}

// Writes CircuitPython (unless the board already has this build) and the drive.
export async function flashDevice(port, drive, { status, progress }) {
    const [{ ESPLoader, Transport }, image] = await Promise.all([import('esptool-js'), firmware()]);
    const transport = new Transport(port, false);
    try {
        status("Connecting. If it doesn't, hold BOOT and try again.");
        const loader = new ESPLoader({ transport, baudrate: 460800, romBaudrate: 115200, terminal: quiet });
        const chip = await loader.main();
        if (!chip.startsWith('ESP32') || /^ESP32-[SCHP]\d/.test(chip)) throw new Error(`That's an ${chip}, not the CYD's ESP32.`);
        // The app header holds the build's hash.
        const header = await loader.readFlash(APP, 256);
        const current = header.every((byte, i) => byte === image[APP + i]);
        const files = current ? [] : [{ data: image, address: 0 }];
        files.push({ data: used(drive), address: DRIVE });
        status(current ? 'Writing your project.' : 'Writing CircuitPython and your project.');
        await loader.writeFlash({
            fileArray: files,
            flashMode: 'keep',
            flashFreq: 'keep',
            flashSize: 'keep',
            eraseAll: false,
            compress: true,
            reportProgress: (index, written, total) => progress((index + written / total) / files.length),
        });
        // RST: RTS pulls EN low; DTR low keeps GPIO0 high for a normal boot.
        // esptool-js's hard_reset only releases RTS.
        // Closing the port can glitch DTR; the board samples GPIO0 at boot, so it waits.
        await transport.setDTR(false);
        await transport.setRTS(true);
        await new Promise((resolve) => setTimeout(resolve, 100));
        await transport.setRTS(false);
        await new Promise((resolve) => setTimeout(resolve, 1000));
    } finally {
        await transport.disconnect();
    }
}

// CircuitPython, then the drive, as one image to write at 0x0.
export async function flashImage(drive) {
    const drivePart = used(drive);
    const out = new Uint8Array(DRIVE + drivePart.length).fill(0xff);
    out.set(await firmware());
    out.set(drivePart, DRIVE);
    return out;
}
