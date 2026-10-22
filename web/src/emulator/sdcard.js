export const BLOCK = 512;
export const CARD_SIZES_GB = [4, 8, 16, 32];

export function cardSectors(sizeGB) {
    return Math.floor((sizeGB * 1e9 * 0.97) / BLOCK / 1024) * 1024;
}

const R1_IDLE = 0x01;
const R1_ILLEGAL = 0x04;
const R1_ADDRESS_ERROR = 0x40;
const TOKEN_SINGLE = 0xfe;
const TOKEN_MULTI = 0xfc;
const TOKEN_STOP = 0xfd;
const DATA_ACCEPTED = 0x05;

export class SDCard {
    constructor(card) {
        this.load(card);
    }

    load(card) {
        this.sectors = card.sectors;
        this.blocks = card.blocks;
        this.dirty = new Set();
        this.powerOn();
    }

    powerOn() {
        this.idle = true;
        this.appCommand = false;
        this.command = [];
        this.state = 'command';
        this.out = [];
        this.outPos = 0;
        this.readNext = -1; // Next block of a CMD18 stream, or -1.
        this.writeNext = 0;
        this.writeBuffer = null;
        this.writeLength = 0;
    }

    read(block) {
        return this.blocks.get(block) ?? new Uint8Array(BLOCK);
    }

    write(block, data) {
        this.blocks.set(block, data);
        this.dirty.add(block);
    }

    transfer(out, into, len, writeValue) {
        for (let i = 0; i < len; i++) {
            const reply = this.next();
            this.receive(out ? out[i] : writeValue);
            if (into) into[i] = reply;
        }
    }

    next() {
        if (this.outPos >= this.out.length && this.readNext >= 0) {
            this.queueBlock(this.readNext++);
        }
        if (this.outPos < this.out.length) {
            return this.out[this.outPos++];
        }
        return 0xff;
    }

    queue(bytes) {
        if (this.outPos >= this.out.length) {
            this.out = [];
            this.outPos = 0;
        }
        for (const b of bytes) this.out.push(b);
    }

    clearQueue() {
        this.out = [];
        this.outPos = 0;
    }

    queueBlock(block) {
        if (block >= this.sectors) {
            this.readNext = -1;
            return;
        }
        this.queue([0xff, TOKEN_SINGLE]);
        this.queue(this.read(block));
        this.queue([0x00, 0x00]);
    }

    get r1() {
        return this.idle ? R1_IDLE : 0x00;
    }

    receive(b) {
        if (this.state === 'write-data') {
            this.writeBuffer[this.writeLength++] = b;
            if (this.writeLength === BLOCK + 2) {
                const block = this.writeNext++;
                if (block < this.sectors) {
                    this.write(block, this.writeBuffer.slice(0, BLOCK));
                }
                this.queue([DATA_ACCEPTED]);
                this.state = this.multiWrite ? 'write-token' : 'command';
            }
            return;
        }
        if (this.state === 'write-token') {
            if (b === (this.multiWrite ? TOKEN_MULTI : TOKEN_SINGLE)) {
                this.writeBuffer = new Uint8Array(BLOCK + 2);
                this.writeLength = 0;
                this.state = 'write-data';
                return;
            }
            if (this.multiWrite && b === TOKEN_STOP) {
                this.state = 'command';
                this.queue([0x00, 0x00, 0x00]);
                return;
            }
            if ((b & 0xc0) !== 0x40) {
                return;
            }
            this.state = 'command';
        }
        if (this.command.length === 0 && (b & 0xc0) !== 0x40) {
            return;
        }
        this.command.push(b);
        if (this.command.length === 6) {
            const [first, a, bb, c, d] = this.command;
            this.command = [];
            this.handle(first & 0x3f, ((a << 24) | (bb << 16) | (c << 8) | d) >>> 0);
        }
    }

    handle(cmd, arg) {
        const app = this.appCommand;
        this.appCommand = false;
        const respond = (...bytes) => this.queue([0xff, ...bytes]);
        if (app) {
            switch (cmd) {
                case 41: // SD_SEND_OP_COND: initialisation finishes.
                    this.idle = false;
                    respond(0x00);
                    return;
                case 23: // SET_WR_BLK_ERASE_COUNT
                    respond(this.r1);
                    return;
                default:
                    respond(this.r1 | R1_ILLEGAL);
                    return;
            }
        }
        switch (cmd) {
            case 0: // GO_IDLE_STATE
                this.powerOn();
                respond(R1_IDLE);
                return;
            case 8: // SEND_IF_COND: a version 2 card, echoing the check pattern.
                respond(this.r1, 0x00, 0x00, 0x01, arg & 0xff);
                return;
            case 55: // APP_CMD
                this.appCommand = true;
                respond(this.r1);
                return;
            case 58: // READ_OCR: powered up, high capacity once initialised.
                respond(this.r1, this.idle ? 0x00 : 0xc0, 0xff, 0x80, 0x00);
                return;
            case 9: // SEND_CSD
                respond(this.r1, 0xff, TOKEN_SINGLE, ...this.csd(), 0x00, 0x00);
                return;
            case 10: // SEND_CID
                respond(this.r1, 0xff, TOKEN_SINGLE, ...CID, 0x00, 0x00);
                return;
            case 13: // SEND_STATUS
                respond(this.r1, 0x00);
                return;
            case 16: // SET_BLOCKLEN: SDHC blocks are always 512 bytes.
                respond(arg === BLOCK ? this.r1 : this.r1 | 0x20);
                return;
            case 59: // CRC_ON_OFF
                respond(this.r1);
                return;
            case 12: // STOP_TRANSMISSION
                this.readNext = -1;
                this.clearQueue();
                respond(0x00);
                return;
            case 17: // READ_SINGLE_BLOCK
                if (arg >= this.sectors) {
                    respond(R1_ADDRESS_ERROR);
                    return;
                }
                respond(0x00);
                this.queueBlock(arg);
                return;
            case 18: // READ_MULTIPLE_BLOCK
                if (arg >= this.sectors) {
                    respond(R1_ADDRESS_ERROR);
                    return;
                }
                respond(0x00);
                this.readNext = arg;
                return;
            case 24: // WRITE_BLOCK
            case 25: // WRITE_MULTIPLE_BLOCK
                if (arg >= this.sectors) {
                    respond(R1_ADDRESS_ERROR);
                    return;
                }
                respond(0x00);
                this.multiWrite = cmd === 25;
                this.writeNext = arg;
                this.state = 'write-token';
                return;
            default:
                respond(this.r1 | R1_ILLEGAL);
        }
    }

