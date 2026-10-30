import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const NAME = 'adafruit-circuitpython-sunton_esp32_2432S028-en_US-10.3.1.bin';
const SHA256 = '47906c96f006c2b7102b0f4331a232f932b72872ddc43f6d7692d5f32448c992';
const URL_ = `https://downloads.circuitpython.org/bin/sunton_esp32_2432S028/en_US/${NAME}`;
const dir = new URL('../public/circuitpython/', import.meta.url);
const file = new URL(NAME, dir);

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
if (existsSync(file) && hash(readFileSync(file)) === SHA256) process.exit(0);

const response = await fetch(URL_);
if (!response.ok) throw new Error(`${URL_}: ${response.status}`);
const bytes = new Uint8Array(await response.arrayBuffer());
if (hash(bytes) !== SHA256) throw new Error(`${NAME}: unexpected SHA-256`);
mkdirSync(dir, { recursive: true });
writeFileSync(file, bytes);
console.log(`Fetched ${NAME}`);
