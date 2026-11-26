// hud.js — the instruments, read at a glance and lit like they have been flown:
// altitude, speed and heading across the top, fuel and damage on the right, a
// live minimap with the storm cells, and the mission banner. In cockpit view a
// full six-pack of round dials sits on the glareshield.

import { STRIPS, WORLD_SIZE } from './terrain.js';

function fmt(n, digits = 0) {
  return n.toLocaleString('en-US', { maximumFractionDigits: digits });
}

export function drawHud(ctx, W, H, state) {
  const { plane, mission, rings, weather, camera, banner, time } = state;
  // The strip the pilot is flying to right now (multi-leg sorties move it).
  const targetStrip = state.target || null;
  ctx.save();
  ctx.textBaseline = 'alphabetic';

  // --- Top bar: ALT / SPD / HDG / VSI ---
  const altFt = Math.round(plane.y * 3.28084);
  const hdgDeg = ((plane.heading * 180) / Math.PI % 360 + 360) % 360;
  const items = [
    { label: 'ALT', value: `${fmt(altFt)} FT`, warn: altFt < 600 && plane.airborne },
    { label: 'SPD', value: `${Math.round(plane.speedKt)} KT`, warn: plane.stalled },
    { label: 'HDG', value: `${String(Math.round(hdgDeg)).padStart(3, '0')}°`, warn: false },
    { label: 'VSI', value: `${plane.vsFpm >= 0 ? '+' : ''}${Math.round(plane.vsFpm)} FPM`, warn: plane.vsFpm < -900 },
  ];
  const barW = Math.min(560, W * 0.52);
  const barX = (W - barW) / 2;
  ctx.fillStyle = 'rgba(12,14,20,0.62)';
  roundRect(ctx, barX, 10, barW, 54, 10); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 1;
  roundRect(ctx, barX, 10, barW, 54, 10); ctx.stroke();
  const cellW = barW / items.length;
  items.forEach((it, i) => {
    const cx = barX + cellW * i + cellW / 2;
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '600 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(it.label, cx, 28);
    ctx.fillStyle = it.warn ? '#ff5a4e' : '#ffffff';
    ctx.font = '700 19px system-ui, sans-serif';
    ctx.fillText(it.value, cx, 52);
  });

  // --- Right column: fuel, damage, wind ---
  const rx = W - 178, ry = 76;
  ctx.fillStyle = 'rgba(12,14,20,0.62)';
  roundRect(ctx, rx, ry, 168, 108, 10); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  roundRect(ctx, rx, ry, 168, 108, 10); ctx.stroke();
  gauge(ctx, rx + 14, ry + 24, 140, 'FUEL', plane.fuel / 100, plane.fuel < 25 ? '#ff5a4e' : '#ffb042');
  gauge(ctx, rx + 14, ry + 54, 140, 'DAMAGE', plane.damage / 100, '#ff5a4e');
  const windKt = Math.round(Math.hypot(plane.wind.x, plane.wind.z) / 0.514444);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '600 12px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`WIND ${windKt} KT`, rx + 14, ry + 94);
  if (plane.wind.gust > 0.25) {
    ctx.fillStyle = '#ffb042';
    ctx.fillText('GUSTING', rx + 104, ry + 94);
  }

  // --- Mission banner, bottom-left ---
  const ringsHit = state.stats ? state.stats.ringsHit : rings.filter((r) => r.passed).length;
  const ringsTotal = state.stats ? state.stats.ringsTotal : rings.length;
  ctx.fillStyle = 'rgba(12,14,20,0.62)';
  roundRect(ctx, 12, H - 92, 330, 80, 10); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  roundRect(ctx, 12, H - 92, 330, 80, 10); ctx.stroke();
  ctx.fillStyle = '#ffb042';
  ctx.font = '700 13px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(mission.name.toUpperCase(), 24, H - 66);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = '500 12px system-ui, sans-serif';
  ctx.fillText(`Rings ${ringsHit}/${ringsTotal}   ·   ${mission.kind.toUpperCase()}`, 24, H - 46);
  ctx.fillStyle = plane.fuel < 25 ? '#ff5a4e' : 'rgba(255,255,255,0.6)';
  const legNote = state.legs > 1 ? `  ·  Leg ${state.leg}/${state.legs}` : '';
  ctx.fillText(plane.stalled ? 'STALL — NOSE DOWN, POWER UP' : `Target: ${targetStrip ? targetStrip.name : stripName(mission)}${legNote}`, 24, H - 26);

  // --- Minimap, bottom-right ---
  drawMinimap(ctx, W - 172, H - 172, 160, state);

  // --- Stall / warning flash ---
  if (plane.stalled) {
    ctx.fillStyle = `rgba(255,60,40,${0.12 + 0.08 * Math.sin(time * 10)})`;
    ctx.fillRect(0, 0, W, H);
  }

  // --- Centre banner (events: ring, touchdown, crash, pickup) ---
  if (banner && banner.until > time) {
    const alpha = Math.min(1, (banner.until - time) / 0.5);
    ctx.globalAlpha = alpha;
    ctx.font = '700 26px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = banner.color || '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 12;
    ctx.fillText(banner.text, W / 2, H * 0.3);
    ctx.shadowBlur = 0;
    if (banner.sub) {
      ctx.font = '500 15px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillText(banner.sub, W / 2, H * 0.3 + 28);
    }
    ctx.globalAlpha = 1;
  }

  // --- Cockpit six-pack ---
  if (camera === 'cockpit') drawSixPack(ctx, W, H, plane);

  ctx.restore();
}

