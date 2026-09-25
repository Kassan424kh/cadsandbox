# CadSandbox Desktop & Mobile (Tauri 2)

The native apps wrap the same web build (`apps/web/dist`). CadSandbox is local-first — modelling,
rendering, import/export all run on the device — so the native apps work fully offline; cloud
features (sync, sharing, collaboration) talk to the configured API origin (`https://cadsandbox.com`).

## Prerequisites
- Rust toolchain (`rustup`), plus platform SDKs (Xcode for macOS/iOS, Android Studio + NDK for Android,
  WebView2 on Windows — preinstalled on Windows 11).
- `corepack pnpm --filter @cadsandbox/desktop add -D @tauri-apps/cli@^2`

## Commands
```bash
corepack pnpm --filter @cadsandbox/desktop icons   # generate icons from apps/web/public/icon-1024.png
corepack pnpm --filter @cadsandbox/desktop dev     # desktop dev window (starts the web dev server)
corepack pnpm --filter @cadsandbox/desktop build   # installers: .dmg/.app, .msi/.exe, .deb/.AppImage/.rpm
corepack pnpm --filter @cadsandbox/desktop tauri ios init && … tauri ios build
corepack pnpm --filter @cadsandbox/desktop tauri android init && … tauri android build
```

## Notes
- Cross-origin isolation headers (COOP/COEP) are set in `tauri.conf.json` so multithreaded WASM works.
- For cloud login from the native app the server must allow the app origin (`tauri://localhost`,
  `http://tauri.localhost`) in `TRUSTED_ORIGINS` and issue `SameSite=None; Secure` cookies for it.
- Without Rust installed, users can still install the web app as a PWA (browser "Install app").
