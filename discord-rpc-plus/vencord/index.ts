import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { ApplicationAssetUtils, FluxDispatcher } from "@webpack/common";
const Native = VencordNative.pluginHelpers.SpicetifyRPC as PluginNative<typeof import("./native")>;
const settings = definePluginSettings({
    source: { type: OptionType.SELECT, description: "Playback source (Windows reads the current system media session)", options: [{label:"Spicetify",value:"spotify",default:true},{label:"Windows media",value:"windows"},{label:"Spicetify with Windows fallback",value:"auto"}] },
    useSpotifySettings: { type: OptionType.BOOLEAN, description: "Use customization from Spicetify instead of these overrides", default: true },
    activityType: { type: OptionType.SELECT, description: "Discord activity label", options: [{label:"Playing",value:0},{label:"Listening to",value:2,default:true},{label:"Watching",value:3},{label:"Competing in",value:5}] },
    nameTemplate: { type: OptionType.STRING, description: "Activity name: {title}, {artist}, {album}. Add any custom text here.", default: "{title}" },
    detailsTemplate: { type: OptionType.STRING, description: "Details template (blank hides it)", default: "{title}" },
    stateTemplate: { type: OptionType.STRING, description: "Second line template (blank hides it)", default: "{artist}" },
    smallImage: { type: OptionType.SELECT, description: "Small image", options: [{ label: "None", value: "none", default: true }, { label: "Current playlist", value: "playlist" }, { label: "Custom image / GIF URL", value: "custom" }] },
    swapImages: { type: OptionType.BOOLEAN, description: "Swap the selected image and album cover (selected image large, album small)", default: false },
    smallImageUrl: { type: OptionType.STRING, description: "Custom small image HTTPS URL", default: "" },
    smallImageText: { type: OptionType.STRING, description: "Small image hover text", default: "" },
    showCover: { type: OptionType.BOOLEAN, description: "Show album artwork", default: true },
    showTime: { type: OptionType.BOOLEAN, description: "Show playback time", default: true },
    showButton: { type: OptionType.BOOLEAN, description: "Show Play song button", default: true }
});
let timer: ReturnType<typeof setInterval> | undefined;
let active = false;
let last = "";
let windowsData: any = null, windowsChecked = 0, windowsBusy = false;
function clear() {
    FluxDispatcher.dispatch({ type: "LOCAL_ACTIVITY_UPDATE", activity: null, socketId: "SpicetifyRPC" });
}
export default definePlugin({
    name: "SpicetifyRPC",
    description: "Share Spicetify or Windows media activity. Spicetify mode requires the Spotify extension. Desktop only.",
    settings,
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
            const options = settings.store.useSpotifySettings ? (data.options || {}) : settings.store;
            const template = (value: string) => value.replace(/\{(title|artist|album|playlist|source)\}/g, (_, k) => (k === "playlist" ? data.playlist?.name : data[k]) || "").slice(0, 128);
            const image = async (url: string) => (await ApplicationAssetUtils.fetchAssetIds("1461099412649545850", [url]))[0];
            const activity: any = {
                application_id: "1461099412649545850", name: template(options.nameTemplate ?? "{title}"), type: Number(options.activityType ?? 2),
                details: template(options.detailsTemplate ?? "{title}") || undefined,
                state: template(options.stateTemplate ?? "{artist}") || undefined,
                timestamps: options.showTime !== false && data.start && data.end ? { start: data.start, end: data.end } : undefined,
                assets: options.showCover !== false && data.cover ? { large_image: await image(data.cover), large_text: data.album } : {}
            };
            const smallUrl = options.smallImage === "custom" ? options.smallImageUrl : options.smallImage === "playlist" ? data.playlist?.image : undefined;
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
            FluxDispatcher.dispatch({ type: "LOCAL_ACTIVITY_UPDATE", activity, socketId: "SpicetifyRPC" });
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
