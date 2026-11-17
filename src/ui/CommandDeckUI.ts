import { STATUS_LABELS_ZH, TYPE_THEMES, type BattleSlotId } from '../config/constants';
import { audioEngine } from '../audio/AudioEngine';
import type {
  BattleEngine,
  ParsedSideRequest,
  RequestMoveOption,
  RequestSidePokemon,
} from '../core/BattleEngine';
import type { ActiveBattleContext } from '../core/BattleOrchestrator';
import type { BallTier, RogueRunManager } from '../core/RogueRunManager';
import { getAbilityZh, getItemZh, getMoveZh, getTypeEffectiveness } from '../data/dexRegistry';
import { getPokemonMiniIconStyle } from '../data/spriteResolver';

export interface CommandDeckCallbacks {
  onSubmitChoice: (choiceString: string) => void;
  onThrowPokeball: (ball: BallTier) => void;
}

function formatEffBadge(eff: number): { text: string; cls: string } | null {
  if (eff >= 4) return { text: '4× 极佳', cls: 'eff-super4' };
  if (eff > 1) return { text: '2× 绝佳', cls: 'eff-super' };
  if (eff === 0) return { text: '0× 免疫', cls: 'eff-immune' };
  if (eff <= 0.25) return { text: '¼× 极微', cls: 'eff-resist' };
  if (eff < 1) return { text: '½× 微弱', cls: 'eff-resist' };
  return null;
}

function categoryBadgeZh(cat: 'Physical' | 'Special' | 'Status'): string {
  if (cat === 'Physical') return '物';
  if (cat === 'Special') return '特';
  return '变';
}

/**
 * Showdown 同屏单手指令操控台：
 * 上半区 2×2 属性着色招式网格（含实时克制倍率与太晶开关）+ 下半区 6 槽队伍直觉换人条 + 双打目标选择 + 肉鸽精灵球抽屉
 */
export class CommandDeckUI {
  private root: HTMLElement;
  private rogueManager: RogueRunManager;
  private callbacks: CommandDeckCallbacks;

  private engine: BattleEngine | null = null;
  private req: ParsedSideRequest | null = null;
  private context: ActiveBattleContext | null = null;

  private currentSlotIdx = 0;
  private queuedChoices: string[] = [];
  private usedSwitchIndices = new Set<number>();
  private teraArmed = false;
  private teraUsedInQueue = false;
  private pendingTargetMove: RequestMoveOption | null = null;
  private ballTrayOpen = false;

  constructor(
    root: HTMLElement,
    rogueManager: RogueRunManager,
    callbacks: CommandDeckCallbacks,
  ) {
    this.root = root;
    this.rogueManager = rogueManager;
    this.callbacks = callbacks;
  }

  renderWaiting(messageZh: string): void {
    this.root.innerHTML = `
      <div class="deck-waiting">
        <span class="deck-spinner"></span>
        <span>${messageZh}</span>
      </div>
    `;
  }

  renderTurnRequest(
    engine: BattleEngine,
    req: ParsedSideRequest,
    context: ActiveBattleContext,
  ): void {
    this.engine = engine;
    this.req = req;
    this.context = context;
    this.currentSlotIdx = 0;
    this.queuedChoices = [];
    this.usedSwitchIndices.clear();
    this.teraArmed = false;
    this.teraUsedInQueue = false;
    this.pendingTargetMove = null;
    this.ballTrayOpen = false;

    this.advanceSlotToNextActionable();
    this.renderCurrentState();
  }

  private advanceSlotToNextActionable(): void {
    if (!this.req) return;
    if (this.req.forceSwitch) {
      while (
        this.currentSlotIdx < this.req.forceSwitch.length &&
        !this.req.forceSwitch[this.currentSlotIdx]
      ) {
        this.queuedChoices[this.currentSlotIdx] = 'pass';
        this.currentSlotIdx++;
      }
      return;
    }

    if (this.req.active) {
      while (
        this.currentSlotIdx < this.req.active.length &&
        !this.req.active[this.currentSlotIdx]
      ) {
        this.queuedChoices[this.currentSlotIdx] = 'pass';
        this.currentSlotIdx++;
      }
    }
  }

