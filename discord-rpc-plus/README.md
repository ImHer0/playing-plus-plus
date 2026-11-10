# Discord RPC+

Shows your currently playing Spotify song on Discord, with artist, artwork, playback timestamps and a **Listen to song** button linking to Spotify.

## Install

1. Install Discord RPC+ from Spicetify Marketplace, or copy `discord-rpc-plus.js` into your Spicetify Extensions directory and enable it with `spicetify config extensions discord-rpc-plus.js` then `spicetify apply`.
2. Install Node.js and download `bridge.js` from this folder.
3. Run `node bridge.js` and keep it running alongside the Discord desktop app and Spotify. No npm dependencies are required.
4. Play a song. Enable activity sharing in Discord if necessary.

The bridge listens on 127.0.0.1:6473. Pausing clears the activity. Only Spotify track URIs produce the Listen button. Local files do not have a Spotify track link.

For a custom Discord application, run `node bridge.js YOUR_APPLICATION_ID`.

## Troubleshooting

The bridge should print `Discord connected as ...`. If it does not, start the Discord desktop app. Restart the bridge after updating it. Discord may render your own activity buttons differently from what other users see.

## Vencord companion (no separate Node runtime)

The `vencord` folder contains the desktop-only SpicetifyRPC userplugin. Discord hosts its local receiver; do not run bridge.js at the same time because both use port 6473.

1. Follow https://docs.vencord.dev/installing/ to prepare a Vencord source build. Building requires the documented development tools; running the resulting plugin does not require a separate Node process.
2. Copy `vencord/index.ts` and `vencord/native.ts` into `src/userplugins/spicetifyRPC/` in that checkout.
3. Rebuild and inject Vencord following its instructions, then fully restart Discord.
4. Enable SpicetifyRPC under Vencord Plugins and install/enable the Discord RPC+ Spicetify extension.
5. Play music. The extension reconnects within 15 seconds. Pausing clears the activity; losing Spotify clears it after 45 seconds.

This is a custom userplugin, not an official Vencord plugin or a stock-build download. Browser Vencord is unsupported. Disable the old bridge/autostart before enabling this plugin. Live Discord validation is pending.
