import { Dex } from '@pkmn/dex';
import {
  STAT_LABELS_ZH,
  STATUS_LABELS_ZH,
  TERRAIN_LABELS_ZH,
  TYPE_THEMES,
  WEATHER_LABELS_ZH,
  type BattleSlotId,
} from '../config/constants';
import type { TrainerProfile } from '../config/presets';
import { audioEngine } from '../audio/AudioEngine';
import type { BattleEngine, PartyBallInfo, TrackedSlotState } from '../core/BattleEngine';
import type { ActiveBattleContext } from '../core/BattleOrchestrator';
import { SaveStorage } from '../core/SaveStorage';
import {
  calcSpeedTierRange,
  getAbilityZh,
  getMoveZh,
} from '../data/dexRegistry';
import {
  getPokemonMiniIconStyle,
  getTrainerSpriteUrl,
} from '../data/spriteResolver';

const VOLATILE_ZH: Record<string, string> = {
  Substitute: '替身',
  Taunt: '挑衅',
  Encore: '再来一次',
  Confusion: '混乱',
  confusion: '混乱',
  LeechSeed: '寄生种子',
  'Leech Seed': '寄生种子',
  Yawn: '哈欠',
  Perish3: '灭歌3',
  Perish2: '灭歌2',
  Perish1: '灭歌1',
  Curse: '诅咒',
  FocusEnergy: '聚气',
  Protosynthesis: '古代活性',
  QuarkDrive: '夸克充能',
  FlashFire: '引火',
};

const SIDE_COND_ZH: Record<string, string> = {
  Tailwind: '顺风',
  Reflect: '反射壁',
  'Light Screen': '光墙',
  'Aurora Veil': '极光幕',
  'Stealth Rock': '隐形岩',
  Spikes: '撒菱',
  'Toxic Spikes': '毒菱',
  'Sticky Web': '黏黏网',
  Safeguard: '神秘守护',
};

function formatBoostMultiplier(stages: number): string {
  if (stages > 0) {
    const val = (2 + stages) / 2;
    return `${Number.isInteger(val) ? val.toFixed(1) : val.toFixed(2).replace(/0$/, '')}×`;
  }
  const val = 2 / (2 - stages);
  return `${val.toFixed(2).replace(/0$/, '')}×`;
}

function hpColorClass(pct: number): string {
  if (pct > 50) return 'hp-high';
  if (pct > 20) return 'hp-mid';
  return 'hp-low';
}

interface SlotDomRefs {
  root: HTMLElement;
  nameRow: HTMLElement;
  hpGhost: HTMLElement;
  hpFill: HTMLElement;
  shieldTicks: HTMLElement;
  hpText: HTMLElement;
  chipsRow: HTMLElement;
  lastPct: number;
}

export interface ShowdownHUDActions {
  onCycleSpeed: (nextSpeed: 1 | 2 | 4) => void;
  onOpenSettings: () => void;
  onExitToMenu: () => void;
}

/**
 * Showdown 竞技级透明战斗 HUD：
 * 精确百分比血条 + 延迟残影掉血条 + Boss 多段护盾刻度 + 6 球存活指示灯 + 能力倍率胶囊 + 点击侦察浮窗 + 折叠战报流
 */
export class ShowdownHUD {
  private hudRoot: HTMLElement;
  private modalRoot: HTMLElement;
  private actions: ShowdownHUDActions;

  private topTitleEl!: HTMLElement;
  private topSubEl!: HTMLElement;
  private turnPillEl!: HTMLElement;
  private speedBtnEl!: HTMLButtonElement;
  private bgmBtnEl!: HTMLButtonElement;
  private fieldBarEl!: HTMLElement;
  private aiBannerEl!: HTMLElement;
  private enemyPlatesWrap!: HTMLElement;
  private playerPlatesWrap!: HTMLElement;

  private slotRefs = new Map<BattleSlotId, SlotDomRefs>();
  private logLines: string[] = [];
  private logDrawerOpen = false;
  private aiThoughtExpanded = false;
  private lastEngine: BattleEngine | null = null;

  constructor(hudRoot: HTMLElement, modalRoot: HTMLElement, actions: ShowdownHUDActions) {
    this.hudRoot = hudRoot;
    this.modalRoot = modalRoot;
    this.actions = actions;
    this.mountSkeleton();
  }