  private commitSlotChoice(choice: string): void {
    if (!this.req) return;
    this.queuedChoices[this.currentSlotIdx] = choice;

    const swMatch = /^switch\s+(\d+)/i.exec(choice);
    if (swMatch) {
      this.usedSwitchIndices.add(Number(swMatch[1]));
    }
    if (choice.includes('terastallize')) {
      this.teraUsedInQueue = true;
    }

    this.teraArmed = false;
    this.pendingTargetMove = null;
    this.currentSlotIdx++;
    this.advanceSlotToNextActionable();

    const totalSlots = this.req.forceSwitch
      ? this.req.forceSwitch.length
      : this.req.active
        ? this.req.active.length
        : 1;

    // 若后备不足导致双打第二槽无法继续换人，自动补 pass
    if (this.req.forceSwitch && this.currentSlotIdx < totalSlots) {
      const remainingBench = this.req.side.pokemon.filter(
        (p) => !p.active && !p.fainted && !this.usedSwitchIndices.has(p.index),
      );
      if (remainingBench.length === 0) {
        while (this.currentSlotIdx < totalSlots) {
          this.queuedChoices[this.currentSlotIdx] = 'pass';
          this.currentSlotIdx++;
        }
      }
    }

    if (this.currentSlotIdx >= totalSlots) {
      const finalChoice = this.queuedChoices.join(', ');
      this.callbacks.onSubmitChoice(finalChoice);
    } else {
      audioEngine.playUiSfx('select');
      this.renderCurrentState();
    }
  }

  private rollbackPreviousSlot(): void {
    if (this.currentSlotIdx <= 0) return;
    this.currentSlotIdx = 0;
    this.queuedChoices = [];
    this.usedSwitchIndices.clear();
    this.teraArmed = false;
    this.teraUsedInQueue = false;
    this.pendingTargetMove = null;
    this.advanceSlotToNextActionable();
    audioEngine.playUiSfx('cancel');
    this.renderCurrentState();
  }

  private renderCurrentState(): void {
    if (!this.engine || !this.req || !this.context) return;

    if (this.req.forceSwitch) {
      this.renderForceSwitchPanel();
      return;
    }

    if (this.pendingTargetMove) {
      this.renderDoublesTargetPicker(this.pendingTargetMove);
      return;
    }

    this.renderStandardShowdownDeck();
  }

