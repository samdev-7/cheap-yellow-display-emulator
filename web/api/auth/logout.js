import { handleLogout } from '../../server/auth.js';

export function POST(request) {
    return handleLogout(request, process.env);
}
