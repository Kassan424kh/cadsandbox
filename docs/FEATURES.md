# CadSandbox — Feature Matrix

What architects, designers and makers need, and where CadSandbox covers it. Status: ✅ built ·
🧩 wave 2 (planned next) · 🔭 later. Everything runs on the user's device; the server only syncs.

## 1. Modelling (3D)
| Need | Status |
|---|---|
| Parametric primitives (box w/ rounded edges, sphere, cylinder, cone, torus, capsule, pyramid, wedge, tube, prism, plane, disc) | ✅ |
| Simple forms (circle, triangle, polygon, heart, star, arrow, cross, ring) extruded with bevel — Spline-style | ✅ |
| Free drawing (pen/Bézier) → extruded shape, push/pull (SketchUp-style) | ✅ |
| Revolve, loft, sweep | ✅ |
| Non-destructive booleans (union/subtract/intersect, WASM manifold kernel) | ✅ |
| Groups, components/instances (edit once, update everywhere, GPU instancing) | ✅ |
| Transform gizmos, direct drag, align/distribute, mirror, arrays (linear/polar) | ✅ |
| Precise input everywhere (`2400`, `2.4m`, `8' 6"`, `=1200*2`), snapping + inference guides | ✅ |
| 3D text | ✅ |
| Mesh import & editing as blocks (bake parametric → mesh) | ✅ |
| Fillets/chamfers on B-rep edges (OCCT) | 🔭 |

## 2. 2D drafting (AutoCAD-like)
| Need | Status |
|---|---|
| Line, polyline (with arcs), rectangle, circle, arc, ellipse, spline, text, leader | ✅ |
| Offset, trim, extend, fillet/chamfer, mirror, array | ✅ |
| Hatches (DIN ISO 128 / DIN 1356 conventions: concrete, reinforced concrete, masonry, insulation, earth, wood, steel, glass…) | ✅ |
| Dimensions: linear, aligned, angular, radius, diameter, arc length; architectural ticks | ✅ |
| Layers (color, lineweight, linetype, lock, print), default layer set | ✅ |
| Reference images / scanned plans as underlays for tracing | ✅ |
| Chain dimensions (Maßketten, incl. "Auto-dimension walls"), height markers (Höhenkoten, relative / NN), revision clouds, freehand markups (red Markup layer) | ✅ |
| Structural grid axes (Achsraster) with bubbles, snapping to axes/intersections, shown in plans and sections; north arrow + scale bar symbols (plans & PDF sheets) | ✅ |
| PDF underlay import (raster: chosen page + DPI, pdf.js bundled) + calibrate tool (two points → real distance) | ✅ (vector PDF 🔭) |

## 3. Architecture / BIM
| Need | Status |
|---|---|
| Levels/storeys with elevations & heights; per-level plan views | ✅ |
| Walls: thickness, height, justification, multi-layer build-ups, arcs, automatic L/T/X joins | ✅ |
| Doors (single, double, sliding, folding, pocket, garage, revolving) & windows (casement, tilt-turn, sliding, fixed, awning, hung, bay, skylight) hosted in walls | ✅ |
| Slabs/floors/ceilings/foundations with holes; roofs (flat, shed, gable, hip, mansard, gambrel, pyramid) | ✅ |
| Stairs (straight, L, U, spiral) with DIN 18065 riser/tread rule; railings; columns; beams | ✅ |
| Rooms with auto detection, names, numbers, DIN 277 usage, area/perimeter/volume stamps | ✅ |
| Furniture & fixtures library (living, bedroom, kitchen, bath, plants, people, cars) — parametric | ✅ |
| Terrain / site | ✅ (heightfield) |
| Plans with poché, door swings, window symbols, stair walking lines; sections; elevations | ✅ |
| Schedules: rooms, doors, windows, walls, DIN 277 area summary; CSV export | ✅ |
| Sheets/layouts with title block (Schriftfeld), scales 1:50/1:100/1:200, PDF export | ✅ |
| IFC 4 import & export (openBIM exchange with engineers) | ✅ |
| WoFlV living-area calc, BRI, GRZ/GFZ, DIN 276 cost estimate, U-values from wall layers (GEG) | ✅ (Analysis panel: DIN 277 per level, WoFlV with sampled clear heights, GRZ/GFZ/BMZ/storeys/height, editable DIN 276 prices, ISO 6946 U-values + HT′ vs. GEG reference; CSV + PDF) |
| Barrier-free checks (DIN 18040: door widths, turning circles), escape-route lengths | ✅ (+ DIN 18065 stairs, fall protection, room heights per LBO, 1/8 daylight; click-to-zoom findings) |
| Curtain walls, ceilings with grid, MEP basics | 🔭 |

## 4. Visualisation
| Need | Status |
|---|---|
| Render modes: shaded, realistic (path tracing), clay, wireframe, x-ray, hidden-line, technical | ✅ |
| PBR materials library with procedural textures; custom materials with texture upload | ✅ |
| Environments (studio, daylight, sunset, overcast, night, city) + custom HDRI | ✅ |
| Sun position by location/date/time with shadows (sun study) | ✅ |
| Section planes with caps | ✅ |
| Walk-through (first-person), saved views, high-res image export | ✅ |
| Animated sun study (play the doc's sun over a day, speed control), turntable / walkthrough video export (WebM via MediaRecorder), "View in VR" (WebXR immersive-vr, local-floor; shown only when supported), USDZ Quick Look | ✅ |

## 5. Files & exchange
Import: IFC, DXF, glTF/GLB, OBJ(+MTL), STL, PLY, 3MF, FBX, DAE, 3DM, STEP/IGES, SVG, images, native `.csb/.csbx`. ✅
Export: IFC, DXF, SVG, PDF (sheets), glTF/GLB, OBJ, STL, PLY, 3MF, USDZ, PNG, CSV, native. ✅
DWG: no permissively-licensed library exists (LibreDWG is GPL) — use DXF (AutoCAD opens/saves it natively). 🔭 (commercial SDK)

## 6. Projects & collaboration (CodeSandbox-like)
| Need | Status |
|---|---|
| Projects: create, open, rename, duplicate, move, star, trash/restore, delete; templates | ✅ |
| Workspace folders; project file tree with any file type (designs, textures, PDFs, models…) | ✅ |
| Local-first: works offline without an account; upload to cloud later | ✅ |
| Real-time multi-user editing, presence (avatars, cursors, selections), follow mode | ✅ |
| Sharing: invite by email with roles (view/comment/edit), links with expiry/password, public | ✅ |
| Organisations with members/roles and selected shared projects | ✅ |
| Comments pinned to 3D points/objects, replies, resolve | ✅ |
| Version history (auto + named), restore | ✅ |
| Personal collections: save objects/materials, drag & drop into any project | ✅ |
| Copy/paste between projects and apps (system clipboard) | ✅ |

## 7. Platform
| Need | Status |
|---|---|
| Runs in any modern browser; installable PWA; Tauri 2 desktop/mobile shells | ✅ (native builds need Rust toolchain) |
| Performance: render-on-demand, worker pool, WASM, BVH, instancing, adaptive resolution, quality tiers | ✅ |
| Dark & light themes, English & German UI | ✅ |
| Admin panel: users, orgs, projects (metadata), support tickets, audit log, announcements | ✅ |
| Support with user-granted, time-boxed project access | ✅ |
| Security: 2FA, passkeys, strict CSP, rate limits, audit log, encrypted storage option | ✅ |
| DSGVO/GDPR: EU hosting, no trackers/cookies banner needed, data export, account deletion, retention jobs, AVV/TOM/VVT templates | ✅ |
