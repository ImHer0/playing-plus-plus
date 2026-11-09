const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { dateText, id } = require("./playing-plus-plus.js");

test("dates preserve year/month/day precision", () => {
  assert.equal(dateText("1997"), "1997");
  assert.match(dateText("1997-06"), /1997/);
  assert.doesNotMatch(dateText("1997-06"), /\b1\b/);
  assert.match(dateText({ year: 1997, month: 6, day: 16 }), /16/);
  assert.equal(dateText(null), "Unavailable");
  assert.equal(dateText("garbage"), "Unavailable");
});

test("only Spotify catalog URIs are used as lookup IDs", () => {
  assert.equal(id("spotify:track:" + "a".repeat(22), "track"), "a".repeat(22));
  assert.equal(id("https://open.spotify.com/track/" + "a".repeat(22) + "?si=test", "track"), "a".repeat(22));
  assert.equal(id("spotify:local:artist:song", "track"), undefined);
  assert.equal(id("spotify:episode:" + "a".repeat(22), "track"), undefined);
});

function harness(get, fetch, layout = "legacy", savedStorage = new Map()) {
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.textContent = ""; this.style = {}; }
    append(...children) { for (const child of children) { if (child.parentElement) child.parentElement.children = child.parentElement.children.filter(c => c !== child); child.parentElement = this; this.children.push(child); } }
    replaceChildren(...children) { this.children = children; }
    setAttribute() {}
    get text() { return [this.textContent, ...this.children.map(c => c.text)].join(""); }
  }
  const body = new Element("body");
  const listeners = {};
  const player = { data: null, addEventListener: (event, callback) => { listeners[event] = callback; } };
  const title = new Element("a");
  title.querySelector = () => ({ nativeFontSize: "14px" });
  const artists = new Element("span");
  const quality = layout === "v2" ? new Element("span") : null;
  const elements = [];
  const widget = { querySelector: selector => {
    if (selector.includes("/track/")) return title;
    if (selector.includes("byline")) return artists;
    if (selector.includes("context-item-info-quality")) return quality;
    return null;
  } };
  const document = { querySelector: selector => {
    if (layout === "v2" && !selector.includes('[data-testid="now-playing-widget-v2"]')) return null;
    return widget;
  }, body, head: new Element("head"), createElement: tag => { const e = new Element(tag); elements.push(e); return e; }, getElementById: id => elements.find(e => e.id === id) };
  const storage = savedStorage;
  const navigations = [];
  let menuClick;
  let modal;
  let menuRegistered = false;
  const retries = [];
  const frames = new Map();
  let frameId = 0;
  let startup;
  vm.runInNewContext(fs.readFileSync("playing-plus-plus.js", "utf8"), {
    document, console: { ...console, warn() {} }, setTimeout: (fn, delay) => {
      if (delay === 500) { startup = fn; return 0; }
      if (delay >= 15000) { retries.push(fn); return 0; }
      return setTimeout(fn, delay);
    }, clearTimeout, requestAnimationFrame: fn => { frames.set(++frameId, fn); return frameId; }, cancelAnimationFrame: id => frames.delete(id), Intl, AbortSignal, fetch, getComputedStyle: element => ({ fontSize: element.nativeFontSize }),
    localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    Spicetify: { Player: player, CosmosAsync: { get }, Platform: { History: { push: path => navigations.push(path) } }, Menu: { Item: function (name, enabled, callback) { menuClick = callback; this.register = () => { menuRegistered = true; }; } }, PopupModal: { display: value => { modal = value; } } }
  });
  return { player, title, artists, quality, navigations, storage, retries, frames, openSettings: () => menuClick(), get modal() { return modal; }, get menuRegistered() { return menuRegistered; }, dateLabel: () => elements.find(e => e.id === "playing-plus-plus-date"), genreLabel: () => elements.find(e => e.id === "playing-plus-plus-genres"), genreLinks: () => elements.find(e => e.id === "playing-plus-plus-genres").children.filter(e => e.tag === "a"), startup: () => startup(), details: () => elements.filter(e => e.id === "playing-plus-plus-date" || e.id === "playing-plus-plus-genres").map(e => e.text).join(" "), panel: body.children[0], change: () => listeners.songchange() };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const item = char => ({ uri: `spotify:track:${char.repeat(22)}`, name: char });

