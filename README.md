# CadSandbox

**Design, draft and build together — right in your browser.** A local-first, real-time
collaborative CAD & architecture studio. All modelling and rendering run on your device (WebGL2 +
WASM); the optional server only syncs, stores and shares.

- 3D modelling (parametric primitives, extrusions, booleans, revolve/loft/sweep) and 2D drafting
- Architecture: levels, walls, doors, windows, slabs, roofs, stairs, rooms & areas (DIN 277), schedules, sections, sheets
- Realistic rendering (PBR, procedural textures, path tracing), drag-and-drop libraries & collections
- Import/export: IFC, DXF, glTF, OBJ, STL, 3MF, FBX, 3DM, STEP (import), SVG, PDF, PNG, CSV
- Projects, folders, sharing, organisations, real-time multiplayer, version history
- Admin panel, privacy center, GDPR/DSGVO by design

## Develop

```bash
corepack pnpm install
corepack pnpm dev          # web on :5173, server on :8787
corepack pnpm typecheck
corepack pnpm test
```

Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