function stripName(mission) {
  const s = STRIPS.find((x) => x.id === mission.strip);
  return s ? s.name : '';
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function gauge(ctx, x, y, w, label, frac, color) {
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '600 10px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(label, x, y - 6);
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  roundRect(ctx, x, y, w, 9, 4); ctx.fill();
  ctx.fillStyle = color;
  roundRect(ctx, x, y, Math.max(6, w * Math.max(0, Math.min(1, frac))), 9, 4); ctx.fill();
}

function drawMinimap(ctx, x, y, size, state) {
  const { plane, mission, weather, rings } = state;
  const targetStrip = state.target || null;
  ctx.fillStyle = 'rgba(12,14,20,0.66)';
  roundRect(ctx, x, y, size, size, 10); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  roundRect(ctx, x, y, size, size, 10); ctx.stroke();
  const toMap = (wx, wz) => ({
    x: x + ((wx / WORLD_SIZE + 0.5) * (size - 12)) + 6,
    y: y + ((wz / WORLD_SIZE + 0.5) * (size - 12)) + 6,
  });
  // Storm cells as red swirls.
  for (const c of weather.cells) {
    const p = toMap(c.x, c.z);
    const r = (c.r / WORLD_SIZE) * (size - 12);
    ctx.fillStyle = 'rgba(255,80,60,0.30)';
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,120,90,0.8)';
    ctx.beginPath(); ctx.arc(p.x, p.y, r * 0.55, 0, Math.PI * 2); ctx.stroke();
  }
  // Rings as faint dots, target strip as a diamond.
  for (const r of rings) {
    if (r.passed) continue;
    const p = toMap(r.x, r.z);
    ctx.fillStyle = 'rgba(255,176,66,0.9)';
    ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
  }
  for (const s of STRIPS) {
    const p = toMap(s.x, s.z);
    const target = s.id === (targetStrip ? targetStrip.id : mission.strip);
    ctx.fillStyle = target ? '#ffb042' : 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    if (target) {
      ctx.moveTo(p.x, p.y - 6); ctx.lineTo(p.x + 6, p.y);
      ctx.lineTo(p.x, p.y + 6); ctx.lineTo(p.x - 6, p.y);
      ctx.closePath(); ctx.fill();
    } else {
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
    }
  }
  // The plane.
  const p = toMap(plane.x, plane.z);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(plane.heading);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6);
  ctx.closePath(); ctx.fill();
  ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '600 9px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('MAP — STORMS IN RED', x + 8, y + 13);
}

