import type { PokemonSet } from '@pkmn/sim';
import type { BgmSourceMode } from '../audio/AudioEngine';
import { DEFAULT_LLM_CONFIG, type LLMProviderConfig } from '../ai/LLMTacticalAI';

export type RogueGameMode = 'classic' | 'endless';
export type EggTier = 'common' | 'rare' | 'epic' | 'legendary';
export type GachaMachineType = 'move' | 'legendary' | 'shiny';
export type VoucherTier = 'common' | 'plus' | 'premium';

export interface RogueMemberState {
  uid: string;
  set: PokemonSet;
  exp: number;
  hp: number;
  maxhp: number;
  fainted: boolean;
  status: '' | 'brn' | 'par' | 'slp' | 'frz' | 'psn' | 'tox';
  movePp: Record<string, number>;
  boostStacks: Record<string, number>;
  awakened?: boolean; // 糖果觉醒被动：每波自动微回血 + 全能力 IV 31 精炼标记
}

export interface ActiveWaveBuff {
  stat: 'atk' | 'def' | 'spa' | 'spd' | 'spe';
  stages: number;
  wavesLeft: number;
}

export interface RogueRunSave {
  version: number;
  mode: RogueGameMode;
  wave: number;
  biomeId: string;
  biomeIndex: number;
  money: number;
  balls: {
    pb: number;
    gb: number;
    ub: number;
    mb: number;
  };
  relics: {
    expShare: number;
    luckyEgg: number;
    expCharm: number;
    amuletCoin: number;
    healingCharm: number;
    shinyCharm: number;
    townMap: number;      // 城镇地图：每10层解锁3条透明情报群系分支路线
    lockCapsule: number;  // 锁定胶囊：商店刷新时可锁定当前三选一精灵球品质不降级
    teraOrb: number;      // 太晶宝珠：解锁每战太晶化权限
  };
  lureWavesLeft: number;  // 引虫诱饵剩余波数（大于0时高概率触发野生2v2双打遭遇！）
  rarityLocked: boolean;  // 当前整备商店是否开启了锁品质刷新
  pendingBiomeChoices?: string[]; // 第10波关底待玩家抉择的下一群系分支ID列表
  waveBuffs: ActiveWaveBuff[];
  party: RogueMemberState[];
  inShopPhase: boolean;
  rerollCount: number;
  updatedAt: string;
}

export interface StarterUpgradeRecord {
  costReduction: number; // 0 | 1 | 2（糖果永久减费）
  awakened: boolean;     // 糖果觉醒：满个体 6V + 每波战后额外再生回复
  shinyUnlocked: boolean;
  useShiny: boolean;
  unlockedEggMoves: string[];
}

export interface IncubatingEgg {
  id: string;
  tier: EggTier;
  machine: GachaMachineType;
  targetSpeciesId?: string; // 若由糖果定向兑换，则锁定对应初始宝可梦
  wavesRemaining: number;
  totalWaves: number;
  createdAt: string;
}

export interface HatchedEggResult {
  eggTier: EggTier;
  speciesId: string;
  shiny: boolean;
  isNewUnlock: boolean;
  candyGained: number;
  newEggMove?: string;
}

export interface MetaProgressSave {
  unlockedStarters: string[];
  starterCandies: Record<string, number>;
  starterUpgrades: Record<string, StarterUpgradeRecord>;
  vouchers: {
    common: number;  // 单抽普通蛋券
    plus: number;    // 五连精良蛋券（保底稀有蛋）
    premium: number; // 十连黄金蛋券（保底史诗蛋）
  };
  eggs: IncubatingEgg[];
  totalEggsHatched: number;
  classicClears: number;
  highestClassicWave: number;
  highestEndlessWave: number;
  highestRogueWave: number;
  totalRogueRuns: number;
  ribbonsSpecies: string[]; // 经典 200 层殿堂通关缎带宝可梦记录
}

export interface UserPreferencesSave {
  llm: LLMProviderConfig;
  bgmMode: BgmSourceMode;
  sfxMuted: boolean;
  battleSpeed: 1 | 2 | 4;
}

const KEYS = {
  ROGUE_RUN: 'prp_rogue_run_v2',
  LEGACY_RUN: 'prp_rogue_run_v1',
  META: 'prp_meta_progress_v2',
  LEGACY_META: 'prp_meta_progress_v1',
  PREFS: 'prp_user_prefs_v1',
};