test("late responses cannot replace the current track; artist genres are labeled", async () => {
  let resolveOld;
  const app = harness(url => {
    if (url.includes("tracks/" + "a".repeat(22))) return new Promise(resolve => { resolveOld = resolve; });
    if (url.includes("artists/")) return Promise.resolve({ genres: ["art rock", "experimental rock"] });
    return Promise.resolve({ album: { release_date: "2020" }, artists: [{ id: "c".repeat(22) }] });
  });
  app.player.data = { item: item("a") }; app.change();
  app.player.data = { item: item("b") }; app.change();
  await flush();
  assert.match(app.details(), /2020/);
  assert.match(app.details(), /art rock/);
  assert.match(app.artists.text, / · art rock/);
  assert.match(app.panel.title, /Spotify artist genres/);
  resolveOld({ album: { release_date: "1990" } });
  await flush();
  assert.doesNotMatch(app.details(), /1990/);

});

test("API failures, empty playback and local files have explicit states", async () => {
  const app = harness(() => Promise.reject(new Error("offline")));
  assert.equal(app.panel.hidden, true);
  app.player.data = { item: { uri: "spotify:local:artist:song", name: "Local" } }; app.change();
  assert.match(app.panel.title, /not supported/);
  app.player.data = { item: item("d") }; app.change();
  await flush();
  assert.match(app.details(), /Unavailable/);
  assert.match(app.panel.title, /No genre data/);
});

test("recording genres use the exact ISRC and credential-free external requests", async () => {
  const requests = [];
  const app = harness(() => Promise.resolve({
    album: { release_date: "2001-03" }, artists: [], external_ids: { isrc: "GBABC0100001" }
  }), async (url, options) => {
    requests.push({ url, options });
    return { ok: true, json: async () => url.includes("query=")
      ? { recordings: [{ id: "recording-id", isrcs: ["GBABC0100001"] }] }
      : { genres: [{ name: "shoegaze", count: 4 }, { name: "dream pop", count: 2 }] } };
  });
  app.player.data = { item: item("e") }; app.change();
  await new Promise(resolve => setTimeout(resolve, 1250));
  assert.match(app.details(), /shoegaze/);
  assert.match(app.details(), /dream pop/);
  assert.match(app.panel.title, /MusicBrainz recording genres/);
  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /GBABC0100001/);
  for (const request of requests) assert.equal(request.options.credentials, "omit");
});


test("Connect metadata URI works when the player URI is missing", async () => {
  let requested;
  const app = harness(url => {
    requested = url;
    return Promise.resolve({ album: { release_date: "2024" }, artists: [] });
  });
  app.player.data = { item: { name: "Remote song", metadata: { track_uri: "spotify:track:" + "f".repeat(22) } } };
  app.change();
  await flush();
  assert.match(requested, /tracks\/f{22}$/);
  assert.match(app.details(), /2024/);
  assert.doesNotMatch(app.panel.title, /not supported/);
});

test("Spotify v2 player mounts details without the removed legacy trackInfo class", async () => {
  const app = harness(() => Promise.resolve({ album: { release_date: "2026" }, artists: [] }), undefined, "v2");
  assert.ok(app.panel, "Details must be attached to the v2 player's track information");
  app.player.data = { item: item("g") };
  app.change();
  await flush();
  assert.equal(app.panel.hidden, false);
  assert.match(app.details(), /2026/);
  assert.match(app.title.text, / · 2026/);
  assert.match(app.quality.text, / · Genres unavailable/);
  assert.equal(app.artists.children.length, 0);
});

test("missing ISRC uses a unique exact title, credited artists and duration match", async () => {
  const app = harness(url => Promise.resolve(url.includes("artists/") ? { genres: [] } : {
    name: "I'm God", duration_ms: 277711, artists: [{ name: "Clams Casino", id: "a".repeat(22) }], album: { release_date: "2020" }
  }), async url => ({ ok: true, json: async () => url.includes("query=") ? { recordings: [
    { id: "correct", title: "I’m God", length: 277710, "artist-credit": [{ name: "Clams Casino" }] },
    { id: "mix", title: "I'm God", length: 108135, "artist-credit": [{ name: "Clams Casino" }] }
  ] } : { genres: [{ name: "cloud rap", count: 1 }] } }));
  app.player.data = { item: item("h") }; app.change();
  await new Promise(resolve => setTimeout(resolve, 1250));
  assert.match(app.details(), /cloud rap/);
});

test("initial player data appears even when the wrapper emits no songchange", async () => {
  const app = harness(() => Promise.resolve({ album: { release_date: "2025" }, artists: [] }));
  app.player.data = { item: item("i") };
  app.startup();
  await flush();
  assert.match(app.title.text, / · 2025/);
});

