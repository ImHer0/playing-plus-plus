import { createServer, Server } from "node:http";
let server: Server | undefined;
let latest: Record<string, any> | null = null;
let updated = 0;
export async function start() {
    if (server) return;
    const instance = createServer((req, res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        if (req.method === "OPTIONS") { res.writeHead(204).end(); return; }
        if (req.method !== "POST" || req.url !== "/") { res.writeHead(404).end(); return; }
        let body = "";
        req.on("data", chunk => { body += chunk; if (body.length > 10000) req.destroy(); });
        req.on("end", () => {
            try {
                const data = JSON.parse(body);
                if (!data || typeof data !== "object") throw new Error("Invalid payload");
                latest = data.clear ? null : {
                    options: data.options && typeof data.options === "object" ? data.options : {},
                    title: typeof data.title === "string" ? data.title.slice(0, 128) : "Unknown song",
                    artist: typeof data.artist === "string" ? data.artist.slice(0, 128) : "Unknown artist",
                    album: typeof data.album === "string" ? data.album.slice(0, 128) : undefined,
                    trackUri: typeof data.trackUri === "string" ? data.trackUri : "",
                    cover: typeof data.cover === "string" && /^https:\/\/i\.scdn\.co\/image\/[a-zA-Z0-9]+$/.test(data.cover) ? data.cover : undefined,
                    start: Number.isFinite(data.start) ? data.start : undefined,
                    end: Number.isFinite(data.end) ? data.end : undefined
                };
                updated = Date.now();
                res.writeHead(204).end();
            } catch { res.writeHead(400).end(); }
        });
    });
    await new Promise<void>((resolve, reject) => {
        instance.once("error", reject);
        instance.listen(6473, "127.0.0.1", resolve);
    });
    server = instance;
}
export function snapshot() { return { activity: Date.now() - updated < 45000 ? latest : null, updated }; }
export function stop() { server?.close(); server = undefined; latest = null; updated = 0; }
