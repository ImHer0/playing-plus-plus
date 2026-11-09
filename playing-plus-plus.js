// Playing++ — a standalone Spicetify extension. No build step required.
(() => {
  "use strict";
  const SETTINGS_KEY = "playing-plus-plus:settings";
  const settings = { date: true, genres: true, dateFormat: "long", customDateFormat: "DD/MM/YYYY", maxGenres: 0, hiddenGenres: "", hideUnavailableGenres: false };
  const dateFormats = [["long", "January 31, 2024"], ["short", "Jan 31, 2024"], ["dmy", "31/01/2024"], ["mdy", "01/31/2024"], ["iso", "2024-01-31"], ["custom", "Custom"]];
  let lastState;
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
  let genresFilteredOut = false;
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

  function dateText(value, format = settings.dateFormat, custom = settings.customDateFormat) {
    if (!value) return "Unavailable";
    const raw = typeof value === "object"
      ? [value.year, value.month, value.day].filter(v => v != null).map((v, i) => i ? String(v).padStart(2, "0") : String(v)).join("-")
      : String(value);
    if (/^\d{4}$/.test(raw)) return raw;
    if (!/^\d{4}-\d{2}(-\d{2})?$/.test(raw)) return "Unavailable";
    const date = new Date(`${raw.length === 7 ? raw + "-01" : raw}T12:00:00Z`);
    const [year, month, day] = raw.split("-").map(Number);
    if (Number.isNaN(date.getTime()) || date.getUTCMonth() + 1 !== month || (day && date.getUTCDate() !== day)) return "Unavailable";
    const hasDay = raw.length === 10;
    // Never invent a day for month-only releases, even in custom formats.
    if (!hasDay && format !== "long" && format !== "short") return raw;
    if (format === "iso") return raw;
    if (format === "dmy") return `${raw.slice(8)}/${raw.slice(5, 7)}/${raw.slice(0, 4)}`;
    if (format === "mdy") return `${raw.slice(5, 7)}/${raw.slice(8)}/${raw.slice(0, 4)}`;
    if (format === "custom") {
      const monthName = style => new Intl.DateTimeFormat(undefined, { month: style, timeZone: "UTC" }).format(date);
      const tokens = { YYYY: String(year), YY: String(year).slice(-2), MMMM: monthName("long"), MMM: monthName("short"), MM: raw.slice(5, 7), M: String(month), DD: raw.slice(8), D: String(day) };
      return (custom.trim() || "DD/MM/YYYY").slice(0, 80).replace(/YYYY|MMMM|MMM|YY|MM|DD|M|D/g, token => tokens[token]);
    }
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric", month: format === "short" ? "short" : "long", ...(hasDay ? { day: "numeric" } : {}), timeZone: "UTC"
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

  function sameRecording(recording, track, isrc) {
    const normalize = value => String(value || "").normalize("NFKC").replace(/[\u2010-\u2015]/g, "-").replace(/[’‘]/g, "'").toLowerCase().trim();
    const credits = recording?.["artist-credit"]?.map(c => normalize(c.artist?.name || c.name)).sort();
    const artists = track?.artists?.map(a => normalize(a.name)).sort();
    return Boolean(recording && track?.name && artists?.length && artists.every(Boolean) &&
      /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/i.test(isrc || "") &&
      recording.isrcs?.some(code => code.toUpperCase() === isrc.toUpperCase()) &&
      normalize(recording.title) === normalize(track.name) &&
      Number.isFinite(recording.length) && Number.isFinite(track.duration_ms) && track.duration_ms > 0 &&
      Math.abs(recording.length - track.duration_ms) <= 1000 &&
      credits?.length === artists.length && credits.every((name, i) => name === artists[i]) &&
      !recording.disambiguation && recording.video !== true);
  }

  function earlierReleaseDate(search, recording, track, isrc, edition) {
    const matches = (search?.recordings || []).filter(r => r.isrcs?.some(code => code.toUpperCase() === isrc?.toUpperCase()));
    // A truncated or ambiguous ISRC search cannot establish a unique recording.
    if (!search || (search.count || search.recordings?.length) >= 5 || matches.length !== 1 ||
        matches[0].id !== recording?.id || matches[0]["first-release-date"] !== recording?.["first-release-date"] || !sameRecording(matches[0], track, isrc) || !sameRecording(recording, track, isrc)) return;
    const range = value => {
      const raw = typeof value === "object" && value
        ? [value.year, value.month, value.day].filter(v => v != null).map((v, i) => i ? String(v).padStart(2, "0") : String(v)).join("-")
        : String(value || "");
      if (dateText(raw) === "Unavailable") return;
      const [y, m, d] = raw.split("-").map(Number);
      const lower = `${String(y).padStart(4, "0")}-${String(m || 1).padStart(2, "0")}-${String(d || 1).padStart(2, "0")}`;
      const upper = `${String(y).padStart(4, "0")}-${String(m || 12).padStart(2, "0")}-${String(d || (m ? new Date(Date.UTC(y, m, 0)).getUTCDate() : 31)).padStart(2, "0")}`;
      return { raw, lower, upper };
    };
    const original = range(recording["first-release-date"]);
    const current = range(edition);
    return original && current && original.upper < current.lower ? original.raw : undefined;
  }

  function displayedGenres(genres, max = settings.maxGenres, hidden = settings.hiddenGenres) {
    const excluded = new Set(hidden.split(",").map(value => value.trim().toLowerCase()).filter(Boolean));
    const names = [...new Set(genres || [])].filter(name => !excluded.has(name.toLowerCase()));
    return max > 0 ? names.slice(0, max) : names;
  }

  async function recordingGenres(isrc, track, editionDate) {
    let isrcSearch;
    let match;
    let candidates = [];
    if (/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/i.test(isrc || "")) {
      const search = await musicbrainz(`recording?query=${encodeURIComponent(`isrc:${isrc}`)}&fmt=json&limit=5`);
      isrcSearch = search;
      match = search.recordings?.find(r => r.isrcs?.some(code => code.toUpperCase() === isrc.toUpperCase()));
    }
    // Some Spotify responses omit ISRC. Require an unambiguous title, artist
    // credit and duration match rather than accepting the first search result.
    if (!match && track?.name && track.artists?.length && track.duration_ms) {
      const quote = value => `"${value.replace(/[\\"]/g, "\\$&")}"`;
      const search = await musicbrainz(`recording?query=${encodeURIComponent(`recording:${quote(track.name)} AND artist:${quote(track.artists[0].name)}`)}&fmt=json&limit=25`);
      const normalize = value => value.toLowerCase().normalize("NFKC").replace(/[\u2010-\u2015]/g, "-").replace(/[’‘]/g, "'").trim();
      const matches = (search.recordings || []).filter(r =>
        normalize(r.title) === normalize(track.name) &&
        Math.abs(r.length - track.duration_ms) <= 2000 &&
        track.artists.every(a => r["artist-credit"]?.some(c => normalize(c.artist?.name || c.name || "") === normalize(a.name)))
      );
      candidates = matches;
      if (matches.length === 1) match = matches[0];
    }
    const normalizeArtist = value => value.normalize("NFKC").replace(/[\u2010-\u2015]/g, "-").toLowerCase().trim();
    const primary = track?.artists?.[0]?.name;
    const artistIds = (match ? [match] : candidates).map(r => r["artist-credit"]?.find(c =>
      primary && normalizeArtist(c.artist?.name || c.name || "") === normalizeArtist(primary)
    )?.artist?.id);
    // Different editions can still identify the same artist unambiguously.
    const artistId = artistIds.length && artistIds.every(value => value && value === artistIds[0]) ? artistIds[0] : null;
    if (!match) return { genres: [], artistId };
    const checkOriginal = sameRecording(match, track, isrc);
    const recording = await musicbrainz(`recording/${match.id}?inc=${checkOriginal ? "genres+artists+isrcs" : "genres"}&fmt=json`);
    const originalDate = checkOriginal ? earlierReleaseDate(isrcSearch, recording, track, isrc, editionDate) : undefined;
    return { genres: (recording.genres || []).filter(g => g.count > 0).sort((a, b) => b.count - a.count).map(g => g.name), artistId, originalDate };
  }

  async function artistGenres(name, knownId) {
    if (!name || name === "Unknown artist") return [];
    let artistId = knownId;
    if (!artistId) {
      const quoted = `"${name.replace(/[\\"]/g, "\\$&")}"`;
      const search = await musicbrainz(`artist?query=${encodeURIComponent(`artist:${quoted}`)}&fmt=json&limit=10`);
      const normalize = value => value.normalize("NFKC").replace(/[\u2010-\u2015]/g, "-").toLowerCase().trim();
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
    lastState = state;
    stopMarquee();
    hasTrack = Boolean(state.title);
    panel.hidden = !hasTrack || (!settings.date && !settings.genres);
    const allGenres = [...new Set(state.genres || [])];
    const genreNames = displayedGenres(allGenres);
    genresFilteredOut = !state.message && ((allGenres.length > 0 && genreNames.length === 0) ||
      (settings.hideUnavailableGenres && !allGenres.length && Boolean(state.genreSource)));
    const genres = genreNames.join(" · ");
    dateLine.textContent = ` · ${state.message ? "—" : dateText(state.date)}${!state.message && state.originalDate ? "*" : ""}`;
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
    dateLine.title = [state.originalDate && !state.message ? `Earliest documented release of this recording: ${dateText(state.originalDate)} (MusicBrainz)` : "", details].filter(Boolean).join("\n");
    genreLine.title = [details, allGenres.length ? `All genres: ${allGenres.join(" · ")}` : ""].filter(Boolean).join("\n");
    genreLine.setAttribute("aria-label", [genres || state.genreSource || state.message, state.warning].filter(Boolean).join(". "));
    applyVisibility();
    mount();
    if (genreLine.matches?.(":hover")) startMarquee();
  }

  function applyVisibility() {
    panel.hidden = !hasTrack || (!settings.date && !settings.genres);
    dateLine.hidden = !hasTrack || !settings.date;
    genreLine.hidden = !hasTrack || !settings.genres || genresFilteredOut;
    if (genreLine.hidden) stopMarquee();
  }

  function openSettings() {
    const content = node("div", "", "pp-settings");
    for (const [key, title, description] of [
      ["date", "Date Toggle", "Show the release date beside the song title."],
      ["genres", "Genres Toggle", "Show clickable genres beside the artists or audio quality."]
    ]) {
      const row = node("div", "", "pp-setting-row");
      const text = node("div", "", "pp-setting-text");
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
      if (key === "date") {
        const controls = node("div", "", "pp-date-controls");
        const label = node("label", "Date Format:");
        const select = node("select");
        select.setAttribute("aria-label", "Date Format");
        for (const [value, title] of dateFormats) {
          const option = node("option", title);
          option.value = value;
          select.append(option);
        }
        select.value = settings.dateFormat;
        label.append(select);
        const customLabel = node("label", "Custom Formatting");
        const custom = node("input");
        custom.type = "text";
        custom.value = settings.customDateFormat;
        custom.placeholder = "DD/MM/YYYY";
        custom.maxLength = 80;
        custom.setAttribute("aria-label", "Custom Formatting");
        const help = node("span", "Month or year-only releases keep their original precision.", "pp-setting-description pp-date-note");
        customLabel.append(custom, node("span", "Try DD/MM/YYYY · YYYY / YY = year · MMMM / MMM / MM / M = month · DD / D = day", "pp-setting-description pp-token-guide"));
        const saveFormat = () => {
          settings.dateFormat = select.value;
          settings.customDateFormat = custom.value;
          customLabel.hidden = select.value !== "custom";
          try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* Session settings still work. */ }
          if (lastState) render(lastState);
        };
        select.onchange = saveFormat;
        custom.oninput = saveFormat;
        customLabel.hidden = settings.dateFormat !== "custom";
        controls.append(label, customLabel, help);
        text.append(controls);
      }
      if (key === "genres") {
        const controls = node("div", "", "pp-date-controls pp-genre-controls");
        const countLabel = node("label", "Maximum genres");
        const count = node("select");
        count.setAttribute("aria-label", "Maximum genres");
        for (const value of [0, 1, 2, 3, 4, 5, 8, 10]) {
          const option = node("option", value ? String(value) : "All genres");
          option.value = String(value);
          count.append(option);
        }
        count.value = String(settings.maxGenres);
        countLabel.append(count);
        const hiddenLabel = node("label", "Hide genres");
        const hidden = node("input");
        hidden.type = "text";
        hidden.value = settings.hiddenGenres;
        hidden.placeholder = "e.g. pop, rock";
        hidden.maxLength = 500;
        hidden.setAttribute("aria-label", "Hide genres");
        hiddenLabel.append(hidden, node("span", "Separate exact genre names with commas. The full list stays available on hover.", "pp-setting-description"));
        const unavailableLabel = node("label", "Hide “Genres unavailable”", "pp-inline-option");
        const unavailable = node("input");
        unavailable.type = "checkbox";
        unavailable.checked = settings.hideUnavailableGenres;
        unavailable.setAttribute("aria-label", "Hide Genres unavailable");
        unavailableLabel.append(unavailable);
        const saveGenres = () => {
          settings.maxGenres = Number(count.value);
          settings.hiddenGenres = hidden.value;
          settings.hideUnavailableGenres = unavailable.checked;
          try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* Session settings still work. */ }
          if (lastState) render(lastState);
        };
        count.onchange = hidden.oninput = unavailable.onchange = saveGenres;
        controls.append(countLabel, hiddenLabel, unavailableLabel);
        text.append(controls);
      }
      row.append(text, toggle);
      content.append(row);
    }
    const support = node("footer", "", "pp-support");
    support.append(node("span", "Support Playing++", "pp-support-title"));
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
    support.append(links);
    content.append(support);
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
      const result = await recordingGenres(track?.external_ids?.isrc, recording, state.date);
      genres = result.genres;
      state.originalDate = result.originalDate;
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
      .pp-settings{width:430px;max-width:100%;max-height:min(70vh,700px);overflow-y:auto;scrollbar-width:thin;box-sizing:border-box;padding:4px 4px 8px;color:var(--spice-text,#fff)}
      .pp-settings .pp-setting-row{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:20px;row-gap:6px;padding:20px;border:1px solid #ffffff12;border-radius:14px;background:var(--spice-highlight,#ffffff08)}
      .pp-settings .pp-setting-row+.pp-setting-row{margin-top:12px}
      .pp-settings .pp-setting-text{display:contents}
      .pp-settings strong{grid-column:1;font-size:15px;font-weight:600;line-height:24px;letter-spacing:-.15px}
      .pp-settings .pp-setting-description{grid-column:1;font-size:12px;line-height:1.6;color:var(--spice-subtext,#b3b3b3)}
      .pp-date-controls{grid-column:1/-1;display:flex;flex-direction:column;gap:14px;margin-top:12px;padding-top:18px;border-top:1px solid #ffffff12}
      .pp-date-controls label{display:flex;flex-direction:column;gap:8px;font-size:12px;font-weight:600;color:var(--spice-text,#fff)}
      .pp-date-controls [hidden]{display:none}
      .pp-date-controls select,.pp-date-controls input[type="text"]{width:100%;box-sizing:border-box;min-height:42px;padding:10px 12px;border:1px solid #ffffff26;border-radius:8px;background:var(--spice-main,#121212);color:var(--spice-text,#fff);font:inherit;font-size:14px;font-weight:400;transition:border-color .15s}
      .pp-date-controls select{cursor:pointer}
      .pp-date-controls input[type="text"]{font-family:ui-monospace,Consolas,monospace}
      .pp-date-controls select:hover,.pp-date-controls input[type="text"]:hover{border-color:var(--spice-subtext,#b3b3b3)}
      .pp-date-controls select:focus-visible,.pp-date-controls input[type="text"]:focus-visible{outline:2px solid var(--spice-button,#1ed760);outline-offset:2px}
      .pp-date-controls .pp-inline-option{display:flex;flex-direction:row;align-items:center;justify-content:space-between;gap:16px;font-weight:400}
      .pp-settings .pp-token-guide{font-size:11px;font-weight:400;line-height:1.7}
      .pp-settings .pp-date-note{font-size:11px;line-height:1.6}
      .pp-settings input[type="checkbox"]{grid-column:2;grid-row:1/3;align-self:start;appearance:none;position:relative;width:40px;height:24px;margin:0;flex-shrink:0;border:0;border-radius:20px;background:var(--spice-misc,#727272);cursor:pointer;transition:background .15s}
      .pp-settings input[type="checkbox"]:checked{background:var(--spice-button,#1ed760)}
      .pp-settings input[type="checkbox"]:before{content:"";position:absolute;width:18px;height:18px;left:3px;top:3px;background:#fff;border-radius:50%;transition:transform .15s}
      .pp-settings input[type="checkbox"]:checked:before{transform:translateX(16px)}
      .pp-settings input[type="checkbox"]:focus-visible{outline:2px solid var(--spice-text,#fff);outline-offset:3px}
      .pp-support{display:flex;flex-direction:column;align-items:center;gap:10px;margin-top:20px;padding:2px 8px;color:var(--spice-subtext,#b3b3b3)}
      .pp-support-title{font-size:11px;line-height:1.5}
      .pp-support-links{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:8px 20px}
      .pp-support-link{display:inline-flex;align-items:center;gap:6px;color:inherit;font-size:11px;line-height:24px;text-decoration:none;transition:color .15s}
      .pp-support-link:hover{color:var(--spice-text,#fff);text-decoration:underline}
      .pp-support-link svg{flex-shrink:0}
      .pp-support-link:focus-visible{outline:2px solid var(--spice-button,#1ed760);outline-offset:4px;border-radius:3px}
      @media(max-width:520px){.pp-settings{width:100%}.pp-settings .pp-setting-row{padding:16px;column-gap:12px}}

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
      if ([0, 1, 2, 3, 4, 5, 8, 10].includes(saved?.maxGenres)) settings.maxGenres = saved.maxGenres;
      if (typeof saved?.hiddenGenres === "string") settings.hiddenGenres = saved.hiddenGenres.slice(0, 500);
      if (typeof saved?.hideUnavailableGenres === "boolean") settings.hideUnavailableGenres = saved.hideUnavailableGenres;
      if (dateFormats.some(([value]) => value === saved?.dateFormat)) settings.dateFormat = saved.dateFormat;
      if (typeof saved?.customDateFormat === "string") settings.customDateFormat = saved.customDateFormat.slice(0, 80);
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
  if (typeof document === "undefined" && typeof module !== "undefined" && module.exports) module.exports = { dateText, id, sameRecording, earlierReleaseDate, displayedGenres };
  else start();
})();
