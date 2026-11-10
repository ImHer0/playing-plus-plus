import definePlugin, { PluginNative } from "@utils/types";
import { FluxDispatcher } from "@webpack/common";
const Native = VencordNative.pluginHelpers.SpicetifyRPC as PluginNative<typeof import("./native")>;
let timer: ReturnType<typeof setInterval> | undefined;
let active = false;
let last = "";
function clear() {
    FluxDispatcher.dispatch({ type: "LOCAL_ACTIVITY_UPDATE", activity: null, socketId: "SpicetifyRPC" });
}
export default definePlugin({
    name: "SpicetifyRPC",
    description: "Receive listening activity directly from the Discord RPC+ Spicetify extension. Desktop only.",
    authors: [{ name: "ImHer0", id: 0n }],
    async start() {
        await Native.start();
        active = true;
        const update = async () => {
            const { activity: data } = await Native.snapshot();
            if (!active) return;
            const key = JSON.stringify(data);
            if (key === last) return;
            last = key;
            if (!data) { clear(); return; }
            const trackId = /^spotify:track:([a-zA-Z0-9]{22})$/.exec(data.trackUri)?.[1];
            const activity: any = {
                application_id: "1461099412649545850", name: "Spotify", type: 2,
                details: data.title, state: data.artist, flags: 1,
                timestamps: data.start && data.end ? { start: data.start, end: data.end } : undefined,
                assets: data.cover ? { large_image: "mp:" + data.cover.replace("https://", ""), large_text: data.album } : undefined
            };
            if (trackId) {
                activity.buttons = ["Listen to song"];
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
