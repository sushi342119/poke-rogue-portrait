export type SynthThemeId = 'menu' | 'wild' | 'trainer' | 'elite' | 'boss' | 'victory';

interface NoteStep {
  freq: number;
  dur: number;
  bass?: number;
}

const NOTE: Record<string, number> = {
  C3: 130.81, D3: 146.83, Eb3: 155.56, E3: 164.81, F3: 174.61, G3: 196.0, Ab3: 207.65, A3: 220.0, Bb3: 233.08, B3: 246.94,
  C4: 261.63, Cs4: 277.18, D4: 293.66, Eb4: 311.13, E4: 329.63, F4: 349.23, Fs4: 369.99, G4: 392.0, Ab4: 415.3, A4: 440.0, Bb4: 466.16, B4: 493.88,
  C5: 523.25, Cs5: 554.37, D5: 587.33, Eb5: 622.25, E5: 659.25, F5: 698.46, Fs5: 739.99, G5: 783.99, Ab5: 830.61, A5: 880.0, Bb5: 932.33, B5: 987.77,
  C6: 1046.5, R: 0,
};

const THEMES: Record<SynthThemeId, { bpm: number; steps: NoteStep[] }> = {
  menu: {
    bpm: 124,
    steps: [
      { freq: NOTE.G4, dur: 0.5, bass: NOTE.C3 }, { freq: NOTE.C5, dur: 0.5, bass: NOTE.G3 },
      { freq: NOTE.E5, dur: 0.75, bass: NOTE.C3 }, { freq: NOTE.D5, dur: 0.25, bass: NOTE.G3 },
      { freq: NOTE.C5, dur: 0.5, bass: NOTE.A3 }, { freq: NOTE.B4, dur: 0.5, bass: NOTE.E3 },
      { freq: NOTE.A4, dur: 1.0, bass: NOTE.F3 },
      { freq: NOTE.F4, dur: 0.5, bass: NOTE.F3 }, { freq: NOTE.A4, dur: 0.5, bass: NOTE.C3 },
      { freq: NOTE.D5, dur: 0.75, bass: NOTE.D3 }, { freq: NOTE.C5, dur: 0.25, bass: NOTE.A3 },
      { freq: NOTE.B4, dur: 0.5, bass: NOTE.G3 }, { freq: NOTE.D5, dur: 0.5, bass: NOTE.G3 },
      { freq: NOTE.G5, dur: 1.0, bass: NOTE.C3 },
    ],
  },
  wild: {
    bpm: 156,
    steps: [
      { freq: NOTE.E5, dur: 0.25, bass: NOTE.A3 }, { freq: NOTE.D5, dur: 0.25, bass: NOTE.E3 },
      { freq: NOTE.C5, dur: 0.25, bass: NOTE.A3 }, { freq: NOTE.B4, dur: 0.25, bass: NOTE.E3 },
      { freq: NOTE.A4, dur: 0.5, bass: NOTE.A3 }, { freq: NOTE.E5, dur: 0.5, bass: NOTE.E3 },
      { freq: NOTE.F5, dur: 0.5, bass: NOTE.F3 }, { freq: NOTE.E5, dur: 0.5, bass: NOTE.C3 },
      { freq: NOTE.D5, dur: 0.5, bass: NOTE.G3 }, { freq: NOTE.B4, dur: 0.5, bass: NOTE.D3 },
      { freq: NOTE.C5, dur: 0.75, bass: NOTE.A3 }, { freq: NOTE.E5, dur: 0.25, bass: NOTE.E3 },
      { freq: NOTE.A5, dur: 0.5, bass: NOTE.A3 }, { freq: NOTE.G5, dur: 0.5, bass: NOTE.G3 },
    ],
  },
  trainer: {
    bpm: 166,
    steps: [
      { freq: NOTE.D5, dur: 0.25, bass: NOTE.D3 }, { freq: NOTE.F5, dur: 0.25, bass: NOTE.A3 },
      { freq: NOTE.A5, dur: 0.5, bass: NOTE.D3 }, { freq: NOTE.G5, dur: 0.5, bass: NOTE.C3 },
      { freq: NOTE.F5, dur: 0.5, bass: NOTE.Bb3 }, { freq: NOTE.E5, dur: 0.5, bass: NOTE.A3 },
      { freq: NOTE.D5, dur: 0.5, bass: NOTE.G3 }, { freq: NOTE.Cs5, dur: 0.5, bass: NOTE.A3 },
      { freq: NOTE.D5, dur: 0.25, bass: NOTE.D3 }, { freq: NOTE.E5, dur: 0.25, bass: NOTE.A3 },
      { freq: NOTE.F5, dur: 0.5, bass: NOTE.Bb3 }, { freq: NOTE.G5, dur: 0.5, bass: NOTE.G3 },
      { freq: NOTE.A5, dur: 1.0, bass: NOTE.A3 },
    ],
  },
  elite: {
    bpm: 174,
    steps: [
      { freq: NOTE.C5, dur: 0.25, bass: NOTE.C3 }, { freq: NOTE.Eb5, dur: 0.25, bass: NOTE.G3 },
      { freq: NOTE.G5, dur: 0.5, bass: NOTE.C3 }, { freq: NOTE.Ab5, dur: 0.5, bass: NOTE.F3 },
      { freq: NOTE.G5, dur: 0.5, bass: NOTE.Eb3 }, { freq: NOTE.F5, dur: 0.5, bass: NOTE.D3 },
      { freq: NOTE.Eb5, dur: 0.5, bass: NOTE.C3 }, { freq: NOTE.D5, dur: 0.5, bass: NOTE.G3 },
      { freq: NOTE.C5, dur: 0.5, bass: NOTE.Ab3 }, { freq: NOTE.G5, dur: 0.5, bass: NOTE.Eb3 },
      { freq: NOTE.Fs5, dur: 0.5, bass: NOTE.D3 }, { freq: NOTE.G5, dur: 0.5, bass: NOTE.G3 },
    ],
  },
  boss: {
    bpm: 182,
    steps: [
      { freq: NOTE.E5, dur: 0.25, bass: NOTE.E3 }, { freq: NOTE.R, dur: 0.25, bass: NOTE.E3 },
      { freq: NOTE.E5, dur: 0.25, bass: NOTE.E3 }, { freq: NOTE.G5, dur: 0.25, bass: NOTE.B3 },
      { freq: NOTE.Bb5, dur: 0.5, bass: NOTE.E3 }, { freq: NOTE.A5, dur: 0.5, bass: NOTE.Eb3 },
      { freq: NOTE.G5, dur: 0.5, bass: NOTE.D3 }, { freq: NOTE.Fs5, dur: 0.5, bass: NOTE.Cs4 },
      { freq: NOTE.E5, dur: 0.5, bass: NOTE.C3 }, { freq: NOTE.B4, dur: 0.5, bass: NOTE.B3 },
      { freq: NOTE.C5, dur: 0.5, bass: NOTE.A3 }, { freq: NOTE.Eb5, dur: 0.5, bass: NOTE.B3 },
    ],
  },
  victory: {
    bpm: 148,
    steps: [
      { freq: NOTE.C5, dur: 0.25, bass: NOTE.C3 }, { freq: NOTE.E5, dur: 0.25, bass: NOTE.C3 },
      { freq: NOTE.G5, dur: 0.25, bass: NOTE.E3 }, { freq: NOTE.C6, dur: 0.75, bass: NOTE.G3 },
      { freq: NOTE.Ab5, dur: 0.5, bass: NOTE.Ab3 }, { freq: NOTE.Bb5, dur: 0.5, bass: NOTE.Bb3 },
      { freq: NOTE.C6, dur: 1.5, bass: NOTE.C3 },
    ],
  },
};

