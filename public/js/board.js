// Renders the board from data + assets, positions tokens, houses, ownership markers.
import { TILES, GROUPS } from '/shared/data.js';

const ICONS = {
  utilityElectric: '/assets/electric-company-bulb.svg',
  chest: '/assets/tiles/gen/deck-chest.svg',
  chance: '/assets/tiles/gen/deck-chance.svg',
  logo: '/assets/monopoly-logo-red.svg',
};

// Board walk: tile 0 (GO) bottom-right corner, counter-clockwise like the real board.
// Returns { row, col, side } on an 11x11 grid (1-based for CSS grid).
export function gridPos(i) {
  if (i === 0) return { row: 11, col: 11, side: 'corner' };
  if (i < 10) return { row: 11, col: 11 - i, side: 'bottom' };
  if (i === 10) return { row: 11, col: 1, side: 'corner' };
  if (i < 20) return { row: 11 - (i - 10), col: 1, side: 'left' };
  if (i === 20) return { row: 1, col: 1, side: 'corner' };
  if (i < 30) return { row: 1, col: 1 + (i - 20), side: 'top' };
  if (i === 30) return { row: 1, col: 11, side: 'corner' };
  return { row: 1 + (i - 30), col: 11, side: 'right' };
}

// Every tile shows its raw SVG from the Figma kit (assets/tiles/gen). Only the
// dynamic text (street names, prices) is overlaid on top, since the kit ships
// those as "NAME"/"M100" placeholders.
function tileHtml(tile) {
  const art = `<img class="tile-art" src="/assets/tiles/gen/tile-${tile.id}.svg" alt="" draggable="false">`;
  // tiles 33/36 (right column) reuse bottom-row art and need the CSS rotation
  const rotateArt = tile.id === 33 || tile.id === 36;
  const overlayBody = (cls, inner) => `<div class="tile-rotor"><div class="tile-body ${cls}">${inner}</div></div>`;
  let overlay = '';
  switch (tile.type) {
    case 'property':
      overlay = overlayBody('tb-property',
        `<div class="tile-name">${tile.name.toUpperCase()}</div><div class="tile-price">£${tile.price}</div>`);
      break;
    case 'railroad':
      overlay = overlayBody('tb-station',
        `<div class="tile-name">${tile.name.toUpperCase()}</div><div class="tile-price">£${tile.price}</div>`);
      break;
    case 'utility': {
      const icon = tile.id === 12 ? `<img class="tile-icon big" src="${ICONS.utilityElectric}" alt="">` : '';
      overlay = overlayBody('tb-station',
        `<div class="tile-name">${tile.name.toUpperCase()}</div>${icon}<div class="tile-price">£${tile.price}</div>`);
      break;
    }
    case 'tax':
      // Income Tax keeps its baked art name; Super Tax's baked "LUXURY TAX" is
      // stripped by the generator, so its name is overlaid like other tiles
      overlay = tile.id === 38
        ? overlayBody('tb-station', `<div class="tile-name">${tile.name.toUpperCase()}</div><div class="tile-price">PAY £${tile.amount}</div>`)
        : overlayBody('tb-tax', `<div class="tile-price">PAY £${tile.amount}</div>`);
      break;
    // chance/chest/corners: complete art, nothing to overlay
  }
  return (rotateArt ? `<div class="tile-rotor">${art}</div>` : art) + overlay;
}

