import { views } from './shared.js';
import { createHal } from './hal.js';

self.onmessage = async (event) => {
    const { type, sab, firmwareUrl, files, card } = event.data;
    if (type !== 'start') {
        return;
    }
    const post = (message, transfer) => self.postMessage(message, transfer ?? []);
    const hal = createHal(views(sab), files, post, card);
    const { default: createCircuitPython } = await import(/* @vite-ignore */ firmwareUrl);
    const module = await createCircuitPython({
        hal,
        locateFile: (path) => new URL(path, firmwareUrl).href,
        print: (text) => console.log(text),
        printErr: (text) => console.warn(text),
    });
    self.postMessage({ type: 'started' });
    try {
        module._main();
    } catch (error) {
        hal.flush();
        self.postMessage({ type: 'crashed', message: String(error && error.stack ? error.stack : error) });
    }
};