test("Spotify error bodies fall back to player metadata for recording genres", async () => {
  const app = harness(() => Promise.resolve({ code: 403, error: null, message: "Forbidden", stack: "" }),
    async url => ({ ok: true, json: async () => url.includes("query=")
      ? { recordings: [{ id: "recording", title: "I’m God", length: 277710, "artist-credit": [{ name: "Clams Casino" }, { name: "Imogen Heap" }] }] }
      : { genres: [{ name: "cloud rap", count: 1 }, { name: "instrumental hip hop", count: 1 }] } }));
  app.player.getDuration = () => 277711;
  app.player.data = { item: { ...item("j"), name: "I'm God", artists: [{ name: "Clams Casino" }, { name: "Imogen Heap" }], album: { release_date: "2020-04-24" } } };
  app.change();
  await new Promise(resolve => setTimeout(resolve, 1250));
  assert.match(app.title.text, /2020/);
  assert.match(app.artists.text, /cloud rap/);
  assert.match(app.panel.title, /Spotify track lookup unavailable/);
});

test("date matches native title size; genre links open playlists with a search fallback", async () => {
  let restricted = false;
  const app = harness(url => {
    if (url.includes("/search?")) return Promise.resolve(restricted ? { code: 403 } : { playlists: { items: [null, { uri: "spotify:playlist:" + "p".repeat(22) }] } });
    if (url.includes("artists/")) return Promise.resolve({ genres: ["cloud rap", "instrumental hip hop"] });
    return Promise.resolve({ album: { release_date: "2020" }, artists: [{ id: "a".repeat(22) }] });
  });
  app.player.data = { item: item("k") }; app.change();
  await flush();
  assert.equal(app.title.children[0].style.fontSize, "14px");
  assert.equal(app.genreLinks().length, 2);
  assert.equal(app.genreLinks()[0].href, "/search/cloud%20rap/playlists");
  const event = { stopPropagation() {}, preventDefault() {} };
  await app.genreLinks()[0].onclick(event);
  assert.equal(app.navigations[0], "/playlist/" + "p".repeat(22));
  restricted = true;
  await app.genreLinks()[1].onclick(event);
  assert.equal(app.navigations[1], "/search/instrumental%20hip%20hop/playlists");
});

test("Self Aware falls back to MusicBrainz artist genres and keeps them clickable", async () => {
  const requests = [];
  const app = harness(() => Promise.resolve({ code: 403 }), async url => {
    requests.push(url);
    return { ok: true, json: async () => {
      if (url.includes("/recording?")) return { recordings: [] };
      if (url.includes("/artist?")) return { artists: [{ id: "temper-city", name: "Temper City", tags: [{ name: "industry plant" }] }] };
      return { genres: [{ name: "alternative rock", count: 1 }], tags: [{ name: "industry plant" }] };
    } };
  }, "v2");
  app.player.getDuration = () => 177000;
  app.player.data = { item: { ...item("l"), name: "Self Aware", artists: [{ name: "Temper City" }], album: { release_date: "2026-02-15" } } };
  app.change();
  await new Promise(resolve => setTimeout(resolve, 2400));
  assert.match(app.quality.text, /alternative rock/);
  assert.match(app.panel.title, /MusicBrainz artist genres/);
  assert.doesNotMatch(app.quality.text, /industry plant/);
  assert.equal(app.genreLinks()[0].href, "/search/alternative%20rock/playlists");
  assert.equal(requests.length, 3);
});

test("artist fallback rejects ambiguous namesakes", async () => {
  const requests = [];
  const app = harness(() => Promise.resolve({ code: 403 }), async url => {
    requests.push(url);
    return { ok: true, json: async () => ({ artists: [{ id: "one", name: "Same Name" }, { id: "two", name: "Same Name" }] }) };
  });
  app.player.data = { item: { ...item("m"), name: "Song", artists: [{ name: "Same Name" }] } };
  app.change();
  await flush();
  assert.match(app.details(), /Genres unavailable/);
  assert.equal(requests.length, 1);
});

