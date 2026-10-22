import { handleSession } from '../server/session.js';

export function POST(request) {
    return handleSession(request, process.env);
}
