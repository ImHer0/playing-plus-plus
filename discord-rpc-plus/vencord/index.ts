import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { ApplicationAssetUtils, FluxDispatcher, React } from "@webpack/common";
const Native = VencordNative.pluginHelpers.ListeningRPC as PluginNative<typeof import("./native")>;
function windowsOnly(): boolean { return settings.store.source === "windows"; }
const settings = definePluginSettings({
    source: { type: OptionType.SELECT, description: "Playback source (Windows reads the current system media session)", options: [{label:"Spicetify",value:"spotify"},{label:"Windows media",value:"windows",default:true},{label:"Spicetify with Windows fallback",value:"auto"}] },
    useSpotifySettings: { hidden: windowsOnly, type: OptionType.BOOLEAN, description: "Use customization from Spicetify instead of these overrides", default: true },
    activityType: { type: OptionType.SELECT, description: "Discord activity label", options: [{label:"Playing",value:0},{label:"Listening to",value:2,default:true},{label:"Watching",value:3},{label:"Competing in",value:5}] },
    nameTemplate: { type: OptionType.STRING, description: "Activity name: {title}, {artist}, {album}. Add any custom text here.", default: "{title}" },
    detailsTemplate: { type: OptionType.STRING, description: "Details template (blank hides it)", default: "{title}" },
    stateTemplate: { type: OptionType.STRING, description: "Second line template (blank hides it)", default: "{artist}" },
    playlistImage: { type: OptionType.BOOLEAN, description: "Use current playlist artwork instead of custom small image", default: false, hidden: windowsOnly },
    smallImage: { type: OptionType.SELECT, description: "Small image", options: [{ label: "None", value: "none", default: true }, { label: "Custom image / GIF URL", value: "custom" }] },
    swapImages: { type: OptionType.BOOLEAN, description: "Swap the selected image and album cover (selected image large, album small)", default: false },
    smallImageUrl: { type: OptionType.STRING, description: "Custom small image HTTPS URL", default: "" },
    smallImageText: { type: OptionType.STRING, description: "Small image hover text", default: "" },
    showCover: { type: OptionType.BOOLEAN, description: "Show album artwork", default: true },
    showTime: { type: OptionType.BOOLEAN, description: "Show playback time", default: true },
    showButton: { hidden: windowsOnly, type: OptionType.BOOLEAN, description: "Show Play song button", default: true }
});
let timer: ReturnType<typeof setInterval> | undefined;
let active = false;
let last = "";
let windowsData: any = null, windowsChecked = 0, windowsBusy = false;
function clear() {
    FluxDispatcher.dispatch({ type: "LOCAL_ACTIVITY_UPDATE", activity: null, socketId: "ListeningRPC" });
}
export default definePlugin({
    name: "ListeningRPC",
    description: "Share Spicetify or Windows media activity. Windows media is the default; optional Spotify enrichment requires Spicetify.",
    settings,
    settingsAboutComponent: () => React.createElement("p", null,
        "Windows media works without Spicetify. For Spotify artwork, playlist context and exact song links: ",
        React.createElement("a", { href: "https://github.com/ImHer0/spicetify-extensions/tree/main/discord-rpc-plus#install-the-spotify-extension", target: "_blank", rel: "noopener noreferrer" }, "SpicetifyRPC installation guide")),
    patches: [{
        find: ".USER_PROFILE_ACTIVITY_BUTTONS),",
        replacement: { match: /.getId\(\)===\i.id/, replace: "$& && false" }
    }],
    authors: [{ name: "ImHer0", id: 1401294711041429679n }],
    async start() {
        await Native.start();
        active = true;
        const update = async () => {
            const { activity: spotifyData } = await Native.snapshot();
            const source = settings.store.source;
            if (source !== "spotify" && Date.now() - windowsChecked > 10000 && !windowsBusy) {
                windowsBusy = true;
                try { windowsData = await Native.windowsSnapshot(); }
                finally { windowsChecked = Date.now(); windowsBusy = false; }
            }
            const data = source === "windows" ? windowsData : spotifyData || (source === "auto" ? windowsData : null);
            if (!active) return;
            const key = JSON.stringify([data, settings.store]);
            if (key === last) return;
            last = key;
            if (!data) { clear(); return; }
            const trackId = /^spotify:track:([a-zA-Z0-9]{22})$/.exec(data.trackUri)?.[1];
            const options = data.source !== "Spotify" ? { ...settings.store, showCover: settings.store.showCover, showButton: false, playlistImage: false } : settings.store.useSpotifySettings ? (data.options || {}) : settings.store;
            const template = (value: string) => value.replace(/\{(title|artist|album|playlist|source)\}/g, (_, k) => (k === "playlist" ? data.playlist?.name : data[k]) || "").slice(0, 128);
            if (data.source !== "Spotify" && options.showCover && !data.cover) {
                data.cover = await Native.artwork(data.title, data.artist, data.album || "");
            }
            const image = async (url: string) => (await ApplicationAssetUtils.fetchAssetIds("1461099412649545850", [url]))[0];
            const activity: any = {
                application_id: "1461099412649545850", name: template(options.nameTemplate ?? "{title}"), type: Number(options.activityType ?? 2),
                details: template(options.detailsTemplate ?? "{title}") || undefined,
                state: template(options.stateTemplate ?? "{artist}") || undefined,
                timestamps: options.showTime !== false && data.start && data.end ? { start: data.start, end: data.end } : undefined,
                assets: options.showCover !== false && data.cover ? { large_image: await image(data.cover), large_text: data.album } : {}
            };
            const smallUrl = options.playlistImage ? data.playlist?.image : options.smallImage === "custom" ? options.smallImageUrl : options.smallImage === "playlist" ? data.playlist?.image : undefined;
            if (typeof smallUrl === "string" && /^https:\/\//.test(smallUrl)) {
                activity.assets.small_image = await image(smallUrl);
                activity.assets.small_text = (options.smallImageText || (options.smallImage === "playlist" ? data.playlist?.name : "Custom image") || "Playlist").slice(0, 128);
            }
            if (options.swapImages && activity.assets.small_image) {
                const { large_image, large_text, small_image, small_text } = activity.assets;
                activity.assets = { large_image: small_image, large_text: small_text, small_image: large_image, small_text: large_text };
            }
            if (trackId && options.showButton !== false) {
                activity.buttons = ["Play song"];
                activity.metadata = { button_urls: [`https://open.spotify.com/track/${trackId}`] };
            }
            if (!active) return;
            FluxDispatcher.dispatch({ type: "LOCAL_ACTIVITY_UPDATE", activity, socketId: "ListeningRPC" });
        };
        timer = setInterval(() => { void update().catch(console.error); }, 1000);
        await update();
    },
    stop() {
        active = false;
        clearInterval(timer);
        last = "";
        clear();
        void Native.stop();
    }
});