test("Here uses the Apple catalog only for the matching song and primary artist", async () => {
  const app = harness(() => Promise.resolve({ code: 403 }), async (url, options) => {
    assert.equal(options.credentials, "omit");
    return { ok: true, json: async () => url.includes("itunes.apple.com") ? { results: [
      { trackName: "Here", artistName: "LUCIAN & Amanda Yang", trackTimeMillis: 207520, primaryGenreName: "Electronic" },
      { trackName: "Here (Nightcore)", artistName: "LUCIAN", trackTimeMillis: 207520, primaryGenreName: "Dance" },
      { trackName: "Here", artistName: "Luciano", trackTimeMillis: 207520, primaryGenreName: "Reggae" }
    ] } : { recordings: [], artists: [] } };
  }, "v2");
  app.player.getDuration = () => 207520;
  app.player.data = { item: { ...item("n"), name: "Here", artists: [{ name: "Lucian" }, { name: "Amanda Yang" }], album: { release_date: "2021-09-30" } } };
  app.change();
  await new Promise(resolve => setTimeout(resolve, 1250));
  assert.match(app.quality.text, /Electronic/);
  assert.match(app.panel.title, /Apple Music catalog genre/);
  assert.equal(app.genreLinks()[0].href, "/search/Electronic/playlists");
});

test("FULL BLOOM resolves Rav from recording credits across editions", async () => {
  const requests = [];
  let artistAttempts = 0;
  const app = harness(() => Promise.resolve({ code: 403 }), async url => {
    requests.push(url);
    if (url.includes("/artist/") && artistAttempts++ === 0) return { ok: false, status: 503 };
    return { ok: true, json: async () => url.includes("/recording?") ? { recordings: [
      { id: "single", title: "FULL BLOOM", length: 236378, "artist-credit": [{ name: "Rav", artist: { id: "rav-rapper", name: "Rav" } }] },
      { id: "album", title: "Full Bloom", length: 235104, "artist-credit": [{ name: "Rav", artist: { id: "rav-rapper", name: "Rav" } }] }
    ] } : { genres: [{ name: "hip hop", count: 3 }, { name: "underground hip hop", count: 3 }] } };
  }, "v2");
  app.player.getDuration = () => 236378;
  app.player.data = { item: { ...item("o"), name: "FULL BLOOM", artists: [{ name: "Rav" }], album: { release_date: "2024-12-31" } } };
  app.change();
  await new Promise(resolve => setTimeout(resolve, 3000));
  assert.match(app.quality.text, /hip hop/);
  assert.match(app.panel.title, /MusicBrainz artist genres/);
  assert.equal(requests.length, 3);
  assert.match(requests[1], /artist\/rav-rapper\?/);
  assert.equal(app.genreLinks().length, 2);
});


test("profile settings independently control date and genres and survive reload", async () => {
  const get = url => Promise.resolve(url.includes("artists/") ? { genres: ["hip hop"] } : { album: { release_date: "2024" }, artists: [{ id: "a".repeat(22) }] });
  const app = harness(get);
  app.player.data = { item: item("p") }; app.change(); await flush();
  assert.equal(app.menuRegistered, true);
  app.openSettings();
  assert.equal(app.modal.title, "Playing++");
  const rows = app.modal.content.children;
  assert.match(rows[0].text, /Date Toggle/);
  assert.match(rows[1].text, /Genres Toggle/);
  const dateSwitch = rows[0].children[1];
  const genreSwitch = rows[1].children[1];
  dateSwitch.checked = false; dateSwitch.onchange();
  assert.equal(app.dateLabel().hidden, true);
  assert.equal(app.genreLabel().hidden, false);
  genreSwitch.checked = false; genreSwitch.onchange();
  assert.equal(app.genreLabel().hidden, true);
  dateSwitch.checked = true; dateSwitch.onchange();
  assert.equal(app.dateLabel().hidden, false);
  assert.equal(app.genreLabel().hidden, true);
  const reloaded = harness(get, undefined, "legacy", app.storage);
  reloaded.player.data = { item: item("p") }; reloaded.change(); await flush();
  assert.equal(reloaded.dateLabel().hidden, false);
  assert.equal(reloaded.genreLabel().hidden, true);
  reloaded.openSettings();
  assert.equal(reloaded.modal.content.children[1].children[1].checked, false);
});

test("missing genres schedule bounded retries for the current song", async () => {
  const app = harness(() => Promise.resolve({ code: 403 }));
  app.player.data = { item: item("q") }; app.change(); await flush();
  assert.equal(app.retries.length, 1);
  app.retries[0](); await flush();
  assert.equal(app.retries.length, 2);
  app.retries[1](); await flush();
  assert.equal(app.retries.length, 2);
});

