// Charte « Jardin aquarelle » : icônes dessinées, illustrations de plantes
// et Lulu, la coccinelle jardinière. Tout est en SVG inline (fonctionne hors connexion).

const PATHS = {
  drop: '<path d="M12 3.2C12 3.2 5.5 10.6 5.5 14.8a6.5 6.5 0 0 0 13 0C18.5 10.6 12 3.2 12 3.2z"/>',
  sprout: '<path d="M12 21v-9"/><path d="M12 13c0-4-3-6.5-7-6.5 0 4 3 6.5 7 6.5z"/><path d="M12 11c0-4 3-6.5 7-6.5 0 4-3 6.5-7 6.5z"/>',
  pot: '<path d="M5 9h14l-1.8 11H6.8z"/><path d="M4 6.5h16V9H4z"/><path d="M12 6.5V3.5"/>',
  note: '<path d="M4.5 19.5l1-4.2L16 4.8l3.2 3.2L8.7 18.5z"/><path d="M14 6.8l3.2 3.2"/>',
  camera: '<path d="M3.5 8.5h3.2l1.8-2.5h7l1.8 2.5h3.2v11h-17z"/><circle cx="12" cy="13.5" r="3.6"/>',
  leaf: '<path d="M5 19C5 10 11.5 5 20 4.5 19.5 13 15 19 5 19z"/><path d="M5 19l8-8"/>',
  settings: '<path d="M4 7h10M18 7h2M4 12h3M11 12h9M4 17h12"/><circle cx="16" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="18" cy="17" r="2"/>',
  heart: '<path d="M12 20C4.5 14.5 3.5 10.5 5 7.5a4 4 0 0 1 7 .3 4 4 0 0 1 7-.3c1.5 3 .5 7-7 12.5z"/><path d="M7.5 12h2.5l1.2-2 1.6 4 1.2-2h2.5"/>',
  sparkle: '<path d="M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9z"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  pin: '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  image: '<rect x="3.5" y="5" width="17" height="14" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="M20.5 16l-5-5-8 8"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
  // Module Pièces
  home: '<path d="M3.5 11.5L12 4.5l8.5 7"/><path d="M6 10v9.5h12V10"/><path d="M10 19.5v-5h4v5"/>',
  window: '<rect x="4.5" y="3.5" width="15" height="17" rx="2"/><path d="M12 3.5v17M4.5 12h15"/>',
  door: '<path d="M5.5 20.5V3.5h13v17"/><path d="M3.5 20.5h17"/><path d="M12 3.5v17"/><path d="M10 12.5v1M14 12.5v1"/>',
  shape: '<path d="M4.5 5h9v6h6v8.5h-15z"/><circle cx="4.5" cy="5" r="1.4"/><circle cx="13.5" cy="11" r="1.4"/><circle cx="19.5" cy="19.5" r="1.4"/>',
  compass: '<circle cx="12" cy="12" r="8.5"/><path d="M14.8 9.2l-1.6 4-4 1.6 1.6-4z"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  snow: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="M9.5 4.5L12 7l2.5-2.5M9.5 19.5L12 17l2.5 2.5"/>',
  star: '<path d="M12 3.8l2.4 5 5.4.7-4 3.7 1 5.4-4.8-2.6-4.8 2.6 1-5.4-4-3.7 5.4-.7z"/>',
};

// Couleur par type d'entrée du journal (utilisée par les pastilles).
export const TYPE_COLORS = {
  water: 'var(--water)',
  fertilize: 'var(--ok)',
  repot: 'var(--warn)',
  note: 'var(--primary)',
  photo: 'var(--lilac)',
  diagnosis: 'var(--primary)',
};

export function icon(name, size = 22, extra = '') {
  return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" `
    + `stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${PATHS[name] || ''}</svg>`;
}

// Icône dans une pastille ronde teintée.
export function iconBadge(name, color, size = 20) {
  return `<span class="ib" style="--c:${color}">${icon(name, size)}</span>`;
}

// --- Illustrations de plantes (quand il n'y a pas de photo) -----------------

const LEAF = ['#8FAE95', '#6D8F78'];
const POTS = ['#D9967A', '#C4708A', '#B9A7D1', '#EDC2A0'];

function leaf(x, y, ang, L, W, col) {
  return `<g transform="translate(${x} ${y}) rotate(${ang})"><path d="M0 0 C${W} ${-L * 0.3} ${W * 0.6} ${-L * 0.85} 0 ${-L} C${-W * 0.6} ${-L * 0.85} ${-W} ${-L * 0.3} 0 0z" fill="${col}"/></g>`;
}