  private renderForceSwitchPanel(): void {
    if (!this.req) return;
    const slotLabel = this.req.forceSwitch && this.req.forceSwitch.length > 1
      ? this.currentSlotIdx === 0
        ? '左位 (p1a)'
        : '右位 (p1b)'
      : '出战位';

    const cardsHtml = this.req.side.pokemon
      .map((mon) => {
        const disabled = mon.active || mon.fainted || this.usedSwitchIndices.has(mon.index);
        const movesText = mon.moves.slice(0, 4).map((m) => getMoveZh(m)).join(' · ');
        const stBadge = mon.status
          ? `<span class="mini-status" style="background:${STATUS_LABELS_ZH[mon.status]?.color || '#666'}">${STATUS_LABELS_ZH[mon.status]?.zh || mon.status}</span>`
          : '';
        return `
          <button type="button" class="force-switch-card ${disabled ? 'is-disabled' : ''}" data-switch="${mon.index}" ${disabled ? 'disabled' : ''}>
            <div class="fsc-top">
              <span style="${getPokemonMiniIconStyle(mon.species)}"></span>
              <div class="fsc-title">
                <strong>${mon.zhName} <small>Lv.${mon.level}</small> ${stBadge}</strong>
                <span>${getAbilityZh(mon.ability)}${mon.item ? ` · ${getItemZh(mon.item)}` : ''}</span>
              </div>
              <b class="fsc-hp">${mon.fainted ? '濒死' : `${Math.round(mon.hpPercent)}%`}</b>
            </div>
            <div class="fsc-hpbar"><i style="width:${mon.hpPercent}%"></i></div>
            <div class="fsc-moves">${movesText}</div>
          </button>
        `;
      })
      .join('');

    this.root.innerHTML = `
      <div class="deck-force-wrap">
        <div class="deck-header-bar">
          <span class="deck-prompt">⇄ 请选择替补登场的宝可梦（${slotLabel}）</span>
        </div>
        <div class="force-switch-grid">${cardsHtml}</div>
      </div>
    `;

    this.root.querySelectorAll<HTMLButtonElement>('[data-switch]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.switch);
        this.commitSlotChoice(`switch ${idx}`);
      });
    });
  }

  private renderDoublesTargetPicker(mv: RequestMoveOption): void {
    if (!this.engine) return;
    const moveType =
      this.teraArmed && mv.id === 'terablast'
        ? this.req?.active?.[this.currentSlotIdx]?.canTerastallize || mv.type
        : mv.type;

    const buildTargetBtn = (slotId: BattleSlotId, targetCode: string, roleLabel: string) => {
      const st = this.engine!.slots.get(slotId);
      if (!st || st.fainted) {
        return `<button type="button" class="target-card is-disabled" disabled>${roleLabel}（空位）</button>`;
      }
      const eff = mv.category === 'Status' ? 1 : getTypeEffectiveness(moveType, st.types);
      const badge = mv.category === 'Status' ? null : formatEffBadge(eff);
      return `
        <button type="button" class="target-card" data-target="${targetCode}">
          <span style="${getPokemonMiniIconStyle(st.species)}"></span>
          <div class="target-card-info">
            <strong>${roleLabel} · ${st.zhSpecies}</strong>
            <span>HP ${Math.round(st.hpPercent)}%</span>
          </div>
          ${badge ? `<em class="move-eff-tag ${badge.cls}">${badge.text}</em>` : ''}
        </button>
      `;
    };

    const allySlot: BattleSlotId = this.currentSlotIdx === 0 ? 'p1b' : 'p1a';
    const allyCode = this.currentSlotIdx === 0 ? '-2' : '-1';
    const allowAlly = mv.target === 'normal' || mv.target === 'any' || mv.target === 'adjacentAlly';

    this.root.innerHTML = `
      <div class="deck-target-picker">
        <div class="deck-header-bar">
          <span class="deck-prompt">🎯 选择【${mv.zhName}】的攻击目标</span>
          <button type="button" class="deck-small-btn" id="btn-cancel-target">← 返回招式</button>
        </div>
        <div class="target-foe-row">
          ${buildTargetBtn('p2a', '+1', '敌方左位')}
          ${buildTargetBtn('p2b', '+2', '敌方右位')}
        </div>
        ${
          allowAlly
            ? `<div class="target-ally-row">${buildTargetBtn(allySlot, allyCode, '我方队友')}</div>`
            : ''
        }
      </div>
    `;

    this.root.querySelector('#btn-cancel-target')?.addEventListener('click', () => {
      this.pendingTargetMove = null;
      audioEngine.playUiSfx('cancel');
      this.renderCurrentState();
    });

    this.root.querySelectorAll<HTMLButtonElement>('[data-target]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetCode = btn.dataset.target!;
        const teraSuffix = this.teraArmed ? ' terastallize' : '';
        this.commitSlotChoice(`move ${mv.index} ${targetCode}${teraSuffix}`);
      });
    });
  }

  private renderStandardShowdownDeck(): void {
    if (!this.engine || !this.req || !this.context) return;

    const isDoubles = (this.req.active?.length || 1) > 1;
    const activeSlotReq = this.req.active?.[this.currentSlotIdx];
    const slotKey: BattleSlotId = this.currentSlotIdx === 0 ? 'p1a' : 'p1b';
    const activeTracked = this.engine.slots.get(slotKey);
    const activeSideMon: RequestSidePokemon | undefined =
      this.req.side.pokemon.find((p) => p.ident === activeTracked?.ident) ||
      this.req.side.pokemon.filter((p) => p.active)[this.currentSlotIdx];

    const actorName = activeTracked?.zhSpecies || activeSideMon?.zhName || '宝可梦';
    const canTeraType = !this.teraUsedInQueue ? activeSlotReq?.canTerastallize : undefined;
    const teraTheme = canTeraType ? TYPE_THEMES[canTeraType] || TYPE_THEMES.Stellar : null;

    // 肉鸽精灵球库存统计
    const run = this.rogueManager.getRun();
    const totalBalls = run
      ? run.balls.pb + run.balls.gb + run.balls.ub + run.balls.mb
      : 0;

    // 计算当前招式对敌方目标的实时克制提示
    const foePrimary = this.engine.slots.get('p2a');
    const foeSecondary = this.engine.slots.get('p2b');

    const moves = activeSlotReq?.moves || [];
    const moveButtonsHtml = moves
      .map((mv) => {
        const effectiveType =
          this.teraArmed && mv.id === 'terablast' && canTeraType ? canTeraType : mv.type;
        const theme = TYPE_THEMES[effectiveType] || TYPE_THEMES.Normal;

        let effBadgeHtml = '';
        if (mv.category !== 'Status') {
          if (!isDoubles && foePrimary && !foePrimary.fainted) {
            const eff = getTypeEffectiveness(effectiveType, foePrimary.types);
            const b = formatEffBadge(eff);
            if (b) effBadgeHtml = `<span class="move-eff-tag ${b.cls}">${b.text}</span>`;
          } else if (isDoubles) {
            const aliveFoes = [foePrimary, foeSecondary].filter((f) => f && !f.fainted);
            if (aliveFoes.length > 0) {
              const bestEff = Math.max(
                ...aliveFoes.map((f) => getTypeEffectiveness(effectiveType, f!.types)),
              );
              const b = formatEffBadge(bestEff);
              if (b) effBadgeHtml = `<span class="move-eff-tag ${b.cls}">${b.text}</span>`;
            }
          }
        }

        const isStab =
          mv.category !== 'Status' &&
          ((this.teraArmed && canTeraType === effectiveType) ||
            activeTracked?.types.includes(effectiveType));

        return `
          <button
            type="button"
            class="sd-move-btn ${mv.disabled ? 'is-disabled' : ''}"
            data-move-idx="${mv.index}"
            style="--mv-bg:${theme.bg};--mv-border:${theme.border}"
            ${mv.disabled ? 'disabled' : ''}
          >
            <div class="sd-move-top">
              <strong class="sd-move-name">${mv.zhName}</strong>
              ${effBadgeHtml}
            </div>
            <div class="sd-move-meta">
              <span class="sd-move-type">${theme.zh}·${categoryBadgeZh(mv.category)}${mv.basePower ? ` ${mv.basePower}` : ''}${isStab ? '★' : ''}</span>
              <span class="sd-move-pp">PP ${mv.pp}/${mv.maxpp}</span>
            </div>
          </button>
        `;
      })
      .join('');

    // 精灵球快捷投掷条（仅肉鸽可收服战斗展开时显示）
    let pokeballDrawerHtml = '';
    if (this.context.canCatch && this.ballTrayOpen && run && foePrimary && !foePrimary.fainted) {
      const ballSpecs: Array<{ tier: BallTier; zh: string; count: number }> = [
        { tier: 'pb', zh: '精灵球', count: run.balls.pb },
        { tier: 'gb', zh: '超级球', count: run.balls.gb },
        { tier: 'ub', zh: '高级球', count: run.balls.ub },
        { tier: 'mb', zh: '大师球', count: run.balls.mb },
      ];
      pokeballDrawerHtml = `
        <div class="sd-ball-drawer">
          ${ballSpecs
            .map((b) => {
              const pct = this.rogueManager.estimateCatchProbability(
                b.tier,
                foePrimary.species,
                foePrimary.hpPercent,
                foePrimary.status,
                foePrimary.bossShieldRemaining,
              );
              const disabled = b.count <= 0 || foePrimary.bossShieldRemaining > 0;
              return `
                <button type="button" class="ball-throw-btn tier-${b.tier} ${disabled ? 'is-disabled' : ''}" data-ball="${b.tier}" ${disabled ? 'disabled' : ''}>
                  <img src="./assets/pr/pokeball/${b.tier}.png" alt="${b.zh}" />
                  <div>
                    <strong>${b.zh} ×${b.count}</strong>
                    <span>${foePrimary.bossShieldRemaining > 0 ? '需先破盾' : `捕获率 ${pct}%`}</span>
                  </div>
                </button>
              `;
            })
            .join('')}
        </div>
      `;
    }

    // 下半区 Showdown 一屏直达 6 槽换人条
    const trapped = Boolean(activeSlotReq?.trapped);
    const switchStripHtml = this.req.side.pokemon
      .map((mon) => {
        const isCurrent = mon.active;
        const alreadyQueued = this.usedSwitchIndices.has(mon.index);
        const disabled = isCurrent || mon.fainted || trapped || alreadyQueued;
        const statusDot = mon.status
          ? `<i class="sw-status-dot" style="background:${STATUS_LABELS_ZH[mon.status]?.color || '#999'}"></i>`
          : '';
        return `
          <button
            type="button"
            class="sd-switch-slot ${isCurrent ? 'is-active-mon' : ''} ${mon.fainted ? 'is-fainted' : ''}"
            data-switch-idx="${mon.index}"
            title="${mon.zhName} Lv.${mon.level} (${mon.hp}/${mon.maxhp})"
            ${disabled ? 'disabled' : ''}
          >
            <div class="sw-icon-wrap">
              <span style="${getPokemonMiniIconStyle(mon.species)}"></span>
              ${statusDot}
            </div>
            <span class="sw-name">${mon.zhName}</span>
            <div class="sw-hp-mini"><i style="width:${mon.hpPercent}%"></i></div>
          </button>
        `;
      })
      .join('');

    this.root.innerHTML = `
      <div class="sd-deck-container">
        <div class="deck-header-bar">
          <div class="deck-prompt">
            ${
              isDoubles && this.currentSlotIdx > 0
                ? `<button type="button" class="deck-back-slot" id="btn-back-slot">←左位</button>`
                : ''
            }
            <span>⚔ <b>${actorName}</b>${isDoubles ? ` (${this.currentSlotIdx + 1}/2)` : ''}</span>
          </div>

          <div class="deck-toggles">
            ${
              this.context.canCatch
                ? `<button type="button" class="deck-pill-btn ball-toggle ${this.ballTrayOpen ? 'active' : ''}" id="btn-toggle-balls">🔴 收服球 (${totalBalls})</button>`
                : ''
            }
            ${
              canTeraType && teraTheme
                ? `<button type="button" class="deck-pill-btn tera-toggle ${this.teraArmed ? 'armed' : ''}" id="btn-toggle-tera" style="--tera-c:${teraTheme.bg}">💎 太晶·${teraTheme.zh}</button>`
                : ''
            }
          </div>
        </div>

        ${pokeballDrawerHtml}

        <div class="sd-moves-grid">
          ${moveButtonsHtml}
        </div>

        <div class="sd-switch-section">
          <div class="sd-switch-label">
            <span>⇄ 换人联防 (Switch)</span>
            ${trapped ? '<em class="trapped-tag">当前被束缚无法替换</em>' : ''}
          </div>
          <div class="sd-switch-strip">
            ${switchStripHtml}
          </div>
        </div>
      </div>
    `;

    // 绑定事件
    this.root.querySelector('#btn-back-slot')?.addEventListener('click', () => {
      this.rollbackPreviousSlot();
    });

    this.root.querySelector('#btn-toggle-tera')?.addEventListener('click', () => {
      this.teraArmed = !this.teraArmed;
      audioEngine.playUiSfx('select');
      this.renderCurrentState();
    });

    this.root.querySelector('#btn-toggle-balls')?.addEventListener('click', () => {
      this.ballTrayOpen = !this.ballTrayOpen;
      audioEngine.playUiSfx('select');
      this.renderCurrentState();
    });

    this.root.querySelectorAll<HTMLButtonElement>('[data-ball]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tier = btn.dataset.ball as BallTier;
        this.callbacks.onThrowPokeball(tier);
      });
    });

    this.root.querySelectorAll<HTMLButtonElement>('[data-move-idx]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.moveIdx);
        const mv = moves.find((m) => m.index === idx);
        if (!mv) return;
        this.handleMoveTapped(mv, isDoubles);
      });
    });

    this.root.querySelectorAll<HTMLButtonElement>('[data-switch-idx]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.switchIdx);
        this.commitSlotChoice(`switch ${idx}`);
      });
    });
  }

  private handleMoveTapped(mv: RequestMoveOption, isDoubles: boolean): void {
    const teraSuffix = this.teraArmed ? ' terastallize' : '';
    if (!isDoubles || !this.engine) {
      this.commitSlotChoice(`move ${mv.index}${teraSuffix}`);
      return;
    }

    const needsTargetSelection = ['normal', 'any', 'adjacentFoe'].includes(mv.target);
    if (needsTargetSelection) {
      const p2aAlive = Boolean(this.engine.slots.get('p2a') && !this.engine.slots.get('p2a')!.fainted);
      const p2bAlive = Boolean(this.engine.slots.get('p2b') && !this.engine.slots.get('p2b')!.fainted);

      // 若双打敌方仅剩 1 只存活且非需要点队友的招式，一键自动锁定存活敌方，减少多余点击
      if (mv.target === 'adjacentFoe' && p2aAlive !== p2bAlive) {
        const autoTarget = p2aAlive ? '+1' : '+2';
        this.commitSlotChoice(`move ${mv.index} ${autoTarget}${teraSuffix}`);
        return;
      }

      this.pendingTargetMove = mv;
      audioEngine.playUiSfx('select');
      this.renderCurrentState();
      return;
    }

    if (mv.target === 'adjacentAlly') {
      const allyTarget = this.currentSlotIdx === 0 ? '-2' : '-1';
      this.commitSlotChoice(`move ${mv.index} ${allyTarget}${teraSuffix}`);
      return;
    }

    if (mv.target === 'adjacentAllyOrSelf') {
      const selfTarget = `-${this.currentSlotIdx + 1}`;
      this.commitSlotChoice(`move ${mv.index} ${selfTarget}${teraSuffix}`);
      return;
    }

    this.commitSlotChoice(`move ${mv.index}${teraSuffix}`);
  }
}
