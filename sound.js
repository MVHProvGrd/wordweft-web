const Sound = (() => {
  let audioCtx = null;
  let musicTimeoutId = null;
  let musicOscillators = [];

  function ensureContext() {
    if (audioCtx) return audioCtx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
    } catch (e) {
      audioCtx = null;
    }
    return audioCtx;
  }

  function playTone(freq, duration, volume = 0.1) {
    return new Promise((resolve) => {
      try {
        const ctx = ensureContext();
        if (!ctx) { resolve(); return; }

        const now = ctx.currentTime;
        const durSec = duration / 1000;
        const attackTime = 0.01;
        const releaseTime = 0.02;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(volume, now + attackTime);
        gain.gain.setValueAtTime(volume, now + durSec - releaseTime);
        gain.gain.linearRampToValueAtTime(0, now + durSec);
        gain.connect(ctx.destination);

        const osc1 = ctx.createOscillator();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(freq, now);
        osc1.connect(gain);
        osc1.start(now);
        osc1.stop(now + durSec);

        const harmonicGain = ctx.createGain();
        harmonicGain.gain.setValueAtTime(0.1, now);
        harmonicGain.connect(gain);

        const osc2 = ctx.createOscillator();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(freq * 2, now);
        osc2.connect(harmonicGain);
        osc2.start(now);
        osc2.stop(now + durSec);

        musicOscillators.push(osc1, osc2);
        osc1.onended = () => {
          musicOscillators = musicOscillators.filter(o => o !== osc1 && o !== osc2);
        };

        setTimeout(resolve, duration);
      } catch (e) {
        resolve();
      }
    });
  }

  function pause(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function playClick() {
    await playTone(800, 30, 0.15);
  }

  async function playTurnChange() {
    await playTone(660, 80, 0.1);
    await playTone(880, 120, 0.1);
  }

  async function playWordSubmit() {
    await playTone(523, 60, 0.2);
  }

  async function playGameStart() {
    await playTone(523, 100, 0.1);
    await playTone(659, 100, 0.1);
    await playTone(784, 150, 0.1);
  }

  async function playGameEnd() {
    await playTone(784, 120, 0.1);
    await playTone(659, 120, 0.1);
    await playTone(523, 120, 0.1);
    await playTone(784, 200, 0.1);
  }

  async function playTimerWarning() {
    await playTone(880, 60, 0.1);
    await pause(100);
    await playTone(880, 60, 0.1);
  }

  const melodies = {
    jazz: {
      notes: [392, 440, 494, 523, 587, 659, 698, 784, 659, 587, 523, 494, 440, 392, 349, 330],
      durations: Array(16).fill(300),
      volume: 0.08,
      gap: 50
    },
    lullaby: {
      notes: [262, 330, 392, 330, 262, 330, 392, 523, 494, 440, 392, 330, 294, 262, 247, 262],
      durations: Array(16).fill(500),
      volume: 0.06,
      gap: 100
    },
    bossa: {
      notes: [330, 392, 440, 494, 523, 494, 440, 392, 349, 330, 294, 330, 349, 392, 440, 494],
      durations: Array(16).fill(250),
      volume: 0.07,
      gap: 30
    },
    blues: {
      notes: [196, 220, 233, 262, 294, 262, 233, 220, 196, 175, 165, 175, 196, 220, 233, 262],
      durations: Array(16).fill(400),
      volume: 0.07,
      gap: 80
    },
    chiptune: {
      notes: [523, 659, 784, 880, 784, 659, 523, 440, 523, 659, 784, 1047, 880, 784, 659, 523],
      durations: Array(16).fill(150),
      volume: 0.06,
      gap: 20
    }
  };

  function startMusic(style) {
    stopMusic();
    const melody = melodies[style];
    if (!melody) return;

    let noteIndex = 0;

    function playNext() {
      const freq = melody.notes[noteIndex];
      const dur = melody.durations[noteIndex];
      playTone(freq, dur, melody.volume);
      noteIndex = (noteIndex + 1) % melody.notes.length;
      musicTimeoutId = setTimeout(playNext, dur + melody.gap);
    }

    playNext();
  }

  function stopMusic() {
    if (musicTimeoutId !== null) {
      clearTimeout(musicTimeoutId);
      musicTimeoutId = null;
    }
    try {
      musicOscillators.forEach((osc) => {
        try { osc.stop(); } catch (e) { /* already stopped */ }
      });
      musicOscillators = [];
    } catch (e) {
      // ignore
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
    stopMusic
  };
})();
