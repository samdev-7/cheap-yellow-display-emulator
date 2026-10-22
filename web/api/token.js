import { handleToken } from '../server/session.js';

export function POST(request) {
    return handleToken(request, process.env);
}