function hash(s) {
  let h = 0;
  for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

// Silhouette choisie d'après l'espèce quand on la reconnaît, sinon au hasard (stable).
function artKind(name, h) {
  const n = String(name || '').toLowerCase();
  if (/monstera|philodendron|alocasia|colocasia/.test(n)) return 3;
  if (/epipremnum|pothos|scindapsus|hedera|tradescantia|chlorophytum|ceropegia|senecio/.test(n)) return 1;
  if (/citrus|olea|laurus|ficus benjamina|coffea|punica/.test(n)) return 2;
  if (/ficus|sansevieria|dracaena|aloe|zamioculcas|yucca/.test(n)) return 0;
  return h % 4;
}

export function plantArt(seed = '', name = '') {
  const h = hash(seed);
  const kind = artKind(name, h);
  const pot = POTS[(h >> 3) % POTS.length];
  const [l1, l2] = LEAF;
  const g = [];
  if (kind === 0) {
    [[-50, 34], [-25, 40], [0, 44], [25, 40], [50, 34], [-12, 30], [14, 30]]
      .forEach(([a, L], i) => g.push(leaf(60, 82, a, L, 11, i % 2 ? l2 : l1)));
  } else if (kind === 1) {
    [[-35, 30], [0, 34], [35, 30]].forEach(([a, L]) => g.push(leaf(60, 80, a, L, 14, l1)));
    g.push(`<path d="M30 84 C20 96 22 108 18 116" stroke="${l2}" stroke-width="2.5" fill="none"/><path d="M90 84 C100 98 96 106 102 116" stroke="${l2}" stroke-width="2.5" fill="none"/>`);
    [[22, 100, 200], [18, 114, 170], [99, 102, 160], [101, 116, 190]].forEach(([x, y, a]) => g.push(leaf(x, y, a, 13, 7, l2)));
  } else if (kind === 2) {
    g.push('<path d="M60 82 V50" stroke="#A27652" stroke-width="5" stroke-linecap="round"/>');
    [[60, 38, 22], [44, 48, 15], [76, 48, 15], [60, 26, 14]].forEach(([x, y, r]) => g.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${l1}"/>`));
    [[48, 42], [70, 34], [64, 52], [54, 28]].forEach(([x, y]) => g.push(`<circle cx="${x}" cy="${y}" r="5" fill="#E8B4C0"/>`));
  } else {
    [[-40, 40, 20], [8, 48, 22], [42, 36, 18]].forEach(([a, L, W]) => {
      g.push(leaf(60, 82, a, L, W, a ? l1 : l2));
      const rad = (a * Math.PI) / 180;
      [0.45, 0.7].forEach((k) => {
        const cx = 60 + Math.sin(rad) * L * k;
        const cy = 82 - Math.cos(rad) * L * k;
        g.push(`<path d="M${cx.toFixed(1)} ${cy.toFixed(1)} l${(Math.cos(rad) * W * 0.55).toFixed(1)} ${(Math.sin(rad) * W * 0.55).toFixed(1)}" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".85"/>`);
      });
    });
  }
  const potSvg = `<path d="M36 84 H84 L79 114 H41 Z" fill="${pot}"/><rect x="32" y="77" width="56" height="10" rx="5" fill="${pot}"/><rect x="32" y="77" width="56" height="10" rx="5" fill="#fff" opacity=".22"/>`;
  return `<svg class="plant-art" viewBox="0 0 120 120" aria-hidden="true">${g.join('')}${potSvg}</svg>`;
}

// --- Lulu, la coccinelle jardinière ------------------------------------------

export function lulu(size = 80) {
  return `<svg class="lulu" width="${size}" height="${Math.round(size * 200 / 210)}" viewBox="0 0 210 200" aria-hidden="true">
    <ellipse cx="100" cy="186" rx="50" ry="6" fill="#000" opacity=".05"/>
    <path d="M30 170 C50 120 90 118 100 150" stroke="#8FAE95" stroke-width="3" fill="none"/>
    ${leaf(70, 128, -70, 40, 16, '#B8CFB9')}
    <circle cx="100" cy="66" r="30" fill="#3D3532"/>
    <path d="M86 40 q-10 -20 -20 -18 M114 40 q10 -20 20 -18" stroke="#3D3532" stroke-width="3" fill="none" stroke-linecap="round"/>
    <circle cx="66" cy="22" r="5" fill="#C4708A"/><circle cx="134" cy="22" r="5" fill="#C4708A"/>
    <ellipse cx="100" cy="122" rx="56" ry="52" fill="#D9576F"/>
    <path d="M100 72 V174" stroke="#3D3532" stroke-width="3"/>
    <circle cx="76" cy="106" r="9" fill="#3D3532"/><circle cx="124" cy="106" r="9" fill="#3D3532"/>
    <circle cx="72" cy="140" r="7" fill="#3D3532"/><circle cx="128" cy="140" r="7" fill="#3D3532"/>
    <circle cx="89" cy="64" r="6" fill="#fff"/><circle cx="111" cy="64" r="6" fill="#fff"/>
    <circle cx="90" cy="65" r="3" fill="#3D3532"/><circle cx="112" cy="65" r="3" fill="#3D3532"/>
    <ellipse cx="80" cy="78" rx="5" ry="3" fill="#E89AAE" opacity=".8"/><ellipse cx="120" cy="78" rx="5" ry="3" fill="#E89AAE" opacity=".8"/>
    <path d="M94 80 q6 5 12 0" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round"/>
    <g transform="translate(150 120) rotate(-15)"><path d="M0 0 h26 l-4 24 h-18z" fill="#EDC2A0"/><path d="M26 6 l18 -12" stroke="#EDC2A0" stroke-width="5" stroke-linecap="round"/><path d="M-6 6 q-8 4 -6 14" stroke="#EDC2A0" stroke-width="4" fill="none"/></g>
    <circle cx="194" cy="102" r="2.5" fill="#9CC3E6"/><circle cx="198" cy="112" r="2" fill="#9CC3E6"/>
  </svg>`;
}

// Bulle de Lulu : mascotte + message.
export function luluSays(title, text, size = 64) {
  return `<div class="lulu-card">${lulu(size)}<div><div class="lulu-title">${title}</div><div class="lulu-text">${text}</div></div></div>`;
}
