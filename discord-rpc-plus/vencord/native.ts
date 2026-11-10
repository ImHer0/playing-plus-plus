import { execFile } from "node:child_process";
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
                    playlist: data.playlist && typeof data.playlist === "object" ? { uri: typeof data.playlist.uri === "string" ? data.playlist.uri : undefined, description: String(data.playlist.description || "").slice(0,512), name: String(data.playlist.name || "Playlist").slice(0,128), image: typeof data.playlist.image === "string" && /^https:\/\//.test(data.playlist.image) ? data.playlist.image : undefined } : {},
                    options: data.options && typeof data.options === "object" ? data.options : {},
                    source: "Spotify",
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
export function snapshot() {
    const now = Date.now();
    // Background Spotify timers can be throttled beyond the heartbeat interval.
    const trackEnd = typeof latest?.end === "number" ? latest.end : 0;
    const expires = Math.max(updated + 120000, Math.min(trackEnd + 90000, updated + 86400000));
    return { activity: now < expires ? latest : null, updated };
}
export function stop() { server?.close(); server = undefined; latest = null; updated = 0; }

const windowsScript = String.raw`
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]
$mediaType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties,Windows.Media.Control,ContentType=WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name.StartsWith('IAsyncOperation') } | Select-Object -First 1
function Await($operation, $type) { $task = $asTask.MakeGenericMethod($type).Invoke($null, @($operation)); $task.GetAwaiter().GetResult() }
$manager = Await ($managerType::RequestAsync()) $managerType
$session = $manager.GetCurrentSession()
if (!$session -or $session.GetPlaybackInfo().PlaybackStatus.ToString() -ne 'Playing') { 'null'; exit }
$media = Await ($session.TryGetMediaPropertiesAsync()) $mediaType
$timeline = $session.GetTimelineProperties()
$now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
@{ title=$media.Title; artist=$media.Artist; album=$media.AlbumTitle; source=$session.SourceAppUserModelId; start=$now-$timeline.Position.TotalMilliseconds; end=$now+($timeline.EndTime-$timeline.Position).TotalMilliseconds } | ConvertTo-Json -Compress
`;
export async function windowsSnapshot() {
    if (process.platform !== "win32") return null;
    return await new Promise<Record<string, any> | null>((resolve, reject) => {
        execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(windowsScript, "utf16le").toString("base64")], { windowsHide: true, timeout: 10000, maxBuffer: 65536 }, (error, stdout) => {
            if (error) { reject(new Error("Windows media session lookup failed: " + error.message)); return; }
            try { resolve(JSON.parse(stdout.trim() || "null")); } catch { resolve(null); }
        });
    });
}

const artworkCache = new Map<string, { expires: number; url?: string }>();
export async function artwork(_event: unknown, title: string, artist: string, album: string) {
    if (typeof title !== "string" || typeof artist !== "string" || !title || !artist || title.length > 512 || artist.length > 512) return;
    const normalize = (text: string) => text.normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    const key = JSON.stringify([title, artist, album]);
    const cached = artworkCache.get(key);
    if (cached && cached.expires > Date.now()) return cached.url;
    try {
        const response = await fetch("https://itunes.apple.com/search?entity=song&limit=15&term=" + encodeURIComponent(title + " " + artist), { signal: AbortSignal.timeout(5000) });
        if (!response.ok) return;
        const result = await response.json();
        const matches = (result.results || []).filter((row: any) => normalize(row.trackName || "") === normalize(title) && normalize(row.artistName || "") === normalize(artist));
        const match = matches.find((row: any) => normalize(row.collectionName || "") === normalize(album || "")) || matches[0];
        const url = typeof match?.artworkUrl100 === "string" && /^https:\/\/[^/]+\.mzstatic\.com\//.test(match.artworkUrl100) ? match.artworkUrl100.replace("100x100bb", "600x600bb") : undefined;
        if (artworkCache.size >= 100) artworkCache.clear();
        artworkCache.set(key, { expires: Date.now() + (url ? 86400000 : 300000), url });
        return url;
    } catch { return; }
}
