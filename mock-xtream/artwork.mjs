// Generated artwork for the mock server: posters, backdrops, episode stills
// and channel logos drawn as SVG from the title alone — no real images, so
// nothing to license. Same title, same picture, every time.

import { rng } from "./catalog.mjs";

/** Colour sets per category: [light, dark, accent] — saturated enough to read as artwork, dark enough at the bottom for white text. */
const PALETTES = [
  ["#3b6fd8", "#0d1633", "#ffc857"],
  ["#e0533d", "#2a0c0c", "#ffd166"],
  ["#f2a541", "#3a1a06", "#fff3c4"],
  ["#2a9d8f", "#062320", "#e9f5a1"],
  ["#7b5cd6", "#160f2e", "#ffd1f7"],
  ["#3a86ff", "#081a3a", "#8ce1ff"],
  ["#ef476f", "#2c0715", "#ffd6e0"],
  ["#06d6a0", "#03261d", "#fef9c3"],
  ["#118ab2", "#04202b", "#ffe8a3"],
  ["#8d99ae", "#141821", "#ef233c"],
  ["#5a189a", "#10031f", "#ff9e00"],
];

function escapeXml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
}

/** Splits a title into lines of roughly `width` characters. */
function wrap(text, width) {
  const lines = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && (line + " " + word).length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

/** A central motif per title (sun, rings, peaks or bars), so a grid of posters reads as varied artwork rather than flat swatches. */
function motif(r, w, h, accent) {
  const cx = r.int(Math.round(w * 0.3), Math.round(w * 0.7));
  const cy = r.int(Math.round(h * 0.22), Math.round(h * 0.38));
  const size = r.int(Math.round(w * 0.22), Math.round(w * 0.34));
  switch (r.int(0, 3)) {
    case 0: // sun over a horizon
      return `<circle cx="${cx}" cy="${cy}" r="${size}" fill="${accent}" opacity="0.9"/><rect x="0" y="${cy + size * 0.35}" width="${w}" height="${h}" fill="#000" opacity="0.35"/>`;
    case 1: // concentric rings
      return [0, 1, 2, 3].map((i) => `<circle cx="${cx}" cy="${cy}" r="${size * (0.4 + i * 0.35)}" fill="none" stroke="${accent}" stroke-width="${10 - i * 2}" opacity="${0.8 - i * 0.18}"/>`).join("");
    case 2: { // mountain peaks
      const base = cy + size;
      return `<path d="M0 ${base} L ${w * 0.3} ${cy - size * 0.4} L ${w * 0.5} ${base - size * 0.5} L ${w * 0.72} ${cy - size * 0.8} L ${w} ${base} Z" fill="${accent}" opacity="0.85"/><path d="M0 ${base + 40} L ${w * 0.45} ${cy + size * 0.2} L ${w} ${base + 60} L ${w} ${h} L 0 ${h} Z" fill="#000" opacity="0.4"/>`;
    }
    default: // diagonal light bars
      return [0, 1, 2].map((i) => `<rect x="${cx - size + i * size * 0.55}" y="-100" width="${size * 0.28}" height="${h * 0.62}" fill="${accent}" opacity="${0.75 - i * 0.2}" transform="rotate(${r.int(12, 28)} ${cx} ${cy})"/>`).join("");
  }
}

/** Soft circles for texture. */
function shapes(r, w, h, accent) {
  const out = [];
  for (let i = 0; i < 3; i++) {
    out.push(`<circle cx="${r.int(0, w)}" cy="${r.int(0, h)}" r="${r.int(Math.round(w * 0.2), Math.round(w * 0.5))}" fill="#fff" opacity="0.05"/>`);
  }
  return out.join("") + motif(r, w, h, accent);
}

const FONT = "Helvetica Neue, Helvetica, Arial, sans-serif";

/** 2:3 movie/series poster. */
export function posterSvg({ title, year, genre, palette }) {
  const [top, bottom, accent] = PALETTES[palette % PALETTES.length];
  const r = rng(`poster:${title}`);
  const w = 600;
  const h = 900;
  const lines = wrap(title.toUpperCase(), 12);
  const size = lines.length > 3 ? 50 : lines.some((line) => line.length > 10) ? 56 : 64;
  const startY = h - 170 - (lines.length - 1) * size;
  const text = lines.map((line, i) => `<text x="44" y="${startY + i * size}" font-size="${size}" font-weight="800">${escapeXml(line)}</text>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs>
<linearGradient id="g" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="0.75" stop-color="${bottom}"/></linearGradient>
<linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.85"/></linearGradient>
</defs>
<rect width="${w}" height="${h}" fill="url(#g)"/>${shapes(r, w, h, accent)}
<rect y="${h * 0.5}" width="${w}" height="${h * 0.5}" fill="url(#s)"/>
<rect x="44" y="${startY - size - 18}" width="64" height="6" rx="3" fill="${accent}"/>
<g fill="#fff" font-family="${FONT}">${text}</g>
<text x="44" y="${h - 96}" fill="${accent}" font-family="${FONT}" font-size="26" font-weight="700" letter-spacing="3">${escapeXml(String(genre).split(",")[0].toUpperCase())}</text>
<text x="44" y="${h - 56}" fill="#ffffffb0" font-family="${FONT}" font-size="24" letter-spacing="2">${escapeXml(year)}</text>
</svg>`;
}

/** 16:9 backdrop (details page) or episode still. */
export function backdropSvg({ title, palette, subtitle = "" }) {
  const [top, bottom, accent] = PALETTES[palette % PALETTES.length];
  const r = rng(`backdrop:${title}:${subtitle}`);
  const w = 1280;
  const h = 720;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><radialGradient id="g" cx="0.7" cy="0.3" r="0.9"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></radialGradient></defs>
<rect width="${w}" height="${h}" fill="url(#g)"/>${shapes(r, w, h, accent)}
<text x="${w - 60}" y="${h - 60}" text-anchor="end" fill="#ffffff22" font-family="${FONT}" font-size="120" font-weight="800">${escapeXml(title.toUpperCase().slice(0, 18))}</text>
</svg>`;
}

/** Square channel logo: initials in a rounded badge, with the name beneath. */
export function logoSvg({ name, palette }) {
  const [top, bottom, accent] = PALETTES[palette % PALETTES.length];
  const words = name.replace(/[^A-Za-z0-9 ]/g, "").split(" ").filter(Boolean);
  const numeric = words.find((word) => /^\d+$/.test(word));
  const initials = (words.filter((word) => !/^\d+$/.test(word)).slice(0, 2).map((word) => word[0]).join("") + (numeric ?? "")).toUpperCase();
  const label = wrap(name, 16).slice(0, 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs>
<rect x="20" y="20" width="360" height="360" rx="72" fill="url(#g)"/>
<rect x="20" y="20" width="360" height="360" rx="72" fill="none" stroke="${accent}" stroke-opacity="0.5" stroke-width="6"/>
<text x="200" y="${label.length > 1 ? 205 : 220}" text-anchor="middle" fill="#fff" font-family="${FONT}" font-size="${initials.length > 2 ? 110 : 140}" font-weight="800">${escapeXml(initials)}</text>
${label.map((line, i) => `<text x="200" y="${285 + i * 38}" text-anchor="middle" fill="${accent}" font-family="${FONT}" font-size="32" font-weight="700">${escapeXml(line)}</text>`).join("")}
</svg>`;
}
