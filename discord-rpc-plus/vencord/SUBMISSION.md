# SpicetifyRPC build and submission notes

Built against Vencord commit: 795ed0ff5b7e6b8db7488d0fcc95512a58edc919

The desktop build contains SpicetifyRPC. Source lives under discord-rpc-plus/vencord in the extension repository. Copy that folder to src/userplugins/spicetifyRPC.desktop for local development. For upstream review, use src/plugins/spicetifyRPC.desktop.

Install the custom build through Vencord's documented source-build installer (`pnpm inject` from the build checkout). The custom build has been installed and used locally. Enable SpicetifyRPC and disable the separate bridge before testing; both bind 127.0.0.1:6473.

Validation completed: pnpm build --dev, pnpm test:ts, local HTTP receiver tests (valid song, clear, rejected malformed JSON, unsupported method, artwork URL filtering).

Before submission: replace the placeholder author Discord ID (0n) with your actual Discord user ID. Test live activity, artwork, Play song button from another account, pause, resume, seek, Discord restart and plugin disable. Current live-profile validation is pending. This is a development build, not an official Vencord release. No upstream PR has been opened.

The plugin uses Discord's embedded native environment and requires no separate Node process at runtime. Vencord source builds still require development tooling.
