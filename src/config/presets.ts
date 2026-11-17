import { Teams, type PokemonSet } from '@pkmn/sim';
import type { TrainerPersonality } from '../ai/BattleSnapshot';

export interface CompetitivePresetTeam {
  id: string;
  zhTitle: string;
  subtitle: string;
  recommendedMode: 'singles' | 'doubles' | 'both';
  paste: string;
}

export interface TrainerProfile {
  id: string;
  zhName: string;
  titleZh: string;
  spriteKey: string;
  personality: TrainerPersonality;
  bgmTrack: string;
  introQuote: string;
}

export const TRAINER_PROFILES: TrainerProfile[] = [
  {
    id: 'cynthia',
    zhName: '竹兰',
    titleZh: '神奥联盟冠军',
    spriteKey: 'cynthia',
    personality: 'champion',
    bgmTrack: 'spl-elite4.mp3',
    introQuote: '在你的宝可梦眼中，我看到了渴望胜利的光芒！',
  },
  {
    id: 'red',
    zhName: '赤红',
    titleZh: '白银山传奇训练家',
    spriteKey: 'red',
    personality: 'champion',
    bgmTrack: 'hgss-kanto-trainer.mp3',
    introQuote: '…………！（压低帽檐，拿出了精灵球！）',
  },
  {
    id: 'steven',
    zhName: '大吾',
    titleZh: '丰缘联盟冠军',
    spriteKey: 'steven',
    personality: 'scientist',
    bgmTrack: 'oras-rival.mp3',
    introQuote: '终究还是我的钢系阵容最为坚不可摧，来验证一下吧。',
  },
  {
    id: 'n',
    zhName: 'N',
    titleZh: '追求理想的训练家',
    spriteKey: 'n',
    personality: 'scientist',
    bgmTrack: 'bw-rival.mp3',
    introQuote: '让我倾听你与宝可梦在战场上的心声吧！',
  },
  {
    id: 'blue',
    zhName: '青绿',
    titleZh: '常青道馆馆主',
    spriteKey: 'blue',
    personality: 'rival',
    bgmTrack: 'bw2-kanto-gym-leader.mp3',
    introQuote: '不管单打还是双打，我都会用实力彻底压制你！',
  },
  {
    id: 'ghetsis',
    zhName: '魁奇思',
    titleZh: '等离子队幕后首脑',
    spriteKey: 'ghetsis',
    personality: 'boss',
    bgmTrack: 'bw-subway-trainer.mp3',
    introQuote: '在绝对的战术计算面前，毫无胜算可言！',
  },
];

