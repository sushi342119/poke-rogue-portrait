export const STAGE_WIDTH = 270;
export const STAGE_HEIGHT = 256;
export const LOGICAL_PORTRAIT_WIDTH = 270;
export const LOGICAL_PORTRAIT_HEIGHT = 480;

export type BattleSlotId = 'p1a' | 'p1b' | 'p2a' | 'p2b';

export interface SlotAnchor {
  x: number;
  y: number;
  isBack: boolean;
  scale: number;
  depth: number;
}

export const SINGLES_ANCHORS: Record<'p1a' | 'p2a', SlotAnchor> = {
  p2a: { x: 192, y: 102, isBack: false, scale: 1, depth: 20 },
  p1a: { x: 76, y: 200, isBack: true, scale: 1.08, depth: 40 },
};

export const DOUBLES_ANCHORS: Record<BattleSlotId, SlotAnchor> = {
  p2a: { x: 148, y: 96, isBack: false, scale: 0.92, depth: 18 },
  p2b: { x: 214, y: 109, isBack: false, scale: 0.92, depth: 22 },
  p1a: { x: 56, y: 196, isBack: true, scale: 0.98, depth: 38 },
  p1b: { x: 126, y: 210, isBack: true, scale: 0.98, depth: 42 },
};

export const PLATFORM_ANCHORS = {
  enemy: { x: 188, y: 108 },
  player: { x: 84, y: 212 },
};

export interface TypeTheme {
  zh: string;
  bg: string;
  border: string;
  text: string;
  glow: string;
}

/**
 * Pokémon Showdown 经典招式按钮与属性胶囊配色表
 */
export const TYPE_THEMES: Record<string, TypeTheme> = {
  Normal: { zh: '一般', bg: '#8a8a7b', border: '#5c5c50', text: '#ffffff', glow: '#c6c6b8' },
  Fire: { zh: '火', bg: '#e25822', border: '#993311', text: '#ffffff', glow: '#ff9466' },
  Water: { zh: '水', bg: '#3b7dd8', border: '#214d8a', text: '#ffffff', glow: '#7fb3ff' },
  Electric: { zh: '电', bg: '#d9a814', border: '#8f6d08', text: '#ffffff', glow: '#ffe066' },
  Grass: { zh: '草', bg: '#4e9a36', border: '#2d611d', text: '#ffffff', glow: '#8cd973' },
  Ice: { zh: '冰', bg: '#4da6b8', border: '#2a6978', text: '#ffffff', glow: '#9ee8f5' },
  Fighting: { zh: '格斗', bg: '#b8382c', border: '#751f17', text: '#ffffff', glow: '#f07569' },
  Poison: { zh: '毒', bg: '#8f418f', border: '#592359', text: '#ffffff', glow: '#d182d1' },
  Ground: { zh: '地面', bg: '#b88e3d', border: '#785a20', text: '#ffffff', glow: '#e8c479' },
  Flying: { zh: '飞行', bg: '#6d82c9', border: '#41508a', text: '#ffffff', glow: '#a8baff' },
  Psychic: { zh: '超能力', bg: '#d64575', border: '#8c2447', text: '#ffffff', glow: '#ff8fb3' },
  Bug: { zh: '虫', bg: '#7d941d', border: '#4e5e0e', text: '#ffffff', glow: '#bdd15c' },
  Rock: { zh: '岩石', bg: '#9c8640', border: '#635424', text: '#ffffff', glow: '#cfc082' },
  Ghost: { zh: '幽灵', bg: '#5c4885', border: '#362852', text: '#ffffff', glow: '#9d88c7' },
  Dragon: { zh: '龙', bg: '#583fc4', border: '#332180', text: '#ffffff', glow: '#9982ff' },
  Dark: { zh: '恶', bg: '#544339', border: '#2e241e', text: '#ffffff', glow: '#917a6c' },
  Steel: { zh: '钢', bg: '#6e8091', border: '#43505c', text: '#ffffff', glow: '#aec0d1' },
  Fairy: { zh: '妖精', bg: '#c95f9b', border: '#823460', text: '#ffffff', glow: '#ff9ed4' },
  Stellar: { zh: '星晶', bg: '#3c7a89', border: '#234a54', text: '#ffffff', glow: '#8de4f7' },
};

export const STATUS_LABELS_ZH: Record<string, { zh: string; color: string }> = {
  brn: { zh: '灼伤', color: '#e25822' },
  par: { zh: '麻痹', color: '#d4a017' },
  slp: { zh: '睡眠', color: '#7a8b99' },
  frz: { zh: '冰冻', color: '#4da6b8' },
  psn: { zh: '中毒', color: '#8f418f' },
  tox: { zh: '剧毒', color: '#6b2378' },
};

export const STAT_LABELS_ZH: Record<string, string> = {
  atk: '物攻',
  def: '物防',
  spa: '特攻',
  spd: '特防',
  spe: '速度',
  accuracy: '命中',
  evasion: '闪避',
};

export const WEATHER_LABELS_ZH: Record<string, { zh: string; color: string }> = {
  SunnyDay: { zh: '大晴天', color: '#e87a24' },
  DesolateLand: { zh: '终结之地', color: '#c93818' },
  RainDance: { zh: '下雨', color: '#3b7dd8' },
  PrimordialSea: { zh: '始源之海', color: '#1f57a8' },
  Sandstorm: { zh: '沙暴', color: '#b88e3d' },
  Snow: { zh: '下雪', color: '#4da6b8' },
  Hail: { zh: '冰雹', color: '#4da6b8' },
  DeltaStream: { zh: '乱流', color: '#5c9c8e' },
};

