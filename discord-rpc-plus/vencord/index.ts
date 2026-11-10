import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { ApplicationAssetUtils, FluxDispatcher } from "@webpack/common";
const Native = VencordNative.pluginHelpers.SpicetifyRPC as PluginNative<typeof import("./native")>;
const settings = definePluginSettings({
    useSpotifySettings: { type: OptionType.BOOLEAN, description: "Use customization from Spicetify instead of these overrides", default: true },
    activityType: { type: OptionType.SELECT, description: "Discord activity label", options: [{label:"Playing",value:0},{label:"Listening to",value:2,default:true},{label:"Watching",value:3},{label:"Competing in",value:5}] },
    nameTemplate: { type: OptionType.STRING, description: "Activity name: {title}, {artist}, {album}. Add any custom text here.", default: "{title}" },
    detailsTemplate: { type: OptionType.STRING, description: "Details template (blank hides it)", default: "{title}" },
    stateTemplate: { type: OptionType.STRING, description: "Second line template (blank hides it)", default: "{artist}" },
    smallImage: { type: OptionType.SELECT, description: "Small image", options: [{ label: "Spotify profile", value: "profile", default: true }, { label: "Custom image / GIF URL", value: "custom" }, { label: "None", value: "none" }] },
    smallImageUrl: { type: OptionType.STRING, description: "Custom small image HTTPS URL", default: "" },
    smallImageText: { type: OptionType.STRING, description: "Small image hover text (blank uses Spotify profile name)", default: "" },
    showCover: { type: OptionType.BOOLEAN, description: "Show album artwork", default: true },
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
    patches: [{
        find: ".USER_PROFILE_ACTIVITY_BUTTONS),",
        replacement: { match: /.getId\(\)===\i.id/, replace: "$& && false" }
    }],
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
            const activity: any = {
                application_id: "1461099412649545850", name: template(options.nameTemplate ?? "{title}"), type: Number(options.activityType ?? 2),
                details: template(options.detailsTemplate ?? "{title}") || undefined,
                state: template(options.stateTemplate ?? "{artist}") || undefined,
                timestamps: options.showTime !== false && data.start && data.end ? { start: data.start, end: data.end } : undefined,
                assets: options.showCover !== false && data.cover ? { large_image: await image(data.cover), large_text: data.album } : {}
            };
            const smallUrl = options.smallImage === "none" ? undefined : options.smallImage === "custom" ? options.smallImageUrl : data.profile?.image;
            if (typeof smallUrl === "string" && /^https:\/\//.test(smallUrl)) {
                activity.assets.small_image = await image(smallUrl);
                activity.assets.small_text = (options.smallImageText || data.profile?.name || "Spotify profile").slice(0, 128);
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
