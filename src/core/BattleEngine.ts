import { BattleStreams, Dex, Teams, toID, type PokemonSet } from '@pkmn/sim';
import { TeamGenerators } from '@pkmn/randoms';
import type { BattleSlotId } from '../config/constants';
import {
  STAT_LABELS_ZH,
  STATUS_LABELS_ZH,
  TERRAIN_LABELS_ZH,
  WEATHER_LABELS_ZH,
} from '../config/constants';
import {
  getAbilityZh,
  getItemZh,
  getMoveZh,
  getSpeciesZh,
} from '../data/dexRegistry';

Teams.setGeneratorFactory(TeamGenerators);

export interface PokemonPersistSlice {
  hp?: number;
  status?: '' | 'brn' | 'par' | 'slp' | 'frz' | 'psn' | 'tox';
  movePp?: Record<string, number>;
}

export interface PartyBallInfo {
  species: string;
  zhName: string;
  hp: number;
  maxhp: number;
  fainted: boolean;
  status: string;
  revealed: boolean;
}

export interface TrackedSlotState {
  slot: BattleSlotId;
  side: 'p1' | 'p2';
  ident: string;
  species: string;
  zhSpecies: string;
  nickname: string;
  level: number;
  gender: 'M' | 'F' | '';
  shiny: boolean;
  hp: number;
  maxhp: number;
  hpPercent: number;
  fainted: boolean;
  status: string;
  boosts: Record<'atk' | 'def' | 'spa' | 'spd' | 'spe' | 'accuracy' | 'evasion', number>;
  volatiles: string[];
  terastallized: string;
  types: string[];
  revealedAbility: string;
  revealedItem: string;
  itemConsumed: boolean;
  revealedMoves: Record<string, number>;
  bossShieldTotal: number;
  bossShieldRemaining: number;
  bossShieldThresholds: number[];
}

export interface TrackedFieldState {
  turn: number;
  isDoubles: boolean;
  weather: string;
  weatherTurns: number;
  terrain: string;
  terrainTurns: number;
  pseudoWeather: Record<string, number>;
  sideConditions: {
    p1: Record<string, number>;
    p2: Record<string, number>;
  };
  partyBalls: {
    p1: PartyBallInfo[];
    p2: PartyBallInfo[];
  };
}

export interface RequestMoveOption {
  index: number; // 1-based
  id: string;
  move: string;
  zhName: string;
  type: string;
  category: 'Physical' | 'Special' | 'Status';
  basePower: number;
  accuracy: number | true;
  pp: number;
  maxpp: number;
  target: string;
  disabled: boolean;
}

export interface RequestActiveSlot {
  moves: RequestMoveOption[];
  canTerastallize?: string;
  trapped?: boolean;
}

export interface RequestSidePokemon {
  index: number; // 1-based
  ident: string;
  details: string;
  species: string;
  zhName: string;
  level: number;
  gender: 'M' | 'F' | '';
  shiny: boolean;
  hp: number;
  maxhp: number;
  hpPercent: number;
  active: boolean;
  fainted: boolean;
  status: string;
  stats: { atk: number; def: number; spa: number; spd: number; spe: number };
  moves: string[];
  baseAbility: string;
  ability: string;
  item: string;
  teraType?: string;
}

export interface ParsedSideRequest {
  wait?: boolean;
  teamPreview?: boolean;
  maxChosenTeamSize?: number;
  forceSwitch?: boolean[];
  active?: (RequestActiveSlot | null)[];
  side: {
    name: string;
    id: 'p1' | 'p2';
    pokemon: RequestSidePokemon[];
  };
}

export type VisualBattleEvent =
  | { kind: 'turn'; turn: number }
  | { kind: 'switch'; slot: BattleSlotId; state: TrackedSlotState }
  | { kind: 'move'; actorSlot: BattleSlotId; moveId: string; moveZh: string; targetSlots: BattleSlotId[]; effectiveness: number }
  | { kind: 'damage'; slot: BattleSlotId; deltaPercent: number; hpPercent: number; isCrit: boolean; effectiveness: number; fromEffect?: string }
  | { kind: 'heal'; slot: BattleSlotId; deltaPercent: number; hpPercent: number; fromEffect?: string }
  | { kind: 'boost'; slot: BattleSlotId; stat: string; amount: number }
  | { kind: 'status'; slot: BattleSlotId; status: string }
  | { kind: 'curestatus'; slot: BattleSlotId }
  | { kind: 'volatile'; slot: BattleSlotId; volatile: string; started: boolean }
  | { kind: 'terastallize'; slot: BattleSlotId; teraType: string }
  | { kind: 'ability'; slot: BattleSlotId; abilityZh: string }
  | { kind: 'item'; slot: BattleSlotId; itemZh: string; consumed: boolean }
  | { kind: 'weather'; weather: string }
  | { kind: 'boss-shield-break'; slot: BattleSlotId; remaining: number; boostedStatZh: string }
  | { kind: 'immune'; slot: BattleSlotId }
  | { kind: 'miss'; slot: BattleSlotId }
  | { kind: 'faint'; slot: BattleSlotId; species: string }
  | { kind: 'log'; html: string; turn: number }
  | { kind: 'win'; winnerSide: 'p1' | 'p2' | 'tie' };

export interface BattleInitOptions {
  isDoubles: boolean;
  teamPreview?: boolean;
  pickedTeamSize?: number;
  p1Name: string;
  p2Name: string;
  p1Team: PokemonSet[];
  p2Team: PokemonSet[];
  /** 肉鸽跨波次持久化状态注入 */
  p1Persist?: PokemonPersistSlice[];
  /** 肉鸽 5 波持续型强化药剂（如 X Attack / X Speed） */
  p1StartingBoosts?: Partial<Record<'atk' | 'def' | 'spa' | 'spd' | 'spe', number>>;
  /** 肉鸽关底 Boss 护盾段数（2~4 段） */
  p2BossShields?: number;
}

function parseDetails(details: string): {
  species: string;
  level: number;
  gender: 'M' | 'F' | '';
  shiny: boolean;
  tera?: string;
} {
  const parts = details.split(',').map((s) => s.trim());
  const species = parts[0] || 'Pikachu';
  let level = 50;
  let gender: 'M' | 'F' | '' = '';
  let shiny = false;
  let tera: string | undefined;

  for (let i = 1; i < parts.length; i++) {
    const p = parts[i];
    if (p.startsWith('L')) {
      level = Number(p.slice(1)) || 50;
    } else if (p === 'M' || p === 'F') {
      gender = p;
    } else if (p === 'shiny') {
      shiny = true;
    } else if (p.startsWith('tera:')) {
      tera = p.slice(5);
    }
  }
  return { species, level, gender, shiny, tera };
}