export const TERRAIN_LABELS_ZH: Record<string, { zh: string; color: string }> = {
  ElectricTerrain: { zh: '电气场地', color: '#c99b10' },
  GrassyTerrain: { zh: '青草场地', color: '#4e9a36' },
  MistyTerrain: { zh: '薄雾场地', color: '#c95f9b' },
  PsychicTerrain: { zh: '精神场地', color: '#d64575' },
};

export interface BiomeConfig {
  id: string;
  zhName: string;
  arenaKey: string;
  primaryTypes: string[];
  skyTop: string;
  skyBottom: string;
  groundTint: string;
  showdownBgm: string;
  synthTheme: 'wild' | 'trainer' | 'elite' | 'boss';
}

export const BIOMES: BiomeConfig[] = [
  {
    id: 'plains',
    zhName: '起始平原',
    arenaKey: 'plains',
    primaryTypes: ['Normal', 'Grass', 'Flying', 'Electric'],
    skyTop: '#6ec0f0',
    skyBottom: '#c2ecff',
    groundTint: '#7ec46c',
    showdownBgm: 'bw-trainer.mp3',
    synthTheme: 'wild',
  },
  {
    id: 'forest',
    zhName: '常青深林',
    arenaKey: 'forest',
    primaryTypes: ['Grass', 'Bug', 'Poison', 'Fairy'],
    skyTop: '#326b47',
    skyBottom: '#78b073',
    groundTint: '#4f8f46',
    showdownBgm: 'hgss-johto-trainer.mp3',
    synthTheme: 'wild',
  },
  {
    id: 'beach',
    zhName: '蔚蓝海岸',
    arenaKey: 'beach',
    primaryTypes: ['Water', 'Flying', 'Ground', 'Ice'],
    skyTop: '#3e96e0',
    skyBottom: '#a6e3ff',
    groundTint: '#e6cf95',
    showdownBgm: 'oras-trainer.mp3',
    synthTheme: 'wild',
  },
  {
    id: 'cave',
    zhName: '晶簇洞窟',
    arenaKey: 'cave',
    primaryTypes: ['Rock', 'Ground', 'Fighting', 'Steel', 'Poison'],
    skyTop: '#2a2633',
    skyBottom: '#4e485c',
    groundTint: '#6e6359',
    showdownBgm: 'dpp-trainer.mp3',
    synthTheme: 'trainer',
  },
  {
    id: 'volcano',
    zhName: '熔岩火山',
    arenaKey: 'volcano',
    primaryTypes: ['Fire', 'Rock', 'Ground', 'Steel', 'Dragon'],
    skyTop: '#4a1812',
    skyBottom: '#9e3b22',
    groundTint: '#592922',
    showdownBgm: 'bw-rival.mp3',
    synthTheme: 'trainer',
  },
  {
    id: 'snowy_forest',
    zhName: '极寒雪原',
    arenaKey: 'snowy_forest',
    primaryTypes: ['Ice', 'Water', 'Psychic', 'Ghost'],
    skyTop: '#5c82a6',
    skyBottom: '#d9effc',
    groundTint: '#d4e8f7',
    showdownBgm: 'xy-trainer.mp3',
    synthTheme: 'wild',
  },
  {
    id: 'badlands',
    zhName: '荒芜峡谷',
    arenaKey: 'badlands',
    primaryTypes: ['Ground', 'Dark', 'Fighting', 'Electric', 'Poison'],
    skyTop: '#8a5232',
    skyBottom: '#d99e6a',
    groundTint: '#a86f44',
    showdownBgm: 'sm-trainer.mp3',
    synthTheme: 'trainer',
  },
  {
    id: 'abyss',
    zhName: '幽邃深渊',
    arenaKey: 'abyss',
    primaryTypes: ['Dragon', 'Ghost', 'Dark', 'Psychic', 'Steel'],
    skyTop: '#141a29',
    skyBottom: '#2d3a54',
    groundTint: '#252f45',
    showdownBgm: 'spl-elite4.mp3',
    synthTheme: 'boss',
  },
];

export const OFFICIAL_ARENA: BiomeConfig = {
  id: 'laboratory',
  zhName: '对战竞技场',
  arenaKey: 'laboratory',
  primaryTypes: [],
  skyTop: '#1f2d3d',
  skyBottom: '#3c536e',
  groundTint: '#48607a',
  showdownBgm: 'bw-subway-trainer.mp3',
  synthTheme: 'trainer',
};

/**
 * PokéRogue 波次等级上限计算（每 10 波解锁下一档等级上限）
 */
export function getWaveLevelCap(wave: number): number {
  const chapter = Math.ceil(Math.max(1, wave) / 10);
  const baseCaps = [8, 16, 25, 34, 44, 54, 64, 75, 86, 98];
  if (chapter <= baseCaps.length) {
    return baseCaps[chapter - 1];
  }
  return 100 + (chapter - baseCaps.length) * 10;
}

export const ASSET_URLS = {
  showdownDirect: 'https://play.pokemonshowdown.com',
  showdownDevProxy: '/showdown-cdn',
  pokeApiSprites: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites',
  localPrAssets: './assets/pr',
  localShowdownAssets: './assets/showdown',
};
