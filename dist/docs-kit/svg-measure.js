/**
 * svg-measure.js - the bounding box of an SVG's paths, from their geometry.
 *
 * The brand settings file (brand.js) measures X, the clear-space unit, off
 * the artwork instead of taking a hand-typed number (Erlen, 2026-11-10: the
 * clear space is brand code and calculation, never hand drawn). A logo names
 * which of its paths are the glyph X is measured from; this module returns
 * their box in the logo's own viewBox units.
 *
 * Exact for lines and Bézier curves: a curve's box includes its turning
 * points, found by solving its derivative, not only its end points. An arc is
 * sampled finely, which is exact to well under a hundredth of a unit at logo
 * sizes. Transforms are refused rather than guessed: a path inside a
 * transformed group, or carrying its own transform, is an error the caller
 * reports, so a measurement is never silently wrong.
 */
'use strict';

const ARC_STEPS = 720;

// One number in path data: an optional sign, digits with at most one point,
// an optional exponent. Read from a position, so "10-5" and ".5.5" split as
// SVG means them.
const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;

/** A cursor over path data: commands, numbers, and an arc's one-digit flags. */
function reader(d) {
  let pos = 0;
  const skip = () => { while (pos < d.length && /[\s,]/.test(d[pos])) pos++; };
  return {
    done() { skip(); return pos >= d.length; },
    command() {
      skip();
      return /[MmLlHhVvCcSsQqTtAaZz]/.test(d[pos] || '') ? d[pos++] : null;
    },
    number() {
      skip();
      NUMBER.lastIndex = pos;
      const m = NUMBER.exec(d);
      if (!m) throw new Error(`path data is malformed near "${d.slice(pos, pos + 12)}"`);
      pos = NUMBER.lastIndex;
      return parseFloat(m[0]);
    },
    // An arc's large-arc and sweep flags are one character each, and may be
    // written with no space before the next number ("a1 1 0 011 1").
    flag() {
      skip();
      const c = d[pos];
      if (c !== '0' && c !== '1') throw new Error(`an arc flag must be 0 or 1, near "${d.slice(pos, pos + 12)}"`);
      pos++;
      return c === '1' ? 1 : 0;
    },
  };
}

/** Roots in [0, 1] of a t² + b t + c, for a curve's turning points. */
function unitRoots(a, b, c) {
  const roots = [];
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) roots.push(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      roots.push((-b + s) / (2 * a), (-b - s) / (2 * a));
    }
  }
  return roots.filter((t) => t > 0 && t < 1);
}

function cubicAt(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

function quadAt(p0, p1, p2, t) {
  const u = 1 - t;
  return u * u * p0 + 2 * u * t * p1 + t * t * p2;
}

/** Points along an SVG arc (endpoint parameterisation, SVG 1.1 F.6.5). */
function arcPoints(x1, y1, rx, ry, phiDeg, largeArc, sweep, x2, y2) {
  // A zero radius is a line; an arc that ends where it starts draws nothing
  if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) return [[x2, y2]];
  rx = Math.abs(rx); ry = Math.abs(ry);
  const phi = (phiDeg * Math.PI) / 180;
  const cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) { const s = Math.sqrt(lambda); rx *= s; ry *= s; }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let coef = Math.sqrt(Math.max(0, num / den));
  if (largeArc === sweep) coef = -coef;
  const cxp = coef * ((rx * y1p) / ry), cyp = coef * (-(ry * x1p) / rx);
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux, uy, vx, vy) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const t1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const pts = [];
  for (let i = 1; i <= ARC_STEPS; i++) {
    const t = t1 + (dt * i) / ARC_STEPS;
    pts.push([cos * rx * Math.cos(t) - sin * ry * Math.sin(t) + cx, sin * rx * Math.cos(t) + cos * ry * Math.sin(t) + cy]);
  }
  return pts;
}

