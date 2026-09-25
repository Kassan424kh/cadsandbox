# CadSandbox Desktop & Mobile

Native shells wrap the same web build (`apps/web/dist`). Because CadSandbox is local-first (all
geometry and rendering run on the device), the native apps work fully offline and sync when online.

- **Tauri 2** (Windows, macOS, Linux, iOS, Android) — see `src-tauri/` (requires the Rust toolchain).
- **PWA** — the web app is installable from the browser today (Chrome/Edge/Safari "Install app").
