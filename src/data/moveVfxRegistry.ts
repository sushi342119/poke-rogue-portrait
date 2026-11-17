import { Dex, toID } from '@pkmn/dex';

export type VfxSheetKey =
  | 'strike'
  | 'slash'
  | 'fire'
  | 'ice'
  | 'electric'
  | 'water'
  | 'dark'
  | 'burst'
  | 'state'
  | 'explosion'
  | 'grass'
  | 'flying';

export type VfxMotionPattern = 'lunge' | 'projectile' | 'target' | 'self' | 'spread';

export interface VfxSheetSpec {
  key: VfxSheetKey;
  url: string;
  frameWidth: number;
  frameHeight: number;
  totalFrames: number;
}

export const VFX_SHEETS: Record<VfxSheetKey, VfxSheetSpec> = {
  strike: { key: 'strike', url: './assets/pr/vfx/strike.png', frameWidth: 96, frameHeight: 96, totalFrames: 10 },
  slash: { key: 'slash', url: './assets/pr/vfx/slash.png', frameWidth: 96, frameHeight: 96, totalFrames: 10 },
  fire: { key: 'fire', url: './assets/pr/vfx/fire.png', frameWidth: 96, frameHeight: 96, totalFrames: 10 },
  ice: { key: 'ice', url: './assets/pr/vfx/ice.png', frameWidth: 95, frameHeight: 96, totalFrames: 15 },
  electric: { key: 'electric', url: './assets/pr/vfx/electric.png', frameWidth: 96, frameHeight: 96, totalFrames: 10 },
  water: { key: 'water', url: './assets/pr/vfx/water.png', frameWidth: 96, frameHeight: 96, totalFrames: 15 },
  dark: { key: 'dark', url: './assets/pr/vfx/dark.png', frameWidth: 96, frameHeight: 96, totalFrames: 15 },
  burst: { key: 'burst', url: './assets/pr/vfx/burst.png', frameWidth: 96, frameHeight: 96, totalFrames: 10 },
  state: { key: 'state', url: './assets/pr/vfx/state.png', frameWidth: 96, frameHeight: 96, totalFrames: 10 },
  explosion: { key: 'explosion', url: './assets/pr/vfx/explosion.png', frameWidth: 96, frameHeight: 96, totalFrames: 10 },
  grass: { key: 'grass', url: './assets/pr/vfx/grass.png', frameWidth: 96, frameHeight: 96, totalFrames: 8 },
  flying: { key: 'flying', url: './assets/pr/vfx/flying.png', frameWidth: 96, frameHeight: 96, totalFrames: 8 },
};

export interface MoveVisualProfile {
  sheet: VfxSheetKey;
  startFrame: number;
  endFrame: number;
  fps: number;
  tint?: number;
  scale: number;
  motion: VfxMotionPattern;
  screenShake: number;
}

const TYPE_VFX_DEFAULTS: Record<string, Omit<MoveVisualProfile, 'motion'>> = {
  Normal: { sheet: 'strike', startFrame: 0, endFrame: 6, fps: 22, scale: 1.0, screenShake: 2 },
  Fire: { sheet: 'fire', startFrame: 0, endFrame: 9, fps: 22, tint: 0xffaa66, scale: 1.15, screenShake: 3 },
  Water: { sheet: 'water', startFrame: 0, endFrame: 11, fps: 24, tint: 0x88ccff, scale: 1.1, screenShake: 2 },
  Electric: { sheet: 'electric', startFrame: 0, endFrame: 9, fps: 24, tint: 0xffee66, scale: 1.15, screenShake: 3 },
  Grass: { sheet: 'grass', startFrame: 0, endFrame: 7, fps: 20, tint: 0x7ce868, scale: 1.05, screenShake: 2 },
  Ice: { sheet: 'ice', startFrame: 0, endFrame: 11, fps: 22, tint: 0xb0f4ff, scale: 1.1, screenShake: 2 },
  Fighting: { sheet: 'strike', startFrame: 2, endFrame: 9, fps: 24, tint: 0xff7755, scale: 1.2, screenShake: 4 },
  Poison: { sheet: 'dark', startFrame: 0, endFrame: 9, fps: 20, tint: 0xc259eb, scale: 1.05, screenShake: 2 },
  Ground: { sheet: 'explosion', startFrame: 0, endFrame: 8, fps: 20, tint: 0xd9a75b, scale: 1.2, screenShake: 5 },
  Flying: { sheet: 'flying', startFrame: 0, endFrame: 7, fps: 24, tint: 0xc4d8ff, scale: 1.1, screenShake: 2 },
  Psychic: { sheet: 'burst', startFrame: 0, endFrame: 9, fps: 22, tint: 0xff73b9, scale: 1.15, screenShake: 2 },
  Bug: { sheet: 'slash', startFrame: 0, endFrame: 7, fps: 24, tint: 0xb8e645, scale: 1.0, screenShake: 2 },
  Rock: { sheet: 'explosion', startFrame: 1, endFrame: 9, fps: 22, tint: 0xc9b171, scale: 1.15, screenShake: 4 },
  Ghost: { sheet: 'dark', startFrame: 3, endFrame: 14, fps: 22, tint: 0x9575ed, scale: 1.15, screenShake: 3 },
  Dragon: { sheet: 'burst', startFrame: 0, endFrame: 9, fps: 22, tint: 0x7b68ff, scale: 1.25, screenShake: 4 },
  Dark: { sheet: 'dark', startFrame: 0, endFrame: 11, fps: 24, tint: 0x8a7570, scale: 1.1, screenShake: 3 },
  Steel: { sheet: 'slash', startFrame: 2, endFrame: 9, fps: 24, tint: 0xcfe2f3, scale: 1.15, screenShake: 3 },
  Fairy: { sheet: 'burst', startFrame: 0, endFrame: 9, fps: 22, tint: 0xffa8e2, scale: 1.15, screenShake: 2 },
  Stellar: { sheet: 'burst', startFrame: 0, endFrame: 9, fps: 24, tint: 0x8cf4ff, scale: 1.25, screenShake: 4 },
};

