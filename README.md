# Spicetify Extensions

Two independent extensions by me!

<a href="PLAYING.md">
  <img src="assets/preview.gif" alt="Playing++ preview across 20 songs" width="420">
</a>

<a href="discord-rpc-plus/README.md">
  <img src="assets/discord-rpc-logo.png" alt="SpicetifyRPC" width="420">
</a>

| Extension | Features | Setup |
| --- | --- | --- |
| Playing++ | Release dates, clickable genres, liked/downloaded/explicit icons beside the artist | [Playing++ guide](PLAYING.md) |
| SpicetifyRPC | Song, artist, artwork, progress and a Play song button on Discord | [SpicetifyRPC guide](discord-rpc-plus/README.md) |

Install either extension from Spicetify Marketplace. SpicetifyRPC requires either its working custom Vencord companion or the standalone Node.js bridge. The companion is not yet included in official Vencord; official inclusion is being prepared. Marketplace installs only the Spotify extension.

## Development

Run `npm test` and `npm run check`. The bridge uses Node.js built-in modules only.