test("overflowing genres scroll on hover and reset to the ellipsis on leave", async () => {
  const app = harness(url => Promise.resolve(url.includes("artists/") ? { genres: ["hip hop", "underground hip hop"] } : { album: { release_date: "2024" }, artists: [{ id: "a".repeat(22) }] }));
  app.player.data = { item: item("r") }; app.change(); await flush();
  const label = app.genreLabel();
  label.clientWidth = 260;
  label.scrollWidth = 360;
  label.onmouseenter();
  assert.equal(label.style.textOverflow, "clip");
  const tick = now => {
    const [id, fn] = [...app.frames][0];
    app.frames.delete(id);
    fn(now);
  };
  tick(0); tick(1600);
  assert.equal(label.scrollLeft, 30);
  assert.equal(app.genreLinks().length, 2);
  label.onmouseleave();
  assert.equal(label.scrollLeft, 0);
  assert.equal(label.style.textOverflow, "");
  assert.equal(app.frames.size, 0);
  label.scrollWidth = 200;
  label.onmouseenter();
  assert.equal(app.frames.size, 0);
});


test("Unicode hyphens in MusicBrainz artist names match Spotify credits", async () => {
  const app = harness(() => Promise.resolve({ code: 403 }), async url => ({
    ok: true, json: async () => url.includes("/artist?")
      ? { artists: [{ id: "wu-tang", name: "Wu\u2010Tang Clan" }] }
      : { genres: [{ name: "east coast hip hop", count: 3 }, { name: "hardcore hip hop", count: 2 }] }
  }), "v2");
  app.player.data = { item: { ...item("w"), name: "Protect Ya Neck", artists: [{ name: "Wu-Tang Clan" }], album: { release_date: "1993-11-09" } } };
  app.change();
  await new Promise(resolve => setTimeout(resolve, 1250));
  assert.match(app.quality.text, /east coast hip hop/);
  assert.match(app.panel.title, /MusicBrainz artist genres/);
  assert.equal(app.genreLinks()[0].href, "/search/east%20coast%20hip%20hop/playlists");
});


test("date formats and custom tokens preserve real release precision", () => {
  assert.equal(dateText("2024-01-31", "dmy"), "31/01/2024");
  assert.equal(dateText("2024-01-31", "mdy"), "01/31/2024");
  assert.equal(dateText("2024-01-31", "iso"), "2024-01-31");
  assert.equal(dateText("2024-01-31", "custom", "DD.MM.YYYY"), "31.01.2024");
  assert.equal(dateText("2024-01-31", "custom", "D/M/YY"), "31/1/24");
  assert.equal(dateText("2024-01", "custom", "DD/MM/YYYY"), "2024-01");
  assert.equal(dateText("2024", "dmy"), "2024");
  assert.equal(dateText("2024-02-31", "iso"), "Unavailable");
});


test("date format settings update playback immediately and survive reload", async () => {
  const get = url => Promise.resolve(url.includes("artists/") ? { genres: ["rock"] } : { album: { release_date: "2024-01-31" }, artists: [{ id: "a".repeat(22) }] });
  const app = harness(get);
  app.player.data = { item: item("f") }; app.change(); await flush();
  app.openSettings();
  const controls = app.modal.content.children[0].children[0].children[2];
  const select = controls.children[0].children[0];
  const customLabel = controls.children[1];
  const input = customLabel.children[0];
  select.value = "dmy"; select.onchange();
  assert.equal(app.dateLabel().textContent, " · 31/01/2024");
  assert.equal(customLabel.hidden, true);
  select.value = "custom"; select.onchange();
  assert.equal(customLabel.hidden, false);
  input.value = "YYYY.MM.DD"; input.oninput();
  assert.equal(app.dateLabel().textContent, " · 2024.01.31");
  const reloaded = harness(get, undefined, "legacy", app.storage);
  reloaded.player.data = { item: item("f") }; reloaded.change(); await flush();
  assert.equal(reloaded.dateLabel().textContent, " · 2024.01.31");
});


test("settings include the donation footer and no release-time notice", () => {
  const app = harness(() => Promise.resolve({}));
  app.openSettings();
  const footer = app.modal.content.children[2];
  assert.match(footer.text, /Support Playing\+\+/);
  const links = footer.children[1].children;
  assert.deepEqual(links.map(link => link.href), ["https://ko-fi.com/imher0", "https://www.paypal.com/paypalme/ImHer0TM", "https://github.com/sponsors/ImHer0"]);
  for (const link of links) {
    assert.equal(link.target, "_blank");
    assert.equal(link.rel, "noopener noreferrer");
    assert.match(link.innerHTML, /<svg/);
  }
  assert.doesNotMatch(app.modal.content.text, /Release time/i);
});
