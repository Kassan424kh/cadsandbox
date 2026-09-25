# CadSandbox — Architecture

CadSandbox is "CodeSandbox for CAD": a browser-first, local-first, real-time collaborative CAD and
architecture studio with Spline-like ease of use. **All geometry and rendering run on the user's
device** (TypeScript + WASM + WebGL2 in workers). The server is optional and only stores accounts,
projects, blobs and relays CRDT updates.

## Principles

1. **The document is the source of truth.** A Yjs CRDT holds the *recipe* (scene tree, params,
   materials, layers, sheets) — never tessellated meshes. Every client re-evaluates geometry locally.
2. **Local-first.** Everything works offline without an account (IndexedDB). Signing in adds cloud
   sync, sharing, collaboration, organisations. Same code paths for both.
3. **Performance by default.** Render-on-demand (no frames when nothing changes), geometry in a
   worker pool, BVH picking, GPU instancing for components, static node geometry and feature edges
   merged into a few BatchedMesh multi-draw batches (per-instance matrix/visibility; selected nodes
   are pulled out for outlines), adaptive resolution while navigating,
   progressive path tracing only when idle, lazy-loaded WASM for heavy formats.
4. **Privacy by design (DSGVO/GDPR).** No third-party requests at all (fonts, wasm, icons are
   self-hosted; cross-origin isolation enforces it), no tracking, only a strictly-necessary session
   cookie, EU hosting, data export + deletion built in, admin access to content only with the user's
   time-boxed consent, audit log of privileged actions.
5. **Simple first, precise when needed.** Big labelled tools, drag-and-drop library, smart defaults
   and snapping; exact numeric input (type `2400`, `2.4m`, `8' 6"`, `=1200*2`) for pros.

## Monorepo

| Path | Package | Role |
|---|---|---|
| `packages/shared` | `@cadsandbox/shared` | units + parsing/formatting, roles/permissions, HTTP API contract (DTOs, zod schemas, route table), collab doc names |
| `packages/doc` | `@cadsandbox/doc` | CRDT document model: `CadDocument` (design file), `ProjectManifest` (file tree), schema types, defaults, built-in materials, transform math, snapshots (clipboard/library) |
| `packages/geometry` | `@cadsandbox/geometry` | Geometry engine: parametric solids, 2D profiles/extrusions, revolve/loft/sweep, booleans (manifold-3d WASM), architecture elements (walls with joins + openings, slabs, roofs, stairs, columns, beams, railings, rooms, furniture), 2D drafting entities, plan symbology, dimensions, schedules, worker pool + cache |
| `packages/render` | `@cadsandbox/render` | Editor engine: three.js WebGL2 viewports, materials + procedural textures, render modes, path tracing, picking, selection, gizmos, snapping, all interactive tools, overlays, presence, command registry |
| `packages/io` | `@cadsandbox/io` | Import/export: glTF/GLB, OBJ, STL, PLY, 3MF, FBX, DAE, 3DM, STEP/IGES (import), IFC (import+export), DXF (import+export), SVG, PDF sheets, PNG, CSV schedules, `.csb`/`.csbx` native |
| `apps/web` | `@cadsandbox/web` | React app: dashboard (projects, folders, orgs, trash, templates), editor chrome, library/collections, sharing, settings, privacy center, admin panel, PWA |
| `apps/server` | `@cadsandbox/server` | Node 22 + Hono + better-auth + Drizzle (Postgres; PGlite in dev) + Hocuspocus (Yjs collab) + blob storage (disk/S3) |
| `apps/desktop` | — | Tauri 2 shell (desktop + mobile) around the web build |

Workspace packages export TypeScript source (`"exports": "./src/index.ts"`); Vite and esbuild
compile them — there is no per-package build step. Type-check with `pnpm typecheck`.

## Conventions (all packages)

- **Units:** meters, float64. **Z-up**, right-handed; plan plane = XY. Display units are a doc
  preference (`meta.units`) and only converted at the UI boundary (`@cadsandbox/shared` units).
- **Angles:** radians unless a field name ends in `Deg`.
- **Scene tree:** flat `nodes` map with `parent` + fractional `order`. Levels (storeys) are nodes
  of type `level`; elevation = `t.p[2]`; everything on a storey is its descendant.
- **Openings** (doors/windows) are children of their host wall; placement = `params.offset` along
  the wall axis (node transform ignored).
- **Components**: definitions live under the hidden parent `DEFS_ROOT`; `instance` nodes reference
  `params.component`. The renderer instances them on the GPU.
- **Materials:** `node.material` (id of a doc or built-in material, `mat-*`) + optional
  `node.color` tint. Built-ins use procedural textures generated on the client (no downloads).
- **Writes** go through `CadDocument` methods (transactions tagged `LOCAL_ORIGIN` → per-user undo).
  Use `SILENT_ORIGIN` for derived updates that must not enter undo. During drags, call
  `doc.stopCapturing()` at start and end so one drag = one undo step.
- **Reads** return cached plain objects — never mutate them.
- **Blobs** (textures, imported meshes, images, files) are content-addressed by sha256 hex.

## Data flow

```
 user input ─▶ Editor tools ─▶ CadDocument (Yjs) ─┬─▶ GeometryService (worker pool) ─▶ results ─▶ Editor scene sync ─▶ WebGL2
                                                   ├─▶ y-indexeddb (offline persistence)
                                                   └─▶ Hocuspocus provider ─▶ server ─▶ other clients
```

## Collaboration

- One Yjs doc per project manifest (`project:{projectId}`) and one per design file
  (`file:{projectId}:{fileId}`), see `docNames` in `@cadsandbox/shared`.
- Awareness carries presence: user (name/color), selection, active tool, 3D cursor, camera, file.
- The server authorizes each doc connection by the caller's project role (viewer = read-only).

## Security & GDPR summary

See `docs/SECURITY.md` and `docs/gdpr/` for details: argon2/scrypt password hashing via
better-auth, 2FA (TOTP) + passkeys, HttpOnly/Secure/SameSite cookies, CSRF-safe design, strict CSP,
rate limiting, input validation (zod), sha256-verified content-addressed uploads with size quotas,
audit log, IP truncation, retention jobs (trash 30 days, deletion grace 7 days, audit 365 days),
data export (ZIP) and account deletion, support access only via user-granted time-boxed consent.
