import { parentPort, workerData } from 'node:worker_threads';

import { NetworkBridge } from '../../web/src/net/network.js';
import { CTRL } from '../../web/src/emulator/shared.js';

const ctrl = workerData.ctrl;
const bridge = new NetworkBridge({
    proxy: null,
    wake: () => {
        Atomics.add(ctrl, CTRL.WAKE, 1);
        Atomics.notify(ctrl, CTRL.WAKE);
    },
    notice: (text) => console.error(`[network] ${text}`),
});
parentPort.on('message', (message) => bridge.handle(message));
