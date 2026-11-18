import { Teams, type PokemonSet } from '@pkmn/sim';
import type { TrainerPersonality } from '../ai/BattleSnapshot';

export interface TrainerProfile {
  id: string;
  zhName: string;
  titleZh: string;
  spriteKey: string;
  personality: TrainerPersonality;
  bgmTrack: string;
  introQuote: string;
  specialtyTypes?: string[];
  signatureSpecies?: string[];
}

/**
 * 经典爬塔模式固定宿敌（第 8 / 25 / 55 / 95 / 145 / 195 层阶梯拦路）
 */
export const RIVAL_PROFILE: TrainerProfile = {
  id: 'rival_hilda',
  zhName: '透子',
  titleZh: '宿命劲敌',
  spriteKey: 'hilda',
  personality: 'rival',
  bgmTrack: 'bw-rival.mp3',
  introQuote: '你也爬到这一层了？让我看看你的队伍成长了多少吧！',
  specialtyTypes: ['Fire', 'Flying', 'Dragon'],
  signatureSpecies: ['Rayquaza', 'Staraptor', 'Arcanine'],
};

/**
 * 8 大生态群系镇守道馆馆主与首领（经典模式第 20 / 50 / 80 / 110 / 140 / 170 层）
 */
export const GYM_LEADERS_BY_BIOME: Record<string, TrainerProfile> = {
  plains: {
    id: 'gym_blue',
    zhName: '青绿',
    titleZh: '常青道馆馆主',
    spriteKey: 'blue',
    personality: 'rival',
    bgmTrack: 'bw2-kanto-gym-leader.mp3',
    introQuote: '平原上的微风可吹不倒我的均衡强攻阵容！',
    specialtyTypes: ['Normal', 'Flying', 'Electric'],
    signatureSpecies: ['Pidgeot', 'Electivire', 'Snorlax'],
  },
  forest: {
    id: 'gym_alder',
    zhName: '阿戴克',
    titleZh: '深林守护冠军',
    spriteKey: 'alder',
    personality: 'champion',
    bgmTrack: 'bw-trainer.mp3',
    introQuote: '与森林万物的羁绊，将化作坚韧不拔的力量！',
    specialtyTypes: ['Bug', 'Grass', 'Fairy'],
    signatureSpecies: ['Volcarona', 'Venusaur', 'Gardevoir'],
  },
  beach: {
    id: 'gym_misty',
    zhName: '小霞',
    titleZh: '华蓝道馆馆主',
    spriteKey: 'misty',
    personality: 'rival',
    bgmTrack: 'hgss-kanto-trainer.mp3',
    introQuote: '用席卷海岸的怒涛攻势一鼓作气冲垮你！',
    specialtyTypes: ['Water', 'Ice'],
    signatureSpecies: ['Starmie', 'Gyarados', 'Lapras'],
  },
  cave: {
    id: 'gym_steven',
    zhName: '大吾',
    titleZh: '晶窟钢系大师',
    spriteKey: 'steven',
    personality: 'scientist',
    bgmTrack: 'oras-rival.mp3',
    introQuote: '千锤百炼的矿石与钢躯，绝不留一丝破绽。',
    specialtyTypes: ['Steel', 'Rock', 'Ground'],
    signatureSpecies: ['Metagross', 'Aggron', 'Excadrill'],
  },
  volcano: {
    id: 'gym_blaine',
    zhName: '夏伯',
    titleZh: '红莲道馆馆主',
    spriteKey: 'blaine',
    personality: 'boss',
    bgmTrack: 'hgss-kanto-trainer.mp3',
    introQuote: '哇哈哈哈！准备好迎接燃尽一切的熔岩烈焰了吗？',
    specialtyTypes: ['Fire', 'Dragon'],
    signatureSpecies: ['Arcanine', 'Magmortar', 'Charizard'],
  },
  snowy_forest: {
    id: 'gym_n',
    zhName: 'N',
    titleZh: '极寒理想追寻者',
    spriteKey: 'n',
    personality: 'scientist',
    bgmTrack: 'bw-rival.mp3',
    introQuote: '在这片静谧雪原中，聆听宝可梦真正的呼唤吧！',
    specialtyTypes: ['Ice', 'Psychic', 'Ghost'],
    signatureSpecies: ['Zoroark', 'Weavile', 'Frosmoth'],
  },
  badlands: {
    id: 'gym_hilbert',
    zhName: '斗也',
    titleZh: '峡谷战术先锋',
    spriteKey: 'hilbert',
    personality: 'rival',
    bgmTrack: 'bw-subway-trainer.mp3',
    introQuote: '荒芜峡谷的沙暴里，唯有果断出击才能取胜！',
    specialtyTypes: ['Ground', 'Dark', 'Fighting'],
    signatureSpecies: ['Krookodile', 'Lucario', 'Garchomp'],
  },
  abyss: {
    id: 'gym_ghetsis',
    zhName: '魁奇思',
    titleZh: '深渊幕后首脑',
    spriteKey: 'ghetsis',
    personality: 'boss',
    bgmTrack: 'spl-elite4.mp3',
    introQuote: '踏入深渊之人，将在绝对的压制力面前绝望！',
    specialtyTypes: ['Dragon', 'Dark', 'Ghost'],
    signatureSpecies: ['Hydreigon', 'Kingambit', 'Dragapult'],
  },
};

