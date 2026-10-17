# Offline dependencies

All assets are served locally. Runtime network/CDN requests are not required.

- SVG-Edit 7.4.2: official npm `svgedit@7.4.2`, dist/editor. Source https://github.com/SVG-Edit/svgedit . Main MIT license bundled; upstream component licenses retained in their source headers. Unused tests, maps and duplicate IIFE bundle omitted. `studio.html` is our integration entry.
- Paper.js 0.12.18: official npm `paper@0.12.18`, paper-core.min.js, MIT license included. https://paperjs.org/
- OpenType.js 2.0.0: official npm `opentype.js@2.0.0`, opentype.min.mjs, MIT license included. https://github.com/opentypejs/opentype.js
- Noto Sans Regular (static): https://github.com/notofonts/noto-fonts/tree/main/hinted/ttf/NotoSans ; SIL Open Font License 1.1 included as FONT-OFL.txt. Downloaded 2026-10-15. Font outlines are converted with OpenType.js; system fonts are not used for cutting.

## Integration contract

`../editor.mjs` exports `MotifEditor(host,{onChange,onStatus})`. Call `await init()`, then `await load(figure)` with `figure.svg`, `figure.width`, `figure.height` in mm. `await commit()` returns the normalized SVG result below. `onChange()` signals unsaved geometry; `onStatus(message)` supplies visible feedback. `undo()`, `redo()`, `destroy()` manage native history/lifecycle. `native` exposes the SVG-Edit Editor and `canvas` the native SvgCanvas after initialization.

`await command(name,value)` supports `unite`, `subtract`, `intersect`; `addText` with `{text,size}` (size in mm); `operation` with `cut` or `engrave`; `mode`/`tool` with native mode names; `group`, `ungroup`, `delete`, `align`, `selectAll`, `grid`, `undo`, `redo`. Bézier drawing, node/handle editing, shape tools, grouping, transformations, grid and native history are provided by SVG-Edit's own UI. Booleans use Paper.js and atomic native history entries. Text uses actual bundled glyph outlines with kerning; each glyph contour is explicitly closed. Contextual script shaping is unsupported; unsupported glyphs produce a clear error.

`../svg.mjs` exports `normalizeSVG(source)`, `parseSafeSVG(source)`, `loadPaper()`, `loadFont()` and `textPath(text,x,y,size)`. Normalization returns `{svg,contours,engravings,sourceTexts,warnings,aspectRatio,physicalWidth,physicalHeight,rawBounds}`. SVG has `viewBox="0 0 100 100"` and independent x/y normalization; contours/engravings use `[0,1]` coordinates with SVG's downward y axis. Reapply `figure.width` and `figure.height` for physical shape aspect. `physicalWidth`/`physicalHeight` are the pre-normalization geometric bounds in editor drawing units (one unit equals one mm); the caller saves these after commits. `sourceTexts` retain original text/font/size metadata; the SVG also includes a `studio-texts` metadata element and real path outlines. Closed compound paths remain compound so counters/holes are preserved. Open geometry becomes engraving with a warning.

The importer rejects active/external content before live insertion and rejects unsupported raster/filter/mask/clip/reference geometry. Bounds: 2 MB UTF-8 input, 2000 elements, 50,000 coordinate numbers, 2048 flattened contour points. Curves in the SVG stay exact; manufacturing contours use a physical tolerance of 0.05 mm, persisted in canonical SVG metadata so reloads remain stable. Browser self-check: `await (await import('./tests/editor.browser.mjs')).runEditorTests()` from the app's served URL.

- polygon-clipping 0.15.7: official package distribution from https://github.com/mfogel/polygon-clipping, locally converted to an ES module. MIT license in POLYGON-CLIPPING-LICENSE.txt; included splaytree notice retained in source. Used to union the integral motif/support material and subtract actual apertures from the single card blank.
