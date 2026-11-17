import { ASSET_URLS } from '../config/constants';
import { getPokemonCryUrl, getPokemonFallbackCryUrl } from '../data/spriteResolver';
import { ChiptuneSynth, type SynthThemeId } from './ChiptuneSynth';

export type BgmSourceMode = 'showdown' | 'chiptune' | 'off';

/**
 * 统一音频总线：结合 Showdown 对战 BGM / 宝可梦原版叫声 + PokéRogue 像素打击音效 + 8-bit 合成器无缝兜底
 */
export class AudioEngine {
  readonly synth = new ChiptuneSynth();
  private bgmMode: BgmSourceMode = 'showdown';
  private sfxMuted = false;
  private bgmAudio: HTMLAudioElement | null = null;
  private currentTrackKey = '';
  private currentSynthFallback: SynthThemeId = 'wild';
  private unlocked = false;

  constructor() {
    if (typeof window !== 'undefined') {
      const unlockHandler = () => {
        this.unlock();
      };
      window.addEventListener('pointerdown', unlockHandler, { passive: true });
      window.addEventListener('keydown', unlockHandler, { passive: true });
    }
  }

  unlock(): void {
    this.synth.unlock();
    if (!this.unlocked) {
      this.unlocked = true;
      if (this.bgmAudio && this.bgmMode === 'showdown') {
        this.bgmAudio.play().catch(() => {
          this.synth.startBgm(this.currentSynthFallback);
        });
      }
    }
  }

  getBgmMode(): BgmSourceMode {
    return this.bgmMode;
  }

  setBgmMode(mode: BgmSourceMode): void {
    this.bgmMode = mode;
    if (mode === 'off') {
      this.stopBgm();
      this.synth.setMuted(this.sfxMuted);
    } else if (mode === 'chiptune') {
      if (this.bgmAudio) {
        this.bgmAudio.pause();
        this.bgmAudio = null;
      }
      this.synth.setMuted(false);
      this.synth.startBgm(this.currentSynthFallback);
    } else {
      this.synth.stopBgm();
      if (this.currentTrackKey) {
        const key = this.currentTrackKey;
        this.currentTrackKey = '';
        this.playBattleBgm(key, this.currentSynthFallback);
      }
    }
  }

  isSfxMuted(): boolean {
    return this.sfxMuted;
  }

  setSfxMuted(muted: boolean): void {
    this.sfxMuted = muted;
  }

  playBattleBgm(showdownTrackFile: string, fallbackTheme: SynthThemeId = 'trainer'): void {
    this.currentSynthFallback = fallbackTheme;
    if (this.bgmMode === 'off') return;

    if (this.bgmMode === 'chiptune') {
      this.synth.startBgm(fallbackTheme);
      return;
    }

    if (this.currentTrackKey === showdownTrackFile && this.bgmAudio && !this.bgmAudio.paused) {
      return;
    }

    this.stopBgm();
    this.currentTrackKey = showdownTrackFile;

    if (typeof Audio === 'undefined') return;
    const audio = new Audio(`${ASSET_URLS.showdownDirect}/audio/${showdownTrackFile}`);
    audio.loop = true;
    audio.volume = 0.34;
    this.bgmAudio = audio;

    audio.onerror = () => {
      if (this.bgmMode !== 'off') {
        this.synth.startBgm(fallbackTheme);
      }
    };

    audio.play().catch(() => {
      // 未解锁或网络受限时先静音待解锁或回退合成器
      if (this.unlocked && this.bgmMode !== 'off') {
        this.synth.startBgm(fallbackTheme);
      }
    });
  }

  playMenuBgm(): void {
    this.currentSynthFallback = 'menu';
    if (this.bgmMode === 'off') return;
    if (this.bgmAudio) {
      this.bgmAudio.pause();
      this.bgmAudio = null;
      this.currentTrackKey = '';
    }
    this.synth.startBgm('menu');
  }

  stopBgm(): void {
    this.currentTrackKey = '';
    if (this.bgmAudio) {
      this.bgmAudio.pause();
      this.bgmAudio = null;
    }
    this.synth.stopBgm();
  }

  /**
   * 播放宝可梦官方原版叫声（濒死时降低播放速率还原正作降调效果）
   */
  playCry(speciesName: string, faint = false): void {
    if (this.sfxMuted || typeof Audio === 'undefined') return;
    const primaryUrl = getPokemonCryUrl(speciesName);
    const fallbackUrl = getPokemonFallbackCryUrl(speciesName);

    const audio = new Audio(primaryUrl);
    audio.volume = 0.45;
    if (faint) {
      audio.preservesPitch = false;
      audio.playbackRate = 0.76;
    }

    audio.onerror = () => {
      if (fallbackUrl !== primaryUrl) {
        const fb = new Audio(fallbackUrl);
        fb.volume = 0.45;
        if (faint) {
          fb.preservesPitch = false;
          fb.playbackRate = 0.76;
        }
        fb.play().catch(() => {});
      } else if (faint) {
        this.synth.playSfx('faint');
      }
    };

    audio.play().catch(() => {
      if (faint) this.synth.playSfx('faint');
    });
  }

  playHitSfx(effectiveness: number): void {
    if (this.sfxMuted) return;
    const file = effectiveness > 1 ? 'hit_strong.wav' : effectiveness < 1 ? 'hit_weak.wav' : 'hit.wav';
    if (typeof Audio !== 'undefined') {
      const se = new Audio(`./assets/pr/se/${file}`);
      se.volume = 0.52;
      se.play().catch(() => {
        this.synth.playSfx(effectiveness > 1 ? 'superHit' : effectiveness < 1 ? 'weakHit' : 'hit');
      });
    } else {
      this.synth.playSfx(effectiveness > 1 ? 'superHit' : effectiveness < 1 ? 'weakHit' : 'hit');
    }
  }

  playLocalSe(file: 'faint.wav' | 'level_up.wav' | 'exp.wav', fallback?: Parameters<ChiptuneSynth['playSfx']>[0]): void {
    if (this.sfxMuted) return;
    if (typeof Audio !== 'undefined') {
      const se = new Audio(`./assets/pr/se/${file}`);
      se.volume = 0.48;
      se.play().catch(() => {
        if (fallback) this.synth.playSfx(fallback);
      });
    } else if (fallback) {
      this.synth.playSfx(fallback);
    }
  }

  playUiSfx(kind: Parameters<ChiptuneSynth['playSfx']>[0]): void {
    if (this.sfxMuted) return;
    this.synth.playSfx(kind);
  }
}

export const audioEngine = new AudioEngine();