    csd() {
        const cSize = this.sectors / 1024 - 1;
        const csd = [
            0x40, 0x0e, 0x00, 0x32, 0x5b, 0x59, 0x00,
            (cSize >> 16) & 0x3f, (cSize >> 8) & 0xff, cSize & 0xff,
            0x7f, 0x80, 0x0a, 0x40, 0x00, 0x00,
        ];
        csd[15] = (crc7(csd.slice(0, 15)) << 1) | 1;
        return csd;
    }
}

const CID = (() => {
    const cid = [0x02, 0x54, 0x4d, 0x43, 0x59, 0x44, 0x45, 0x4d, 0x10, 0x12, 0x34, 0x56, 0x78, 0x01, 0x6a, 0x00];
    cid[15] = (crc7(cid.slice(0, 15)) << 1) | 1;
    return cid;
})();

function crc7(bytes) {
    let crc = 0;
    for (const byte of bytes) {
        let d = byte;
        for (let i = 0; i < 8; i++) {
            crc <<= 1;
            if ((d & 0x80) ^ (crc & 0x80)) crc ^= 0x09;
            d <<= 1;
        }
    }
    return crc & 0x7f;
}

export function formattedCard(sizeGB) {
    const sectors = cardSectors(sizeGB);
    const blocks = new Map();
    const start = 8192;
    const partSectors = sectors - start;

    const mbr = new Uint8Array(BLOCK);
    const view = new DataView(mbr.buffer);
    mbr.set([0x00, 0xfe, 0xff, 0xff, 0x0c, 0xfe, 0xff, 0xff], 446);
    view.setUint32(454, start, true);
    view.setUint32(458, partSectors, true);
    mbr[510] = 0x55;
    mbr[511] = 0xaa;
    blocks.set(0, mbr);

    const sectorsPerCluster = sizeGB <= 8 ? 8 : sizeGB <= 16 ? 16 : 32;
    const reserved = 32;
    const fats = 2;
    const fatSize = Math.ceil((partSectors - reserved) / ((256 * sectorsPerCluster + fats) / 2));

    const boot = new Uint8Array(BLOCK);
    const b = new DataView(boot.buffer);
    boot.set([0xeb, 0x58, 0x90], 0);
    boot.set(ascii('MSWIN4.1'), 3);
    b.setUint16(11, BLOCK, true);
    boot[13] = sectorsPerCluster;
    b.setUint16(14, reserved, true);
    boot[16] = fats;
    boot[21] = 0xf8;
    b.setUint16(24, 63, true);
    b.setUint16(26, 255, true);
    b.setUint32(28, start, true);
    b.setUint32(32, partSectors, true);
    b.setUint32(36, fatSize, true);
    b.setUint32(44, 2, true); // Root directory cluster.
    b.setUint16(48, 1, true); // FSInfo sector.
    b.setUint16(50, 6, true); // Backup boot sector.
    boot[64] = 0x80;
    boot[66] = 0x29;
    b.setUint32(67, (Math.random() * 0xffffffff) >>> 0, true);
    boot.set(ascii('NO NAME    '), 71);
    boot.set(ascii('FAT32   '), 82);
    boot[510] = 0x55;
    boot[511] = 0xaa;

    const info = new Uint8Array(BLOCK);
    const i = new DataView(info.buffer);
    i.setUint32(0, 0x41615252, true);
    i.setUint32(484, 0x61417272, true);
    const clusters = Math.floor((partSectors - reserved - fats * fatSize) / sectorsPerCluster);
    i.setUint32(488, clusters - 1, true);
    i.setUint32(492, 3, true); // Next free cluster.
    i.setUint32(508, 0xaa550000, true);

    blocks.set(start, boot);
    blocks.set(start + 1, info);
    blocks.set(start + 6, boot.slice());
    blocks.set(start + 7, info.slice());

    for (let n = 0; n < fats; n++) {
        const fat = new Uint8Array(BLOCK);
        const f = new DataView(fat.buffer);
        f.setUint32(0, 0x0ffffff8, true);
        f.setUint32(4, 0x0fffffff, true);
        f.setUint32(8, 0x0fffffff, true);
        blocks.set(start + reserved + n * fatSize, fat);
    }
    return { sizeGB, sectors, blocks };
}

export function blankCard(sizeGB) {
    return { sizeGB, sectors: cardSectors(sizeGB), blocks: new Map() };
}

function ascii(text) {
    return [...text].map((c) => c.charCodeAt(0));
}
