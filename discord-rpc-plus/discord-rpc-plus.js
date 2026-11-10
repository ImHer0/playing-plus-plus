// @ts-check
// Discord RPC+: shows what you're playing on Discord without linking Spotify to Discord.
// Requires bridge.js running (node bridge.js).
(function DiscordRpcPlus() {
  if (!Spicetify?.Player?.data) return setTimeout(DiscordRpcPlus, 300);
  const URL = "http://127.0.0.1:6473/";
  const post = (body) => fetch(URL, { method: "POST", body: JSON.stringify(body) }).catch(() => {}); // bridge offline: ignore

  const defaults = { activityType: 2, nameTemplate: "{title}", detailsTemplate: "{title}", stateTemplate: "{artist}", showCover: true, coverSmall: false, showTime: true, showButton: true };
  let options;
  try { options = { ...defaults, ...JSON.parse(Spicetify.LocalStorage.get("discord-rpc-options") || "{}") }; } catch { options = { ...defaults }; }
  new Spicetify.Menu.Item("Discord RPC+ settings", false, () => {
    const panel = document.createElement("div");
    const add = (label, key, choices) => {
      const row = document.createElement("label"); row.style.cssText = "display:flex;justify-content:space-between;gap:12px;margin:12px 0";
      row.append(document.createTextNode(label));
      const input = document.createElement(choices ? "select" : "input");
      if (choices) choices.forEach(([text, value]) => { const option = document.createElement("option"); option.textContent = text; option.value = value; input.append(option); });
      else input.type = typeof defaults[key] === "boolean" ? "checkbox" : "text";
      input.value = options[key]; input.checked = options[key] === true;
      input.onchange = () => { options[key] = input.type === "checkbox" ? input.checked : key === "activityType" ? Number(input.value) : input.value; Spicetify.LocalStorage.set("discord-rpc-options", JSON.stringify(options)); update(); };
      row.append(input); panel.append(row);
    };
    const help = document.createElement("p"); help.textContent = "Templates: {title}, {artist}, {album}. Blank details hide that line. Discord controls the activity label; custom text belongs in the name template. Vencord uses these settings unless overrides are enabled."; panel.append(help);
    add("Activity label", "activityType", [["Playing",0],["Listening to",2],["Watching",3],["Competing in",5]]);
    add("Activity name", "nameTemplate"); add("Details", "detailsTemplate"); add("Second line", "stateTemplate");
    add("Show album artwork", "showCover");
    add("Album cover as small image", "coverSmall"); add("Playback time", "showTime"); add("Play song button", "showButton");
    Spicetify.PopupModal.display({ title: "Discord RPC+ settings", content: panel });
  }).register();
  function update() {
    const d = Spicetify.Player.data;
    const m = d?.item;
    if (!m || d.isPaused) return post({ clear: true });
    const start = Date.now() - Spicetify.Player.getProgress();
    const img = m.images?.[0]?.url || m.metadata?.image_xlarge_url || m.metadata?.image_url || "";
    const id = img.split(":").pop();
    post({
      options,
      title: m.name,
      trackUri: m.uri || m.metadata?.uri || m.metadata?.track_uri,
      artist: (m.artists || []).map((a) => a.name).join(", "),
      album: m.album?.name,
      start, end: start + Spicetify.Player.getDuration(),
      cover: img.startsWith("https://i.scdn.co/") ? img : id && !id.includes("/") ? `https://i.scdn.co/image/${id}` : undefined,
    });
  }

  Spicetify.Player.addEventListener("songchange", update);
  Spicetify.Player.addEventListener("onplaypause", update);
  Spicetify.Player.addEventListener("onprogress", (() => { let last = 0; return () => { const p = Spicetify.Player.getProgress(); if (Math.abs(p - last - 1000) > 3000 && last) update(); last = p; }; })()); // re-sync after seeks
  setInterval(update, 15000); // heartbeat and reconnect after Discord starts
  update();
})();
