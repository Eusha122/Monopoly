// Generates per-tile SVGs for the board from the raw Figma kit exports in
// "assets/board boxs". The exports are used as-is except that the kit's
// placeholder texts ("NAME", "M100"...) are removed so real street names can
// be shown on top. Icons, frames, and color bars are untouched.
// Run: node tools/gen-tiles.mjs
import fs from 'fs';
import path from 'path';
import { TILES, GROUPS } from '../shared/data.js';

const KIT = 'f:/Monopoly/assets/board boxs';
const K  = (f) => path.join(KIT, 'Monopoly Kit (Community) (Copy)', f);      // bottom row
const K1 = (f) => path.join(KIT, 'Monopoly Kit (Community) (Copy) (1)', f);  // right column
const K2 = (f) => path.join(KIT, 'Monopoly Kit (Community) (Copy) (2)', f);  // top row
const K3 = (f) => path.join(KIT, 'Monopoly Kit (Community) (Copy) (3)', f);  // left column
const OUT = 'f:/Monopoly/assets/tiles/gen';
fs.mkdirSync(OUT, { recursive: true });

const sideOf = (id) => id < 10 ? 'bottom' : id < 20 ? 'left' : id < 31 ? 'top' : 'right';

// placeholder text bands per orientation: [axis, from, to]
const BANDS = {
  bottom: [['y', 15, 50], ['y', 55, 80], ['y', 143, 182]],
  top:    [['y', 106, 131], ['y', 136, 171], ['y', 4, 43]],
  left:   [['x', 106, 131], ['x', 136, 171], ['x', 4, 43]],
  right:  [['x', 15, 50], ['x', 55, 80], ['x', 143, 182]],
};

function stripPaths(svg, { bands = [], all = false } = {}) {
  if (all) svg = svg.replace(/<image[^>]*\/>|<image[^>]*>\s*<\/image>/g, '');
  return svg.replace(/<path[^>]*\/>|<path[^>]*>\s*<\/path>/g, (tag) => {
    if (all) return '';
    if (!/fill="black"/.test(tag)) return tag;
    const d = tag.match(/ d="([^"]+)"/)?.[1] || '';
    const starts = [...d.matchAll(/M\s*([\d.]+)[ ,]\s*([\d.]+)/g)]
      .map(m => ({ x: +m[1], y: +m[2] }));
    if (!starts.length) return tag;
    const inside = (p) => bands.some(([axis, a, b]) => p[axis] >= a && p[axis] <= b);
    return starts.every(inside) ? '' : tag;
  });
}

function recolorRect(svg, toColor) {
  // the color bar is the rect with height/width 42 — swap only its fill
  return svg.replace(/(<rect[^>]*(?:height="42"|width="42")[^>]*fill=")([^"]+)(")/g, (m, a, _c, z) => a + toColor + z)
            .replace(/(<rect[^>]*fill=")([^"]+)("[^>]*(?:height="42"|width="42"))/g, (m, a, _c, z) => a + toColor + z);
}

const read = (f) => fs.readFileSync(f, 'utf8');
const write = (id, svg) => fs.writeFileSync(path.join(OUT, `tile-${id}.svg`), svg);

for (const t of TILES) {
  const side = sideOf(t.id);
  const bands = BANDS[side];
  switch (t.type) {
    case 'property': {
      const src = { bottom: K('Location-1.svg'), right: K1('Location.svg'), top: K2('Location.svg'), left: K3('Location.svg') }[side];
      let svg = stripPaths(read(src), { bands });
      svg = recolorRect(svg, GROUPS[t.group].color);
      write(t.id, svg);
      break;
    }
    case 'railroad': {
      const src = { bottom: K('Station.svg'), right: K1('Station.svg'), top: K2('Station.svg'), left: K3('Station.svg') }[side];
      write(t.id, stripPaths(read(src), { bands }));
      break;
    }
    case 'utility': {
      if (t.id === 28) write(t.id, stripPaths(read(K2('Simple Utility.svg')), { bands }));           // Water Works (top)
      else write(t.id, stripPaths(read(K3('Utility.svg')), { all: true }));                          // Electric (left): drop figma logo + text
      break;
    }
    case 'chance': {
      if (t.id === 22) write(t.id, read(K2('Action.svg')));                                          // blue ? (top) as-is
      else write(t.id, read(K('Action.svg')));                                                       // bottom as-is; right reuses it (CSS-rotated)
      break;
    }
    case 'chest': {
      if (t.id === 2) write(t.id, read(K('Action-2.svg')));                                          // bottom, as-is
      else if (t.id === 17) write(t.id, read(K3('Action.svg')));                                     // left, as-is
      else write(t.id, read(K('Action-2.svg')));                                                     // right: bottom art, rotated in CSS
      break;
    }
    case 'tax': {
      if (t.id === 4) write(t.id, stripPaths(read(K('Action-1.svg')), { bands: [['y', 143, 182]] })); // Income Tax: drop "PAY M150" only
      else write(t.id, stripPaths(read(K1('Action.svg')), { bands: [['x', 143, 182], ['x', 14, 53]] })); // Super Tax: drop "M150" and baked "LUXURY TAX"
      break;
    }
  }
}

// deck icons for the board center: the kit tile art cropped (viewBox) to just
// the illustration — same vectors/pattern, no frame, no text
function cropIcon(src, outName) {
  let svg = read(src);
  const m = svg.match(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="url\(#pattern/);
  if (!m) throw new Error('no pattern rect in ' + src);
  svg = svg
    .replace(/<rect[^>]*fill="#D9E8D6"[^>]*\/>/g, '')
    .replace(/<rect[^>]*stroke="black"[^>]*\/>/g, '')
    .replace(/<path[^>]*fill="black"[^>]*\/>/g, '')
    .replace(/<svg width="[^"]*" height="[^"]*" viewBox="[^"]*"/,
      `<svg width="${m[3]}" height="${m[4]}" viewBox="${m[1]} ${m[2]} ${m[3]} ${m[4]}"`);
  fs.writeFileSync(path.join(OUT, outName), svg);
}
cropIcon(K('Action-2.svg'), 'deck-chest.svg');
cropIcon(K('Action.svg'), 'deck-chance.svg');

// corners, raw and untouched
fs.copyFileSync(K('Corner.svg'), path.join(OUT, 'tile-0.svg'));   // GO
fs.copyFileSync(K3('Corner.svg'), path.join(OUT, 'tile-10.svg')); // Jail
fs.copyFileSync(K2('Corner.svg'), path.join(OUT, 'tile-20.svg')); // Free Parking
fs.copyFileSync(K1('Corner.svg'), path.join(OUT, 'tile-30.svg')); // Go To Jail

console.log('generated', fs.readdirSync(OUT).length, 'tiles →', OUT);
