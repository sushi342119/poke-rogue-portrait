import type { PokemonSet } from '@pkmn/sim';
import type { BgmSourceMode } from '../audio/AudioEngine';
import { DEFAULT_LLM_CONFIG, type LLMProviderConfig } from '../ai/LLMTacticalAI';

export interface RogueMemberState {
  uid: string;
  set: PokemonSet;
  exp: number;
  hp: number;
  maxhp: number;
  fainted: boolean;
  status: '' | 'brn' | 'par' | 'slp' | 'frz' | 'psn' | 'tox';
  movePp: Record<string, number>;
  boostStacks: Record<string, number>; // 携带属性增伤/树果叠加记录
}

export interface ActiveWaveBuff {
  stat: 'atk' | 'def' | 'spa' | 'spd' | 'spe';
  stages: number;
  wavesLeft: number;
}

export interface RogueRunSave {
  version: number;
  wave: number;
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
  };
  waveBuffs: ActiveWaveBuff[];
  party: RogueMemberState[];
  inShopPhase: boolean;
  rerollCount: number;
  updatedAt: string;
}

export interface MetaProgressSave {
  unlockedStarters: string[];
  starterCandies: Record<string, number>;
  highestRogueWave: number;
  totalRogueRuns: number;
  factoryBestStreakSingles: number;
  factoryBestStreakDoubles: number;
  officialWins: number;
}

export interface SavedCustomTeam {
  id: string;
  name: string;
  isDoubles: boolean;
  paste: string;
}

export interface UserPreferencesSave {
  llm: LLMProviderConfig;
  bgmMode: BgmSourceMode;
  sfxMuted: boolean;
  battleSpeed: 1 | 2 | 4;
}

const KEYS = {
  ROGUE_RUN: 'prp_rogue_run_v1',
  META: 'prp_meta_progress_v1',
  TEAMS: 'prp_custom_teams_v1',
  PREFS: 'prp_user_prefs_v1',
};

const DEFAULT_STARTERS = [
  'bulbasaur', 'charmander', 'squirtle',
  'chikorita', 'cyndaquil', 'totodile',
  'treecko', 'torchic', 'mudkip',
  'turtwig', 'chimchar', 'piplup',
  'snivy', 'tepig', 'oshawott',
  'rowlet', 'litten', 'popplio',
  'sprigatito', 'fuecoco', 'quaxly',
  'pikachu', 'eevee', 'riolu', 'ralts', 'rookidee', 'gible', 'dreepy', 'frigibax',
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

export const SaveStorage = {
  getRogueRun(): RogueRunSave | null {
    try {
      const raw = storageGetRaw(KEYS.ROGUE_RUN);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as RogueRunSave;
      if (!parsed || !Array.isArray(parsed.party) || parsed.party.length === 0) return null;
      return parsed;
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
  },

  getMeta(): MetaProgressSave {
    const def: MetaProgressSave = {
      unlockedStarters: [...DEFAULT_STARTERS],
      starterCandies: {},
      highestRogueWave: 0,
      totalRogueRuns: 0,
      factoryBestStreakSingles: 0,
      factoryBestStreakDoubles: 0,
      officialWins: 0,
    };
    const meta = safeGet(KEYS.META, def);
    for (const s of DEFAULT_STARTERS) {
      if (!meta.unlockedStarters.includes(s)) meta.unlockedStarters.push(s);
    }
    return meta;
  },

  saveMeta(meta: MetaProgressSave): void {
    safeSet(KEYS.META, meta);
  },

  unlockStarterAndCandy(speciesId: string, candyAmount = 1): void {
    const meta = this.getMeta();
    if (!meta.unlockedStarters.includes(speciesId)) {
      meta.unlockedStarters.push(speciesId);
    }
    meta.starterCandies[speciesId] = (meta.starterCandies[speciesId] || 0) + candyAmount;
    this.saveMeta(meta);
  },

  getCustomTeams(): SavedCustomTeam[] {
    try {
      const raw = storageGetRaw(KEYS.TEAMS);
      return raw ? (JSON.parse(raw) as SavedCustomTeam[]) : [];
    } catch {
      return [];
    }
  },

  saveCustomTeams(teams: SavedCustomTeam[]): void {
    safeSet(KEYS.TEAMS, teams);
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
};
