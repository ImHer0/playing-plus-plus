import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { ApplicationAssetUtils, FluxDispatcher } from "@webpack/common";
const Native = VencordNative.pluginHelpers.SpicetifyRPC as PluginNative<typeof import("./native")>;
const settings = definePluginSettings({
    useSpotifySettings: { type: OptionType.BOOLEAN, description: "Use customization from Spicetify instead of these overrides", default: true },
    activityType: { type: OptionType.SELECT, description: "Discord activity label", options: [{label:"Playing",value:0,default:true},{label:"Listening to",value:2},{label:"Watching",value:3},{label:"Competing in",value:5}] },
    nameTemplate: { type: OptionType.STRING, description: "Activity name: {title}, {artist}, {album}. Add any custom text here.", default: "{title}" },
    detailsTemplate: { type: OptionType.STRING, description: "Details template (blank hides it)", default: "{title}" },
    stateTemplate: { type: OptionType.STRING, description: "Second line template (blank hides it)", default: "{artist}" },
    coverSmall: { type: OptionType.BOOLEAN, description: "Use album cover as small image and logo as large image", default: false },
    showTime: { type: OptionType.BOOLEAN, description: "Show playback time", default: true },
    showButton: { type: OptionType.BOOLEAN, description: "Show Play song button", default: true }
});
let timer: ReturnType<typeof setInterval> | undefined;
let active = false;
let last = "";
function clear() {
    FluxDispatcher.dispatch({ type: "LOCAL_ACTIVITY_UPDATE", activity: null, socketId: "SpicetifyRPC" });
}
export default definePlugin({
    name: "SpicetifyRPC",
    description: "Receive listening activity directly from the Discord RPC+ Spicetify extension. Desktop only.",
    settings,
    authors: [{ name: "ImHer0", id: 0n }],
    async start() {
        await Native.start();
        active = true;
        const update = async () => {
            const { activity: data } = await Native.snapshot();
            if (!active) return;
            const key = JSON.stringify([data, settings.store]);
            if (key === last) return;
            last = key;
            if (!data) { clear(); return; }
            const trackId = /^spotify:track:([a-zA-Z0-9]{22})$/.exec(data.trackUri)?.[1];
            const options = settings.store.useSpotifySettings ? (data.options || {}) : settings.store;
            const template = (value: string) => value.replace(/\{(title|artist|album)\}/g, (_, k) => data[k] || "").slice(0, 128);
            const image = async (url: string) => (await ApplicationAssetUtils.fetchAssetIds("1461099412649545850", [url]))[0];
            const logo = "https://raw.githubusercontent.com/ImHer0/spicetify-extensions/main/assets/discord-rpc-logo.png";
            const activity: any = {
                application_id: "1461099412649545850", name: template(options.nameTemplate ?? "{title}"), type: Number(options.activityType ?? 0),
                details: template(options.detailsTemplate ?? "{title}") || undefined,
                state: template(options.stateTemplate ?? "{artist}") || undefined,
                timestamps: options.showTime !== false && data.start && data.end ? { start: data.start, end: data.end } : undefined,
                assets: options.coverSmall ? { large_image: await image(logo), small_image: data.cover ? await image(data.cover) : undefined, small_text: data.album } : { large_image: await image(data.cover || logo), large_text: data.album, small_image: await image(logo), small_text: "Spicetify" }
            };
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