export const PRESET_TEAMS: CompetitivePresetTeam[] = [
  {
    id: 'vgc-tailwind-balance',
    zhTitle: '顺风联防王牌队',
    subtitle: '水熊 + 振翼发 + 炽焰咆哮虎 + 龙卷云（单双打皆强）',
    recommendedMode: 'both',
    paste: `
Urshifu-Rapid-Strike @ Mystic Water
Ability: Unseen Fist
Level: 50
Tera Type: Water
EVs: 4 HP / 252 Atk / 252 Spe
Jolly Nature
- Surging Strikes
- Close Combat
- Aqua Jet
- Protect

Flutter Mane @ Booster Energy
Ability: Protosynthesis
Level: 50
Tera Type: Fairy
EVs: 116 HP / 140 SpA / 252 Spe
Timid Nature
- Moonblast
- Shadow Ball
- Dazzling Gleam
- Protect

Incineroar @ Sitrus Berry
Ability: Intimidate
Level: 50
Tera Type: Grass
EVs: 244 HP / 100 Def / 164 SpD
Careful Nature
- Flare Blitz
- Knock Off
- Parting Shot
- Fake Out

Tornadus @ Covert Cloak
Ability: Prankster
Level: 50
Tera Type: Steel
EVs: 252 HP / 4 SpA / 252 Spe
Timid Nature
- Bleakwind Storm
- Tailwind
- Rain Dance
- Taunt

Rillaboom @ Assault Vest
Ability: Grassy Surge
Level: 50
Tera Type: Fire
EVs: 252 HP / 196 Atk / 60 SpD
Adamant Nature
- Grassy Glide
- Wood Hammer
- U-turn
- Fake Out

Gholdengo @ Leftovers
Ability: Good as Gold
Level: 50
Tera Type: Steel
EVs: 212 HP / 196 SpA / 100 Spe
Modest Nature
- Make It Rain
- Shadow Ball
- Nasty Plot
- Protect
`.trim(),
  },
  {
    id: 'rain-hyper-offense',
    zhTitle: '暴雨疾行强攻队',
    subtitle: '大嘴鸥降雨 + 铝钢桥龙 + 刺龙王 + 铁包袱高速洗地',
    recommendedMode: 'both',
    paste: `
Pelipper @ Damp Rock
Ability: Drizzle
Level: 50
Tera Type: Ground
EVs: 244 HP / 252 Def / 12 SpA
Bold Nature
- Weather Ball
- Hurricane
- Tailwind
- U-turn

Archaludon @ Assault Vest
Ability: Stamina
Level: 50
Tera Type: Grass
EVs: 252 HP / 196 SpA / 60 SpD
Modest Nature
- Electro Shot
- Flash Cannon
- Draco Meteor
- Body Press

Kingdra @ Life Orb
Ability: Swift Swim
Level: 50
Tera Type: Water
EVs: 4 HP / 252 SpA / 252 Spe
Modest Nature
- Muddy Water
- Hydro Pump
- Draco Meteor
- Ice Beam

Iron Bundle @ Focus Sash
Ability: Quark Drive
Level: 50
Tera Type: Ice
EVs: 4 HP / 252 SpA / 252 Spe
Timid Nature
- Freeze-Dry
- Hydro Pump
- Icy Wind
- Protect

Scizor @ Choice Band
Ability: Technician
Level: 50
Tera Type: Steel
EVs: 236 HP / 252 Atk / 20 Spe
Adamant Nature
- Bullet Punch
- U-turn
- Close Combat
- Knock Off

Zapdos @ Sitrus Berry
Ability: Static
Level: 50
Tera Type: Electric
EVs: 204 HP / 156 SpA / 148 Spe
Modest Nature
- Thunder
- Hurricane
- Volt Switch
- Roost
`.trim(),
  },
  {
    id: 'sun-trickroom-hybrid',
    zhTitle: '晴天古剑空间双轴队',
    subtitle: '煤炭龟重喷 + 月月熊空间 + 振翼发高速收割',
    recommendedMode: 'doubles',
    paste: `
Torkoal @ Charcoal
Ability: Drought
Level: 50
Tera Type: Fire
EVs: 252 HP / 252 SpA / 4 SpD
Quiet Nature
IVs: 0 Spe
- Eruption
- Heat Wave
- Earth Power
- Protect

Ursaluna-Bloodmoon @ Life Orb
Ability: Mind's Eye
Level: 50
Tera Type: Normal
EVs: 252 HP / 252 SpA / 4 SpD
Quiet Nature
IVs: 0 Spe
- Blood Moon
- Hyper Voice
- Earth Power
- Protect

Porygon2 @ Eviolite
Ability: Download
Level: 50
Tera Type: Flying
EVs: 244 HP / 140 Def / 124 SpD
Sassy Nature
IVs: 0 Spe
- Tera Blast
- Ice Beam
- Trick Room
- Recover

Amoonguss @ Rocky Helmet
Ability: Regenerator
Level: 50
Tera Type: Water
EVs: 244 HP / 156 Def / 108 SpD
Relaxed Nature
IVs: 0 Spe
- Spore
- Rage Powder
- Pollen Puff
- Protect

Raging Bolt @ Magnet
Ability: Protosynthesis
Level: 50
Tera Type: Electric
EVs: 196 HP / 252 SpA / 60 Spe
Modest Nature
- Thunderclap
- Thunderbolt
- Draco Meteor
- Protect

Chien-Pao @ Focus Sash
Ability: Sword of Ruin
Level: 50
Tera Type: Ghost
EVs: 4 HP / 252 Atk / 252 Spe
Jolly Nature
- Icicle Crash
- Sucker Punch
- Sacred Sword
- Protect
`.trim(),
  },
  {
    id: 'sandstorm-singles-core',
    zhTitle: '沙暴兄弟单打王道队',
    subtitle: '班基拉斯 + 龙头地鼠 + 多龙巴鲁托 + 钢铠鸦联防',
    recommendedMode: 'singles',
    paste: `
Tyranitar @ Smooth Rock
Ability: Sand Stream
Level: 50
Tera Type: Flying
EVs: 252 HP / 180 Atk / 76 SpD
Adamant Nature
- Stone Edge
- Knock Off
- Earthquake
- Stealth Rock

Excadrill @ Life Orb
Ability: Sand Rush
Level: 50
Tera Type: Ground
EVs: 4 HP / 252 Atk / 252 Spe
Jolly Nature
- Earthquake
- Iron Head
- Rock Slide
- Swords Dance

Dragapult @ Choice Specs
Ability: Infiltrator
Level: 50
Tera Type: Ghost
EVs: 4 HP / 252 SpA / 252 Spe
Timid Nature
- Shadow Ball
- Draco Meteor
- Flamethrower
- U-turn

Corviknight @ Rocky Helmet
Ability: Mirror Armor
Level: 50
Tera Type: Water
EVs: 252 HP / 252 Def / 4 SpD
Impish Nature
- Brave Bird
- Body Press
- U-turn
- Roost

Gastrodon @ Leftovers
Ability: Storm Drain
Level: 50
Tera Type: Poison
EVs: 252 HP / 140 Def / 116 SpD
Calm Nature
- Earth Power
- Surf
- Ice Beam
- Recover

Kingambit @ Black Glasses
Ability: Supreme Overlord
Level: 50
Tera Type: Dark
EVs: 212 HP / 252 Atk / 44 Spe
Adamant Nature
- Kowtow Cleave
- Sucker Punch
- Iron Head
- Swords Dance
`.trim(),
  },
  {
    id: 'classic-champions-allstar',
    zhTitle: '历代冠军全明星队',
    subtitle: '烈咬陆鲨 + 喷火龙 + 路卡利欧 + 巨金怪 + 美纳斯 + 耿鬼',
    recommendedMode: 'singles',
    paste: `
Garchomp @ Focus Sash
Ability: Rough Skin
Level: 50
Tera Type: Ground
EVs: 4 HP / 252 Atk / 252 Spe
Jolly Nature
- Earthquake
- Outrage
- Rock Tomb
- Swords Dance

Charizard @ Heavy-Duty Boots
Ability: Blaze
Level: 50
Tera Type: Fire
EVs: 4 HP / 252 SpA / 252 Spe
Timid Nature
- Flamethrower
- Air Slash
- Scorching Sands
- Dragon Pulse

Lucario @ Life Orb
Ability: Inner Focus
Level: 50
Tera Type: Normal
EVs: 4 HP / 252 Atk / 252 Spe
Jolly Nature
- Close Combat
- Extreme Speed
- Meteor Mash
- Swords Dance

Metagross @ Assault Vest
Ability: Clear Body
Level: 50
Tera Type: Steel
EVs: 252 HP / 252 Atk / 4 SpD
Adamant Nature
- Heavy Slam
- Psychic Fangs
- Bullet Punch
- Earthquake

Milotic @ Flame Orb
Ability: Marvel Scale
Level: 50
Tera Type: Fairy
EVs: 252 HP / 252 Def / 4 SpA
Bold Nature
- Scald
- Ice Beam
- Alluring Voice
- Recover

Gengar @ Choice Scarf
Ability: Cursed Body
Level: 50
Tera Type: Ghost
EVs: 4 HP / 252 SpA / 252 Spe
Timid Nature
- Shadow Ball
- Sludge Bomb
- Thunderbolt
- Dazzling Gleam
`.trim(),
  },
];

export function importShowdownPaste(paste: string, forceLevel50 = true): PokemonSet[] {
  const imported = Teams.import(paste) || [];
  return imported.map((s) => ({
    ...s,
    level: forceLevel50 ? 50 : s.level || 50,
  }));
}

export function exportShowdownPaste(sets: PokemonSet[]): string {
  return Teams.export(sets);
}
