# Editor i18n keys (src/editor)

Maintained by the editor-chrome engineer. Every user-facing string goes through `t(key, 'English fallback', vars?)`;
the fallback is the English source text — add translations for these keys to the app-shell dictionaries.
Placeholders use `{name}` syntax.

Static keys: 617. Dynamic key families (built from data) are listed at the end.

| Key | English fallback |
|---|---|
| `action.boolean` | Boolean |
| `action.booleanTip` | Combine solids |
| `action.component` | Component |
| `action.delete` | Delete |
| `action.duplicate` | Duplicate |
| `action.group` | Group |
| `action.hide` | Hide |
| `action.isolate` | Isolate |
| `action.lock` | Lock |
| `action.redo` | Redo |
| `action.render` | Render |
| `action.renderStop` | Stop realistic rendering · {s}/{n} samples |
| `action.renderTip` | Realistic path-traced preview |
| `action.undo` | Undo |
| `action.ungroup` | Ungroup |
| `action.unisolate` | Show all |
| `action.unlock` | Unlock |
| `action.walk` | Walk |
| `action.walkTip` | Walk through the model (WASD) |
| `bg.color` | Color |
| `bg.environment` | Environment |
| `bg.gradient` | Gradient |
| `bg.transparent` | Transparent |
| `boolean.intersect` | Intersect |
| `boolean.subtract` | Subtract |
| `boolean.union` | Union |
| `collections.collection` | Collection |
| `collections.confirmDelete` | Delete this collection and its items? |
| `collections.defaultName` | My collection |
| `collections.delete` | Delete collection |
| `collections.empty` | No collections yet |
| `collections.emptyHint` | Right-click objects → "Save to collection", or create one here. |
| `collections.item` | Name |
| `collections.itemName` | {count} objects |
| `collections.namePrompt` | Collection name |
| `collections.new` | New collection |
| `collections.newPlaceholder` | New collection name |
| `collections.noItems` | Empty — select objects and use "Save to collection". |
| `collections.none` | No collections yet |
| `collections.orNew` | Or new |
| `collections.pick` | Pick a collection |
| `collections.removeItem` | Remove from collection |
| `collections.saveDesc` | Reuse this selection in any project. Referenced textures travel with it. |
| `collections.saveTitle` | Save to collection |
| `collections.saved` | Saved to collection |
| `collections.tags` | Tags |
| `collections.tagsHint` | Comma separated |
| `collections.unavailable` | Collections need an account |
| `collections.unavailableHint` | Sign in to save objects and materials into reusable collections. |
| `color.clear` | Remove color override |
| `color.label` | Color |
| `color.more` | More colors |
| `color.none` | No tint |
| `command.align.centerX` | Align center (X) |
| `command.align.centerY` | Align center (Y) |
| `command.align.maxX` | Align right (X) |
| `command.align.maxY` | Align back (Y) |
| `command.align.maxZ` | Align top (Z) |
| `command.align.minX` | Align left (X) |
| `command.align.minY` | Align front (Y) |
| `command.align.minZ` | Align bottom (Z) |
| `command.distribute.x` | Distribute X |
| `command.distribute.y` | Distribute Y |
| `command.distribute.z` | Distribute Z |
| `command.object.unhideAll` | Unhide all |
| `command.transform.dropToFloor` | Drop to floor |
| `command.transform.mirrorX` | Mirror X |
| `command.transform.mirrorY` | Mirror Y |
| `command.transform.mirrorZ` | Mirror Z |
| `command.transform.reset` | Reset transform |
| `command.transform.rotate90` | Rotate 90° |
| `comments.add` | Add comment (click in the model) |
| `comments.addShort` | Add comment |
| `comments.confirmDelete` | Delete this comment thread? |
| `comments.filter` | Filter comments |
| `comments.new` | New comment |
| `comments.none` | No open comments |
| `comments.noneHint` | Pin a comment to any point of the model to discuss it with your team. |
| `comments.noneResolved` | Nothing resolved yet |
| `comments.open` | Open ({n}) |
| `comments.openPin` | Comment by {name} |
| `comments.placeholder` | Write a comment… (Mod+Enter to post) |
| `comments.post` | Post |
| `comments.reopen` | Re-open |
| `comments.reply` | Reply |
| `comments.replyPlaceholder` | Reply… |
| `comments.resolve` | Resolve |
| `comments.resolved` | Resolved ({n}) |
| `common.cancel` | Cancel |
| `common.clear` | Clear |
| `common.create` | Create |
| `common.delete` | Delete |
| `common.mixed` | Mixed |
| `common.none` | None |
| `common.remove` | Remove |
| `common.rename` | Rename |
| `common.save` | Save |
| `ctx.align` | Align & distribute |
| `ctx.comment` | Add comment |
| `ctx.copy` | Copy |
| `ctx.cut` | Cut |
| `ctx.editGroup` | Edit group |
| `ctx.measure` | Measure |
| `ctx.paste` | Paste |
| `ctx.saveToCollection` | Save to collection… |
| `ctx.selectAll` | Select all |
| `ctx.transform` | Transform |
| `ctx.zoomExtents` | Zoom extents |
| `ctx.zoomSelection` | Zoom to selection |
| `dnd.dropFiles` | Drop to import |
| `dnd.dropItem` | Drop to place |
| `dnd.dropMaterialOnObject` | Drop a material onto an object to apply it |
| `dnd.materialAdded` | Material "{name}" added to this document |
| `dnd.materialApplied` | Material applied |
| `docSettings.analysis` | Analysis |
| `docSettings.angle` | Angles |
| `docSettings.ao` | Ambient occlusion |
| `docSettings.area` | Areas |
| `docSettings.background` | Background |
| `docSettings.bgColor` | Color |
| `docSettings.envIntensity` | Light intensity |
| `docSettings.envRotation` | Env. rotation |
| `docSettings.environment` | Environment |
| `docSettings.exposure` | Exposure |
| `docSettings.geo` | Location |
| `docSettings.geoEnabled` | Geo-located |
| `docSettings.grid` | Grid |
| `docSettings.gridSize` | Major cell |
| `docSettings.gridSnap` | Snap to grid |
| `docSettings.gridSub` | Subdivisions |
| `docSettings.gridVisible` | Visible |
| `docSettings.kicker` | Document |
| `docSettings.latitude` | Latitude |
| `docSettings.length` | Length |
| `docSettings.longitude` | Longitude |
| `docSettings.name` | Document name |
| `docSettings.neutral` | Neutral |
| `docSettings.north` | True north |
| `docSettings.precision` | Decimals |
| `docSettings.render` | Rendering |
| `docSettings.schedules` | Schedules & quantities |
| `docSettings.shadows` | Shadows |
| `docSettings.sun` | Sun |
| `docSettings.sunDate` | Date |
| `docSettings.sunEnabled` | Sun light |
| `docSettings.sunHour` | Time |
| `docSettings.sunIntensity` | Intensity |
| `docSettings.timezone` | Time zone |
| `docSettings.title` | Document settings |
| `docSettings.toneMapping` | Tone mapping |
| `docSettings.units` | Units & precision |
| `editor.back` | Back to projects |
| `editor.colorBar` | Quick colors |
| `editor.designTooLarge` | This design reached the size limit and is read-only. Split it into several design files or remove large imported objects. |
| `editor.dialogFailed` | This dialog is not available right now |
| `editor.error.back` | Back to projects |
| `editor.error.noFile` | This project has no design file yet. |
| `editor.error.title` | Could not open this design |
| `editor.history` | History |
| `editor.leftRail` | Panels |
| `editor.loading` | Opening design… |
| `editor.modes` | Modes |
| `editor.newMenu` | New |
| `editor.objectActions` | Object actions |
| `editor.panelTabs` | Panel tabs |
| `editor.presentation` | Presentation |
| `editor.projectMenu` | Project menu |
| `editor.readOnlyDevice` | Editing needs a larger screen — open this project on a tablet or computer to change it. |
| `editor.readOnlyHint` | You have view access — ask the owner for edit rights to change this design. |
| `editor.renameFile` | Design name |
| `editor.resizePanel` | Resize panel |
| `editor.shareMenu` | Share & export |
| `editor.stage` | Design canvas |
| `editor.storageFullMember` | The owner’s storage is full, so this project is read-only until they free up space. |
| `editor.storageFullOwner` | Your storage is full, so this project is read-only. Delete files or projects you no longer need to keep editing. |
| `editor.toolOptions` | Tool options |
| `editor.viewOnly` | View only |
| `editor.viewOnlyDevice` | Editing needs a larger screen |
| `engine.reload` | Reload |
| `engine.unavailableLoad` | The 3D engine could not be loaded. Check your connection and reload the page. |
| `engine.unavailableStill` | Panels and document editing still work. Exports that need the 3D view are paused. |
| `engine.unavailableTitle` | 3D view unavailable |
| `engine.unavailableWebgl` | Your browser could not start WebGL 2, which the 3D view needs. Turn on hardware acceleration in the browser settings, update your graphics driver, or use a current Chrome, Edge, Firefox or Safari. |
| `files.cannotDeleteOpen` | Switch to another design before deleting this one |
| `files.confirmDelete` | Delete "{name}"{extra}? It moves to the project trash. |
| `files.duplicate` | Duplicate |
| `files.empty` | No files |
| `files.emptyHint` | Create a design or upload reference files. |
| `files.newDesign` | New design |
| `files.newDesignHere` | New design here |
| `files.newDesignName` | Untitled design |
| `files.newFolder` | New folder |
| `files.newFolderHere` | New folder here |
| `files.newFolderName` | New folder |
| `files.open` | Open |
| `files.openDesign` | Open |
| `files.preview` | Preview |
| `files.upload` | Upload files |
| `files.uploadHere` | Upload here |
| `files.uploaded` | {count} file(s) uploaded |
| `inspector.appearance` | Appearance |
| `inspector.color` | Color tint |
| `inspector.editOnCanvas` | Edit on canvas |
| `inspector.id` | Id |
| `inspector.layer` | Layer |
| `inspector.level` | Level |
| `inspector.material` | Material |
| `inspector.mixedTypes` | Select objects of one type to edit their parameters together. |
| `inspector.multi` | {count} objects · {types} |
| `inspector.name` | Name |
| `inspector.noLevel` | Outside levels |
| `inspector.noParams` | No parameters for this type. |
| `inspector.noQuantities` | Quantities appear once geometry is evaluated. |
| `inspector.open` | Properties |
| `inspector.openingPlacement` | Openings are positioned along their wall — use "Position along wall" below. |
| `inspector.organization` | Organisation |
| `inspector.params` | {type} parameters |
| `inspector.pathSummary` | {contours} contours · {points} points |
| `inspector.pointsSummary` | {count} points |
| `inspector.quantities` | Quantities |
| `inspector.title` | Properties |
| `inspector.transform` | Transform |
| `io.csbxFromDashboard` | Project archives (.csbx) open as a new project — import them on the dashboard. |
| `io.designImported` | Design "{name}" added to the project |
| `io.exportNotReady` | Export to {format} is not available yet |
| `io.exported` | Exported {name} |
| `io.exporting` | Exporting {format}… |
| `io.imageInserted` | Image placed as reference |
| `io.imported` | Imported {name} · {count} objects |
| `io.importing` | Importing {name}… |
| `io.notReady` | Import for {format} is not available yet |
| `io.unsupported` | Unsupported file: {name} |
| `layers.add` | Add layer |
| `layers.assignSelection` | Assign selection |
| `layers.color` | Layer color |
| `layers.hide` | Hide layer |
| `layers.lineType` | Line type |
| `layers.lineWeight` | Line weight |
| `layers.lock` | Lock layer |
| `layers.meta` | {count} objects · {weight} mm · {type} |
| `layers.newName` | Layer {n} |
| `layers.noPrint` | Exclude from print |
| `layers.print` | Include in print |
| `layers.printable` | Printable |
| `layers.selectObjects` | Select objects on layer |
| `layers.show` | Show layer |
| `layers.unlock` | Unlock layer |
| `level.defaultName` | Level {n} |
| `levels.add` | Add level above |
| `levels.addFirst` | Add ground floor |
| `levels.confirmDelete` | Delete this level and its {count} objects? |
| `levels.cutHeight` | Plan cut |
| `levels.duplicate` | Duplicate level above |
| `levels.elevation` | Elevation |
| `levels.empty` | No levels |
| `levels.emptyHint` | Levels organise a building into storeys. Plans are cut per level. |
| `levels.height` | Height |
| `levels.hide` | Hide level |
| `levels.meta` | {elev} · h {height} · {count} objects |
| `levels.setActive` | Set active |
| `levels.show` | Show level |
| `levels.zoom` | Zoom to level |
| `library.archToolsHint` | Walls, doors, windows, slabs, roofs, stairs and rooms are drawn with the Build tools in the top bar. |
| `library.group.archTools` | Building elements |
| `library.group.lights` | Lights |
| `library.group.structure` | Structure & site |
| `library.itemTip` | {label} — click to place, or drag onto the canvas |
| `library.readOnly` | View-only access |
| `library.readOnlyHint` | Ask for edit rights to add objects. |
| `library.search` | Search library… |
| `library.tab.collections` | My collections |
| `library.tab.furniture` | Furniture |
| `library.tab.materials` | Materials |
| `library.tab.shapes` | Shapes |
| `library.tab.structure` | Structure |
| `lineType.center` | Center |
| `lineType.continuous` | Continuous |
| `lineType.dashdot` | Dash-dot |
| `lineType.dashed` | Dashed |
| `lineType.dotted` | Dotted |
| `lineType.hidden` | Hidden |
| `material.applySelection` | Apply to selection |
| `material.applyTip` | Apply {name} to the selection · drag onto an object |
| `material.category` | Category |
| `material.clearcoat` | Clearcoat |
| `material.color` | Base color |
| `material.created` | Material created |
| `material.default` | Default |
| `material.defaultNamed` | Default · {name} |
| `material.documentMaterials` | This document |
| `material.doubleSided` | Double sided |
| `material.dragTip` | Drag {name} onto an object |
| `material.duplicateEdit` | Duplicate & edit |
| `material.edit` | Edit |
| `material.editTitle` | Edit material |
| `material.emissive` | Emissive |
| `material.emissiveIntensity` | Emissive intensity |
| `material.hatch` | Plan hatch |
| `material.ior` | IOR |
| `material.mapColor` | Color map |
| `material.mapNormal` | Normal map |
| `material.mapRoughness` | Roughness map |
| `material.metalness` | Metalness |
| `material.name` | Name |
| `material.new` | New material |
| `material.newName` | New material |
| `material.newTitle` | New material |
| `material.opacity` | Opacity |
| `material.pick` | Material: {name} |
| `material.previewHint` | Preview is approximate; the viewport renders the full PBR material. |
| `material.proceduralGroup` | Procedural |
| `material.roughness` | Roughness |
| `material.saved` | Material saved |
| `material.search` | Search materials… |
| `material.selectFirst` | Select an object first, or drag the material onto one |
| `material.sheen` | Sheen |
| `material.tile` | Tile size |
| `material.tileH` | Tile height |
| `material.tileHint` | World-space size of one texture repeat |
| `material.tileW` | Tile width |
| `material.transmission` | Transmission |
| `material.upload` | Upload image |
| `material.uploadedImage` | Uploaded image |
| `material.useDefault` | Type default ({name}) |
| `material.useDefaultGeneric` | Type default |
| `menu.add.hint` | Click to place · drag from the Library for more |
| `menu.add.lightsStructure` | Lights & structure |
| `menu.add.objects3d` | 3D objects |
| `menu.add.simpleForms` | Simple forms |
| `menu.annotate.measureAnnotate` | Measure & annotate |
| `menu.build.addLevel` | + Level |
| `menu.build.addLevelTip` | Add a storey above the top level |
| `menu.build.elements` | Building elements |
| `menu.build.hint` | Doors and windows snap into walls |
| `menu.draw.hint` | Type exact lengths while drawing |
| `menu.draw.sketch` | Sketch |
| `menu.io.downloadDesign` | Download design file |
| `menu.io.downloadProject` | Download project archive |
| `menu.io.export2d` | Drawings & data |
| `menu.io.export3d` | 3D |
| `menu.io.import` | Import… |
| `menu.io.renderImage` | Render image… |
| `menu.modify.tools` | Modify |
| `menu.new.design` | New design file |
| `menu.new.import` | Import file… |
| `menu.project.current` | Current |
| `menu.project.duplicateFile` | Duplicate file |
| `menu.project.duplicated` | File duplicated |
| `menu.project.help` | Get help |
| `menu.project.legal` | Imprint & privacy |
| `menu.project.newDesign` | New design |
| `menu.project.noFiles` | No other designs |
| `menu.project.rename` | Rename |
| `menu.project.settings` | Document settings |
| `menu.project.shortcuts` | Keyboard shortcuts |
| `menu.project.switchFile` | Switch file |
| `menu.project.theme` | Theme |
| `menu.project.versions` | Version history |
| `mode.add` | Add |
| `mode.annotate` | Annotate |
| `mode.build` | Build |
| `mode.draw` | Draw |
| `mode.modify` | Modify |
| `mode.select` | Select |
| `onboarding.add.body` | Simple forms, 3D objects, lights — pick one and click on the canvas to place it. Drag to size, type a number for precision. |
| `onboarding.add.title` | Add anything in one click |
| `onboarding.build.body` | Walls join automatically, doors and windows snap into them, rooms compute their DIN 277 areas. Every level gets a plan view. |
| `onboarding.build.title` | Build like an architect |
| `onboarding.done` | Start designing |
| `onboarding.engineUnavailable` | 3D view unavailable |
| `onboarding.library.body` | Furniture, materials and your own collections drop straight onto the canvas — materials onto objects. |
| `onboarding.library.title` | Drag from the Library |
| `onboarding.next` | Next |
| `onboarding.palette.body` | Press |
| `onboarding.palette.body2` | for the command palette and |
| `onboarding.palette.body3` | for all shortcuts. |
| `onboarding.palette.title` | Everything is a keystroke away |
| `onboarding.skip` | Skip |
| `onboarding.step` | Tip {n} of {total} |
| `outliner.empty` | Nothing here yet |
| `outliner.emptyHint` | Add shapes, draw walls or drop items from the Library. |
| `outliner.hide` | Hide |
| `outliner.lock` | Lock |
| `outliner.noMatches` | No objects match |
| `outliner.search` | Search objects… |
| `outliner.show` | Show |
| `outliner.unlock` | Unlock |
| `palette.add` | Add |
| `palette.appearance` | Appearance & help |
| `palette.commands` | Commands |
| `palette.empty` | No results |
| `palette.files` | Files |
| `palette.navigate` | navigate |
| `palette.panels` | Panels |
| `palette.place` | Place |
| `palette.placeholder` | Type a command, tool or object… |
| `palette.run` | run |
| `palette.title` | Command palette |
| `palette.tools` | Tools |
| `panel.comments` | Comments |
| `panel.files` | Files |
| `panel.layers` | Layers |
| `panel.levels` | Levels |
| `panel.library` | Library |
| `panel.scene` | Scene |
| `panel.schedules` | Schedules |
| `panel.sheets` | Sheets |
| `panel.views` | Views |
| `presence.usingTool` | using {tool} |
| `render.clay` | Clay |
| `render.hiddenLine` | Hidden line |
| `render.realistic` | Realistic |
| `render.shaded` | Shaded |
| `render.technical` | Technical |
| `render.wireframe` | Wireframe |
| `render.xray` | X-ray |
| `renderImage.custom` | Custom |
| `renderImage.desc` | Export a high-resolution PNG of a viewport. Realistic mode path-traces until the sample count is reached. |
| `renderImage.done` | Image saved |
| `renderImage.height` | Height |
| `renderImage.pixels` | Pixels |
| `renderImage.realistic` | Realistic |
| `renderImage.render` | Render PNG |
| `renderImage.rendering` | Rendering… |
| `renderImage.samples` | Samples |
| `renderImage.samplesHint` | More samples → less noise, longer render. |
| `renderImage.size` | Size |
| `renderImage.title` | Render image |
| `renderImage.transparent` | Transparent |
| `renderImage.viewport` | Viewport |
| `renderImage.width` | Width |
| `schedule.areas` | Areas (DIN 277) |
| `schedule.bgf` | Gross floor area (BGF) |
| `schedule.bri` | Gross volume (BRI) |
| `schedule.col.area` | Area |
| `schedule.col.height` | Height |
| `schedule.col.length` | Length |
| `schedule.col.level` | Level |
| `schedule.col.material` | Material |
| `schedule.col.name` | Name |
| `schedule.col.netArea` | Net area |
| `schedule.col.number` | No. |
| `schedule.col.sill` | Sill |
| `schedule.col.style` | Style |
| `schedule.col.thickness` | Thickness |
| `schedule.col.usage` | Usage |
| `schedule.col.volume` | Volume |
| `schedule.col.wall` | Wall |
| `schedule.col.width` | Width |
| `schedule.computing` | Computing… |
| `schedule.counts` | Rooms · Doors · Windows |
| `schedule.doors` | Doors |
| `schedule.exportCsv` | Export CSV |
| `schedule.exportCsvLong` | Export {kind} as CSV |
| `schedule.fallbackNote` | Computed from document parameters; geometry-accurate quantities arrive with the geometry engine. |
| `schedule.noAreas` | Areas appear once rooms exist. |
| `schedule.noOpenings` | No {kind} yet. |
| `schedule.noRooms` | No rooms yet — use Build › Room. |
| `schedule.noWalls` | No walls yet — use Build › Wall. |
| `schedule.nrf` | Net floor area (NRF) |
| `schedule.refresh` | Recompute |
| `schedule.rooms` | Rooms |
| `schedule.walls` | Walls |
| `schedule.windows` | Windows |
| `share.signInHint` | Sign in to share this project and collaborate live |
| `sheets.addPlanQuick` | Add plan of first level |
| `sheets.addViewport` | + Add |
| `sheets.createFirst` | Create a sheet |
| `sheets.duplicate` | Duplicate |
| `sheets.edit` | Edit sheet |
| `sheets.empty` | No sheets yet |
| `sheets.emptyHint` | Compose plans, sections, elevations and 3D views on paper sizes with a title block, then export PDF. |
| `sheets.exportPdf` | Export PDF |
| `sheets.group.elevations` | Elevations |
| `sheets.group.plans` | Plans |
| `sheets.group.schedules` | Schedules |
| `sheets.group.sections` | Sections |
| `sheets.group.views` | 3D views |
| `sheets.landscape` | Landscape |
| `sheets.name` | Name |
| `sheets.new` | New sheet |
| `sheets.noViewports` | Add a plan, section, elevation or 3D view. |
| `sheets.number` | Number |
| `sheets.orientation` | Orientation |
| `sheets.paper` | Paper |
| `sheets.portrait` | Portrait |
| `sheets.props` | Sheet |
| `sheets.source.ceiling` | Ceiling plan · {level} |
| `sheets.source.elevation` | Elevation {dir} |
| `sheets.source.plan` | Plan · {level} |
| `sheets.source.schedule` | Schedule · {kind} |
| `sheets.source.section` | Section {label} |
| `sheets.source.view` | 3D view · {name} |
| `sheets.style.hiddenLine` | Hidden line |
| `sheets.style.lines` | Lines |
| `sheets.style.realistic` | Realistic |
| `sheets.style.shaded` | Shaded |
| `sheets.tb.checkedBy` | Checked |
| `sheets.tb.client` | Client |
| `sheets.tb.date` | Date |
| `sheets.tb.drawnBy` | Drawn |
| `sheets.tb.phase` | Phase |
| `sheets.tb.sheet` | Sheet |
| `sheets.titleBlock` | Title block |
| `sheets.viewport` | Viewport |
| `sheets.viewports` | viewports |
| `sheets.viewportsTitle` | Viewports |
| `sheets.vp.scale` | Scale |
| `sheets.vp.style` | Style |
| `sheets.vp.title` | Title |
| `sheets.zoomIn` | Zoom in |
| `sheets.zoomOut` | Zoom out |
| `shortcuts.cancel` | Cancel tool / deselect |
| `shortcuts.desc` | Single keys switch tools; hold Shift for ×10 steps in number fields. |
| `shortcuts.general` | General |
| `shortcuts.help` | This sheet |
| `shortcuts.navigation` | Navigation |
| `shortcuts.orbit` | Orbit |
| `shortcuts.pan` | Pan |
| `shortcuts.panels` | Toggle Scene · Files · Library · Comments |
| `shortcuts.title` | Keyboard shortcuts |
| `shortcuts.tools` | Tools |
| `shortcuts.vcb` | Type an exact value while drawing |
| `shortcuts.walkKeys` | Walk mode movement |
| `shortcuts.zoom` | Zoom |
| `snap.angle` | Angle steps |
| `snap.angleStep` | Angle step |
| `snap.center` | Centers |
| `snap.enable` | Enable snapping |
| `snap.endpoint` | Endpoints |
| `snap.extension` | Extensions |
| `snap.grid` | Grid |
| `snap.intersection` | Intersections |
| `snap.midpoint` | Midpoints |
| `snap.nearest` | Nearest |
| `snap.off` | Snap off — right-click for settings |
| `snap.on` | Snap on — right-click for settings |
| `snap.ortho` | Ortho lock |
| `snap.parallel` | Parallel |
| `snap.perpendicular` | Perpendicular |
| `snap.radius` | Snap radius |
| `snap.title` | Snapping |
| `status.cursor` | Cursor position |
| `status.engineUnavailable` | 3D view unavailable — panels and document editing still work |
| `status.grid` | Grid |
| `status.gridToggle` | Toggle grid |
| `status.hintSelect` | Click to select · drag to box-select · double-click to edit a group |
| `status.hintTool` | {tool} tool |
| `status.ortho` | Ortho |
| `status.orthoToggle` | Toggle ortho lock |
| `status.persp` | Persp |
| `status.snap` | Snap |
| `status.snapToggle` | Toggle snapping |
| `status.units` | Document units |
| `status.vcbTip` | Type an exact value and press Enter |
| `status.viewport` | Active viewport |
| `sync.connecting` | Connecting… |
| `sync.error` | Sync error |
| `sync.local` | Saved on this device |
| `sync.offline` | Offline — changes are saved locally |
| `sync.synced` | Synced |
| `sync.syncing` | Syncing… |
| `theme.dark` | Dark |
| `theme.light` | Light |
| `theme.system` | System |
| `theme.useDark` | Use dark theme |
| `theme.useLight` | Use light theme |
| `theme.useSystem` | Follow system theme |
| `topbar.export` | Export |
| `topbar.new` | New |
| `topbar.share` | Share |
| `transform.position` | Position |
| `transform.rotation` | Rotation |
| `transform.scale` | Scale |
| `transform.uniform` | Uniform scale |
| `transform.uniformOff` | Scale axes independently |
| `transform.uniformOn` | Uniform scale (linked) |
| `unit.deg` | Degrees |
| `unit.rad` | Radians |
| `versions.title` | Version history |
| `view.back` | Back |
| `view.bottom` | Bottom |
| `view.custom` | Custom |
| `view.front` | Front |
| `view.iso` | Isometric |
| `view.left` | Left |
| `view.perspective` | Perspective |
| `view.right` | Right |
| `view.top` | Top |
| `viewport.layout` | Viewport layout |
| `viewport.layoutQuad` | Four views |
| `viewport.layoutSingle` | Single view |
| `viewport.layoutSplit` | Split: 2D + 3D |
| `viewport.renderMenu` | Render mode: {label} |
| `viewport.saveView` | Save this view |
| `viewport.standardViews` | Standard views |
| `viewport.viewMenu` | View: {label} |
| `viewport.zoomExtents` | Zoom extents |
| `views.defaultName` | View {n} |
| `views.empty` | No saved views |
| `views.emptyHint` | Save camera positions to jump back later or place them on sheets. |
| `views.manageSheets` | Manage |
| `views.noSections` | Use Annotate › Section to cut the model. |
| `views.ortho` | Orthographic |
| `views.persp` | Perspective |
| `views.restore` | Go to view |
| `views.save` | Save current view |
| `views.saved` | Saved views |
| `views.sectionOff` | Disabled |
| `views.sectionOn` | Cutting |
| `views.sectionToggle` | Enable section |
| `views.sections` | Section planes |
| `views.sheets` | Sheets |
| `views.update` | Update with current camera |
| `wallLayer.add` | Add layer |
| `wallLayer.air` | Air gap |
| `wallLayer.clear` | Clear |
| `wallLayer.confirmClear` | Really clear? |
| `wallLayer.finish` | Finish |
| `wallLayer.function` | Function |
| `wallLayer.insulation` | Insulation |
| `wallLayer.membrane` | Membrane |
| `wallLayer.none` | Single-layer wall. Add layers for a multi-layer build-up. |
| `wallLayer.structure` | Structure |
| `wallLayer.thickness` | Layer thickness |
| `wallLayer.total` | Layers {total} of {thickness} |

