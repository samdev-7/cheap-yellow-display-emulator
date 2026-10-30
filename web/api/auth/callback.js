import { handleCallback } from '../../server/auth.js';

export function GET(request) {
    return handleCallback(request, process.env);
}