function drawSixPack(ctx, W, H, plane) {
  const panelY = H * 0.86;
  const cy = panelY + (H - panelY) / 2;
  const dials = [
    { x: W * 0.30, label: 'ATT', draw: (c, r) => drawAttitude(c, r, plane) },
    { x: W * 0.42, label: 'SPD', draw: (c, r) => drawDial(c, r, plane.speedKt, 0, 160, 'KT') },
    { x: W * 0.54, label: 'ALT', draw: (c, r) => drawDial(c, r, plane.y * 3.28084, 0, 9000, 'FT') },
    { x: W * 0.66, label: 'HDG', draw: (c, r) => drawHeading(c, r, plane) },
  ];
  for (const d of dials) {
    const r = Math.min(34, (H - panelY) / 2 - 8);
    ctx.fillStyle = '#14161c';
    ctx.beginPath(); ctx.arc(d.x, cy, r + 5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#3a3f4a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(d.x, cy, r + 5, 0, Math.PI * 2); ctx.stroke();
    ctx.save();
    ctx.beginPath(); ctx.arc(d.x, cy, r, 0, Math.PI * 2); ctx.clip();
    d.draw({ x: d.x, y: cy }, r);
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '600 9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(d.label, d.x, cy + r + 14);
  }
}

function drawDial(c, r, value, min, max, unit) {
  const ctx = currentCtx();
  ctx.fillStyle = '#0e1013';
  ctx.fillRect(c.x - r, c.y - r, r * 2, r * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1;
  for (let i = 0; i <= 10; i++) {
    const a = -Math.PI * 0.75 + (i / 10) * Math.PI * 1.5;
    ctx.beginPath();
    ctx.moveTo(c.x + Math.cos(a) * (r - 3), c.y + Math.sin(a) * (r - 3));
    ctx.lineTo(c.x + Math.cos(a) * (r - 8), c.y + Math.sin(a) * (r - 8));
    ctx.stroke();
  }
  const frac = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const a = -Math.PI * 0.75 + frac * Math.PI * 1.5;
  ctx.strokeStyle = '#ffb042'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(c.x, c.y);
  ctx.lineTo(c.x + Math.cos(a) * (r - 10), c.y + Math.sin(a) * (r - 10)); ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = '700 11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(String(Math.round(value)), c.x, c.y + r * 0.55);
}

function drawAttitude(c, r, plane) {
  const ctx = currentCtx();
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(-plane.roll);
  const off = plane.pitch * r * 2.2;
  ctx.fillStyle = '#3a6ea8';
  ctx.fillRect(-r, -r + off, r * 2, r);
  ctx.fillStyle = '#8a6a45';
  ctx.fillRect(-r, off, r * 2, r);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-r, off); ctx.lineTo(r, off); ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = '#ffb042'; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(c.x - r * 0.5, c.y); ctx.lineTo(c.x - r * 0.15, c.y);
  ctx.moveTo(c.x + r * 0.15, c.y); ctx.lineTo(c.x + r * 0.5, c.y);
  ctx.stroke();
  ctx.fillStyle = '#ffb042';
  ctx.beginPath(); ctx.arc(c.x, c.y, 3, 0, Math.PI * 2); ctx.fill();
}

function drawHeading(c, r, plane) {
  const ctx = currentCtx();
  ctx.fillStyle = '#0e1013';
  ctx.fillRect(c.x - r, c.y - r, r * 2, r * 2);
  const hdg = ((plane.heading * 180) / Math.PI % 360 + 360) % 360;
  ctx.fillStyle = '#fff';
  ctx.font = '700 13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(String(Math.round(hdg)).padStart(3, '0'), c.x, c.y + 5);
  ctx.fillStyle = '#ffb042';
  ctx.beginPath();
  ctx.moveTo(c.x, c.y - r + 4); ctx.lineTo(c.x - 5, c.y - r + 12); ctx.lineTo(c.x + 5, c.y - r + 12);
  ctx.closePath(); ctx.fill();
}

// The dial helpers need the context; set by drawHud through a module slot.
let _ctx = null;
export function setHudCtx(ctx) { _ctx = ctx; }
function currentCtx() { return _ctx; }
