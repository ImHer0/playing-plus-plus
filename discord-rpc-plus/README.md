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
2. Copy `vencord/index.ts` and `vencord/native.ts` into `src/userplugins/spicetifyRPC.desktop/` in that checkout.
3. Rebuild and inject Vencord following its instructions, then fully restart Discord.
4. Enable SpicetifyRPC under Vencord Plugins and install/enable the Discord RPC+ Spicetify extension.
5. Play music. The extension reconnects within 15 seconds. Pausing clears the activity; losing Spotify clears it after 45 seconds.

This is a custom userplugin, not an official Vencord plugin or a stock-build download. Browser Vencord is unsupported. Disable the old bridge/autostart before enabling this plugin. Desktop build and TypeScript checks pass. Live Discord validation is pending.

## Customization

Open **Discord RPC+ settings** from Spotify's profile menu. Templates support `{title}`, `{artist}`, and `{album}`; blank detail lines are hidden. Choose Playing, Listening to, Watching or Competing in, toggle timestamps and the Play song button, and move album art to the small image. Discord controls the fixed activity label; arbitrary text is supported in the name template.

Vencord: open Settings > Vencord > Plugins > SpicetifyRPC settings. Disable **Use customization from Spicetify** to use Vencord overrides. Otherwise the Spotify settings apply to both the Vencord receiver and standalone bridge.

The Play song button opens the current track on Spotify. Final button visibility and artwork need live profile validation from another account.

### Small image options

The large image remains the album cover when **Show album artwork** is enabled. The independent **Small image** dropdown offers:

- **Spotify profile** (default): your Spotify avatar, with your display name on hover. If the profile has no avatar or Spotify cannot provide it, the small image is omitted.
- **Custom image / GIF URL**: a publicly accessible direct HTTPS image URL. Discord resolves and caches it; GIF animation depends on Discord support and may display as a still image.
- **None**: no small image.

**Small image hover text** overrides the default profile name. Leave it blank to use your Spotify display name. These options exist in both Spotify and Vencord. In Vencord, enable Use customization from Spicetify to share the Spotify settings, or disable it for independent overrides. The old small album-art option is retired.