/** The box of one path's data, as { minX, minY, maxX, maxY }, or null when it draws nothing. */
function pathBox(d) {
  const r = reader(d);
  let cmd = null;
  let x = 0, y = 0, sx = 0, sy = 0;     // current point, subpath start
  let cx2 = null, cy2 = null;           // last control point, for S and T
  let prevCmd = null;
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const add = (px, py) => {
    if (px < box.minX) box.minX = px; if (px > box.maxX) box.maxX = px;
    if (py < box.minY) box.minY = py; if (py > box.maxY) box.maxY = py;
  };
  const num = () => r.number();
  while (!r.done()) {
    const next = r.command();
    if (next) cmd = next;
    else if (cmd === null) throw new Error('path data must start with a command');
    // A number with no command repeats the last one; after a moveto it is a
    // lineto, and after a closepath it is an error
    else if (cmd === 'M') cmd = 'L';
    else if (cmd === 'm') cmd = 'l';
    else if (cmd === 'Z' || cmd === 'z') throw new Error('path data is malformed: a number follows a closepath');
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === 'Z') { x = sx; y = sy; prevCmd = 'Z'; cx2 = cy2 = null; continue; }
    const ox = rel ? x : 0, oy = rel ? y : 0;
    if (C === 'M') {
      x = ox + num(); y = oy + num(); sx = x; sy = y; add(x, y); cx2 = cy2 = null;
    } else if (C === 'L') {
      x = ox + num(); y = oy + num(); add(x, y); cx2 = cy2 = null;
    } else if (C === 'H') {
      x = (rel ? x : 0) + num(); add(x, y); cx2 = cy2 = null;
    } else if (C === 'V') {
      y = (rel ? y : 0) + num(); add(x, y); cx2 = cy2 = null;
    } else if (C === 'C' || C === 'S') {
      let x1, y1;
      if (C === 'C') { x1 = ox + num(); y1 = oy + num(); }
      else if (prevCmd === 'C' || prevCmd === 'S') { x1 = 2 * x - cx2; y1 = 2 * y - cy2; }
      else { x1 = x; y1 = y; }
      const x2 = ox + num(), y2 = oy + num(), x3 = ox + num(), y3 = oy + num();
      add(x3, y3);
      for (const [p0, p1, p2, p3, axis] of [[x, x1, x2, x3, 'x'], [y, y1, y2, y3, 'y']]) {
        const a = 3 * (-p0 + 3 * p1 - 3 * p2 + p3), b = 6 * (p0 - 2 * p1 + p2), c = 3 * (p1 - p0);
        for (const r of unitRoots(a, b, c)) {
          const v = cubicAt(p0, p1, p2, p3, r);
          if (axis === 'x') add(v, y3 === y3 ? cubicAt(y, y1, y2, y3, r) : y);
          else add(cubicAt(x, x1, x2, x3, r), v);
        }
      }
      cx2 = x2; cy2 = y2; x = x3; y = y3;
    } else if (C === 'Q' || C === 'T') {
      let x1, y1;
      if (C === 'Q') { x1 = ox + num(); y1 = oy + num(); }
      else if (prevCmd === 'Q' || prevCmd === 'T') { x1 = 2 * x - cx2; y1 = 2 * y - cy2; }
      else { x1 = x; y1 = y; }
      const x2 = ox + num(), y2 = oy + num();
      add(x2, y2);
      for (const [p0, p1, p2] of [[x, x1, x2], [y, y1, y2]]) {
        const den = p0 - 2 * p1 + p2;
        if (Math.abs(den) > 1e-12) {
          const r = (p0 - p1) / den;
          if (r > 0 && r < 1) add(quadAt(x, x1, x2, r), quadAt(y, y1, y2, r));
        }
      }
      cx2 = x1; cy2 = y1; x = x2; y = y2;
    } else if (C === 'A') {
      const rx = num(), ry = num(), rot = num(), large = r.flag(), sweep = r.flag();
      const x2 = ox + num(), y2 = oy + num();
      for (const [px, py] of arcPoints(x, y, rx, ry, rot, !!large, !!sweep, x2, y2)) add(px, py);
      x = x2; y = y2; cx2 = cy2 = null;
    }
    prevCmd = C;
  }
  return Number.isFinite(box.minX) ? box : null;
}

/**
 * The paths of an SVG, in document order, as their `d`. Throws when anything
 * carries a transform, or the markup holds something other than paths and
 * groups: another shape, text, or a mask or clip whose paths would shift the
 * numbers.
 */
function svgPaths(markup) {
  const body = markup.replace(/<!--[\s\S]*?-->/g, '');
  if (/<[a-zA-Z][^>]*\stransform\s*=/.test(body)) {
    throw new Error('it carries a transform. Flatten it on export, so its paths can be measured');
  }
  // Only paths are numbered, so anything else that draws, or a path that
  // only clips or masks, would make the numbers mean the wrong shapes
  const other = body.match(/<(rect|circle|ellipse|line|polyline|polygon|use|defs|clipPath|mask|symbol|text)\b/);
  if (other) {
    throw new Error(`it holds a <${other[1]}>. Export the logo as paths only (outline strokes and text, flatten masks), so its paths can be numbered and measured`);
  }
  const paths = [];
  for (const m of body.matchAll(/<path\b[^>]*?\sd\s*=\s*("([^"]*)"|'([^']*)')/g)) paths.push(m[2] !== undefined ? m[2] : m[3]);
  return paths;
}

/**
 * The box of the paths at the given indexes (0-based, document order), as
 * { x, y, w, h }. Throws with a reason a person can act on.
 */
function measurePaths(markup, indexes) {
  const paths = svgPaths(markup);
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const index of indexes) {
    if (!Number.isInteger(index) || index < 0 || index >= paths.length) {
      throw new Error(`it has ${paths.length} paths, so path ${index + 1} doesn't exist`);
    }
    const b = pathBox(paths[index]);
    if (!b) throw new Error(`path ${index + 1} draws nothing`);
    box.minX = Math.min(box.minX, b.minX); box.minY = Math.min(box.minY, b.minY);
    box.maxX = Math.max(box.maxX, b.maxX); box.maxY = Math.max(box.maxY, b.maxY);
  }
  return { x: box.minX, y: box.minY, w: box.maxX - box.minX, h: box.maxY - box.minY };
}

/** To two decimals, as every hand-measured X was written. */
function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { pathBox, svgPaths, measurePaths, round2 };
