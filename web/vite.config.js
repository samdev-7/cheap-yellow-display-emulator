import { readFileSync } from 'node:fs';
import { defineConfig, loadEnv } from 'vite';

const isolation = {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
};

const deployed = Object.fromEntries(
    JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8'))
        .headers.find((rule) => rule.source === '/(.*)')
        .headers.map(({ key, value }) => [key, value]),
);

function api(mode) {
    const env = { ...process.env, ...loadEnv(mode, process.cwd(), ''), dev: true };
    const routes = {
        '/api/session': async (request) => (await import('./server/session.js')).handleSession(request, env),
        '/api/token': async (request) => (await import('./server/session.js')).handleToken(request, env),
        '/api/proxy': async (request) => (await import('./server/proxy.js')).handleProxy(request, env),
        '/api/account': async (request) => (await import('./server/auth.js')).handleAccount(request, env),
        '/api/auth/login': async (request) => (await import('./server/auth.js')).handleLogin(request, env),
        '/api/auth/callback': async (request) => (await import('./server/auth.js')).handleCallback(request, env),
        '/api/auth/logout': async (request) => (await import('./server/auth.js')).handleLogout(request, env),
        '/api/auth/dev': async (request) => (await import('./server/auth.js')).handleDevLogin(request, env),
    };
    const serve = (server) => {
        server.middlewares.use(async (req, res, next) => {
            const handle = routes[req.url.split('?')[0]];
            if (!handle) return next();
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            const headers = new Headers();
            for (const [name, value] of Object.entries(req.headers)) {
                headers.set(name, Array.isArray(value) ? value.join(', ') : value);
            }
            const body = ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks);
            const response = await handle(new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers, body })).catch(
                (error) => new Response(String(error), { status: 500 }),
            );
            res.statusCode = response.status;
            response.headers.forEach((value, name) => name !== 'set-cookie' && res.setHeader(name, value));
            const cookies = response.headers.getSetCookie();
            if (cookies.length) res.setHeader('Set-Cookie', cookies);
            res.end(Buffer.from(await response.arrayBuffer()));
        });
    };
    return { name: 'network-proxy-api', configureServer: serve, configurePreviewServer: serve };
}

export default defineConfig(({ mode }) => ({
    server: { headers: isolation },
    preview: { headers: deployed },
    worker: { format: 'es' },
    plugins: [api(mode)],
}));
