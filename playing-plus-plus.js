// Playing++ — a standalone Spicetify extension. No build step required.
(() => {
  "use strict";
  const SETTINGS_KEY = "playing-plus-plus:settings";
  const settings = { date: true, genres: true };
  const cache = new Map();
  let mbQueue = Promise.resolve();
  let generation = 0;
  let panel;
  let api;
  let retryTimer;
  let retryTrack;
  let retryCount = 0;
  let dateLine;
  let genreLine;
  let hasTrack = false;
  let marqueeFrame;

  function stopMarquee() {
    if (marqueeFrame != null) cancelAnimationFrame(marqueeFrame);
    marqueeFrame = null;
    genreLine.scrollLeft = 0;
    genreLine.style.textOverflow = "";
  }

  function startMarquee() {
    stopMarquee();
    const distance = genreLine.scrollWidth - genreLine.clientWidth;
    if (distance <= 0 || globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    genreLine.style.textOverflow = "clip";
    let start;
    const travelTime = distance / 30 * 1000;
    const frame = now => {
      if (start == null) start = now;
      const elapsed = (now - start) % (600 + travelTime + 1500);
      genreLine.scrollLeft = Math.min(distance, Math.max(0, (elapsed - 600) / 1000 * 30));
      marqueeFrame = requestAnimationFrame(frame);
    };
    marqueeFrame = requestAnimationFrame(frame);
  }

  function remember(key, load) {
    if (cache.has(key)) return cache.get(key);
    const promise = load().catch(error => { cache.delete(key); throw error; });
    cache.set(key, promise);
    if (cache.size > 150) cache.delete(cache.keys().next().value);
    return promise;
  }

  function dateText(value) {
    if (!value) return "Unavailable";
    const raw = typeof value === "object"
      ? [value.year, value.month, value.day].filter(v => v != null).map((v, i) => i ? String(v).padStart(2, "0") : String(v)).join("-")
      : String(value);
    // Keep the supplied precision: a year is not January 1st.
    if (/^\d{4}$/.test(raw)) return raw;
    if (!/^\d{4}-\d{2}(-\d{2})?$/.test(raw)) return "Unavailable";
    const date = new Date(`${raw.length === 7 ? raw + "-01" : raw}T12:00:00Z`);
    if (Number.isNaN(date.getTime())) return "Unavailable";
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric", month: "long", ...(raw.length === 10 ? { day: "numeric" } : {}), timeZone: "UTC"
    }).format(date);
  }

  function id(uri, type) {
    return new RegExp(`^spotify:${type}:([a-zA-Z0-9]{22})$`).exec(uri || "")?.[1]
      || new RegExp(`^https://open\\.spotify\\.com/(?:intl-[^/]+/)?${type}/([a-zA-Z0-9]{22})(?:[?#].*)?$`).exec(uri || "")?.[1];
  }

  async function spotify(path) {
    return remember(path, async () => {
      const data = await api.CosmosAsync.get(`https://api.spotify.com/v1/${path}`);
      if (!data || data.error || Number(data.code) >= 400 || (!data.name && !data.album && !Array.isArray(data.genres))) throw new Error("Spotify metadata unavailable");
      return data;
    });
  }

  function musicbrainz(path) {
    return remember(`mb:${path}`, () => {
      const result = mbQueue.then(async () => {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const response = await fetch(`https://musicbrainz.org/ws/2/${path}`, {
              credentials: "omit", signal: AbortSignal.timeout(10000), headers: { Accept: "application/json" }
            });
            if (!response.ok) {
              const error = new Error(`MusicBrainz ${response.status}`);
              error.retryable = response.status === 429 || response.status >= 500;
              throw error;
            }
            return await response.json();
          } catch (error) {
            if (attempt === 2 || error.retryable === false) throw error;
            await new Promise(resolve => setTimeout(resolve, 1500 * (attempt + 1)));
          }
        }
      });
      // MusicBrainz asks clients to stay below one request per second.
      mbQueue = result.catch(() => {}).then(() => new Promise(resolve => setTimeout(resolve, 1100)));
      return result;
    });
  }

  async function recordingGenres(isrc, track) {
    let match;
    let candidates = [];
    if (/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/i.test(isrc || "")) {
      const search = await musicbrainz(`recording?query=${encodeURIComponent(`isrc:${isrc}`)}&fmt=json&limit=5`);
      match = search.recordings?.find(r => r.isrcs?.some(code => code.toUpperCase() === isrc.toUpperCase()));
    }
    // Some Spotify responses omit ISRC. Require an unambiguous title, artist
    // credit and duration match rather than accepting the first search result.
    if (!match && track?.name && track.artists?.length && track.duration_ms) {
      const quote = value => `"${value.replace(/[\\"]/g, "\\$&")}"`;
      const search = await musicbrainz(`recording?query=${encodeURIComponent(`recording:${quote(track.name)} AND artist:${quote(track.artists[0].name)}`)}&fmt=json&limit=25`);
      const normalize = value => value.toLowerCase().normalize("NFKC").replace(/[’‘]/g, "'").trim();
      const matches = (search.recordings || []).filter(r =>
        normalize(r.title) === normalize(track.name) &&
        Math.abs(r.length - track.duration_ms) <= 2000 &&
        track.artists.every(a => r["artist-credit"]?.some(c => normalize(c.artist?.name || c.name || "") === normalize(a.name)))
      );
      candidates = matches;
      if (matches.length === 1) match = matches[0];
    }
    const normalizeArtist = value => value.normalize("NFKC").toLowerCase().trim();
    const primary = track?.artists?.[0]?.name;
    const artistIds = (match ? [match] : candidates).map(r => r["artist-credit"]?.find(c =>
      primary && normalizeArtist(c.artist?.name || c.name || "") === normalizeArtist(primary)
    )?.artist?.id);
    // Different editions can still identify the same artist unambiguously.
    const artistId = artistIds.length && artistIds.every(value => value && value === artistIds[0]) ? artistIds[0] : null;
    if (!match) return { genres: [], artistId };
    const recording = await musicbrainz(`recording/${match.id}?inc=genres&fmt=json`);
    return { genres: (recording.genres || []).filter(g => g.count > 0).sort((a, b) => b.count - a.count).map(g => g.name), artistId };
  }

  async function artistGenres(name, knownId) {
    if (!name || name === "Unknown artist") return [];
    let artistId = knownId;
    if (!artistId) {
      const quoted = `"${name.replace(/[\\"]/g, "\\$&")}"`;
      const search = await musicbrainz(`artist?query=${encodeURIComponent(`artist:${quoted}`)}&fmt=json&limit=10`);
      const normalize = value => value.normalize("NFKC").toLowerCase().trim();
      const matches = (search.artists || []).filter(a => normalize(a.name) === normalize(name));
      // Namesakes are ambiguous; do not silently pick the highest search result.
      if (matches.length !== 1) return [];
      artistId = matches[0].id;
    }
    const artist = await musicbrainz(`artist/${artistId}?inc=genres&fmt=json`);
    // Use the genre field, not arbitrary tags such as chart positions or opinions.
    return (artist.genres || []).filter(g => g.count > 0).sort((a, b) => b.count - a.count).map(g => g.name);
  }

  async function catalogGenres(track) {
    const artist = track.artists?.[0]?.name;
    if (!track.name || !artist || artist === "Unknown artist" || !track.duration_ms) return [];
    const query = encodeURIComponent(`${track.name} ${artist}`);
    const data = await remember(`apple:${query}`, async () => {
      const response = await fetch(`https://itunes.apple.com/search?term=${query}&entity=song&limit=25`, {
        credentials: "omit", signal: AbortSignal.timeout(10000)
      });
      if (!response.ok) throw new Error(`Apple catalog ${response.status}`);
      return response.json();
    });
    const normalize = value => value.normalize("NFKC").toLowerCase().replace(/[’‘]/g, "'").trim();
    const primary = normalize(artist);
    const matches = (data.results || []).filter(r => {
      const credit = normalize(r.artistName || "");
      const sameArtist = credit === primary || [" & ", ", ", " feat. ", " featuring "].some(separator => credit.startsWith(primary + separator));
      return normalize(r.trackName || "") === normalize(track.name) && sameArtist && Math.abs(r.trackTimeMillis - track.duration_ms) <= 2000;
    });
    const genres = [...new Set(matches.map(r => r.primaryGenreName).filter(Boolean))];
    // Multiple catalog editions are fine only when their genre agrees.
    return genres.length === 1 ? genres : [];
  }

  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  function mount() {
    if (!document.querySelector) return;
    const widget = document.querySelector('[data-testid="now-playing-widget-v2"], [data-testid="now-playing-widget"], .main-nowPlayingWidget-nowPlaying');
    if (!widget) return;
    const title = widget.querySelector('.snZjumJBv7mO_jikMyAG, .main-trackInfo-name')
      || widget.querySelector('a[href*="/track/"]');
    const byline = widget.querySelector('[data-testid="now-playing-widget-v2-byline"], .main-trackInfo-artists');
    const quality = widget.querySelector('[data-testid="context-item-info-quality"]');
    const genreTarget = quality || byline;
    if (title && dateLine.parentElement !== title) title.append(dateLine);
    if (title && typeof getComputedStyle === "function") {
      const titleText = title.querySelector('.uwz8JdTwEBKMf1SFiv2T, [data-encore-id="text"]') || title.firstElementChild || title;
      dateLine.style.fontSize = getComputedStyle(titleText).fontSize;
    }
    if (genreTarget && genreLine.parentElement !== genreTarget) genreTarget.append(genreLine);
  }

  function genreLink(genre) {
    const link = node("a", genre, "pp-genre-link");
    const resultsPath = `/search/${encodeURIComponent(genre)}/playlists`;
    link.href = resultsPath;
    link.title = `Find a ${genre} playlist`;
    link.onclick = async event => {
      event.stopPropagation();
      if (!api.Platform?.History?.push || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      let path = resultsPath;
      try {
        const result = await api.CosmosAsync.get(`https://api.spotify.com/v1/search?q=${encodeURIComponent(genre)}&type=playlist&limit=5`);
        const playlist = result?.playlists?.items?.find(p => id(p?.uri, "playlist"));
        if (playlist) path = `/playlist/${id(playlist.uri, "playlist")}`;
      } catch { /* Playlist search remains available if the Web API is restricted. */ }
      api.Platform.History.push(path);
    };
    return link;
  }

  function render(state) {
    stopMarquee();
    hasTrack = Boolean(state.title);
    panel.hidden = !hasTrack || (!settings.date && !settings.genres);
    const genreNames = [...new Set(state.genres || [])];
    const genres = genreNames.join(" · ");
    dateLine.textContent = ` · ${state.message ? "—" : dateText(state.date)}`;
    genreLine.replaceChildren();
    genreLine.textContent = "";
    if (genreNames.length && !state.message) {
      for (const genre of genreNames) genreLine.append(node("span", " · "), genreLink(genre));
    } else {
      genreLine.textContent = ` · ${state.message ? "Loading…" : (state.genreSource ? "Genres unavailable" : "Loading genres…")}`;
    }
    const details = [state.title, state.artist, state.message,
      "Spotify album / edition release", state.genreSource, state.warning].filter(Boolean).join("\n");
    panel.title = details;
    panel.setAttribute("aria-label", details);
    dateLine.title = genreLine.title = details;
    genreLine.setAttribute("aria-label", [genres || state.genreSource || state.message, state.warning].filter(Boolean).join(". "));
    applyVisibility();
    mount();
    if (genreLine.matches?.(":hover")) startMarquee();
  }

  function applyVisibility() {
    panel.hidden = !hasTrack || (!settings.date && !settings.genres);
    dateLine.hidden = !hasTrack || !settings.date;
    genreLine.hidden = !hasTrack || !settings.genres;
    if (genreLine.hidden) stopMarquee();
  }

  function openSettings() {
    const content = node("div", "", "pp-settings");
    for (const [key, title, description] of [
      ["date", "Date Toggle", "Show the release date beside the song title."],
      ["genres", "Genres Toggle", "Show clickable genres beside the artists or audio quality."]
    ]) {
      const row = node("label", "", "pp-setting-row");
      const text = node("span", "", "pp-setting-text");
      text.append(node("strong", title), node("span", description, "pp-setting-description"));
      const toggle = node("input");
      toggle.type = "checkbox";
      toggle.checked = settings[key];
      toggle.setAttribute("role", "switch");
      toggle.setAttribute("aria-label", title);
      toggle.onchange = () => {
        settings[key] = toggle.checked;
        try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* Session settings still work. */ }
        applyVisibility();
      };
      row.append(text, toggle);
      content.append(row);
    }
    api.PopupModal.display({ title: "Playing++", content });
  }

  async function update() {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    const version = ++generation;
    const item = api.Player.data?.item;
    const current = () => version === generation;
    if (!item) { render({}); return; }
    const state = {
      title: item.name || item.metadata?.title || "Unknown track",
      artist: item.artists?.map(a => a.name).join(", ") || item.metadata?.artist_name || "Unknown artist"
    };
    const trackId = [item.uri, item.metadata?.uri, item.metadata?.track_uri, item.link].map(uri => id(uri, "track")).find(Boolean);
    if (retryTrack !== trackId) { retryTrack = trackId; retryCount = 0; }
    if (!trackId) { render({ ...state, message: "Details are available for Spotify songs; local files, podcasts and ads are not supported." }); return; }
    render({ ...state, message: "Loading song details…" });
    let track;
    try { track = await spotify(`tracks/${trackId}`); }
    catch (error) { console.warn("[Playing++] Track lookup failed", error); }
    if (!current()) return;
    state.date = track?.album?.release_date || item.album?.release_date || item.metadata?.release_date || item.metadata?.album_year || item.metadata?.year;
    // The desktop metadata endpoint also works when the Web API is unavailable.
    if (!state.date) {
      const albumId = id(item.album?.uri || item.metadata?.album_uri, "album");
      if (albumId && api.Platform?.RequestBuilder?.build && api.URI?.idToHex) {
        try {
          const response = await api.Platform.RequestBuilder.build()
            .withHost("https://spclient.wg.spotify.com/metadata/4")
            .withPath(`/album/${api.URI.idToHex(albumId)}`).send();
          state.date = response.body?.date;
        } catch (error) { console.warn("[Playing++] Album lookup failed", error); }
      }
    }
    if (!current()) return;
    render(state);
    // Fetch artist data concurrently with recording genres, but render recording tags first.
    const artists = track?.artists || item.artists || [];
    const artistIds = [...new Set(artists.map(a => a.id || id(a.uri, "artist")).filter(Boolean))];
    if (!artistIds.length) {
      const primary = id(item.metadata?.artist_uri, "artist");
      if (primary) artistIds.push(primary);
    }
    const artistResults = Promise.allSettled(artistIds.map(artistId => spotify(`artists/${artistId}`)));
    let genres = [];
    let recordingArtistId;
    const recording = track || {
      name: state.title,
      artists: item.artists?.length ? item.artists : [{ name: item.metadata?.artist_name || state.artist }],
      duration_ms: api.Player.getDuration?.() || Number(item.metadata?.duration || item.duration?.milliseconds || item.duration)
    };
    try {
      const result = await recordingGenres(track?.external_ids?.isrc, recording);
      genres = result.genres;
      recordingArtistId = result.artistId;
    }
    catch (error) {
      console.warn("[Playing++] Recording genres unavailable", error);
      state.warning = `Recording genre lookup failed: ${error.message}`;
    }
    if (!current()) return;
    if (genres.length) {
      state.genres = genres;
      state.genreSource = "MusicBrainz recording genres · community supplied";
    } else {
      const results = await artistResults;
      if (!current()) return;
      state.genres = results.flatMap(r => r.status === "fulfilled" ? r.value.genres || [] : []);
      state.genreSource = state.genres.length
        ? "Spotify artist genres · track-specific subgenres unavailable"
        : "No genre data available for this recording or its artists.";
      if (!state.genres.length) {
        try {
          state.genres = await artistGenres(recording.artists?.[0]?.name, recordingArtistId);
          if (!current()) return;
          if (state.genres.length) state.genreSource = "MusicBrainz artist genres · track-specific subgenres unavailable";
        } catch (error) {
          console.warn("[Playing++] Artist genres unavailable", error);
        }
      }
    }
    if (!current()) return;
    if (!state.genres?.length) {
      try {
        state.genres = await catalogGenres(recording);
        if (!current()) return;
        if (state.genres.length) state.genreSource = "Apple Music catalog genre · matched song listing";
      } catch (error) {
        console.warn("[Playing++] Catalog genres unavailable", error);
      }
    }
    if (!current()) return;
    if (!track) state.warning = "Spotify track lookup unavailable. Some details may be missing.";
    render(state);
    if (!state.genres?.length && retryCount < 2) {
      retryCount++;
      retryTimer = setTimeout(() => {
        if (current()) update().catch(error => console.warn("[Playing++] Genre retry failed", error));
      }, retryCount * 15000);
    }
  }

  function start() {
    api = globalThis.Spicetify;
    if (!api?.Player?.addEventListener || !api?.CosmosAsync?.get || !api?.Menu?.Item || !api?.PopupModal?.display || !document.body) {
      setTimeout(start, 500);
      return;
    }
    if (document.getElementById("playing-plus-plus")) return;
    const style = node("style");
    style.textContent = `
      #playing-plus-plus{display:none}
      #playing-plus-plus-date,#playing-plus-plus-genres{white-space:pre;flex-shrink:0;color:var(--spice-subtext,#b3b3b3);font:inherit;text-decoration:none}
      #playing-plus-plus-date[hidden],#playing-plus-plus-genres[hidden]{display:none}
      #playing-plus-plus-date{font-size:14px}
      #playing-plus-plus-genres{display:inline-block;max-width:260px;overflow:hidden;text-overflow:ellipsis;vertical-align:bottom}
      #playing-plus-plus-genres .pp-genre-link{color:inherit;font:inherit;text-decoration:none;cursor:pointer}
      #playing-plus-plus-genres .pp-genre-link:hover{text-decoration:underline;color:var(--spice-text,#fff)}
      #playing-plus-plus-genres .pp-genre-link:focus-visible{outline:2px solid var(--spice-button,#1ed760);outline-offset:2px}
      .pp-settings{min-width:300px;padding:4px 0;color:var(--spice-text,#fff)}
      .pp-settings .pp-setting-row{display:flex;align-items:center;justify-content:space-between;gap:28px;padding:18px 0;cursor:pointer}
      .pp-settings .pp-setting-row+.pp-setting-row{border-top:1px solid #ffffff18}
      .pp-settings .pp-setting-text{display:flex;flex-direction:column;gap:6px}
      .pp-settings strong{font-size:15px;font-weight:600}
      .pp-settings .pp-setting-description{font-size:13px;line-height:1.5;color:var(--spice-subtext,#b3b3b3);max-width:310px}
      .pp-settings input{appearance:none;position:relative;width:40px;height:24px;flex-shrink:0;border:0;border-radius:20px;background:var(--spice-misc,#727272);cursor:pointer;transition:background .15s}
      .pp-settings input:checked{background:var(--spice-button,#1ed760)}
      .pp-settings input:before{content:"";position:absolute;width:18px;height:18px;left:3px;top:3px;background:#fff;border-radius:50%;transition:transform .15s}
      .pp-settings input:checked:before{transform:translateX(16px)}
      .pp-settings input:focus-visible{outline:2px solid var(--spice-text,#fff);outline-offset:3px}
    `;
    document.head.append(style);
    panel = node("section");
    panel.id = "playing-plus-plus";
    dateLine = node("span", "", "pp-date");
    dateLine.id = "playing-plus-plus-date";
    genreLine = node("span", "", "pp-genres");
    genreLine.id = "playing-plus-plus-genres";
    genreLine.onmouseenter = startMarquee;
    genreLine.onmouseleave = stopMarquee;
    genreLine.setAttribute("role", "note");
    panel.setAttribute("aria-label", "Playing++ song details");
    panel.setAttribute("aria-live", "polite");
    document.body.append(panel);
    mount();
    if (typeof MutationObserver !== "undefined") {
      const observer = new MutationObserver(() => mount());
      observer.observe(document.body, { childList: true, subtree: true });
    }
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
      if (typeof saved?.date === "boolean") settings.date = saved.date;
      if (typeof saved?.genres === "boolean") settings.genres = saved.genres;
    } catch { /* Invalid or unavailable storage uses enabled defaults. */ }
    applyVisibility();
    const menuIcon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M1 2Q1 1 2 1.5L11.5 6.5Q12.5 7 11.5 7.5L2 12.5Q1 13 1 12Z"/><path d="M8 11H9.2V12.2H10.4V13.4H9.2V14.6H8V13.4H6.8V12.2H8ZM12.8 11H14V12.2H15.2V13.4H14V14.6H12.8V13.4H11.6V12.2H12.8Z" style="stroke:currentColor;stroke-width:.3;stroke-linejoin:round"/></svg>';
    new api.Menu.Item("Playing++", false, openSettings, menuIcon).register();
    const refresh = () => update().catch(error => {
      console.error("[Playing++]", error);
      render({ title: "Song details unavailable", message: "Try another song or reload Spotify." });
    });
    api.Player.addEventListener("songchange", refresh);
    api.Player.addEventListener("onplaypause", refresh);
    refresh();
    // The wrapper initially assigns Player.data without a songchange event.
    // Wait for that first state so startup does not leave both labels hidden.
    if (!api.Player.data?.item) {
      let attempts = 0;
      const waitForInitialTrack = () => {
        if (api.Player.data?.item) refresh();
        else if (++attempts < 60) setTimeout(waitForInitialTrack, 500);
      };
      setTimeout(waitForInitialTrack, 500);
    }
  }

  // Pure helpers are exported only for Node's built-in test runner.
  if (typeof document === "undefined" && typeof module !== "undefined" && module.exports) module.exports = { dateText, id };
  else start();
})();