function parseCondition(condition: string): {
  hp: number;
  maxhp: number;
  hpPercent: number;
  fainted: boolean;
  status: string;
} {
  if (!condition || condition === '0 fnt' || condition.endsWith('fnt')) {
    return { hp: 0, maxhp: 100, hpPercent: 0, fainted: true, status: '' };
  }
  const [hpPart, statusPart] = condition.trim().split(/\s+/);
  const [curStr, maxStr] = hpPart.split('/');
  const hp = Math.max(0, Number(curStr) || 0);
  const maxhp = Math.max(1, Number(maxStr) || 100);
  const hpPercent = Number(((hp / maxhp) * 100).toFixed(1));
  return {
    hp,
    maxhp,
    hpPercent,
    fainted: hp <= 0,
    status: statusPart || '',
  };
}

/**
 * 封装 @pkmn/sim BattleStream 的权威单/双打对战内核
 * 同时维护严格战争迷雾状态、Showdown 侦察数据、肉鸽跨波持久化与 Boss 护盾机制
 */
export class BattleEngine {
  private stream!: BattleStreams.BattleStream;
  private streams!: ReturnType<typeof BattleStreams.getPlayerStreams>;

  readonly slots = new Map<BattleSlotId, TrackedSlotState>();
  readonly field: TrackedFieldState;

  private p1Request: ParsedSideRequest | null = null;
  private p2Request: ParsedSideRequest | null = null;
  private eventBatch: VisualBattleEvent[] = [];
  private ended = false;
  private winner: 'p1' | 'p2' | 'tie' | null = null;

  private options: BattleInitOptions;
  private persistApplied = false;
  private startBoostsApplied = false;
  private bossHookInstalled = false;
  private bossShieldTotal = 0;
  private bossShieldGates: number[] = []; // 降序百分比阈值，如 [67, 34]
  private brokenGatesQueue: Array<{
    remaining: number;
    pickedStat: 'atk' | 'def' | 'spa' | 'spd' | 'spe';
  }> = [];

  // 用于把 |-crit| / |-supereffective| 聚合到最近一次伤害事件中
  private pendingMoveSlot: BattleSlotId | null = null;
  private pendingMoveId = '';
  private pendingEffectiveness = 1;
  private pendingCrit = false;

  private readLoopsPromise: Promise<void> | null = null;
  private stepWaiters: (() => void)[] = [];

  constructor(options: BattleInitOptions) {
    this.options = options;
    this.bossShieldTotal = options.p2BossShields || 0;
    if (this.bossShieldTotal > 0) {
      for (let i = this.bossShieldTotal; i >= 1; i--) {
        const pct = Math.round((i / (this.bossShieldTotal + 1)) * 100);
        this.bossShieldGates.push(pct);
      }
    }

    this.field = {
      turn: 0,
      isDoubles: options.isDoubles,
      weather: '',
      weatherTurns: 0,
      terrain: '',
      terrainTurns: 0,
      pseudoWeather: {},
      sideConditions: { p1: {}, p2: {} },
      partyBalls: {
        p1: options.p1Team.map((mon, idx) => {
          const persist = options.p1Persist?.[idx];
          const fainted = persist?.hp === 0;
          return {
            species: mon.species,
            zhName: getSpeciesZh(mon.species),
            hp: persist?.hp ?? 100,
            maxhp: 100,
            fainted,
            status: persist?.status || '',
            revealed: true,
          };
        }),
        p2: options.p2Team.map((mon) => ({
          species: mon.species,
          zhName: getSpeciesZh(mon.species),
          hp: 100,
          maxhp: 100,
          fainted: false,
          status: '',
          revealed: Boolean(options.teamPreview),
        })),
      },
    };
  }

  async start(): Promise<VisualBattleEvent[]> {
    this.stream = new BattleStreams.BattleStream({ keepAlive: false });
    this.streams = BattleStreams.getPlayerStreams(this.stream);

    const baseFormat = this.options.isDoubles ? 'gen9doublescustomgame' : 'gen9customgame';
    const rules: string[] = [];
    if (this.options.teamPreview) {
      if (this.options.pickedTeamSize) {
        rules.push(`Picked Team Size = ${this.options.pickedTeamSize}`);
      }
    } else {
      rules.push('!Team Preview');
    }
    const formatid = rules.length > 0 ? `${baseFormat}@@@${rules.join(',')}` : baseFormat;

    this.readLoopsPromise = this.pumpStreams();

    void this.streams.omniscient.write(`>start ${JSON.stringify({ formatid })}`);
    void this.streams.omniscient.write(
      `>player p1 ${JSON.stringify({ name: this.options.p1Name, team: Teams.pack(this.options.p1Team) })}`,
    );
    void this.streams.omniscient.write(
      `>player p2 ${JSON.stringify({ name: this.options.p2Name, team: Teams.pack(this.options.p2Team) })}`,
    );

    await this.waitForIdle();
    return this.flushEvents();
  }

  private async pumpStreams(): Promise<void> {
    // 消费 p1 视角协议流（天然屏蔽对手未公开底牌，严守 Showdown 信息规则）
    const p1Reader = (async () => {
      for await (const chunk of this.streams.p1) {
        this.processP1Chunk(chunk);
        this.notifyStepWaiters();
      }
    })();

    // 独立消费 p2 的 |request| 供 AI 决策使用（仅提取 AI 自身手牌请求）
    const p2Reader = (async () => {
      for await (const chunk of this.streams.p2) {
        for (const line of chunk.split('\n')) {
          if (line.startsWith('|request|')) {
            const jsonStr = line.slice(9).trim();
            if (jsonStr) {
              this.p2Request = this.enrichRequest(JSON.parse(jsonStr));
            }
          }
        }
        this.notifyStepWaiters();
      }
    })();

    await Promise.all([p1Reader, p2Reader]);
  }

  private notifyStepWaiters(): void {
    // 检查是否已达到稳定等待点（战斗结束 或 双边请求均就绪）
    const p1Ready = this.p1Request !== null;
    const p2Ready = this.p2Request !== null;
    if (this.ended || (p1Ready && p2Ready)) {
      for (const resolve of this.stepWaiters.splice(0)) {
        resolve();
      }
    }
  }