/**
 * 经典模式第 182~190 波 四天王与联盟冠军终盘连战配置
 */
export const CLASSIC_ELITE_GAUNTLET: Record<number, TrainerProfile> = {
  182: {
    id: 'e4_steven',
    zhName: '大吾',
    titleZh: '天王试炼·壹',
    spriteKey: 'steven',
    personality: 'scientist',
    bgmTrack: 'oras-rival.mp3',
    introQuote: '欢迎来到高塔之巅，第一道钢铁防线由我镇守！',
    specialtyTypes: ['Steel', 'Rock'],
    signatureSpecies: ['Metagross', 'Corviknight', 'Archaludon'],
  },
  184: {
    id: 'e4_n',
    zhName: 'N',
    titleZh: '天王试炼·贰',
    spriteKey: 'n',
    personality: 'scientist',
    bgmTrack: 'bw-rival.mp3',
    introQuote: '你的信念能否超越理想与真实的界限？',
    specialtyTypes: ['Dragon', 'Electric', 'Fire'],
    signatureSpecies: ['Zekrom', 'Reshiram', 'Zoroark'],
  },
  186: {
    id: 'e4_ghetsis',
    zhName: '魁奇思',
    titleZh: '天王试炼·叁',
    spriteKey: 'ghetsis',
    personality: 'boss',
    bgmTrack: 'bw-subway-trainer.mp3',
    introQuote: '休想再往前踏出半步！全部给我粉碎吧！',
    specialtyTypes: ['Dark', 'Poison', 'Dragon'],
    signatureSpecies: ['Hydreigon', 'Roaring Moon', 'Toxapex'],
  },
  188: {
    id: 'e4_red',
    zhName: '赤红',
    titleZh: '天王试炼·肆',
    spriteKey: 'red',
    personality: 'champion',
    bgmTrack: 'hgss-kanto-trainer.mp3',
    introQuote: '…………！（赤红压低帽檐，派出了千锤百炼的王牌！）',
    specialtyTypes: ['Electric', 'Fire', 'Water', 'Grass'],
    signatureSpecies: ['Pikachu', 'Charizard', 'Blastoise', 'Venusaur', 'Snorlax'],
  },
  190: {
    id: 'champ_cynthia',
    zhName: '竹兰',
    titleZh: '巅峰联盟冠军',
    spriteKey: 'cynthia',
    personality: 'champion',
    bgmTrack: 'spl-elite4.mp3',
    introQuote: '在前往第 200 层终焉祭坛之前，用尽全力战胜我吧！',
    specialtyTypes: ['Dragon', 'Ground', 'Ghost', 'Fairy'],
    signatureSpecies: ['Garchomp', 'Spiritomb', 'Togekiss', 'Lucario', 'Milotic'],
  },
};

/**
 * 路人/精英训练家池（供普通波次与无尽模式使用）
 */
export const TRAINER_PROFILES: TrainerProfile[] = [
  GYM_LEADERS_BY_BIOME.plains,
  GYM_LEADERS_BY_BIOME.cave,
  GYM_LEADERS_BY_BIOME.snowy_forest,
  GYM_LEADERS_BY_BIOME.badlands,
  CLASSIC_ELITE_GAUNTLET[188],
  CLASSIC_ELITE_GAUNTLET[190],
];

/**
 * 轻量级 Showdown 文本解析辅助（仅供单元测试快速构造对局阵容使用）
 */
export function importShowdownPaste(paste: string, forceLv50 = false): PokemonSet[] {
  const imported = Teams.import(paste) as PokemonSet[] | null;
  if (!imported || imported.length === 0) return [];
  return imported.map((s) => ({
    ...s,
    level: forceLv50 ? 50 : s.level || 50,
  }));
}
