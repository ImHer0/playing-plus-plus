# SpicetifyRPC

![SpicetifyRPC](../assets/discord-rpc-logo.png)

Share the song playing in Spotify on Discord: song title, artist, album artwork, playback time, and a **Play song** button linking to Spotify.

**Vencord availability:** the companion works as a custom desktop plugin and is not included in official Vencord yet. An official inclusion submission is being prepared. Until accepted, use a custom Vencord build or the standalone bridge below. This is not an official Vencord release.

## Install the Spotify extension

Install **SpicetifyRPC** from Spicetify Marketplace (indexing may take time), or copy `discord-rpc-plus.js` into your Spicetify Extensions folder and run:

```sh
spicetify config extensions discord-rpc-plus.js
spicetify apply
```

The existing filename is retained for compatibility. Choose one receiver below; Marketplace installs only the Spotify extension.

## Option 1: Vencord companion

No separate Node process is needed at runtime. Custom Vencord builds require development tools.

1. Follow [Vencord's source-build guide](https://docs.vencord.dev/installing/).
2. Copy `vencord/index.ts` and `vencord/native.ts` into `src/userplugins/listeningRPC.desktop/`.
3. Build with `pnpm build --dev`, then use `pnpm inject` to install your build. Fully restart Discord.
4. Enable **ListeningRPC** in Vencord Plugins.
5. Enable the Spotify extension and play music.

Use desktop Discord. Browser Vencord is unsupported. Stop the standalone bridge and disable its autostart before enabling the companion: both use `127.0.0.1:6473`.

## Option 2: standalone bridge

1. Install Node.js and download `bridge.js`.
2. Run `node bridge.js` alongside desktop Discord and Spotify. No npm dependencies are required.
3. The log should show `Discord connected as ...`.

To use your own Discord application: `node bridge.js YOUR_APPLICATION_ID`.

## Settings

Spotify: profile menu > **SpicetifyRPC settings**.

Vencord: Settings > Vencord > Plugins > **ListeningRPC** settings. **Use customization from Spicetify** is enabled by default. Disable it to use independent Vencord overrides.

| Setting | Behaviour |
| --- | --- |
| Activity label | Listening to (default), Playing, Watching, or Competing in |
| Activity name | Text after the Discord label; defaults to `{title}` |
| Details | First detail line; defaults to `{title}`; blank hides it |
| Second line | Defaults to `{artist}`; blank hides it |
| Show album artwork | Album cover as the large image |
| Small image | None (default), Current playlist, or Custom image / GIF URL |
| Custom image HTTPS URL | Public direct HTTPS image URL |
| Small image hover text | Tooltip for the custom small image |
| Playback time | Toggle playback timestamps |
| Play song button | Open the current track on Spotify |

Text templates support `{title}`, `{artist}`, and `{album}`. Example: `Enjoying {title} by {artist}`. Discord controls the fixed activity label; arbitrary text belongs in the activity name or detail templates.

Small artwork is independent of the album cover. Spotify profile fetching is not used. GIF rendering and animation depend on Discord's asset handling and caching; a GIF may appear as a still image. The project logo is used on GitHub and Marketplace, not in Discord activity.

## Behaviour and troubleshooting

- Pause clears the activity. Song changes and seeks update it.
- The extension sends a heartbeat every 15 seconds to reconnect after Discord starts.
- The Vencord receiver tolerates background timer throttling: activity remains valid through the expected song end plus 90 seconds, with a minimum two-minute heartbeat grace. Pause clears it immediately; if Spotify closes abruptly, the last song can remain visible until that grace expires.
- Enable Discord activity sharing if your activity is hidden.
- Only Spotify track URIs produce a Play song link; local files have no Spotify track link.
- Discord normally hides buttons on your own profile. The companion includes the same visibility patch used by Vencord CustomRPC. Check a full profile from another account when verifying public visibility.
- A port-in-use error usually means both receivers are running. Use only one.
- Fully restart Discord after updating native plugin code.

## Development and submission

Vencord desktop builds and TypeScript checks pass. Verify current artwork, button navigation and public profile visibility live before submitting. See [submission notes](vencord/SUBMISSION.md). Author Discord ID: `1401294711041429679`. No upstream PR has been created by this project tooling.

## Support

Optional: [Ko-fi](https://ko-fi.com/imher0), [PayPal](https://www.paypal.com/paypalme/ImHer0TM), [GitHub Sponsors](https://github.com/sponsors/ImHer0). The same links are in Spotify's SpicetifyRPC settings.

### Playlist artwork and swapping images

Select **Current playlist** to show the artwork of the Spotify playlist providing the playback context. Its name is the default hover text. Album, artist, radio, queue-only and other non-playlist contexts have no playlist image. If Spotify restricts playlist metadata, the image is omitted.

Enable **Swap large and small images** to display the selected custom image/GIF or playlist artwork as the large image, and album artwork as the small image. Hover text follows each image. With no available selected image, the normal album artwork remains large. Disable Show album artwork to omit album art in either position. GIF animation depends on Discord support.

## ListeningRPC for Vencord

The Vencord Source dropdown offers Spicetify, Windows media, or Spicetify with Windows fallback. Windows mode uses Windows system media sessions via built-in Windows PowerShell, with no Spotify extension or standalone Node installation required. It polls every ten seconds and shows title, artist, album and playback timing supplied by the current Windows media session. It clears paused playback. Only apps exposing Windows media controls are supported; Windows chooses the current session.

Windows mode provides text and timing plus optional online artwork lookup, but not native thumbnail artwork or service-specific song URLs. Custom image/GIF options remain available. Spotify mode retains exact Spotify song links, album artwork and playlist-context metadata.

Spicetify now sends playlist name, URI, description and artwork when available, using client playback context as a fallback to Spotify's API. Templates additionally support `{playlist}` and `{source}`. Playlist artwork still depends on metadata available in the installed Spotify version; missing images are omitted.


### Windows-first settings and artwork

The Discord companion is named **ListeningRPC**; the Spotify extension remains **SpicetifyRPC**. ListeningRPC defaults to Windows media and works without the extension. Its settings include a link to this SpicetifyRPC installation guide.

Windows mode offers activity types, text templates, playback time, album-art lookup, custom small images/GIFs and image swapping. Spotify-only controls (Spotify settings overrides, playlist artwork and exact Play song links) are hidden in Windows mode.

Windows album artwork is looked up through Apple's iTunes catalog using the title and artist, preferring the matching album. Enabling Show album artwork sends that metadata to Apple. Matching requires normalized title and artist equality; unmatched songs have no artwork. Matches are cached. This is online artwork, not the native Windows thumbnail.

Swap large and small images makes your custom image/GIF large and the album cover small in either mode. The default small image is None.

### Release verification

Desktop build, TypeScript and JavaScript syntax checks are run locally. Windows media reading and an artwork lookup have been exercised on this PC. Public Discord button visibility, GIF animation, restricted Spotify playlist artwork and non-Spotify player compatibility require live checks. The plugin works as a custom desktop build and is not included in official Vencord.
