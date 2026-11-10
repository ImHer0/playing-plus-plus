# ListeningRPC submission notes

ListeningRPC is the Vencord companion; SpicetifyRPC is the optional Spotify extension.

Place index.ts and native.ts in src/userplugins/listeningRPC.desktop for local builds, or src/plugins/listeningRPC.desktop for upstream review. Author: ImHer0, Discord ID 1401294711041429679.

Build: pnpm build --dev --standalone. Type check: pnpm test:ts. Windows support uses built-in Windows PowerShell and Windows media sessions. Online artwork lookup sends title and artist to Apple's iTunes Search API. No separate Node runtime is needed for users of an installed custom desktop build.

Not included in official Vencord. No upstream PR has been created by this tooling. Human review and live cross-account profile checks remain necessary before submission. See ../README.md for settings, privacy behaviour and limitations.