  private mountSkeleton(): void {
    this.hudRoot.innerHTML = `
      <div class="sd-topbar">
        <div class="sd-topbar-left">
          <span class="sd-mode-title" id="sd-top-title">准备就绪</span>
          <span class="sd-mode-sub" id="sd-top-sub"></span>
          <span class="sd-turn-pill" id="sd-turn-pill">T1</span>
        </div>
        <div class="sd-topbar-actions">
          <button type="button" class="sd-icon-btn" id="sd-btn-speed" title="切换战斗倍速">1×</button>
          <button type="button" class="sd-icon-btn" id="sd-btn-bgm" title="切换音乐模式">♪</button>
          <button type="button" class="sd-icon-btn" id="sd-btn-log" title="展开回合战报">战报</button>
          <button type="button" class="sd-icon-btn" id="sd-btn-settings" title="AI与音频设置">⚙</button>
          <button type="button" class="sd-icon-btn sd-btn-exit" id="sd-btn-exit" title="返回主菜单">退出</button>
        </div>
      </div>

      <div class="sd-field-strip" id="sd-field-strip"></div>

      <div class="sd-ai-banner hidden" id="sd-ai-banner"></div>

      <div class="sd-plates-group sd-plates-enemy" id="sd-plates-enemy"></div>
      <div class="sd-plates-group sd-plates-player" id="sd-plates-player"></div>
    `;

    this.topTitleEl = this.hudRoot.querySelector('#sd-top-title')!;
    this.topSubEl = this.hudRoot.querySelector('#sd-top-sub')!;
    this.turnPillEl = this.hudRoot.querySelector('#sd-turn-pill')!;
    this.speedBtnEl = this.hudRoot.querySelector('#sd-btn-speed') as HTMLButtonElement;
    this.bgmBtnEl = this.hudRoot.querySelector('#sd-btn-bgm') as HTMLButtonElement;
    this.fieldBarEl = this.hudRoot.querySelector('#sd-field-strip')!;
    this.aiBannerEl = this.hudRoot.querySelector('#sd-ai-banner')!;
    this.enemyPlatesWrap = this.hudRoot.querySelector('#sd-plates-enemy')!;
    this.playerPlatesWrap = this.hudRoot.querySelector('#sd-plates-player')!;

    this.refreshControlBadges();

    this.speedBtnEl.addEventListener('click', () => {
      const cur = SaveStorage.getPrefs().battleSpeed;
      const next: 1 | 2 | 4 = cur === 1 ? 2 : cur === 2 ? 4 : 1;
      this.actions.onCycleSpeed(next);
      this.refreshControlBadges();
    });

    this.bgmBtnEl.addEventListener('click', () => {
      const prefs = SaveStorage.getPrefs();
      const next =
        prefs.bgmMode === 'showdown'
          ? 'chiptune'
          : prefs.bgmMode === 'chiptune'
            ? 'off'
            : 'showdown';
      prefs.bgmMode = next;
      SaveStorage.savePrefs(prefs);
      audioEngine.setBgmMode(next);
      this.refreshControlBadges();
    });

    this.hudRoot.querySelector('#sd-btn-log')!.addEventListener('click', () => {
      this.toggleLogDrawer();
    });

    this.hudRoot.querySelector('#sd-btn-settings')!.addEventListener('click', () => {
      this.actions.onOpenSettings();
    });

    this.hudRoot.querySelector('#sd-btn-exit')!.addEventListener('click', () => {
      this.actions.onExitToMenu();
    });

    this.aiBannerEl.addEventListener('click', () => {
      this.aiThoughtExpanded = !this.aiThoughtExpanded;
      this.aiBannerEl.classList.toggle('expanded', this.aiThoughtExpanded);
    });

    // 预挂载 4 个槽位面板以便血条 CSS transition 与残影平滑插值
    for (const slot of ['p2a', 'p2b'] as BattleSlotId[]) {
      const refs = this.createSlotPlate(slot);
      this.slotRefs.set(slot, refs);
      this.enemyPlatesWrap.appendChild(refs.root);
    }
    for (const slot of ['p1a', 'p1b'] as BattleSlotId[]) {
      const refs = this.createSlotPlate(slot);
      this.slotRefs.set(slot, refs);
      this.playerPlatesWrap.appendChild(refs.root);
    }
  }

