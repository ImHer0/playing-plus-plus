// @ts-check
// SpicetifyRPC: shows what you're playing on Discord without linking Spotify to Discord.
// Requires bridge.js running (node bridge.js).
(function DiscordRpcPlus() {
  if (!Spicetify?.Player?.data) return setTimeout(DiscordRpcPlus, 300);
  const URL = "http://127.0.0.1:6473/";
  let lastPost = 0;
  const post = (body) => { lastPost = Date.now(); return fetch(URL, { method: "POST", body: JSON.stringify(body) }).catch(() => {}); }; // bridge offline: ignore

  const defaults = { activityType: 2, nameTemplate: "{title}", detailsTemplate: "{title}", stateTemplate: "{artist}", showCover: true, smallImage: "none", swapImages: false, smallImageUrl: "", smallImageText: "", showTime: true, showButton: true };
  let options;
  try { options = { ...defaults, ...JSON.parse(Spicetify.LocalStorage.get("discord-rpc-options") || "{}") }; } catch { options = { ...defaults }; }
  if (!["custom", "playlist"].includes(options.smallImage)) options.smallImage = "none";
  new Spicetify.Menu.Item("SpicetifyRPC settings", false, () => {
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
    const help = document.createElement("p"); help.textContent = "Templates: {title}, {artist}, {album}, {playlist}, {source}. Blank details hide that line. Discord controls the activity label; custom text belongs in the name template. Vencord uses these settings unless overrides are enabled."; panel.append(help);
    add("Activity label", "activityType", [["Playing",0],["Listening to",2],["Watching",3],["Competing in",5]]);
    add("Activity name", "nameTemplate"); add("Details", "detailsTemplate"); add("Second line", "stateTemplate");
    add("Show album artwork", "showCover");
    add("Small image", "smallImage", [["None", "none"], ["Current playlist", "playlist"], ["Custom image / GIF", "custom"]]);
    add("Swap large and small images", "swapImages");
    add("Custom image HTTPS URL", "smallImageUrl"); add("Small image hover text", "smallImageText"); add("Playback time", "showTime"); add("Play song button", "showButton");
    const node = (tag, text = "", className = "") => { const element = document.createElement(tag); element.textContent = text; element.className = className; return element; };
    const support = node("footer", "", "pp-support");
    support.append(node("span", "Support SpicetifyRPC", "pp-support-title"));
    const links = node("div", "", "pp-support-links");
    for (const [name, url, path] of [["Ko-fi", "https://ko-fi.com/imher0", "M23.881 8.948c-.773-4.085-4.859-4.593-4.859-4.593H.723c-.604 0-.679.798-.679.798s-.082 7.324-.022 11.822c.164 2.424 2.586 2.672 2.586 2.672s8.267-.023 11.966-.049c2.438-.426 2.683-2.566 2.658-3.734 4.352.24 7.422-2.831 6.649-6.916zm-11.062 3.511c-1.246 1.453-4.011 3.976-4.011 3.976s-.121.119-.31.023c-.076-.057-.108-.09-.108-.09-.443-.441-3.368-3.049-4.034-3.954-.709-.965-1.041-2.7-.091-3.71.951-1.01 3.005-1.086 4.363.407 0 0 1.565-1.782 3.468-.963 1.904.82 1.832 3.011.723 4.311zm6.173.478c-.928.116-1.682.028-1.682.028V7.284h1.77s1.971.551 1.971 2.638c0 1.913-.985 2.667-2.059 3.015z"], ["PayPal", "https://www.paypal.com/paypalme/ImHer0TM", "M7.016 19.198h-4.2a.562.562 0 0 1-.555-.65L5.093.584A.692.692 0 0 1 5.776 0h7.222c3.417 0 5.904 2.488 5.846 5.5-.006.25-.027.5-.066.747A6.794 6.794 0 0 1 12.071 12H8.743a.69.69 0 0 0-.682.583l-.325 2.056-.013.083-.692 4.39-.015.087zM19.79 6.142c-.01.087-.01.175-.023.261a7.76 7.76 0 0 1-7.695 6.598H9.007l-.283 1.795-.013.083-.692 4.39-.134.843-.014.088H6.86l-.497 3.15a.562.562 0 0 0 .555.65h3.612c.34 0 .63-.249.683-.585l.952-6.031a.692.692 0 0 1 .683-.584h2.126a6.793 6.793 0 0 0 6.707-5.752c.306-1.95-.466-3.744-1.89-4.906z"], ["GitHub Sponsors", "https://github.com/sponsors/ImHer0", "M17.625 1.499c-2.32 0-4.354 1.203-5.625 3.03-1.271-1.827-3.305-3.03-5.625-3.03C3.129 1.499 0 4.253 0 8.249c0 4.275 3.068 7.847 5.828 10.227a33.14 33.14 0 0 0 5.616 3.876l.028.017.008.003-.001.003c.163.085.342.126.521.125.179.001.358-.041.521-.125l-.001-.003.008-.003.028-.017a33.14 33.14 0 0 0 5.616-3.876C20.932 16.096 24 12.524 24 8.249c0-3.996-3.129-6.75-6.375-6.75zm-.919 15.275a30.766 30.766 0 0 1-4.703 3.316l-.004-.002-.004.002a30.955 30.955 0 0 1-4.703-3.316c-2.677-2.307-5.047-5.298-5.047-8.523 0-2.754 2.121-4.5 4.125-4.5 2.06 0 3.914 1.479 4.544 3.684.143.495.596.797 1.086.796.49.001.943-.302 1.085-.796.63-2.205 2.484-3.684 4.544-3.684 2.004 0 4.125 1.746 4.125 4.5 0 3.225-2.37 6.216-5.048 8.523z"]]) {
      const link = node("a", "", "pp-support-link");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="${path}"/></svg>`;
      link.append(node("span", name));
      links.append(link);
    }
    support.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:10px;margin-top:20px;font-size:12px";
    links.style.cssText = "display:flex;gap:18px;flex-wrap:wrap;justify-content:center";
    for (const link of links.children) link.style.cssText = "display:inline-flex;align-items:center;gap:6px;color:inherit";
    support.append(links);
    panel.append(support);
    Spicetify.PopupModal.display({ title: "SpicetifyRPC settings", content: panel });
  }).register();
  let contextUri = "", playlist = {}, contextVersion = 0;
  async function refreshPlaylist() {
    const context = Spicetify.Player.data?.context || Spicetify.Player.data?.item?.context;
    const uri = context?.uri || context?.metadata?.uri || Spicetify.Player.data?.context_uri || "";
    if (uri === contextUri) return;
    contextUri = uri; playlist = {};
    const version = ++contextVersion;
    const metadata = context?.metadata || {};
    const contextImage = metadata.image_url || metadata.image || context?.images?.[0]?.url;
    playlist = { name: metadata.context_description || metadata.name || context?.name, image: contextImage?.startsWith("spotify:image:") ? `https://i.scdn.co/image/${contextImage.split(":").pop()}` : contextImage, uri };
    const id = /^spotify:playlist:([a-zA-Z0-9]{22})$/.exec(uri)?.[1];
    if (!id) return;
    try {
      const data = await Spicetify.CosmosAsync.get(`https://api.spotify.com/v1/playlists/${id}?fields=name,images,description`);
      if (version !== contextVersion) return;
      playlist = { ...playlist, name: data.name || playlist.name, image: data.images?.[0]?.url || playlist.image, description: data.description, uri }; update();
    } catch { /* No playlist artwork when Spotify restricts the lookup. */ }
  }
  function update() {
    void refreshPlaylist();
    const d = Spicetify.Player.data;
    const m = d?.item;
    if (!m || d.isPaused) return post({ clear: true });
    const start = Date.now() - Spicetify.Player.getProgress();
    const img = m.images?.[0]?.url || m.metadata?.image_xlarge_url || m.metadata?.image_url || "";
    const id = img.split(":").pop();
    post({
      options, playlist, source: "Spotify",
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
  Spicetify.Player.addEventListener("onprogress", (() => { let last = 0; return () => { const p = Spicetify.Player.getProgress(); if ((Math.abs(p - last - 1000) > 3000 && last) || Date.now() - lastPost >= 15000) update(); last = p; }; })()); // re-sync after seeks
  setInterval(update, 15000); // heartbeat and reconnect after Discord starts
  update();
})();