export function renderBoard(boardEl) {
  boardEl.innerHTML = '';
  for (const tile of TILES) {
    const { row, col, side } = gridPos(tile.id);
    const el = document.createElement('div');
    el.className = `tile side-${side} type-${tile.type}`;
    el.dataset.tile = tile.id;
    el.style.gridRow = row;
    el.style.gridColumn = col;
    el.innerHTML = `${tileHtml(tile)}
      <div class="owner-marker" hidden></div>
      <div class="houses" hidden></div>
      <div class="mortgage-x" hidden>✕</div>`;
    boardEl.appendChild(el);
  }
  // center area
  const center = document.createElement('div');
  center.className = 'board-center';
  center.innerHTML = `
    <img class="center-logo" src="${ICONS.logo}" alt="MONOPOLY">
    <div class="deck deck-chest"><img src="${ICONS.chest}" alt=""><span>COMMUNITY CHEST</span></div>
    <div class="deck deck-chance"><img src="${ICONS.chance}" alt=""><span>CHANCE</span></div>
    <div class="dice-area" id="dice-area" hidden>
      <div class="die" id="die1"></div>
      <div class="die" id="die2"></div>
    </div>`;
  boardEl.appendChild(center);
  // token layer sits above everything
  const layer = document.createElement('div');
  layer.className = 'token-layer';
  layer.id = 'token-layer';
  boardEl.appendChild(layer);

  // shrink any name/price that overflows its tile (e.g. MEDITERRANEAN AVENUE)
  const fit = () => fitTileText(boardEl);
  document.fonts?.ready.then(fit).catch(fit);
  requestAnimationFrame(fit);
  let rt;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(fit, 150); });
}

export function fitTileText(boardEl) {
  for (const el of boardEl.querySelectorAll('.tile-name, .tile-price')) {
    el.style.fontSize = '';
    let size = parseFloat(getComputedStyle(el).fontSize);
    let guard = 14;
    while (guard-- > 0 && size > 4 && el.scrollWidth > el.clientWidth + 0.5) {
      size -= 0.5;
      el.style.fontSize = size + 'px';
    }
  }
}

// ---------- dynamic overlays ----------

export function updateOwnership(boardEl, state) {
  for (const tile of TILES) {
    const el = boardEl.querySelector(`[data-tile="${tile.id}"]`);
    if (!el) continue;
    const own = state.owner[tile.id];
    const marker = el.querySelector('.owner-marker');
    const houses = el.querySelector('.houses');
    const mx = el.querySelector('.mortgage-x');
    if (own) {
      const owner = state.players.find(p => p.id === own.playerId);
      marker.hidden = false;
      marker.style.background = owner?.color || '#888';
      mx.hidden = !own.mortgaged;
      if (own.houses > 0) {
        houses.hidden = false;
        houses.innerHTML = own.houses === 5
          ? '<span class="hotel"></span>'
          : Array.from({ length: own.houses }, () => '<span class="house"></span>').join('');
      } else houses.hidden = true;
    } else {
      marker.hidden = true; houses.hidden = true; mx.hidden = true;
    }
  }
}

const DOT = [[], [[50,50]], [[30,30],[70,70]], [[30,30],[50,50],[70,70]],
  [[30,30],[70,30],[30,70],[70,70]], [[30,30],[70,30],[50,50],[30,70],[70,70]],
  [[30,30],[70,30],[30,50],[70,50],[30,70],[70,70]]];

export function drawDie(el, value) {
  el.innerHTML = DOT[value].map(([x, y]) => `<i style="left:${x}%;top:${y}%"></i>`).join('');
}

// Position of a tile's center relative to the board element (percent).
export function tileCenter(boardEl, tileId, slot = 0, slots = 1) {
  const tileEl = boardEl.querySelector(`[data-tile="${tileId}"]`);
  const b = boardEl.getBoundingClientRect();
  const t = tileEl.getBoundingClientRect();
  let cx = t.left - b.left + t.width / 2;
  let cy = t.top - b.top + t.height / 2;
  if (slots > 1) { // spread multiple tokens on the same tile in a mini-grid
    const per = Math.ceil(Math.sqrt(slots));
    const ix = slot % per, iy = Math.floor(slot / per);
    const spread = Math.min(t.width, t.height) * 0.38;
    cx += (ix - (per - 1) / 2) * (spread / Math.max(1, per - 1) * 1.6 || 0);
    cy += (iy - (per - 1) / 2) * (spread / Math.max(1, per - 1) * 1.6 || 0);
  }
  return { x: (cx / b.width) * 100, y: (cy / b.height) * 100 };
}

// Walk path between two positions (for hop animation)
export function pathBetween(from, to) {
  const path = [];
  let i = from;
  while (i !== to) { i = (i + 1) % 40; path.push(i); }
  return path;
}
