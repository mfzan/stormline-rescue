// render.js — the STORMLINE 2.5D renderer: dusk sky, a painter's-algorithm
// heightfield, mountain strips, ring gates and the bush plane itself, all drawn
// on one canvas with no library and no network. The camera is a chase camera
// behind the plane (or a cockpit camera at the nose); the world is projected with
// a yaw/pitch perspective transform and drawn far-to-near.

import { WORLD_SIZE, GRID, CELL, PEAKS, STRIPS } from './terrain.js';

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0;
  function resize(w, h) { W = w; H = h; canvas.width = w; canvas.height = h; }

  // Cloud puffs live at fixed world spots so the sky is stable between frames.
  const clouds = [];
  {
    let s = 987654321;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < 22; i++) {
      clouds.push({
        x: (rnd() - 0.5) * WORLD_SIZE * 0.9,
        z: (rnd() - 0.5) * WORLD_SIZE * 0.9,
        y: 1700 + rnd() * 1200,
        r: 300 + rnd() * 420,
        a: 0.15 + rnd() * 0.18,
      });
    }
  }

  // Project a world point into screen space. Returns null when behind the camera.
  // Forward is (sin h, -cos h): depth = dx*sin(h) - dz*cos(h), right = dx*cos(h)
  // + dz*sin(h). (An earlier build had the yaw sign flipped, which pointed the
  // camera backwards — the rings and strips ahead never drew. This is the fix.)
  // With clampNear, a point a hair behind the near plane is clamped onto it
  // instead of dropped: terrain quads straddling the camera would otherwise
  // leave holes in the ground right under the plane.
  function project(cam, px, py, pz, clampNear) {
    const dx = px - cam.x, dy = py - cam.y, dz = pz - cam.z;
    const sinH = Math.sin(cam.heading), cosH = Math.cos(cam.heading);
    const rx = dx * cosH + dz * sinH;
    const rz = dx * sinH - dz * cosH;
    const sinP = Math.sin(cam.pitch), cosP = Math.cos(cam.pitch);
    const ry = dy * cosP - rz * sinP;
    let rz2 = dy * sinP + rz * cosP;
    if (rz2 < 8) {
      // Only points just behind the plane are clamped onto it; points far
      // behind would smear across the whole frame if clamped, so drop those.
      if (!clampNear || rz2 < -60) return null;
      rz2 = 8;
    }
    const f = (H / 2) / Math.tan((62 * Math.PI) / 360);
    return { x: W / 2 + (rx / rz2) * f, y: H / 2 - (ry / rz2) * f, d: rz2 };
  }

  function drawSky(cam, weather, t) {
    const horizonY = H / 2 - Math.tan(cam.pitch) * (H / 2) / Math.tan((62 * Math.PI) / 360);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    const storm = weather.rainAt(cam.x, cam.z);
    if (storm > 0.35) {
      g.addColorStop(0, '#2c3247'); g.addColorStop(0.55, '#5a5f74');
      g.addColorStop(0.72, '#8a6f63'); g.addColorStop(1, '#3a3340');
    } else {
      g.addColorStop(0, '#1d2a52'); g.addColorStop(0.45, '#4a5f8f');
      g.addColorStop(0.68, '#c97e4e'); g.addColorStop(0.75, '#e8a35c');
      g.addColorStop(1, '#2e2a33');
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // Low dusk sun in the west, fixed in the world so it parallaxes with heading.
    const sunDir = Math.atan2(-1, 0.35);
    let sunA = sunDir - cam.heading;
    while (sunA > Math.PI) sunA -= 2 * Math.PI;
    while (sunA < -Math.PI) sunA += 2 * Math.PI;
    if (Math.abs(sunA) < 1.1) {
      const sx = W / 2 + Math.tan(sunA) * (H / 2) / Math.tan((62 * Math.PI) / 360) * 1.4;
      const sy = horizonY - H * 0.06;
      const sg = ctx.createRadialGradient(sx, sy, 4, sx, sy, 120);
      sg.addColorStop(0, 'rgba(255,214,140,0.95)');
      sg.addColorStop(0.25, 'rgba(255,170,90,0.55)');
      sg.addColorStop(1, 'rgba(255,150,70,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(sx - 130, sy - 130, 260, 260);
      ctx.fillStyle = '#ffe6b0';
      ctx.beginPath(); ctx.arc(sx, sy, 22, 0, Math.PI * 2); ctx.fill();
    }
    // Cloud puffs, far to near.
    const drawn = [];
    for (const c of clouds) {
      const p = project(cam, c.x, c.y, c.z);
      if (!p) continue;
      drawn.push({ p, c });
    }
    drawn.sort((a, b) => b.p.d - a.p.d);
    for (const { p, c } of drawn) {
      const r = Math.max(8, (c.r / p.d) * (H / 2) / Math.tan((62 * Math.PI) / 360));
      ctx.fillStyle = `rgba(235,228,222,${c.a * (1 - storm * 0.45)})`;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, r, r * 0.32, 0, 0, Math.PI * 2);
      ctx.ellipse(p.x - r * 0.5, p.y + r * 0.08, r * 0.6, r * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawTerrain(cam, terrain) {
    // Rows sorted far-to-near from the camera, so nearer ground paints over far.
    const rows = [];
    for (let j = 0; j < GRID; j++) {
      const zc = (j + 0.5) / GRID * WORLD_SIZE - WORLD_SIZE / 2;
      const xc = 0;
      const dx = xc - cam.x, dz = zc - cam.z;
      rows.push({ j, d: dx * dx + dz * dz });
    }
    rows.sort((a, b) => b.d - a.d);
    for (const { j } of rows) {
      const z0 = (j / GRID - 0.5) * WORLD_SIZE;
      const z1 = ((j + 1) / GRID - 0.5) * WORLD_SIZE;
      for (let i = 0; i < GRID; i++) {
        const x0 = (i / GRID - 0.5) * WORLD_SIZE;
        const x1 = ((i + 1) / GRID - 0.5) * WORLD_SIZE;
        const h00 = terrain.heights[j * (GRID + 1) + i];
        const h10 = terrain.heights[j * (GRID + 1) + i + 1];
        const h01 = terrain.heights[(j + 1) * (GRID + 1) + i];
        const h11 = terrain.heights[(j + 1) * (GRID + 1) + i + 1];
        const a = project(cam, x0, h00, z0, true);
        const b = project(cam, x1, h10, z0, true);
        const c = project(cam, x1, h11, z1, true);
        const d = project(cam, x0, h01, z1, true);
        if (!a || !b || !c || !d) continue;
        if (Math.max(a.x, b.x, c.x, d.x) < -40 || Math.min(a.x, b.x, c.x, d.x) > W + 40) continue;
        if (Math.max(a.y, b.y, c.y, d.y) < -40 || Math.min(a.y, b.y, c.y, d.y) > H + 40) continue;
        ctx.fillStyle = terrain.colors[j * GRID + i];
        ctx.beginPath();
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y);
        ctx.closePath(); ctx.fill();
      }
    }
  }

  function drawStrip(cam, strip) {
    const hdg = (strip.hdg * Math.PI) / 180;
    const dirX = Math.sin(hdg), dirZ = -Math.cos(hdg);
    const perpX = dirZ, perpZ = -dirX;
    const hl = strip.len / 2, hw = 20;
    const corner = (a, b) => ({
      x: strip.x + dirX * a + perpX * b,
      y: strip.elev + 1,
      z: strip.z + dirZ * a + perpZ * b,
    });
    // The runway is drawn in 8 lengthwise segments: the half behind the camera
    // must not cull the half ahead of it (the pilot is parked on the strip).
    const segs = 8;
    for (let k = 0; k < segs; k++) {
      const a0 = -hl + (k * 2 * hl) / segs;
      const a1 = -hl + ((k + 1) * 2 * hl) / segs;
      const q1 = project(cam, corner(a0, -hw).x, corner(a0, -hw).y, corner(a0, -hw).z, true);
      const q2 = project(cam, corner(a1, -hw).x, corner(a1, -hw).y, corner(a1, -hw).z, true);
      const q3 = project(cam, corner(a1, hw).x, corner(a1, hw).y, corner(a1, hw).z, true);
      const q4 = project(cam, corner(a0, hw).x, corner(a0, hw).y, corner(a0, hw).z, true);
      if (!q1 || !q2 || !q3 || !q4) continue;
      ctx.fillStyle = '#3c3f45';
      ctx.beginPath();
      ctx.moveTo(q1.x, q1.y); ctx.lineTo(q2.x, q2.y);
      ctx.lineTo(q3.x, q3.y); ctx.lineTo(q4.x, q4.y);
      ctx.closePath(); ctx.fill();
    }
    // Small details (markings, windsock, hangar, name) only read up close and
    // below the horizon: from kilometres away, or high above the camera, they
    // collapse into floating specks across the sky, so skip them.
    const dist = Math.hypot(cam.x - strip.x, cam.z - strip.z);
    const horizonY = H / 2 - Math.tan(cam.pitch) * (H / 2) / Math.tan((62 * Math.PI) / 360);
    const midEarly = project(cam, strip.x, strip.elev + 8, strip.z);
    const near = dist < 2500 && midEarly && midEarly.y > horizonY;
    if (!near) return;
    // Threshold bars at both ends so the strip reads as a runway, not a road.
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 3;
    for (const end of [-hl + 14, hl - 14]) {
      const a = project(cam, strip.x + dirX * end + perpX * -13, strip.elev + 1.5, strip.z + dirZ * end + perpZ * -13, true);
      const b = project(cam, strip.x + dirX * end + perpX * 13, strip.elev + 1.5, strip.z + dirZ * end + perpZ * 13, true);
      if (a && b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    }
    // Centreline dashes.
    ctx.strokeStyle = 'rgba(240,240,230,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    const n = 6;
    for (let k = 0; k < n; k++) {
      const t0 = -hl + (k * 2 * hl) / n + 12;
      const t1 = -hl + ((k + 0.55) * 2 * hl) / n;
      const a = project(cam, strip.x + dirX * t0, strip.elev + 1.5, strip.z + dirZ * t0, true);
      const b = project(cam, strip.x + dirX * t1, strip.elev + 1.5, strip.z + dirZ * t1, true);
      if (a && b) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
    }
    ctx.stroke();
    // Windsock at the threshold.
    const ws = project(cam, strip.x + perpX * 34, strip.elev + 14, strip.z + perpZ * 34);
    const wsB = project(cam, strip.x + perpX * 34, strip.elev + 1, strip.z + perpZ * 34);
    if (ws && wsB) {
      ctx.strokeStyle = '#d8d8d8'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(wsB.x, wsB.y); ctx.lineTo(ws.x, ws.y); ctx.stroke();
      ctx.fillStyle = '#e8542f';
      ctx.beginPath(); ctx.arc(ws.x, ws.y, 4, 0, Math.PI * 2); ctx.fill();
    }
    // A small hangar beside the strip: two faces of a box, roof in red.
    const hx = strip.x - perpX * 44, hz = strip.z - perpZ * 44;
    const hw2 = 14, hd2 = 10, hh = 8;
    const top = [
      project(cam, hx - hw2, strip.elev + hh, hz - hd2),
      project(cam, hx + hw2, strip.elev + hh, hz - hd2),
      project(cam, hx + hw2, strip.elev + hh, hz + hd2),
      project(cam, hx - hw2, strip.elev + hh, hz + hd2),
    ];
    const front = [
      project(cam, hx - hw2, strip.elev + 1, hz + hd2),
      project(cam, hx + hw2, strip.elev + 1, hz + hd2),
      project(cam, hx + hw2, strip.elev + hh, hz + hd2),
      project(cam, hx - hw2, strip.elev + hh, hz + hd2),
    ];
    if (top.every(Boolean) && front.every(Boolean)) {
      ctx.fillStyle = '#c8442c';
      ctx.beginPath();
      ctx.moveTo(top[0].x, top[0].y); ctx.lineTo(top[1].x, top[1].y);
      ctx.lineTo(top[2].x, top[2].y); ctx.lineTo(top[3].x, top[3].y);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#6b6258';
      ctx.beginPath();
      ctx.moveTo(front[0].x, front[0].y); ctx.lineTo(front[1].x, front[1].y);
      ctx.lineTo(front[2].x, front[2].y); ctx.lineTo(front[3].x, front[3].y);
      ctx.closePath(); ctx.fill();
    }
    // Strip name tag, readable when close (and never over the top HUD bar, and
    // never when parked on the strip itself — the font grows with closeness).
    const mid = project(cam, strip.x, strip.elev + 8, strip.z);
    if (mid && mid.d > 120 && mid.d < 1500 && mid.y > 110) {
      ctx.font = `600 ${Math.min(26, Math.max(11, 340 / mid.d * 14))}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillText(strip.name.toUpperCase(), mid.x, mid.y - 14);
    }
  }

  function drawRing(cam, ring, isNext) {
    const p = project(cam, ring.x, ring.y, ring.z);
    if (!p) return;
    const f = (H / 2) / Math.tan((62 * Math.PI) / 360);
    const r = Math.max(3, (ring.r / p.d) * f);
    ctx.save();
    ctx.lineWidth = isNext ? 5 : 3;
    ctx.strokeStyle = ring.passed
      ? 'rgba(120,220,130,0.55)'
      : isNext ? 'rgba(255,176,66,0.95)' : 'rgba(255,255,255,0.4)';
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
    if (isNext) {
      ctx.lineWidth = 12;
      ctx.strokeStyle = 'rgba(255,176,66,0.22)';
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  // The bush plane, seen from behind and above in chase view: high wing, red
  // and white livery, tundra tyres, nav lights. It rolls with the airframe.
  function drawPlaneChase(plane) {
    const cx = W / 2, cy = H * 0.62;
    const s = Math.min(W, H) / 560;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-plane.roll);
    ctx.translate(0, plane.pitch * 260 * s);
    ctx.scale(s, s);
    // Wing (high wing, spans wide).
    ctx.fillStyle = '#e8e4da';
    ctx.beginPath();
    ctx.moveTo(-150, -8); ctx.lineTo(150, -8); ctx.lineTo(138, 10); ctx.lineTo(-138, 10);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#c8442c';
    ctx.fillRect(-150, -8, 34, 18); ctx.fillRect(116, -8, 34, 18);
    // Fuselage, seen from behind: tapered, red cheatline.
    ctx.fillStyle = '#f2efe6';
    ctx.beginPath();
    ctx.moveTo(-26, -34); ctx.lineTo(26, -34); ctx.lineTo(30, 34);
    ctx.quadraticCurveTo(0, 46, -30, 34); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#c8442c';
    ctx.fillRect(-27, -6, 54, 10);
    // Tailplane + fin.
    ctx.fillStyle = '#e8e4da';
    ctx.beginPath();
    ctx.moveTo(-58, 26); ctx.lineTo(58, 26); ctx.lineTo(50, 38); ctx.lineTo(-50, 38);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#c8442c';
    ctx.beginPath();
    ctx.moveTo(-12, -34); ctx.lineTo(12, -34); ctx.lineTo(8, -62); ctx.lineTo(-8, -62);
    ctx.closePath(); ctx.fill();
    // Tundra tyres.
    ctx.fillStyle = '#22242a';
    ctx.beginPath(); ctx.arc(-20, 52, 11, 0, Math.PI * 2); ctx.arc(20, 52, 11, 0, Math.PI * 2); ctx.fill();
    // Nav lights.
    ctx.fillStyle = '#ff3b30';
    ctx.beginPath(); ctx.arc(-150, 0, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#35d461';
    ctx.beginPath(); ctx.arc(150, 0, 4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawRain(cam, weather, t) {
    const rain = weather.rainAt(cam.x, cam.z);
    if (rain <= 0.02) return;
    const n = Math.floor(rain * 260);
    ctx.strokeStyle = 'rgba(200,215,235,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    let s = 424242;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < n; i++) {
      const x = rnd() * W, y = rnd() * H;
      const len = 14 + rain * 22;
      ctx.moveTo(x, y); ctx.lineTo(x - len * 0.18, y + len);
    }
    ctx.stroke();
    // Lightning wash.
    const flash = weather.flashAt(cam.x, cam.z);
    if (flash > 0.02) {
      ctx.fillStyle = `rgba(230,235,255,${flash * 0.28})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function drawCockpitFrame() {
    // Windscreen pillars + glareshield: the cockpit the pilot actually sits in.
    ctx.fillStyle = '#1c1e24';
    ctx.beginPath();
    ctx.moveTo(0, H); ctx.lineTo(0, H * 0.72);
    ctx.lineTo(W * 0.1, H * 0.68); ctx.lineTo(W * 0.16, H);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(W, H); ctx.lineTo(W, H * 0.72);
    ctx.lineTo(W * 0.9, H * 0.68); ctx.lineTo(W * 0.84, H);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#20222a';
    ctx.fillRect(0, H * 0.86, W, H * 0.14);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(0, H * 0.86, W, 3);
  }

  return {
    resize,
    render(state) {
      const { terrain, plane, weather, rings, camera, time } = state;
      const cam = camera === 'cockpit'
        ? {
            x: plane.x + Math.sin(plane.heading) * 2,
            y: plane.y + 1.6,
            z: plane.z - Math.cos(plane.heading) * 2,
            heading: plane.heading, pitch: plane.pitch * 0.9 + 0.05,
          }
        : {
            x: plane.x - Math.sin(plane.heading) * (plane.onGround ? 26 : 17) - Math.sin(plane.roll) * 2,
            y: plane.y + (plane.onGround ? 13 : 7.5) + plane.pitch * 4,
            z: plane.z + Math.cos(plane.heading) * (plane.onGround ? 26 : 17),
            heading: plane.heading, pitch: plane.pitch * 0.55 - 0.06,
          };
      drawSky(cam, weather, time);
      drawTerrain(cam, terrain);
      for (const strip of STRIPS) drawStrip(cam, strip);
      const nextIdx = rings.findIndex((r) => !r.passed);
      rings.forEach((r, i) => drawRing(cam, r, i === nextIdx));
      if (camera === 'chase') drawPlaneChase(plane);
      else drawCockpitFrame();
      drawRain(cam, weather, time);
    },
  };
}

export function peakLabelPositions() {
  return PEAKS.map((p) => ({ name: p.name, x: p.x, z: p.z }));
}
