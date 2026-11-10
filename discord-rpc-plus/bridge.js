// Local bridge: Spotify (Spicetify) can't open Discord's IPC pipe, so the extension POSTs here.
// Usage: node bridge.js [clientId]   (no dependencies)
const net = require("net"), http = require("http"), os = require("os");
const CLIENT_ID = process.argv[2] || "1461099412649545850";
const PORT = 6473;
let sock = null, ready = false, pending = null, nonce = 0;

const frame = (op, obj) => { const d = Buffer.from(JSON.stringify(obj)), b = Buffer.alloc(8 + d.length); b.writeInt32LE(op, 0); b.writeInt32LE(d.length, 4); d.copy(b, 8); return b; };
const pipePath = (i) => os.platform() === "win32" ? String.raw`\\?\pipe\discord-ipc-${i}` : `${process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || "/tmp"}/discord-ipc-${i}`;

function connect(i = 0) {
  if (i > 9) return setTimeout(() => connect(0), 5000); // Discord not running: retry
  const s = net.connect(pipePath(i));
  let buf = Buffer.alloc(0);
  s.on("connect", () => { sock = s; s.write(frame(0, { v: 1, client_id: CLIENT_ID })); });
  s.on("data", (d) => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 8 && buf.length >= 8 + buf.readInt32LE(4)) {
      const len = buf.readInt32LE(4), msg = JSON.parse(buf.slice(8, 8 + len));
      buf = buf.slice(8 + len);
      if (msg.evt === "READY") { ready = true; console.log("Discord connected as", msg.data.user.username); if (pending) send(pending); }
    }
  });
  s.on("error", () => { if (!sock) connect(i + 1); });
  s.on("close", () => { if (sock === s) { sock = null; ready = false; setTimeout(() => connect(0), 3000); } });
}

function send(activity) {
  pending = activity;
  if (!ready) return;
  sock.write(frame(1, { cmd: "SET_ACTIVITY", args: { pid: process.pid, activity }, nonce: String(++nonce) }));
}

// Only accept requests from Spotify's own origin/localhost; body is untrusted -> whitelist fields.
http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") return res.writeHead(204).end();
  let body = "";
  req.on("data", (c) => { body += c; if (body.length > 10000) req.destroy(); });
  req.on("end", () => {
    try {
      const p = JSON.parse(body || "{}");
      if (p.clear) send(null);
      else {
        const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : undefined);
        const o = p.options || {};
        const template = value => value.replace(/\{(title|artist|album)\}/g, (_, k) => str(p[k], 128) || "").slice(0,128);
        const a = { name: template(typeof o.nameTemplate === "string" ? o.nameTemplate : "{title}"), type: [0,2,3,5].includes(o.activityType) ? o.activityType : 2,
          details: template(typeof o.detailsTemplate === "string" ? o.detailsTemplate : "{title}") || undefined,
          state: template(typeof o.stateTemplate === "string" ? o.stateTemplate : "{artist}") || undefined };
        if (o.showTime !== false && p.start && p.end) a.timestamps = { start: Math.floor(+p.start), end: Math.floor(+p.end) };
        const cover = typeof p.cover === "string" && p.cover.startsWith("https://i.scdn.co/") ? p.cover : undefined;
        a.assets = o.showCover !== false && cover ? { large_image: cover, large_text: str(p.album,128) } : {};
        const smallUrl = o.smallImage === "none" ? undefined : o.smallImage === "custom" ? o.smallImageUrl : p.profile?.image;
        if (typeof smallUrl === "string" && /^https:\/\//.test(smallUrl)) { a.assets.small_image = smallUrl; a.assets.small_text = str(o.smallImageText || p.profile?.name || "Spotify profile", 128); }
        const trackId = /^spotify:track:([a-zA-Z0-9]{22})$/.exec(p.trackUri || "")?.[1];
        if (trackId && o.showButton !== false) a.buttons = [{ label: "Play song", url: `https://open.spotify.com/track/${trackId}` }];
        send(a);
      }
      res.writeHead(204).end();
    } catch { res.writeHead(400).end(); }
  });
}).listen(PORT, "127.0.0.1", () => console.log("Bridge on 127.0.0.1:" + PORT));

connect();