  private waitForIdle(): Promise<void> {
    if (this.ended || (this.p1Request !== null && this.p2Request !== null)) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.stepWaiters.push(resolve);
    });
  }

  private applyInitialRoguePersistIfNeeded(): void {
    const battle = this.stream.battle;
    if (!battle) return;

    // 挂载 PokéRogue 关底 Boss 真实内核伤害护盾拦截器（在 @pkmn/sim 判死前精准锁血并触发狂暴加成）
    if (!this.bossHookInstalled && this.bossShieldTotal > 0) {
      const bossMon = battle.sides[1]?.pokemon?.[0];
      if (bossMon) {
        this.bossHookInstalled = true;
        const origDamage = bossMon.damage.bind(bossMon);
        bossMon.damage = ((d: number, source?: unknown, effect?: unknown) => {
          if (this.bossShieldGates.length > 0 && d > 0 && bossMon.hp > 0) {
            const nextGatePct = this.bossShieldGates[0];
            const gateHp = Math.max(1, Math.ceil((bossMon.maxhp * nextGatePct) / 100));
            if (bossMon.hp - d <= gateHp) {
              this.bossShieldGates.shift();
              const clampedD = Math.max(0, bossMon.hp - gateHp);
              const statsPool: Array<'atk' | 'def' | 'spa' | 'spd' | 'spe'> = [
                'atk',
                'spa',
                'spe',
                'def',
                'spd',
              ];
              const pickedStat = statsPool[this.bossShieldGates.length % statsPool.length];
              const actual = origDamage(
                clampedD,
                source as Parameters<typeof origDamage>[1],
                effect as Parameters<typeof origDamage>[2],
              );
              if (bossMon.hp > 0 && !bossMon.fainted) {
                bossMon.boostBy({ [pickedStat]: 1 });
              }
              this.brokenGatesQueue.push({
                remaining: this.bossShieldGates.length,
                pickedStat,
              });
              return actual;
            }
          }
          return origDamage(
            d,
            source as Parameters<typeof origDamage>[1],
            effect as Parameters<typeof origDamage>[2],
          );
        }) as typeof bossMon.damage;
      }
    }

    if (!this.persistApplied && this.options.p1Persist) {
      this.persistApplied = true;
      const p1Mons = battle.sides[0]?.pokemon || [];
      for (let i = 0; i < p1Mons.length; i++) {
        const mon = p1Mons[i];
        const slice = this.options.p1Persist[i];
        if (!mon || !slice) continue;
        if (typeof slice.hp === 'number') {
          const clampedHp = Math.max(0, Math.min(mon.maxhp, slice.hp));
          mon.hp = clampedHp;
          if (clampedHp === 0) {
            mon.fainted = true;
            mon.status = '' as never;
          }
        }
        if (slice.status && mon.hp > 0) {
          mon.status = slice.status as never;
        }
        if (slice.movePp) {
          for (const slot of mon.moveSlots) {
            const savedPp = slice.movePp[slot.id];
            if (typeof savedPp === 'number') {
              slot.pp = Math.max(0, Math.min(slot.maxpp, savedPp));
            }
          }
        }
      }
    }

    if (!this.startBoostsApplied && this.options.p1StartingBoosts && battle.turn >= 1) {
      this.startBoostsApplied = true;
      const active = battle.sides[0]?.active?.[0];
      if (active && !active.fainted) {
        for (const [stat, val] of Object.entries(this.options.p1StartingBoosts)) {
          if (val && val > 0) {
            active.boostBy({ [stat]: val });
            const tracked = this.slots.get('p1a');
            if (tracked) {
              const k = stat as keyof TrackedSlotState['boosts'];
              tracked.boosts[k] = Math.min(6, (tracked.boosts[k] || 0) + val);
            }
            this.eventBatch.push({
              kind: 'boost',
              slot: 'p1a',
              stat,
              amount: val,
            });
            this.pushLog(
              `<span class="log-buff">✦ 战前强化药剂生效：${getSpeciesZh(active.species.name)} 的${STAT_LABELS_ZH[stat] || stat}提升了 ${val} 级！</span>`,
            );
          }
        }
      }
    }
  }

  private enrichRequest(raw: Record<string, unknown>): ParsedSideRequest {
    const sideRaw = raw.side as {
      name: string;
      id: 'p1' | 'p2';
      pokemon: Array<{
        ident: string;
        details: string;
        condition: string;
        active: boolean;
        stats: { atk: number; def: number; spa: number; spd: number; spe: number };
        moves: string[];
        baseAbility: string;
        ability?: string;
        item: string;
        teraType?: string;
      }>;
    };

    const pokemon: RequestSidePokemon[] = (sideRaw?.pokemon || []).map((p, idx) => {
      const det = parseDetails(p.details);
      const cond = parseCondition(p.condition);
      return {
        index: idx + 1,
        ident: p.ident,
        details: p.details,
        species: det.species,
        zhName: getSpeciesZh(det.species),
        level: det.level,
        gender: det.gender,
        shiny: det.shiny,
        hp: cond.hp,
        maxhp: cond.maxhp,
        hpPercent: cond.hpPercent,
        active: Boolean(p.active),
        fainted: cond.fainted,
        status: cond.status,
        stats: p.stats,
        moves: p.moves || [],
        baseAbility: p.baseAbility,
        ability: p.ability || p.baseAbility,
        item: p.item || '',
        teraType: p.teraType || det.tera,
      };
    });

    // 同步我方 6 球状态灯精确数据
    if (sideRaw?.id === 'p1') {
      this.field.partyBalls.p1 = pokemon.map((p) => ({
        species: p.species,
        zhName: p.zhName,
        hp: p.hp,
        maxhp: p.maxhp,
        fainted: p.fainted,
        status: p.status,
        revealed: true,
      }));
    }

    let activeOut: (RequestActiveSlot | null)[] | undefined;
    if (Array.isArray(raw.active)) {
      activeOut = raw.active.map((slotObj: Record<string, unknown> | null) => {
        if (!slotObj) return null;
        const rawMoves = (slotObj.moves as Array<Record<string, unknown>>) || [];
        const moves: RequestMoveOption[] = rawMoves.map((m, idx) => {
          const id = toID(String(m.id || m.move || 'struggle'));
          const dexMv = Dex.moves.get(id);
          return {
            index: idx + 1,
            id,
            move: String(m.move || dexMv.name || id),
            zhName: getMoveZh(id),
            type: dexMv.exists ? dexMv.type : 'Normal',
            category: dexMv.exists ? dexMv.category : 'Physical',
            basePower: dexMv.exists ? dexMv.basePower : 0,
            accuracy: dexMv.exists ? dexMv.accuracy : 100,
            pp: typeof m.pp === 'number' ? m.pp : 10,
            maxpp: typeof m.maxpp === 'number' ? m.maxpp : 10,
            target: String(m.target || dexMv.target || 'normal'),
            disabled: Boolean(m.disabled) || (typeof m.pp === 'number' && m.pp <= 0),
          };
        });
        return {
          moves,
          canTerastallize: slotObj.canTerastallize ? String(slotObj.canTerastallize) : undefined,
          trapped: Boolean(slotObj.trapped || slotObj.maybeTrapped),
        };
      });
    }

    return {
      wait: Boolean(raw.wait),
      teamPreview: Boolean(raw.teamPreview),
      maxChosenTeamSize: typeof raw.maxChosenTeamSize === 'number' ? raw.maxChosenTeamSize : undefined,
      forceSwitch: Array.isArray(raw.forceSwitch) ? (raw.forceSwitch as boolean[]) : undefined,
      active: activeOut,
      side: {
        name: sideRaw?.name || '',
        id: sideRaw?.id || 'p1',
        pokemon,
      },
    };
  }

  private parseSlotFromIdent(identRaw: string): BattleSlotId | null {
    const prefix = identRaw.slice(0, 3);
    if (prefix === 'p1a' || prefix === 'p1b' || prefix === 'p2a' || prefix === 'p2b') {
      return prefix;
    }
    if (identRaw.startsWith('p1:')) return 'p1a';
    if (identRaw.startsWith('p2:')) return 'p2a';
    return null;
  }

  private pushLog(html: string): void {
    this.eventBatch.push({ kind: 'log', html, turn: this.field.turn });
  }

  private processP1Chunk(chunk: string): void {
    const lines = chunk.split('\n');
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('|')) continue;
      const parts = line.split('|');
      const cmd = parts[1];

      switch (cmd) {
        case 'request': {
          const jsonStr = line.slice(9).trim();
          if (jsonStr) {
            this.applyInitialRoguePersistIfNeeded();
            this.p1Request = this.enrichRequest(JSON.parse(jsonStr));
            // 同步我方已上场槽位精确血量
            for (const p of this.p1Request.side.pokemon) {
              if (p.active) {
                const slotId = this.slots.get('p1a')?.ident === p.ident
                  ? 'p1a'
                  : this.slots.get('p1b')?.ident === p.ident
                    ? 'p1b'
                    : null;
                if (slotId) {
                  const st = this.slots.get(slotId)!;
                  st.hp = p.hp;
                  st.maxhp = p.maxhp;
                  st.hpPercent = p.hpPercent;
                  st.status = p.status;
                }
              }
            }
          }
          break;
        }

        case 'turn': {
          const turnNum = Number(parts[2]) || 1;
          this.field.turn = turnNum;
          if (this.field.weather && this.field.weatherTurns > 0) this.field.weatherTurns++;
          if (this.field.terrain && this.field.terrainTurns > 0) this.field.terrainTurns++;
          this.applyInitialRoguePersistIfNeeded();
          this.eventBatch.push({ kind: 'turn', turn: turnNum });
          this.pushLog(`<div class="sd-log-turn">=== 第 ${turnNum} 回合 ===</div>`);
          break;
        }

        case 'switch':
        case 'drag':
        case 'replace': {
          const slot = this.parseSlotFromIdent(parts[2]);
          if (!slot) break;
          const side: 'p1' | 'p2' = slot.startsWith('p1') ? 'p1' : 'p2';
          const nickname = (parts[2].split(':')[1] || '').trim();
          const det = parseDetails(parts[3] || '');
          const cond = parseCondition(parts[4] || '100/100');

          // 若是首次登场的 p1 肉鸽宝可梦，确保同步注入后的真实血量百分比
          if (side === 'p1' && this.options.p1Persist) {
            this.applyInitialRoguePersistIfNeeded();
            const simMon = this.stream.battle?.sides[0]?.active?.[slot === 'p1a' ? 0 : 1];
            if (simMon) {
              cond.hp = simMon.hp;
              cond.maxhp = simMon.maxhp;
              cond.hpPercent = Number(((simMon.hp / simMon.maxhp) * 100).toFixed(1));
              cond.status = simMon.status || '';
            }
          }

          const dexSp = Dex.species.get(det.species);
          const prev = this.slots.get(slot);
          const isBossSlot = slot === 'p2a' && this.bossShieldTotal > 0;

          const state: TrackedSlotState = {
            slot,
            side,
            ident: parts[2],
            species: det.species,
            zhSpecies: getSpeciesZh(det.species),
            nickname,
            level: det.level,
            gender: det.gender,
            shiny: det.shiny,
            hp: cond.hp,
            maxhp: cond.maxhp,
            hpPercent: cond.hpPercent,
            fainted: cond.fainted,
            status: cond.status,
            boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0 },
            volatiles: [],
            terastallized: det.tera || '',
            types: det.tera ? [det.tera] : dexSp.exists ? [...dexSp.types] : ['Normal'],
            revealedAbility: prev?.ident === parts[2] ? prev.revealedAbility : '',
            revealedItem: prev?.ident === parts[2] ? prev.revealedItem : '',
            itemConsumed: prev?.ident === parts[2] ? prev.itemConsumed : false,
            revealedMoves: prev?.ident === parts[2] ? prev.revealedMoves : {},
            bossShieldTotal: isBossSlot ? this.bossShieldTotal : 0,
            bossShieldRemaining: isBossSlot ? this.bossShieldGates.length : 0,
            bossShieldThresholds: isBossSlot ? [...this.bossShieldGates] : [],
          };
          this.slots.set(slot, state);

          // 更新对手 6 球已亮明阵容状态
          if (side === 'p2') {
            this.syncOpponentPartyBall(det.species, cond.hpPercent, cond.fainted, cond.status);
          }

          this.eventBatch.push({ kind: 'switch', slot, state: { ...state, boosts: { ...state.boosts } } });
          const sideLabel = side === 'p1' ? '我方' : '对手';
          this.pushLog(
            `<span class="log-switch">${sideLabel}派出了 <b>${state.zhSpecies}</b> (Lv.${state.level})！</span>`,
          );
          break;
        }

        case 'detailschange':
        case '-formechange': {
          const slot = this.parseSlotFromIdent(parts[2]);
          const st = slot ? this.slots.get(slot) : undefined;
          if (!st) break;
          const newSpName = cmd === 'detailschange' ? parseDetails(parts[3] || '').species : parts[3];
          if (newSpName) {
            st.species = newSpName;
            st.zhSpecies = getSpeciesZh(newSpName);
            const dexSp = Dex.species.get(newSpName);
            if (dexSp.exists && !st.terastallized) {
              st.types = [...dexSp.types];
            }
            this.eventBatch.push({ kind: 'switch', slot: st.slot, state: { ...st } });
            this.pushLog(`<span class="log-buff">✦ 形态变化为 <b>${st.zhSpecies}</b>！</span>`);
          }
          break;
        }

        case '-terastallize': {
          const slot = this.parseSlotFromIdent(parts[2]);
          const st = slot ? this.slots.get(slot) : undefined;
          const teraType = (parts[3] || '').trim();
          if (st && teraType) {
            st.terastallized = teraType;
            st.types = [teraType];
            this.eventBatch.push({ kind: 'terastallize', slot: st.slot, teraType });
            this.pushLog(
              `<span class="log-tera">💎 <b>${st.zhSpecies}</b> 太晶化成为了【${teraType}】属性！</span>`,
            );
          }
          break;
        }

        case 'move': {
          const actorSlot = this.parseSlotFromIdent(parts[2]);
          const moveName = parts[3] || 'Struggle';
          const targetSlot = this.parseSlotFromIdent(parts[4] || '');
          if (!actorSlot) break;

          const actor = this.slots.get(actorSlot);
          const moveId = toID(moveName);
          const moveZh = getMoveZh(moveId);
          if (actor) {
            actor.revealedMoves[moveId] = (actor.revealedMoves[moveId] || 0) + 1;
          }

          this.pendingMoveSlot = actorSlot;
          this.pendingMoveId = moveId;
          this.pendingEffectiveness = 1;
          this.pendingCrit = false;

          const targets: BattleSlotId[] = [];
          const dexMv = Dex.moves.get(moveId);
          if (dexMv.target === 'allAdjacentFoes') {
            const foePrefix = actorSlot.startsWith('p1') ? 'p2' : 'p1';
            for (const s of [`${foePrefix}a`, `${foePrefix}b`] as BattleSlotId[]) {
              const t = this.slots.get(s);
              if (t && !t.fainted) targets.push(s);
            }
          } else if (targetSlot) {
            targets.push(targetSlot);
          } else {
            targets.push(actorSlot);
          }

          this.eventBatch.push({
            kind: 'move',
            actorSlot,
            moveId,
            moveZh,
            targetSlots: targets,
            effectiveness: 1,
          });
          const sideTag = actorSlot.startsWith('p1') ? '我方' : '敌方';
          this.pushLog(
            `<span class="log-move">${sideTag} <b>${actor?.zhSpecies || ''}</b> 使用了 <b>${moveZh}</b>！</span>`,
          );
          break;
        }

        case '-supereffective':
          this.pendingEffectiveness = 2;
          break;

        case '-resisted':
          this.pendingEffectiveness = 0.5;
          break;

        case '-crit':
          this.pendingCrit = true;
          break;

        case '-immune': {
          const slot = this.parseSlotFromIdent(parts[2]);
          if (slot) {
            this.eventBatch.push({ kind: 'immune', slot });
            const st = this.slots.get(slot);
            this.pushLog(`<span class="log-muted">对 ${st?.zhSpecies || '目标'} 没有效果…</span>`);
          }
          break;
        }

        case '-miss': {
          const target = this.parseSlotFromIdent(parts[3] || parts[2]);
          if (target) {
            this.eventBatch.push({ kind: 'miss', slot: target });
            this.pushLog(`<span class="log-muted">招式没有命中！</span>`);
          }
          break;
        }

        case '-damage': {
          const slot = this.parseSlotFromIdent(parts[2]);
          const st = slot ? this.slots.get(slot) : undefined;
          if (!st) break;
          const prevPct = st.hpPercent;
          let cond = parseCondition(parts[3] || '0 fnt');
          const fromTag = parts.slice(4).join('|');

          // PokéRogue Boss 护盾破盾视觉与狂暴强化事件同步
          if (slot === 'p2a' && this.brokenGatesQueue.length > 0) {
            const brk = this.brokenGatesQueue.shift()!;
            st.bossShieldRemaining = brk.remaining;
            st.bossShieldThresholds = [...this.bossShieldGates];
            st.boosts[brk.pickedStat] = Math.min(6, st.boosts[brk.pickedStat] + 1);

            const statZh = STAT_LABELS_ZH[brk.pickedStat] || brk.pickedStat;
            this.eventBatch.push({
              kind: 'boss-shield-break',
              slot: 'p2a',
              remaining: brk.remaining,
              boostedStatZh: statZh,
            });
            this.pushLog(
              `<span class="log-boss">⚡ 击破了霸主 <b>${st.zhSpecies}</b> 的一段护盾！霸主的${statZh}提升了！</span>`,
            );
          }

          st.hp = cond.hp;
          st.maxhp = cond.maxhp;
          st.hpPercent = cond.hpPercent;
          st.fainted = cond.fainted;
          if (cond.status) st.status = cond.status;

          if (st.side === 'p2') {
            this.syncOpponentPartyBall(st.species, st.hpPercent, st.fainted, st.status);
          }

          const deltaPct = Math.max(0.1, Number((prevPct - st.hpPercent).toFixed(1)));
          const eff = fromTag.includes('[from]') ? 1 : this.pendingEffectiveness;
          const isCrit = fromTag.includes('[from]') ? false : this.pendingCrit;

          // 回填最近一次 move 事件的克制倍率以播放对应强弱打击音
          for (let i = this.eventBatch.length - 1; i >= 0; i--) {
            const ev = this.eventBatch[i];
            if (ev.kind === 'move' && ev.actorSlot === this.pendingMoveSlot) {
              ev.effectiveness = eff;
              break;
            }
          }

          this.eventBatch.push({
            kind: 'damage',
            slot: st.slot,
            deltaPercent: deltaPct,
            hpPercent: st.hpPercent,
            isCrit,
            effectiveness: eff,
            fromEffect: fromTag,
          });

          const extraNotes: string[] = [];
          if (eff > 1) extraNotes.push('效果绝佳！');
          else if (eff < 1) extraNotes.push('效果不好…');
          if (isCrit) extraNotes.push('击中要害！');

          this.pushLog(
            `<span class="log-dmg">  ↳ ${st.zhSpecies} 失去了 <b>${deltaPct}%</b> HP ${extraNotes.join(' ')}</span>`,
          );

          this.pendingEffectiveness = 1;
          this.pendingCrit = false;
          break;
        }

        case '-heal':
        case '-sethp': {
          const slot = this.parseSlotFromIdent(parts[2]);
          const st = slot ? this.slots.get(slot) : undefined;
          if (!st) break;
          const prevPct = st.hpPercent;
          const cond = parseCondition(parts[3] || '100/100');
          st.hp = cond.hp;
          st.maxhp = cond.maxhp;
          st.hpPercent = cond.hpPercent;
          st.fainted = cond.fainted;
          if (st.side === 'p2') {
            this.syncOpponentPartyBall(st.species, st.hpPercent, st.fainted, st.status);
          }
          const delta = Number((st.hpPercent - prevPct).toFixed(1));
          if (delta > 0) {
            this.eventBatch.push({
              kind: 'heal',
              slot: st.slot,
              deltaPercent: delta,
              hpPercent: st.hpPercent,
            });
            this.pushLog(`<span class="log-heal">  ↳ ${st.zhSpecies} 回复了 <b>+${delta}%</b> HP</span>`);
          }
          break;
        }

        case '-boost':
        case '-unboost': {
          const slot = this.parseSlotFromIdent(parts[2]);
          const st = slot ? this.slots.get(slot) : undefined;
          if (!st) break;
          const stat = parts[3] as keyof TrackedSlotState['boosts'];
          const rawAmt = Number(parts[4]) || 1;
          const amt = cmd === '-boost' ? rawAmt : -rawAmt;
          if (stat in st.boosts) {
            st.boosts[stat] = Math.max(-6, Math.min(6, st.boosts[stat] + amt));
          }
          this.eventBatch.push({ kind: 'boost', slot: st.slot, stat, amount: amt });
          const statZh = STAT_LABELS_ZH[stat] || stat;
          this.pushLog(
            `<span class="${amt > 0 ? 'log-buff' : 'log-debuff'}">  ${st.zhSpecies} 的${statZh}${amt > 0 ? `提升了 +${amt}` : `下降了 ${amt}`}！</span>`,
          );
          break;
        }

        case '-clearallboost': {
          for (const s of this.slots.values()) {
            s.boosts = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0 };
          }
          this.pushLog(`<span class="log-muted">全场所有的能力变化都复原了！</span>`);
          break;
        }

        case '-status': {
          const slot = this.parseSlotFromIdent(parts[2]);
          const st = slot ? this.slots.get(slot) : undefined;
          const status = parts[3] || '';
          if (st && status) {
            st.status = status;
            if (st.side === 'p2') {
              this.syncOpponentPartyBall(st.species, st.hpPercent, st.fainted, st.status);
            }
            this.eventBatch.push({ kind: 'status', slot: st.slot, status });
            const stZh = STATUS_LABELS_ZH[status]?.zh || status;
            this.pushLog(`<span class="log-debuff">  ${st.zhSpecies} 陷入了【${stZh}】状态！</span>`);
          }
          break;
        }

        case '-curestatus': {
          const slot = this.parseSlotFromIdent(parts[2]);
          const st = slot ? this.slots.get(slot) : undefined;
          if (st) {
            st.status = '';
            if (st.side === 'p2') {
              this.syncOpponentPartyBall(st.species, st.hpPercent, st.fainted, '');
            }
            this.eventBatch.push({ kind: 'curestatus', slot: st.slot });
            this.pushLog(`<span class="log-heal">  ${st.zhSpecies} 的异常状态治愈了！</span>`);
          }
          break;
        }

        case '-start':
        case '-end': {
          const slot = this.parseSlotFromIdent(parts[2]);
          const st = slot ? this.slots.get(slot) : undefined;
          const rawEffect = (parts[3] || '').replace(/^move:\s*/i, '').replace(/^ability:\s*/i, '');
          if (st && rawEffect) {
            const started = cmd === '-start';
            if (started) {
              if (!st.volatiles.includes(rawEffect)) st.volatiles.push(rawEffect);
            } else {
              st.volatiles = st.volatiles.filter((v) => v !== rawEffect);
            }
            this.eventBatch.push({ kind: 'volatile', slot: st.slot, volatile: rawEffect, started });
          }
          break;
        }

        case '-ability': {
          const slot = this.parseSlotFromIdent(parts[2]);
          const st = slot ? this.slots.get(slot) : undefined;
          const abName = parts[3] || '';
          if (st && abName) {
            const abZh = getAbilityZh(abName);
            st.revealedAbility = abZh;
            this.eventBatch.push({ kind: 'ability', slot: st.slot, abilityZh: abZh });
            this.pushLog(`<span class="log-ability">[${st.zhSpecies} 的特性：${abZh}]</span>`);
          }
          break;
        }

        case '-item':
        case '-enditem': {
          const slot = this.parseSlotFromIdent(parts[2]);
          const st = slot ? this.slots.get(slot) : undefined;
          const itemName = parts[3] || '';
          if (st && itemName) {
            const itemZh = getItemZh(itemName);
            st.revealedItem = itemZh;
            st.itemConsumed = cmd === '-enditem';
            this.eventBatch.push({
              kind: 'item',
              slot: st.slot,
              itemZh,
              consumed: st.itemConsumed,
            });
          }
          break;
        }

        case '-weather': {
          const w = parts[2] === 'none' ? '' : parts[2] || '';
          if (w !== this.field.weather) {
            this.field.weather = w;
            this.field.weatherTurns = w ? 1 : 0;
            this.eventBatch.push({ kind: 'weather', weather: w });
            const wZh = w ? WEATHER_LABELS_ZH[w]?.zh || w : '恢复晴朗';
            this.pushLog(`<span class="log-field">☀ 天气变化：<b>${wZh}</b></span>`);
          }
          break;
        }

        case '-fieldstart':
        case '-fieldend': {
          const rawField = (parts[2] || '').replace(/^move:\s*/i, '').trim();
          const id = rawField.replace(/\s+/g, '');
          if (TERRAIN_LABELS_ZH[id]) {
            this.field.terrain = cmd === '-fieldstart' ? id : '';
            this.field.terrainTurns = cmd === '-fieldstart' ? 1 : 0;
          } else {
            if (cmd === '-fieldstart') this.field.pseudoWeather[rawField] = 1;
            else delete this.field.pseudoWeather[rawField];
          }
          break;
        }

        case '-sidestart':
        case '-sideend': {
          const sideId: 'p1' | 'p2' = parts[2]?.startsWith('p1') ? 'p1' : 'p2';
          const condName = (parts[3] || '').replace(/^move:\s*/i, '').trim();
          if (cmd === '-sidestart') {
            this.field.sideConditions[sideId][condName] =
              (this.field.sideConditions[sideId][condName] || 0) + 1;
          } else {
            delete this.field.sideConditions[sideId][condName];
          }
          break;
        }

        case 'faint': {
          const slot = this.parseSlotFromIdent(parts[2]);
          const st = slot ? this.slots.get(slot) : undefined;
          if (st) {
            st.hp = 0;
            st.hpPercent = 0;
            st.fainted = true;
            if (st.side === 'p2') {
              this.syncOpponentPartyBall(st.species, 0, true, '');
            }
            this.eventBatch.push({ kind: 'faint', slot: st.slot, species: st.species });
            this.pushLog(`<span class="log-faint">✖ <b>${st.zhSpecies}</b> 倒下了！</span>`);
          }
          break;
        }

        case 'win': {
          this.ended = true;
          const winnerName = parts[2] || '';
          this.winner = winnerName === this.options.p1Name ? 'p1' : 'p2';
          this.eventBatch.push({ kind: 'win', winnerSide: this.winner });
          break;
        }

        case 'tie': {
          this.ended = true;
          this.winner = 'tie';
          this.eventBatch.push({ kind: 'win', winnerSide: 'tie' });
          break;
        }
      }
    }
  }

  private syncOpponentPartyBall(
    species: string,
    hpPct: number,
    fainted: boolean,
    status: string,
  ): void {
    const balls = this.field.partyBalls.p2;
    let entry = balls.find((b) => b.revealed && toID(b.species) === toID(species));
    if (!entry) {
      entry = balls.find((b) => !b.revealed && toID(b.species) === toID(species)) || balls.find((b) => !b.revealed);
    }
    if (entry) {
      entry.species = species;
      entry.zhName = getSpeciesZh(species);
      entry.hp = Math.round(hpPct);
      entry.maxhp = 100;
      entry.fainted = fainted;
      entry.status = status;
      entry.revealed = true;
    }
  }

  flushEvents(): VisualBattleEvent[] {
    return this.eventBatch.splice(0);
  }

  isEnded(): boolean {
    return this.ended;
  }

  getWinner(): 'p1' | 'p2' | 'tie' | null {
    return this.winner;
  }

  getP1Request(): ParsedSideRequest | null {
    return this.p1Request;
  }

  getP2Request(): ParsedSideRequest | null {
    return this.p2Request;
  }

  /**
   * 肉鸽野生收服成功时直接强制获胜结算本场战斗
   */
  async forcePlayerCaptureWin(): Promise<VisualBattleEvent[]> {
    if (!this.ended) {
      this.p1Request = null;
      this.p2Request = null;
      void this.streams.omniscient.write(`>forcewin p1`);
      await this.waitForIdle();
    }
    return this.flushEvents();
  }

  /**
   * 肉鸽波次结束时提取玩家队伍精确剩余 HP / 异常状态 / 招式剩余 PP
   */
  extractPlayerPartyPersist(): Array<{
    species: string;
    hp: number;
    maxhp: number;
    fainted: boolean;
    status: '' | 'brn' | 'par' | 'slp' | 'frz' | 'psn' | 'tox';
    movePp: Record<string, number>;
  }> {
    const simSide = this.stream.battle?.sides?.[0];
    if (!simSide) return [];
    return simSide.pokemon.map((mon) => {
      const movePp: Record<string, number> = {};
      for (const m of mon.moveSlots) {
        movePp[m.id] = m.pp;
      }
      return {
        species: mon.species.name,
        hp: Math.max(0, mon.hp),
        maxhp: Math.max(1, mon.maxhp),
        fainted: mon.fainted || mon.hp <= 0,
        status: (mon.fainted ? '' : mon.status || '') as '' | 'brn' | 'par' | 'slp' | 'frz' | 'psn' | 'tox',
        movePp,
      };
    });
  }

  /**
   * 提交我方与 AI 双方回合指令，推进 @pkmn/sim 并返回本回合全部事件队列
   */
  async submitChoices(p1Choice: string, p2Choice?: string): Promise<VisualBattleEvent[]> {
    if (this.ended) return [];

    const curP1Req = this.p1Request;
    const curP2Req = this.p2Request;
    const needP1 = curP1Req && !curP1Req.wait;
    const needP2 = curP2Req && !curP2Req.wait;

    if (needP1) {
      const safeP1 = this.validateOrFallbackChoice(curP1Req, p1Choice);
      this.p1Request = null;
      void this.streams.omniscient.write(`>p1 ${safeP1}`);
    }
    if (needP2 && p2Choice) {
      const safeP2 = this.validateOrFallbackChoice(curP2Req, p2Choice);
      this.p2Request = null;
      void this.streams.omniscient.write(`>p2 ${safeP2}`);
    }

    // 注意：若仅单边需要换人（如濒死补位 forceSwitch），另一边处于 wait: true，则等待新 request 即可
    await this.waitForIdle();
    return this.flushEvents();
  }

  /**
   * 肉鸽野生宝可梦挣脱精灵球时：消耗玩家本回合出手机会（不扣招式 PP），敌方正常执行回合动作与回合末结算
   */
  async consumePlayerTurnForBallThrow(p2Choice: string): Promise<VisualBattleEvent[]> {
    if (this.ended) return [];
    const battle = this.stream.battle;
    const curP1Req = this.p1Request;
    const curP2Req = this.p2Request;
    if (!battle || !curP1Req || !curP2Req) return [];

    const p1Mon = battle.sides[0]?.active?.[0];
    const origRunAction = battle.runAction.bind(battle);
    let skipped = false;
    battle.runAction = ((action: { choice?: string; pokemon?: unknown }) => {
      if (!skipped && action.pokemon === p1Mon && (action.choice === 'move' || action.choice === 'switch')) {
        skipped = true;
        return;
      }
      return origRunAction(action as Parameters<typeof origRunAction>[0]);
    }) as typeof battle.runAction;

    try {
      this.p1Request = null;
      this.p2Request = null;
      const safeP2 = this.validateOrFallbackChoice(curP2Req, p2Choice);
      await this.streams.omniscient.write(`>p1 default\n>p2 ${safeP2}`);
      await this.waitForIdle();
    } finally {
      battle.runAction = origRunAction;
    }

    return this.flushEvents();
  }

  /**
   * 仅单边指令提交（例如一方濒死强制补位 forceSwitch 而另一方 wait）
   */
  async submitStep(p1Choice: string | null, p2Choice: string | null): Promise<VisualBattleEvent[]> {
    if (this.ended) return [];
    const curP2Req = this.p2Request;

    if (p1Choice && this.p1Request && !this.p1Request.wait) {
      this.p1Request = null;
      void this.streams.omniscient.write(`>p1 ${p1Choice}`);
    }
    if (p2Choice && curP2Req && !curP2Req.wait) {
      this.p2Request = null;
      const safeP2 = this.validateOrFallbackChoice(curP2Req, p2Choice);
      void this.streams.omniscient.write(`>p2 ${safeP2}`);
    }

    await this.waitForIdle();
    return this.flushEvents();
  }

  /**
   * 枚举指定 request 的全部合法原子动作（供本地启发式 AI 与外部大模型掩码强校验使用）
   */
  static enumerateLegalChoicesForSlot(
    req: ParsedSideRequest,
    slotIndex: number,
    alreadyChosenSwitches: Set<number>,
  ): string[] {
    if (req.wait) return ['pass'];

    if (req.teamPreview) {
      const total = req.side.pokemon.length;
      const pickCount = req.maxChosenTeamSize || total;
      const indices = Array.from({ length: Math.min(pickCount, total) }, (_, i) => i + 1).join('');
      return [`team ${indices}`];
    }

    const bench = req.side.pokemon.filter(
      (p) => !p.active && !p.fainted && !alreadyChosenSwitches.has(p.index),
    );

    if (req.forceSwitch) {
      if (!req.forceSwitch[slotIndex]) return ['pass'];
      if (bench.length === 0) return ['pass'];
      return bench.map((b) => `switch ${b.index}`);
    }

    const activeSlot = req.active?.[slotIndex];
    if (!activeSlot) return ['pass'];

    const legal: string[] = [];
    const isDoubles = (req.active?.length || 1) > 1;

    for (const mv of activeSlot.moves) {
      if (mv.disabled) continue;
      const needsExplicitTarget =
        isDoubles && ['normal', 'any', 'adjacentFoe'].includes(mv.target);
      const needsAllyTarget = isDoubles && mv.target === 'adjacentAlly';
      const needsAllyOrSelf = isDoubles && mv.target === 'adjacentAllyOrSelf';

      if (needsExplicitTarget) {
        legal.push(`move ${mv.index} +1`, `move ${mv.index} +2`);
        if (activeSlot.canTerastallize) {
          legal.push(`move ${mv.index} +1 terastallize`, `move ${mv.index} +2 terastallize`);
        }
      } else if (needsAllyTarget) {
        const allyTarget = slotIndex === 0 ? -2 : -1;
        legal.push(`move ${mv.index} ${allyTarget}`);
      } else if (needsAllyOrSelf) {
        legal.push(`move ${mv.index} -${slotIndex + 1}`);
      } else {
        legal.push(`move ${mv.index}`);
        if (activeSlot.canTerastallize) {
          legal.push(`move ${mv.index} terastallize`);
        }
      }
    }

    if (!activeSlot.trapped) {
      for (const b of bench) {
        legal.push(`switch ${b.index}`);
      }
    }

    return legal.length > 0 ? legal : ['default'];
  }

  /**
   * 强校验外部大模型或启发式 AI 生成的指令，若不合法自动安全降级至合法动作，确保 0 卡死
   */
  validateOrFallbackChoice(req: ParsedSideRequest | null, candidate: string): string {
    if (!req || req.wait) return 'pass';
    if (req.teamPreview) {
      const clean = candidate.trim();
      const total = req.side.pokemon.length;
      const pickCount = req.maxChosenTeamSize || total;
      const m = /^team\s+([1-6]+)$/i.exec(clean);
      if (m) {
        const digits = Array.from(new Set(m[1].split('').map(Number))).filter((d) => d >= 1 && d <= total);
        if (digits.length >= Math.min(pickCount, total)) {
          return `team ${digits.slice(0, pickCount).join('')}`;
        }
      }
      return BattleEngine.enumerateLegalChoicesForSlot(req, 0, new Set())[0];
    }

    const slotCount = req.forceSwitch
      ? req.forceSwitch.length
      : req.active
        ? req.active.length
        : 1;

    const rawParts = candidate.split(',').map((s) => s.trim());
    const usedSwitches = new Set<number>();
    let usedTera = false;
    const validatedParts: string[] = [];

    for (let i = 0; i < slotCount; i++) {
      const legalForSlot = BattleEngine.enumerateLegalChoicesForSlot(req, i, usedSwitches);
      let chosen = rawParts[i] || '';

      if (usedTera && chosen.includes('terastallize')) {
        chosen = chosen.replace(/\s*terastallize/i, '').trim();
      }

      if (!legalForSlot.includes(chosen)) {
        // 尝试宽松匹配相同 move index
        const moveMatch = /^move\s+(\d+)/i.exec(chosen);
        const fallbackSameMove = moveMatch
          ? legalForSlot.find((l) => l.startsWith(`move ${moveMatch[1]}`))
          : undefined;
        chosen = fallbackSameMove || legalForSlot[0] || 'default';
      }

      const swMatch = /^switch\s+(\d+)/i.exec(chosen);
      if (swMatch) {
        usedSwitches.add(Number(swMatch[1]));
      }
      if (chosen.includes('terastallize')) {
        usedTera = true;
      }
      validatedParts.push(chosen);
    }

    return validatedParts.join(', ');
  }
}
