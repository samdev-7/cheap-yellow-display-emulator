import { handleAccount } from '../server/auth.js';

export function GET(request) {
    return handleAccount(request, process.env);
}
