// @ts-check
// Discord RPC+: shows what you're playing on Discord without linking Spotify to Discord.
// Requires bridge.js running (node bridge.js).
(function DiscordRpcPlus() {
  if (!Spicetify?.Player?.data) return setTimeout(DiscordRpcPlus, 300);
  const URL = "http://127.0.0.1:6473/";
  const post = (body) => fetch(URL, { method: "POST", body: JSON.stringify(body) }).catch(() => {}); // bridge offline: ignore

  function update() {
    const d = Spicetify.Player.data;
    const m = d?.item;
    if (!m || d.isPaused) return post({ clear: true });
    const start = Date.now() - Spicetify.Player.getProgress();
    const img = m.images?.[0]?.url || m.metadata?.image_xlarge_url || m.metadata?.image_url || "";
    const id = img.split(":").pop();
    post({
      title: m.name,
      trackUri: m.uri,
      artist: (m.artists || []).map((a) => a.name).join(", "),
      album: m.album?.name,
      start, end: start + Spicetify.Player.getDuration(),
      cover: id && !id.includes("/") ? `https://i.scdn.co/image/${id}` : undefined,
    });
  }

  Spicetify.Player.addEventListener("songchange", update);
  Spicetify.Player.addEventListener("onplaypause", update);
  Spicetify.Player.addEventListener("onprogress", (() => { let last = 0; return () => { const p = Spicetify.Player.getProgress(); if (Math.abs(p - last - 1000) > 3000 && last) update(); last = p; }; })()); // re-sync after seeks
  update();
})();
