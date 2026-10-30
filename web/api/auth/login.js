import { handleLogin } from '../../server/auth.js';

export function GET(request) {
    return handleLogin(request, process.env);
}