/**
 * 零依赖 Web Audio API 掌机 8-bit 合成器（双通道方波/三角波 + 战斗音效）
 */
export class ChiptuneSynth {
  private ctx: AudioContext | null = null;
  private loopTimer: number | null = null;
  private activeTheme: SynthThemeId | null = null;
  private stepIdx = 0;
  private muted = false;
  private volume = 0.22;

  unlock(): void {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) {
      this.stopBgm();
    }
  }

  setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
  }

  private playTone(
    freq: number,
    durationSec: number,
    type: OscillatorType = 'square',
    gainLevel = 0.14,
    slideToFreq?: number,
    delaySec = 0,
  ): void {
    if (this.muted || !this.ctx || freq <= 0) return;
    if (this.ctx.state === 'suspended') return;

    const now = this.ctx.currentTime + delaySec;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (slideToFreq && slideToFreq > 0) {
      osc.frequency.exponentialRampToValueAtTime(slideToFreq, now + durationSec);
    }

    const peak = Math.max(0.001, gainLevel * this.volume);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + durationSec + 0.02);
  }

  startBgm(theme: SynthThemeId): void {
    if (this.muted) return;
    this.unlock();
    if (this.activeTheme === theme && this.loopTimer !== null) return;
    this.stopBgm();
    this.activeTheme = theme;
    this.stepIdx = 0;
    this.scheduleNextStep();
  }

  private scheduleNextStep(): void {
    if (this.muted || !this.activeTheme) return;
    const spec = THEMES[this.activeTheme];
    const step = spec.steps[this.stepIdx % spec.steps.length];
    const beatSec = 60 / spec.bpm;
    const durSec = step.dur * beatSec;

    if (step.freq > 0) {
      this.playTone(step.freq, durSec * 0.86, 'square', 0.16);
    }
    if (step.bass && step.bass > 0) {
      this.playTone(step.bass, durSec * 0.92, 'triangle', 0.22);
    }

    this.stepIdx++;
    if (this.activeTheme === 'victory' && this.stepIdx >= spec.steps.length) {
      this.activeTheme = null;
      this.loopTimer = null;
      return;
    }

    this.loopTimer = window.setTimeout(() => this.scheduleNextStep(), durSec * 1000);
  }

  stopBgm(): void {
    if (this.loopTimer !== null) {
      clearTimeout(this.loopTimer);
      this.loopTimer = null;
    }
    this.activeTheme = null;
  }

  playSfx(
    kind:
      | 'select'
      | 'confirm'
      | 'cancel'
      | 'hit'
      | 'superHit'
      | 'weakHit'
      | 'statUp'
      | 'statDown'
      | 'heal'
      | 'ballThrow'
      | 'ballShake'
      | 'ballCatch'
      | 'shieldBreak'
      | 'faint',
  ): void {
    this.unlock();
    switch (kind) {
      case 'select':
        this.playTone(680, 0.045, 'square', 0.18);
        break;
      case 'confirm':
        this.playTone(587.33, 0.055, 'square', 0.2);
        this.playTone(880, 0.08, 'square', 0.2, undefined, 0.05);
        break;
      case 'cancel':
        this.playTone(440, 0.06, 'square', 0.18, 280);
        break;
      case 'hit':
        this.playTone(190, 0.11, 'sawtooth', 0.35, 70);
        break;
      case 'superHit':
        this.playTone(320, 0.08, 'sawtooth', 0.4, 110);
        this.playTone(520, 0.14, 'square', 0.32, 95, 0.05);
        break;
      case 'weakHit':
        this.playTone(150, 0.09, 'triangle', 0.25, 95);
        break;
      case 'statUp':
        this.playTone(440, 0.07, 'square', 0.2);
        this.playTone(554.37, 0.07, 'square', 0.2, undefined, 0.06);
        this.playTone(659.25, 0.11, 'square', 0.22, undefined, 0.12);
        break;
      case 'statDown':
        this.playTone(523.25, 0.07, 'square', 0.2);
        this.playTone(415.3, 0.07, 'square', 0.2, undefined, 0.06);
        this.playTone(329.63, 0.12, 'square', 0.22, undefined, 0.12);
        break;
      case 'heal':
        this.playTone(523.25, 0.09, 'triangle', 0.25);
        this.playTone(659.25, 0.09, 'triangle', 0.25, undefined, 0.08);
        this.playTone(783.99, 0.16, 'triangle', 0.28, undefined, 0.16);
        break;
      case 'ballThrow':
        this.playTone(320, 0.16, 'triangle', 0.24, 760);
        break;
      case 'ballShake':
        this.playTone(290, 0.07, 'triangle', 0.22, 360);
        break;
      case 'ballCatch':
        this.playTone(523.25, 0.08, 'square', 0.24);
        this.playTone(659.25, 0.08, 'square', 0.24, undefined, 0.08);
        this.playTone(783.99, 0.08, 'square', 0.24, undefined, 0.16);
        this.playTone(1046.5, 0.26, 'square', 0.28, undefined, 0.24);
        break;
      case 'shieldBreak':
        this.playTone(720, 0.07, 'sawtooth', 0.35, 220);
        this.playTone(480, 0.16, 'sawtooth', 0.35, 120, 0.06);
        break;
      case 'faint':
        this.playTone(360, 0.28, 'sawtooth', 0.28, 85);
        break;
    }
  }
}
