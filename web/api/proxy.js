import { handleProxy } from '../server/proxy.js';

export function POST(request) {
    return handleProxy(request, process.env);
}