/**
 * 为任意宝可梦招式匹配对应的 18 属性像素打击特效、运动轨迹与震屏强度
 */
export function getMoveVisualProfile(moveNameOrId: string): MoveVisualProfile {
  const id = toID(moveNameOrId);
  const mv = Dex.moves.get(id);

  if (!mv.exists) {
    return { ...TYPE_VFX_DEFAULTS.Normal, motion: 'lunge' };
  }

  // 保护/守住/替身/强化/回复类变化技
  if (mv.category === 'Status') {
    if (mv.target === 'self' || mv.target === 'adjacentAllyOrSelf' || mv.target === 'allySide') {
      const isProtect = ['protect', 'detect', 'spikyshield', 'kingsshield', 'banefulbunker', 'silktrap'].includes(id);
      const isHeal = Boolean(mv.flags?.heal) || ['recover', 'roost', 'moonlight', 'synthesis', 'slackoff', 'wish', 'rest'].includes(id);
      return {
        sheet: 'state',
        startFrame: 0,
        endFrame: 9,
        fps: 22,
        tint: isProtect ? 0x7af5ff : isHeal ? 0x7dff9b : 0xffdf6b,
        scale: 1.05,
        motion: 'self',
        screenShake: 0,
      };
    }
    return {
      sheet: 'dark',
      startFrame: 0,
      endFrame: 9,
      fps: 20,
      tint: TYPE_VFX_DEFAULTS[mv.type]?.tint || 0xc8a2ff,
      scale: 0.95,
      motion: 'target',
      screenShake: 1,
    };
  }

  // 斩击/爪击类招式走锋利刀光序列帧
  const isSlicing =
    Boolean(mv.flags?.slicing) ||
    /slash|claw|cut|blade|leafblade|xscissor|sacredsword|kowtow|psycho|aerialace/.test(id);

  const base = isSlicing
    ? {
        sheet: 'slash' as VfxSheetKey,
        startFrame: 0,
        endFrame: 9,
        fps: 26,
        tint: TYPE_VFX_DEFAULTS[mv.type]?.tint,
        scale: 1.15,
        screenShake: 3,
      }
    : TYPE_VFX_DEFAULTS[mv.type] || TYPE_VFX_DEFAULTS.Normal;

  const isSpread = mv.target === 'allAdjacentFoes' || mv.target === 'allAdjacent';
  const motion: VfxMotionPattern = isSpread
    ? 'spread'
    : mv.category === 'Physical' || Boolean(mv.flags?.contact)
      ? 'lunge'
      : 'projectile';

  const powerBoost = (mv.basePower || 60) >= 100 ? 1.18 : 1.0;

  return {
    ...base,
    scale: Number((base.scale * powerBoost).toFixed(2)),
    screenShake: (mv.basePower || 60) >= 110 ? Math.max(base.screenShake, 5) : base.screenShake,
    motion,
  };
}
