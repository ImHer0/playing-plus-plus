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