export const DEFAULT_STARTERS = [
  'bulbasaur', 'charmander', 'squirtle',
  'chikorita', 'cyndaquil', 'totodile',
  'treecko', 'torchic', 'mudkip',
  'turtwig', 'chimchar', 'piplup',
  'snivy', 'tepig', 'oshawott',
  'chespin', 'fennekin', 'froakie',
  'rowlet', 'litten', 'popplio',
  'grookey', 'scorbunny', 'sobble',
  'sprigatito', 'fuecoco', 'quaxly',
  'pikachu', 'eevee', 'riolu', 'ralts', 'rookidee', 'gible', 'dreepy', 'frigibax', 'charcadet',
];

const memoryFallback = new Map<string, string>();

function storageGetRaw(key: string): string | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(key);
    }
  } catch {
    // Cross-origin iframe with third-party storage blocked
  }
  return memoryFallback.get(key) ?? null;
}

function storageSetRaw(key: string, val: string): void {
  memoryFallback.set(key, val);
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(key, val);
    }
  } catch {
    // Quota or cross-origin iframe privacy mode
  }
}

function storageRemoveRaw(key: string): void {
  memoryFallback.delete(key);
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Cross-origin iframe privacy mode
  }
}

function safeGet<T>(key: string, fallback: T): T {
  try {
    const raw = storageGetRaw(key);
    if (!raw) return fallback;
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}

function safeSet(key: string, value: unknown): void {
  try {
    storageSetRaw(key, JSON.stringify(value));
  } catch {
    // Serialization fallback
  }
}

export function getDefaultUpgradeRecord(): StarterUpgradeRecord {
  return {
    costReduction: 0,
    awakened: false,
    shinyUnlocked: false,
    useShiny: false,
    unlockedEggMoves: [],
  };
}

export const SaveStorage = {
  getRogueRun(): RogueRunSave | null {
    try {
      const raw = storageGetRaw(KEYS.ROGUE_RUN) || storageGetRaw(KEYS.LEGACY_RUN);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<RogueRunSave>;
      if (!parsed || !Array.isArray(parsed.party) || parsed.party.length === 0) return null;

      return {
        version: 2,
        mode: parsed.mode || 'classic',
        wave: parsed.wave || 1,
        biomeId: parsed.biomeId || 'plains',
        biomeIndex: parsed.biomeIndex || 0,
        money: parsed.money ?? 1000,
        balls: parsed.balls || { pb: 5, gb: 1, ub: 0, mb: 0 },
        relics: {
          expShare: parsed.relics?.expShare ?? 1,
          luckyEgg: parsed.relics?.luckyEgg ?? 0,
          expCharm: parsed.relics?.expCharm ?? 0,
          amuletCoin: parsed.relics?.amuletCoin ?? 0,
          healingCharm: parsed.relics?.healingCharm ?? 0,
          shinyCharm: parsed.relics?.shinyCharm ?? 0,
          townMap: parsed.relics?.townMap ?? 0,
          lockCapsule: parsed.relics?.lockCapsule ?? 0,
          teraOrb: parsed.relics?.teraOrb ?? 0,
        },
        lureWavesLeft: parsed.lureWavesLeft ?? 0,
        rarityLocked: Boolean(parsed.rarityLocked),
        pendingBiomeChoices: parsed.pendingBiomeChoices,
        waveBuffs: parsed.waveBuffs || [],
        party: parsed.party,
        inShopPhase: Boolean(parsed.inShopPhase),
        rerollCount: parsed.rerollCount || 0,
        updatedAt: parsed.updatedAt || new Date().toISOString(),
      };
    } catch {
      return null;
    }
  },

  saveRogueRun(run: RogueRunSave): void {
    run.updatedAt = new Date().toISOString();
    safeSet(KEYS.ROGUE_RUN, run);
  },

  clearRogueRun(): void {
    storageRemoveRaw(KEYS.ROGUE_RUN);
    storageRemoveRaw(KEYS.LEGACY_RUN);
  },

  getMeta(): MetaProgressSave {
    const def: MetaProgressSave = {
      unlockedStarters: [...DEFAULT_STARTERS],
      starterCandies: {},
      starterUpgrades: {},
      // 新手开局礼赠：3张单抽券 + 2张五连精良券，首次进游戏即可爽抽扭蛋机！
      vouchers: {
        common: 3,
        plus: 2,
        premium: 0,
      },
      eggs: [],
      totalEggsHatched: 0,
      classicClears: 0,
      highestClassicWave: 0,
      highestEndlessWave: 0,
      highestRogueWave: 0,
      totalRogueRuns: 0,
      ribbonsSpecies: [],
    };

    const rawV2 = storageGetRaw(KEYS.META);
    const rawV1 = !rawV2 ? storageGetRaw(KEYS.LEGACY_META) : null;
    const base = rawV2
      ? safeGet(KEYS.META, def)
      : rawV1
        ? { ...def, ...JSON.parse(rawV1), vouchers: def.vouchers }
        : def;

    if (!base.vouchers) base.vouchers = { ...def.vouchers };
    if (!base.starterUpgrades) base.starterUpgrades = {};
    if (!Array.isArray(base.eggs)) base.eggs = [];
    if (!Array.isArray(base.ribbonsSpecies)) base.ribbonsSpecies = [];

    for (const s of DEFAULT_STARTERS) {
      if (!base.unlockedStarters.includes(s)) base.unlockedStarters.push(s);
    }
    return base;
  },

  saveMeta(meta: MetaProgressSave): void {
    safeSet(KEYS.META, meta);
  },

  getStarterUpgrade(speciesId: string): StarterUpgradeRecord {
    const meta = this.getMeta();
    return meta.starterUpgrades[speciesId] || getDefaultUpgradeRecord();
  },

  unlockStarterAndCandy(
    speciesId: string,
    candyAmount = 1,
    opts?: { shiny?: boolean; eggMove?: string },
  ): { isNewUnlock: boolean; newEggMove?: string } {
    const meta = this.getMeta();
    let isNewUnlock = false;
    if (!meta.unlockedStarters.includes(speciesId)) {
      meta.unlockedStarters.push(speciesId);
      isNewUnlock = true;
    }
    meta.starterCandies[speciesId] = (meta.starterCandies[speciesId] || 0) + candyAmount;

    const upg = meta.starterUpgrades[speciesId] || getDefaultUpgradeRecord();
    if (opts?.shiny) {
      upg.shinyUnlocked = true;
      upg.useShiny = true;
    }
    let learnedEggMove: string | undefined;
    if (opts?.eggMove && !upg.unlockedEggMoves.includes(opts.eggMove)) {
      upg.unlockedEggMoves.push(opts.eggMove);
      learnedEggMove = opts.eggMove;
    }
    meta.starterUpgrades[speciesId] = upg;
    this.saveMeta(meta);
    return { isNewUnlock, newEggMove: learnedEggMove };
  },

  addVoucher(tier: VoucherTier, count = 1): void {
    const meta = this.getMeta();
    meta.vouchers[tier] = (meta.vouchers[tier] || 0) + count;
    this.saveMeta(meta);
  },

  getPrefs(): UserPreferencesSave {
    return safeGet<UserPreferencesSave>(KEYS.PREFS, {
      llm: { ...DEFAULT_LLM_CONFIG },
      bgmMode: 'showdown',
      sfxMuted: false,
      battleSpeed: 1,
    });
  },

  savePrefs(prefs: UserPreferencesSave): void {
    safeSet(KEYS.PREFS, prefs);
  },

  /**
   * 导出跨端存档码（包含元进度、当前爬塔进度与音频倍速偏好，不含敏感 API Key）
   */
  exportSaveBundle(): string {
    const prefs = this.getPrefs();
    const safePrefs: UserPreferencesSave = {
      ...prefs,
      llm: { ...prefs.llm, apiKey: '' },
    };
    const payload = {
      schema: 'prp-backup-v2',
      exportedAt: new Date().toISOString(),
      meta: this.getMeta(),
      run: this.getRogueRun(),
      prefs: safePrefs,
    };
    const json = JSON.stringify(payload);
    const bytes = new TextEncoder().encode(json);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return `PRP2:${btoa(binary)}`;
  },

  /**
   * 从跨端存档码导入恢复（支持网页版 ⇄ 安卓 APK 互传）
   */
  importSaveBundle(rawInput: string): { ok: boolean; message: string } {
    const trimmed = rawInput.trim();
    if (!trimmed) {
      return { ok: false, message: '请先粘贴以 PRP2: 开头的存档备份码。' };
    }
    try {
      const b64 = trimmed.startsWith('PRP2:') ? trimmed.slice(5).trim() : trimmed;
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const parsed = JSON.parse(new TextDecoder().decode(bytes)) as {
        schema?: string;
        meta?: MetaProgressSave;
        run?: RogueRunSave | null;
      };
      if (!parsed || parsed.schema !== 'prp-backup-v2' || !parsed.meta || !Array.isArray(parsed.meta.unlockedStarters)) {
        return { ok: false, message: '存档码格式校验失败，请确认复制完整。' };
      }
      this.saveMeta(parsed.meta);
      if (parsed.run && Array.isArray(parsed.run.party) && parsed.run.party.length > 0) {
        this.saveRogueRun(parsed.run);
      } else {
        this.clearRogueRun();
      }
      return {
        ok: true,
        message: `存档恢复成功！已同步 ${parsed.meta.unlockedStarters.length} 只初始宠与爬塔进度。`,
      };
    } catch {
      return { ok: false, message: '存档码解析失败，请检查是否漏字或包含多余字符。' };
    }
  },
};
