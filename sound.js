const Sound = (() => {
  let audioCtx = null;
  let musicTimeoutId = null;
  let musicOscillators = [];
  let muted = false;
  // Mute is a hard gate — when true, playTone returns immediately and
  // startMusic is a no-op. Persistence lives at the caller layer (e.g.
  // wefty-run.html uses localStorage.wefty_sound_muted).
  function setMuted(m) {
    muted = !!m;
    if (muted) stopMusic();
  }
  function isMuted() { return muted; }

  function ensureContext() {
    if (audioCtx) {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      return audioCtx;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) {
      audioCtx = null;
    }
    return audioCtx;
  }

  // 3-overtone synthesis matching Android's SoundManager
  function playTone(freq, durationMs, volume, overtone2, overtone3) {
    return new Promise((resolve) => {
      if (muted) { resolve(); return; }
      try {
        const ctx = ensureContext();
        if (!ctx) { resolve(); return; }

        const now = ctx.currentTime;
        const dur = durationMs / 1000;
        const attack = dur * 0.1;
        const release = dur * 0.1;

        const masterGain = ctx.createGain();
        masterGain.gain.setValueAtTime(0, now);
        masterGain.gain.linearRampToValueAtTime(volume, now + attack);
        masterGain.gain.setValueAtTime(volume, now + dur - release);
        masterGain.gain.linearRampToValueAtTime(0, now + dur);
        masterGain.connect(ctx.destination);

        // Fundamental
        const osc1 = ctx.createOscillator();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(freq, now);
        const g1 = ctx.createGain();
        g1.gain.setValueAtTime(0.7, now);
        osc1.connect(g1);
        g1.connect(masterGain);
        osc1.start(now);
        osc1.stop(now + dur);

        // 2nd overtone
        const o2amp = overtone2 !== undefined ? overtone2 : 0.15;
        const osc2 = ctx.createOscillator();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(freq * 2, now);
        const g2 = ctx.createGain();
        g2.gain.setValueAtTime(o2amp, now);
        osc2.connect(g2);
        g2.connect(masterGain);
        osc2.start(now);
        osc2.stop(now + dur);

        // 3rd overtone
        const o3amp = overtone3 !== undefined ? overtone3 : 0.08;
        const osc3 = ctx.createOscillator();
        osc3.type = 'sine';
        osc3.frequency.setValueAtTime(freq * 3, now);
        const g3 = ctx.createGain();
        g3.gain.setValueAtTime(o3amp, now);
        osc3.connect(g3);
        g3.connect(masterGain);
        osc3.start(now);
        osc3.stop(now + dur);

        musicOscillators.push(osc1, osc2, osc3);
        osc1.onended = () => {
          musicOscillators = musicOscillators.filter(o => o !== osc1 && o !== osc2 && o !== osc3);
        };

        setTimeout(resolve, durationMs);
      } catch (e) {
        resolve();
      }
    });
  }

  function pause(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Sound effects matching Android volumes/durations
  async function playClick() {
    await playTone(800, 30, 0.15);
  }

  async function playTurnChange() {
    await playTone(660, 80, 0.10);
    await playTone(880, 120, 0.10);
  }

  async function playWordSubmit() {
    await playTone(523, 60, 0.08);
  }

  async function playGameStart() {
    await playTone(523, 100, 0.12);
    await playTone(659, 100, 0.12);
    await playTone(784, 150, 0.12);
  }

  async function playGameEnd() {
    await playTone(784, 120, 0.12);
    await playTone(659, 120, 0.12);
    await playTone(523, 120, 0.12);
    await playTone(784, 200, 0.14);
  }

  async function playTimerWarning() {
    await playTone(880, 50, 0.08);
    await pause(100);
    await playTone(880, 50, 0.08);
  }

  // Melodies matching Android SoundManager exactly
  const melodies = {
    jazz: {
      notes:     [262, 294, 330, 392, 440, 392, 330, 349, 392, 330, 294, 330, 262, 294, 330, 392, 440, 392, 330, 294],
      durations: [400, 300, 500, 300, 600, 300, 400, 300, 500, 400, 300, 500, 600, 300, 400, 300, 500, 400, 300, 600],
      volume: 0.15,
      overtone2: 0.15,
      overtone3: 0.08,
      gap: 50,
      loopPause: 300
    },
    lullaby: {
      notes:     [262, 330, 392, 330, 262, 330, 392, 440, 392, 330, 294, 262, 294, 330, 294, 262],
      durations: [600, 600, 800, 400, 600, 600, 800, 800, 600, 400, 600, 800, 600, 600, 400, 800],
      volume: 0.12,
      overtone2: 0.08,
      overtone3: 0.03,
      gap: 80,
      loopPause: 500
    },
    bossa: {
      notes:     [330, 349, 392, 349, 330, 294, 330, 349, 392, 440, 494, 440, 392, 349, 330, 294, 262, 294, 330, 392],
      durations: [300, 200, 400, 200, 300, 300, 200, 400, 300, 200, 400, 200, 300, 300, 200, 400, 500, 300, 300, 500],
      volume: 0.14,
      overtone2: 0.12,
      overtone3: 0.06,
      gap: 30,
      loopPause: 400
    },
    blues: {
      notes:     [196, 220, 233, 262, 294, 262, 233, 220, 196, 262, 294, 330, 294, 262, 233, 196],
      durations: [500, 300, 400, 600, 500, 400, 300, 500, 600, 400, 300, 500, 400, 500, 300, 700],
      volume: 0.14,
      overtone2: 0.20,
      overtone3: 0.10,
      gap: 60,
      loopPause: 500
    },
    chiptune: {
      notes:     [523, 587, 659, 784, 659, 587, 523, 494, 523, 659, 784, 880, 784, 659, 523, 494, 440, 523, 587, 659],
      durations: [150, 150, 150, 300, 150, 150, 150, 300, 150, 150, 150, 300, 150, 150, 150, 300, 150, 150, 150, 300],
      volume: 0.12,
      overtone2: 0.25,
      overtone3: 0.20,
      gap: 20,
      loopPause: 200
    }
  };

  let currentMusicStyle = null;

  // Lyria-generated instrumental loops replacing the MIDI-style synth
  // for the two styles the user liked most. Other styles keep the
  // 3-overtone synth path below.
  const loopTracks = {
    jazz:     { src: 'jazz_loop.mp3',     volume: 0.35 },
    chiptune: { src: 'chiptune_loop.mp3', volume: 0.32 },
    lullaby:  { src: 'lullaby_loop.mp3',  volume: 0.32 },
    bossa:    { src: 'bossa_loop.mp3',    volume: 0.34 },
    blues:    { src: 'blues_loop.mp3',    volume: 0.34 },
  };
  let loopAudio = null;

  function startMusic(style, force) {
    if (muted) return;
    // Don't restart if already playing the same style
    if (!force && currentMusicStyle === style && (musicTimeoutId || loopAudio)) return;
    stopMusic();
    currentMusicStyle = style;

    const track = loopTracks[style];
    if (track) {
      loopAudio = new Audio(track.src);
      loopAudio.loop = true;
      loopAudio.volume = track.volume;
      loopAudio.play().catch(() => {});
      return;
    }

    const melody = melodies[style];
    if (!melody) return;

    let noteIndex = 0;
    let stopped = false;

    function playNext() {
      if (stopped) return;
      const freq = melody.notes[noteIndex];
      const dur = melody.durations[noteIndex];
      playTone(freq, dur, melody.volume, melody.overtone2, melody.overtone3);
      noteIndex++;

      if (noteIndex >= melody.notes.length) {
        noteIndex = 0;
        musicTimeoutId = setTimeout(playNext, dur + melody.gap + melody.loopPause);
      } else {
        musicTimeoutId = setTimeout(playNext, dur + melody.gap);
      }
    }

    playNext();
  }

  function stopMusic(clearStyle) {
    if (clearStyle !== false) currentMusicStyle = null;
    if (musicTimeoutId !== null) {
      clearTimeout(musicTimeoutId);
      musicTimeoutId = null;
    }
    try {
      musicOscillators.forEach((osc) => {
        try { osc.stop(); } catch (e) {}
      });
      musicOscillators = [];
    } catch (e) {}
    if (loopAudio) {
      try { loopAudio.pause(); loopAudio.src = ''; } catch (e) {}
      loopAudio = null;
    }
  }

  return {
    playClick,
    playTurnChange,
    playWordSubmit,
    playGameStart,
    playGameEnd,
    playTimerWarning,
    startMusic,
    stopMusic,
    setMuted,
    isMuted
  };
})();
