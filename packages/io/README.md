# @cadsandbox/io

Client-side import/export for CadSandbox. Every loader and WASM module (web-ifc, occt-import-js,
rhino3dm, Draco) is self-hosted via Vite `?url` assets and loaded on first use — no CDN, no
third-party request.

```ts
import { importFile, importFiles, insertImportResult, exportFile, exportSheetPdf } from '@cadsandbox/io'

const result = await importFiles(droppedFiles, { onProgress })       // OBJ+MTL+textures, glTF+.bin …
for (const a of result.assets) await assets.put(a.bytes, a.mime)     // blobs are content-addressed
insertImportResult(doc, result, { levelId })                         // merges layers, places on the level

const { blob, fileName } = await exportFile({ doc, geometry, assets, editor }, 'ifc')
```

Register the renderer's scene builder once (`setExportSceneBuilder(buildExportScene)`); without it
io imports it lazily from `@cadsandbox/render`, and falls back to its own builder (no baked
procedural textures) if that fails.

## Import

| Format | Notes |
|---|---|
| glTF / GLB | Draco + meshopt, PBR (transmission, clearcoat, sheen, emissive), original texture bytes, instancing → components |
| OBJ (+MTL) | drop the .mtl and textures together; PBR MTL extensions (Pr/Pm) |
| STL, PLY | unitless → millimeters (STL) / meters (PLY) unless `units`; PLY point clouds unsupported |
| 3MF, FBX, DAE | units from the file; FBX/DAE external textures via multi-file drop |
| 3DM | meshes, Brep/Extrusion render meshes (saved in the file), SubD, planar curves, blocks, layers, materials |
| STEP / IGES / BREP | OpenCASCADE tessellation in a worker; assemblies → groups, face colors kept |
| IFC | storeys → levels, straight rectangular walls → parametric walls with door/window openings, spaces → rooms, the rest → meshes; GlobalId, type, material and property sets in `meta.ifc` |
| DXF | lines, (LW)polylines with bulges, circles, arcs, ellipses, splines, text/MTEXT, hatches (incl. arc/spline boundaries, holes), blocks → components, dimensions, 3DFACE/polyface meshes; layers with color, linetype, lineweight; `$INSUNITS` |
| SVG | filled paths → flat shapes (holes kept), strokes → polylines/splines; exact Béziers |
| PNG / JPEG / WebP | underlay at 1 px = 1 cm unless `units` |
| .csb / .csbx | native design JSON / project archive |

**DWG is not supported**: no DWG library exists under a permissive license. Save the drawing as
DXF in your CAD application (AutoCAD: *Save As → DXF*; BricsCAD/DraftSight/LibreCAD likewise).

## Export

| Format | Notes |
|---|---|
| GLB / glTF / USDZ | Y-up, meters, embedded textures (USDZ for iOS AR Quick Look) |
| OBJ | zip with .obj + .mtl + textures, Y-up |
| STL / PLY | binary, Z-up; STL in millimeters, PLY in meters by default |
| 3MF | millimeters, welded meshes, per-object colors |
| IFC4 | storeys, walls (swept solids + openings + doors/windows), slabs with holes, spaces with quantities, roofs/stairs/columns/beams/railings/furniture/proxies as triangulated face sets, materials + colors, Pset_*Common; stable GlobalIds |
| DXF | AutoCAD 2018; layers (true color, lineweight, linetype), bulged polylines, hatches with embedded patterns, true DIMENSION entities with block graphics |
| SVG / PDF | plan at 1:scale; PDF layout sheets with frame, title block (Leistungsphase), scale bar, north arrow |
| PNG, CSV, .csb, .csbx | screenshot, schedules (UTF-8 BOM, `;` = German Excel), design JSON, project archive |

Hatch scale follows the geometry engine (model space, base unit 0.1 m: ANSI31 lines 0.1 m apart at
scale 1); DXF pattern scales are converted so the physical spacing is preserved both ways.
DRACO decoding runs in a blob-URL worker (three.js design): allow `worker-src blob:` in the CSP.
