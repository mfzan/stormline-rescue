// audio.js — every sound in STORMLINE is synthesized, no audio files: an engine
// drone that follows the throttle, wind that rises with speed, rain inside a
// cell, thunder on a lightning strike, and radio blips for rings and landings.
// Nothing plays until the pilot presses a key or clicks, so autoplay rules are
// respected.

export function createAudio() {
  let ac = null;
  let engineOsc, engineOsc2, engineGain, windSrc, windGain, windFilter;
  let rainSrc, rainGain, master;
  let muted = false;
  let started = false;

  function ensure() {
    if (ac) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = 0.5;
    master.connect(ac.destination);

    engineOsc = ac.createOscillator();
    engineOsc.type = 'sawtooth';
    engineOsc2 = ac.createOscillator();
    engineOsc2.type = 'square';
    const engineFilter = ac.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 420;
    engineGain = ac.createGain();
    engineGain.gain.value = 0;
    engineOsc.connect(engineFilter);
    engineOsc2.connect(engineFilter);
    engineFilter.connect(engineGain);
    engineGain.connect(master);
    engineOsc.start();
    engineOsc2.start();

    windSrc = ac.createBufferSource();
    windSrc.buffer = noiseBuffer(2);
    windSrc.loop = true;
    windFilter = ac.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 500;
    windGain = ac.createGain();
    windGain.gain.value = 0;
    windSrc.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(master);
    windSrc.start();

    rainSrc = ac.createBufferSource();
    rainSrc.buffer = noiseBuffer(2);
    rainSrc.loop = true;
    const rainFilter = ac.createBiquadFilter();
    rainFilter.type = 'highpass';
    rainFilter.frequency.value = 1800;
    rainGain = ac.createGain();
    rainGain.gain.value = 0;
    rainSrc.connect(rainFilter);
    rainFilter.connect(rainGain);
    rainGain.connect(master);
    rainSrc.start();
  }

  function noiseBuffer(seconds) {
    const buf = ac.createBuffer(1, ac.sampleRate * seconds, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  return {
    start() {
      ensure();
      if (!ac || started) return;
      started = true;
      if (ac.state === 'suspended') ac.resume();
    },
    // Called every frame with the live flight state.
    setFlight({ throttle, speedKt, rain, stalled }) {
      if (!ac || !started) return;
      const t = ac.currentTime;
      const rpm = 55 + throttle * 75 + (stalled ? 12 : 0);
      engineOsc.frequency.setTargetAtTime(rpm, t, 0.1);
      engineOsc2.frequency.setTargetAtTime(rpm * 1.5, t, 0.1);
      engineGain.gain.setTargetAtTime(muted ? 0 : 0.05 + throttle * 0.075, t, 0.15);
      windGain.gain.setTargetAtTime(muted ? 0 : Math.min(0.16, speedKt * 0.0011), t, 0.2);
      windFilter.frequency.setTargetAtTime(300 + speedKt * 6, t, 0.2);
      rainGain.gain.setTargetAtTime(muted ? 0 : rain * 0.12, t, 0.3);
    },
    beep(freq = 880) {
      if (!ac || !started || muted) return;
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.22, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.22);
      o.connect(g); g.connect(master);
      o.start(); o.stop(ac.currentTime + 0.25);
    },
    thunder() {
      if (!ac || !started || muted) return;
      const src = ac.createBufferSource();
      src.buffer = noiseBuffer(2.5);
      const f = ac.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(900, ac.currentTime);
      f.frequency.exponentialRampToValueAtTime(90, ac.currentTime + 2.2);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.5, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 2.4);
      src.connect(f); f.connect(g); g.connect(master);
      src.start();
    },
    thud() {
      if (!ac || !started || muted) return;
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(90, ac.currentTime);
      o.frequency.exponentialRampToValueAtTime(38, ac.currentTime + 0.18);
      g.gain.setValueAtTime(0.5, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.2);
      o.connect(g); g.connect(master);
      o.start(); o.stop(ac.currentTime + 0.22);
    },
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.5;
      return muted;
    },
  };
}