## Dynamic key families

These keys are composed at runtime; provide translations per known value or rely on the fallback:

- `.${styles.treeLabel}`
- `command.${c.id}`
- `command.category.${c.category}`
- `command.category.${cat}`
- `env.${e}`
- `material.category.${cat}`
- `material.category.${c}`
- `material.category.${m.category}`
- `material.procedural.${p}`
- `nodeType.${x}`
- `param.${type}.${f.key}`
- `param.${type}.${f.key}.${o.value}`
- `param.${type}.${f.key}.hint`
- `quantity.${k}`
- `sheets.tb.${k}`
- `toolOption.${tool}.${s.key}`
- `toolOption.${tool}.${s.key}.${o.value}`
- `unit.${u}`

Known enumerations: `tool.<name>` (see engine/tools.tsx), `library.item.<id>` (library/catalog.tsx), `param.<nodeType>.<key>` (+ `.hint`, `.<optionValue>`; inspector/schema.ts), `toolOption.<toolId>.<key>` (+ `.<optionValue>`), `command.<commandId>` and `command.category.<Category>` (engine commands), `material.category.<category>`, `material.procedural.<kind>`, `quantity.<key>`, `nodeType.<type>`, `unit.<unit>`, `env.<preset>`, `sheets.tb.<field>`, `library.furniture.<category>`.
