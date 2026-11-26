// input.js — keyboard and mouse for STORMLINE. Arrows fly the plane, W/S work
// the throttle, F drops the flaps, C swaps chase and cockpit cameras, P pauses,
// M mutes, Enter confirms a menu choice and R restarts after a crash. The mouse
// clicks the menu buttons the game draws.

export function createInput(canvas) {
  const keys = new Set();
  const pressed = new Set(); // edge-triggered keys, consumed once
  let click = null; // {x, y} of the last click in canvas pixels, consumed once

  function code(e) {
    return e.code || e.key;
  }
  window.addEventListener('keydown', (e) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(code(e))) {
      e.preventDefault();
    }
    if (!keys.has(code(e))) pressed.add(code(e));
    keys.add(code(e));
  });
  window.addEventListener('keyup', (e) => keys.delete(code(e)));
  canvas.addEventListener('mousedown', (e) => {
    const r = canvas.getBoundingClientRect();
    const sx = canvas.width / r.width;
    const sy = canvas.height / r.height;
    click = { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
  });
  window.addEventListener('blur', () => keys.clear());

  return {
    // Continuous control state, read every frame by the flight model.
    readControls() {
      const pitch = (keys.has('ArrowUp') ? 1 : 0) + (keys.has('ArrowDown') ? -1 : 0);
      const roll = (keys.has('ArrowLeft') ? -1 : 0) + (keys.has('ArrowRight') ? 1 : 0);
      let throttle = null;
      if (keys.has('KeyW') || keys.has('ShiftLeft') || keys.has('ShiftRight')) throttle = 'up';
      if (keys.has('KeyS') || keys.has('ControlLeft') || keys.has('ControlRight')) throttle = 'down';
      return { pitch, roll, throttle };
    },
    // Was this key pressed since the last check? (menus, toggles)
    wasPressed(name) {
      if (pressed.has(name)) {
        pressed.delete(name);
        return true;
      }
      return false;
    },
    has(name) {
      return keys.has(name);
    },
    takeClick() {
      const c = click;
      click = null;
      return c;
    },
    clearPressed() {
      pressed.clear();
    },
  };
}