  refreshControlBadges(): void {
    const prefs = SaveStorage.getPrefs();
    this.speedBtnEl.textContent = prefs.battleSpeed === 4 ? '⚡极速' : `${prefs.battleSpeed}×`;
    this.bgmBtnEl.textContent =
      prefs.bgmMode === 'off' ? '静音' : prefs.bgmMode === 'chiptune' ? '8Bit' : '♪原声';
  }

  private createSlotPlate(slot: BattleSlotId): SlotDomRefs {
    const root = document.createElement('div');
    root.className = `sd-plate sd-plate-${slot} hidden`;
    root.dataset.slot = slot;
    root.innerHTML = `
      <div class="sd-plate-head"></div>
      <div class="sd-hp-track">
        <div class="sd-hp-ghost" style="width:100%"></div>
        <div class="sd-hp-fill hp-high" style="width:100%"></div>
        <div class="sd-shield-ticks"></div>
        <span class="sd-hp-num">100%</span>
      </div>
      <div class="sd-chips-row"></div>
    `;

    root.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openScoutPopover(slot);
    });

    return {
      root,
      nameRow: root.querySelector('.sd-plate-head')!,
      hpGhost: root.querySelector('.sd-hp-ghost')!,
      hpFill: root.querySelector('.sd-hp-fill')!,
      shieldTicks: root.querySelector('.sd-shield-ticks')!,
      hpText: root.querySelector('.sd-hp-num')!,
      chipsRow: root.querySelector('.sd-chips-row')!,
      lastPct: 100,
    };
  }

  setVisible(visible: boolean): void {
    this.hudRoot.classList.toggle('hidden', !visible);
  }

  sync(engine: BattleEngine, context: ActiveBattleContext): void {
    this.lastEngine = engine;
    this.setVisible(true);
    this.topTitleEl.textContent = context.titleZh;
    this.topSubEl.textContent = context.subBadgeZh;
    this.turnPillEl.textContent = `T${Math.max(1, engine.field.turn)}`;

    // 1. 场地状态胶囊（天气 / 场地 / 空间 / 双边钉子屏幕）
    const fieldChips: string[] = [];
    if (engine.field.weather) {
      const w = WEATHER_LABELS_ZH[engine.field.weather];
      fieldChips.push(
        `<span class="sd-field-chip" style="background:${w?.color || '#4a607a'}">☀ ${w?.zh || engine.field.weather}</span>`,
      );
    }
    if (engine.field.terrain) {
      const t = TERRAIN_LABELS_ZH[engine.field.terrain];
      fieldChips.push(
        `<span class="sd-field-chip" style="background:${t?.color || '#4e9a36'}">❖ ${t?.zh || engine.field.terrain}</span>`,
      );
    }
    for (const pw of Object.keys(engine.field.pseudoWeather)) {
      const zh = pw.toLowerCase().includes('trick') ? '戏法空间' : pw;
      fieldChips.push(`<span class="sd-field-chip" style="background:#7950f2">✦ ${zh}</span>`);
    }
    for (const [cond, stacks] of Object.entries(engine.field.sideConditions.p1)) {
      const zh = SIDE_COND_ZH[cond] || cond;
      fieldChips.push(
        `<span class="sd-field-chip sd-chip-ally">我:${zh}${stacks > 1 ? `×${stacks}` : ''}</span>`,
      );
    }
    for (const [cond, stacks] of Object.entries(engine.field.sideConditions.p2)) {
      const zh = SIDE_COND_ZH[cond] || cond;
      fieldChips.push(
        `<span class="sd-field-chip sd-chip-foe">敌:${zh}${stacks > 1 ? `×${stacks}` : ''}</span>`,
      );
    }
    this.fieldBarEl.innerHTML = fieldChips.join('');

    // 2. 更新双方 6 球指示栏与槽位血条面板
    this.renderPartyBallsHeader('p2', engine.field.partyBalls.p2);
    this.renderPartyBallsHeader('p1', engine.field.partyBalls.p1);

    const activeSlots: BattleSlotId[] = engine.field.isDoubles
      ? ['p2a', 'p2b', 'p1a', 'p1b']
      : ['p2a', 'p1a'];

    for (const slot of ['p2a', 'p2b', 'p1a', 'p1b'] as BattleSlotId[]) {
      const refs = this.slotRefs.get(slot)!;
      const state = engine.slots.get(slot);
      if (!activeSlots.includes(slot) || !state || state.fainted) {
        refs.root.classList.add('hidden');
        continue;
      }
      refs.root.classList.remove('hidden');
      this.updateSlotPlate(refs, state);
    }
  }

  private renderPartyBallsHeader(side: 'p1' | 'p2', balls: PartyBallInfo[]): void {
    const wrap = side === 'p2' ? this.enemyPlatesWrap : this.playerPlatesWrap;
    let tray = wrap.querySelector('.sd-party-balls') as HTMLElement | null;
    if (!tray) {
      tray = document.createElement('div');
      tray.className = `sd-party-balls sd-balls-${side}`;
      wrap.prepend(tray);
    }

    const total = Math.max(balls.length, 1);
    const icons: string[] = [];
    for (let i = 0; i < total; i++) {
      const b = balls[i];
      if (!b) continue;
      let cls = 'ball-alive';
      let tip = b.revealed ? `${b.zhName} (${b.fainted ? '濒死' : `${b.hp}%`})` : '未亮明底牌';
      if (b.fainted) cls = 'ball-fainted';
      else if (!b.revealed) cls = 'ball-unrevealed';
      else if (b.status) cls = 'ball-status';
      icons.push(`<span class="sd-ball-dot ${cls}" title="${tip}"></span>`);
    }
    tray.innerHTML = icons.join('');
  }

  private updateSlotPlate(refs: SlotDomRefs, st: TrackedSlotState): void {
    const genderHtml =
      st.gender === 'M'
        ? '<span class="sd-gender-m">♂</span>'
        : st.gender === 'F'
          ? '<span class="sd-gender-f">♀</span>'
          : '';
    const shinyHtml = st.shiny ? '<span class="sd-shiny-star" title="闪光宝可梦">✦</span>' : '';
    const teraHtml = st.terastallized
      ? `<span class="sd-tera-mini" style="background:${TYPE_THEMES[st.terastallized]?.bg || '#3c7a89'}">💎${TYPE_THEMES[st.terastallized]?.zh || st.terastallized}</span>`
      : '';
    const bossBadge =
      st.bossShieldRemaining > 0
        ? `<span class="sd-boss-badge">🛡×${st.bossShieldRemaining}</span>`
        : '';

    refs.nameRow.innerHTML = `
      <span class="sd-poke-name">${shinyHtml}${st.zhSpecies}${genderHtml}${teraHtml}</span>
      <span class="sd-poke-lv">${bossBadge}Lv.${st.level}</span>
    `;

    const pct = Math.max(0, Math.min(100, st.hpPercent));
    refs.hpFill.className = `sd-hp-fill ${hpColorClass(pct)}`;
    refs.hpFill.style.width = `${pct}%`;

    // Showdown 延迟掉血残影效果
    if (pct < refs.lastPct) {
      const targetPct = pct;
      window.setTimeout(() => {
        refs.hpGhost.style.width = `${targetPct}%`;
      }, 150);
    } else {
      refs.hpGhost.style.width = `${pct}%`;
    }
    refs.lastPct = pct;

    // Boss 护盾分段金线刻度
    if (st.bossShieldThresholds.length > 0) {
      refs.shieldTicks.innerHTML = st.bossShieldThresholds
        .map((th) => `<i class="sd-shield-line" style="left:${th}%"></i>`)
        .join('');
    } else {
      refs.shieldTicks.innerHTML = '';
    }

    refs.hpText.textContent =
      st.side === 'p1' && st.maxhp !== 100
        ? `${st.hp}/${st.maxhp} (${Math.round(pct)}%)`
        : `${pct % 1 === 0 ? pct.toFixed(0) : pct.toFixed(1)}%`;

    // 状态与能力升降倍率胶囊（Showdown 原汁原味）
    const chips: string[] = [];
    if (st.status) {
      const info = STATUS_LABELS_ZH[st.status] || { zh: st.status.toUpperCase(), color: '#868e96' };
      chips.push(
        `<span class="sd-chip sd-chip-status" style="background:${info.color}">${info.zh}</span>`,
      );
    }

    for (const [stat, val] of Object.entries(st.boosts)) {
      if (!val) continue;
      const label = STAT_LABELS_ZH[stat] || stat;
      const mult = formatBoostMultiplier(val);
      chips.push(
        `<span class="sd-chip ${val > 0 ? 'sd-chip-buff' : 'sd-chip-debuff'}">${label} ${mult}</span>`,
      );
    }

    for (const vol of st.volatiles) {
      const zh = VOLATILE_ZH[vol] || VOLATILE_ZH[vol.replace(/\s+/g, '')];
      if (zh) {
        chips.push(`<span class="sd-chip sd-chip-vol">${zh}</span>`);
      }
    }

    refs.chipsRow.innerHTML = chips.join('');
  }

  updateAiBanner(info: {
    trainer?: TrainerProfile;
    speechBubble: string;
    thoughtSummary: string;
    source: 'heuristic' | 'llm' | 'llm-fallback' | 'thinking';
  }): void {
    if (!info.trainer && !info.speechBubble) {
      this.aiBannerEl.classList.add('hidden');
      return;
    }
    this.aiBannerEl.classList.remove('hidden');

    const avatarHtml = info.trainer
      ? `<img class="sd-trainer-avatar" src="${getTrainerSpriteUrl(info.trainer.spriteKey)}" alt="${info.trainer.zhName}" />`
      : `<span class="sd-wild-badge">野生</span>`;

    const sourceLabel =
      info.source === 'llm'
        ? 'LLM 实时博弈'
        : info.source === 'thinking'
          ? 'LLM 思考中…'
          : info.source === 'llm-fallback'
            ? '离线接管'
            : '战术AI';

    this.aiBannerEl.innerHTML = `
      <div class="sd-ai-row">
        ${avatarHtml}
        <div class="sd-ai-bubble-col">
          <div class="sd-ai-bubble">
            <strong>${info.trainer ? info.trainer.zhName : '遭遇'}：</strong>${info.speechBubble}
          </div>
          <div class="sd-ai-thought">
            <span class="sd-ai-tag">${sourceLabel}</span>
            <span>${info.thoughtSummary}</span>
          </div>
        </div>
      </div>
    `;
  }

  clearLogs(): void {
    this.logLines = [];
    this.syncLogDrawerIfOpen();
  }

  appendLog(html: string): void {
    this.logLines.push(html);
    if (this.logLines.length > 180) {
      this.logLines.shift();
    }
    this.syncLogDrawerIfOpen();
  }

  toggleLogDrawer(): void {
    this.logDrawerOpen = !this.logDrawerOpen;
    if (!this.logDrawerOpen) {
      const existing = this.modalRoot.querySelector('#sd-log-drawer');
      existing?.remove();
      return;
    }

    let drawer = this.modalRoot.querySelector('#sd-log-drawer') as HTMLElement | null;
    if (!drawer) {
      drawer = document.createElement('div');
      drawer.id = 'sd-log-drawer';
      drawer.className = 'sd-modal-backdrop';
      drawer.innerHTML = `
        <div class="sd-sheet sd-log-sheet">
          <div class="sd-sheet-header">
            <h3>📜 Showdown 对战战报流</h3>
            <button type="button" class="sd-close-btn" id="sd-close-log">关闭</button>
          </div>
          <div class="sd-log-body" id="sd-log-body"></div>
        </div>
      `;
      drawer.addEventListener('click', (e) => {
        if (e.target === drawer || (e.target as HTMLElement).id === 'sd-close-log') {
          this.logDrawerOpen = false;
          drawer?.remove();
        }
      });
      this.modalRoot.appendChild(drawer);
    }
    this.syncLogDrawerIfOpen();
  }

  private syncLogDrawerIfOpen(): void {
    const body = this.modalRoot.querySelector('#sd-log-body') as HTMLElement | null;
    if (!body) return;
    body.innerHTML =
      this.logLines.length > 0
        ? this.logLines.map((l) => `<div class="sd-log-line">${l}</div>`).join('')
        : '<div class="sd-log-empty">暂无战报记录</div>';
    body.scrollTop = body.scrollHeight;
  }

  /**
   * 点击宝可梦或血条弹出的 Showdown 竞技侦察浮窗（属性、种族值、速度线上下界、已暴露特性/道具/招式）
   */
  openScoutPopover(slot: BattleSlotId): void {
    if (!this.lastEngine) return;
    const st = this.lastEngine.slots.get(slot);
    if (!st || st.fainted) return;

    const sp = Dex.species.get(st.species);
    const speTier = calcSpeedTierRange(st.species, st.level);

    // 若为我方宝可梦，可从 p1Request 读取精确特性/携带物/面板值；敌方则严格只展示已暴露情报 + 种族候选
    let abilityLine = st.revealedAbility;
    if (!abilityLine) {
      const possible = Object.values(sp.abilities || {}).map((a) => getAbilityZh(a));
      abilityLine = `未知（可能：${possible.join(' / ')}）`;
    }
    const itemLine = st.revealedItem
      ? `${st.revealedItem}${st.itemConsumed ? ' (已消耗)' : ''}`
      : '未知携带物';

    const revealedMovesHtml =
      Object.keys(st.revealedMoves).length > 0
        ? Object.entries(st.revealedMoves)
            .map(([mId, used]) => {
              const dm = Dex.moves.get(mId);
              const maxPp = dm.pp ? Math.floor(dm.pp * 1.6) : 16;
              return `<span class="scout-move-pill">${getMoveZh(mId)} <small>已用 ${used}/${maxPp}</small></span>`;
            })
            .join('')
        : '<span class="scout-muted">尚未出招暴露</span>';

    const typeBadges = st.types
      .map((t) => {
        const th = TYPE_THEMES[t] || TYPE_THEMES.Normal;
        return `<span class="sd-type-badge" style="background:${th.bg};border-color:${th.border}">${th.zh}</span>`;
      })
      .join('');

    const bs = sp.baseStats || { hp: 70, atk: 70, def: 70, spa: 70, spd: 70, spe: 70 };
    const statItems = [
      ['HP', bs.hp],
      ['物攻', bs.atk],
      ['物防', bs.def],
      ['特攻', bs.spa],
      ['特防', bs.spd],
      ['速度', bs.spe],
    ] as const;

    const old = this.modalRoot.querySelector('#sd-scout-modal');
    old?.remove();

    const modal = document.createElement('div');
    modal.id = 'sd-scout-modal';
    modal.className = 'sd-modal-backdrop';
    modal.innerHTML = `
      <div class="sd-sheet sd-scout-sheet">
        <div class="sd-sheet-header">
          <div class="scout-title-wrap">
            <span style="${getPokemonMiniIconStyle(st.species)}"></span>
            <div>
              <h3>${st.zhSpecies} <small>Lv.${st.level}</small></h3>
              <div class="scout-types">${typeBadges}</div>
            </div>
          </div>
          <button type="button" class="sd-close-btn" id="sd-close-scout">关闭</button>
        </div>

        <div class="scout-grid">
          <div class="scout-row">
            <span class="scout-label">⚡ Lv.${st.level} 速度线区间</span>
            <span class="scout-val"><b>${speTier.minSpe}</b> ~ <b>${speTier.maxSpe}</b> (围巾 <b>${speTier.scarfSpe}</b>)</span>
          </div>
          <div class="scout-row">
            <span class="scout-label">✦ 特性情报</span>
            <span class="scout-val">${abilityLine}</span>
          </div>
          <div class="scout-row">
            <span class="scout-label">🎒 道具情报</span>
            <span class="scout-val">${itemLine}</span>
          </div>
          <div class="scout-row">
            <span class="scout-label">⚔ 已暴露招式</span>
            <div class="scout-moves">${revealedMovesHtml}</div>
          </div>
        </div>

        <div class="scout-bst-box">
          ${statItems
            .map(
              ([lbl, val]) => `
            <div class="scout-bst-line">
              <span>${lbl}</span>
              <div class="scout-bst-bar"><i style="width:${Math.min(100, Math.round((val / 180) * 100))}%"></i></div>
              <b>${val}</b>
            </div>
          `,
            )
            .join('')}
        </div>
      </div>
    `;

    modal.addEventListener('click', (e) => {
      if (e.target === modal || (e.target as HTMLElement).id === 'sd-close-scout') {
        modal.remove();
      }
    });
    this.modalRoot.appendChild(modal);
  }
}
