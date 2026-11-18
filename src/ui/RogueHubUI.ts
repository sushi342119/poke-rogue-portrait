import { Dex, toID } from '@pkmn/sim';
import { TYPE_THEMES } from '../config/constants';
import { audioEngine } from '../audio/AudioEngine';
import {
  EGG_TIER_META,
  EggGachaSystem,
  getCandyActionCosts,
  getSpeciesEggMoves,
} from '../core/EggGachaSystem';
import type { RogueRunManager } from '../core/RogueRunManager';
import {
  SaveStorage,
  type GachaMachineType,
  type HatchedEggResult,
  type RogueGameMode,
  type VoucherTier,
} from '../core/SaveStorage';
import {
  getAbilityZh,
  getMoveZh,
  getRogueDexDatabase,
  getSpeciesZh,
} from '../data/dexRegistry';
import { getPokemonMiniIconStyle } from '../data/spriteResolver';

export interface RogueHubCallbacks {
  onBackToMenu: () => void;
  onStartNewRogueRun: (starterIds: string[], mode: RogueGameMode) => void;
  onToast: (msg: string, tone?: 'info' | 'warn' | 'good') => void;
}

type StarterFilter = 'unlocked' | 'shiny' | 'candy' | 'ribbon' | 'all';

const MACHINE_INFO: Record<
  GachaMachineType,
  { titleZh: string; badgeZh: string; descZh: string; accent: string }
> = {
  move: {
    titleZh: '📘 招式 UP 扭蛋机',
    badgeZh: '王牌第4蛋招式 2.5× UP',
    descZh: '破壳宝可梦极高概率直接领悟超模稀有遗传大招（如喷火、破壳、龙之舞、三旋击）！',
    accent: '#3b82f6',
  },
  legendary: {
    titleZh: '👑 传说 UP 扭蛋机',
    badgeZh: '神兽金蛋 & 史诗蛋 UP',
    descZh: '大幅提升 8~9 费封面传说神兽与 6~7 费准神/幻兽彩蛋爆率，无尽冲层必抽！',
    accent: '#eab308',
  },
  shiny: {
    titleZh: '✦ 闪光 UP 扭蛋机',
    badgeZh: '异色闪光率 4× UP',
    descZh: '极高概率孵出永久闪光初始宠！每只闪光出战直接提升局内商店战利品球升级幸运度！',
    accent: '#ec4899',
  },
};

/**
 * 纯肉鸽局外养成中枢：
 * 1. 经典200层(10费) / 无尽刷塔(15费) 选宠编队工坊（支持最多 6 宠自由搭配凑闪光幸运）
 * 2. 单只初始宠糖果养成抽屉（永久减费 / 6V潜能觉醒 / 蛋招式图鉴 / 闪光切换 / 定向换蛋）
 * 3. 三大 UP 扭蛋机（单抽/五连保底/十连黄金券）与温箱孵蛋破壳系统
 */
export class RogueHubUI {
  private screenRoot: HTMLElement;
  private modalRoot: HTMLElement;
  private rogueManager: RogueRunManager;
  private callbacks: RogueHubCallbacks;

  private activeTab: 'starters' | 'gacha' = 'starters';
  private gameMode: RogueGameMode = 'classic';
  private selectedStarters: string[] = ['charmander', 'bulbasaur'];
  private quickTrio: string[] = [];
  private searchQuery = '';
  private filterMode: StarterFilter = 'unlocked';
  private selectedMachine: GachaMachineType = 'legendary';

  constructor(
    screenRoot: HTMLElement,
    modalRoot: HTMLElement,
    rogueManager: RogueRunManager,
    callbacks: RogueHubCallbacks,
  ) {
    this.screenRoot = screenRoot;
    this.modalRoot = modalRoot;
    this.rogueManager = rogueManager;
    this.callbacks = callbacks;
  }

  hide(): void {
    this.screenRoot.classList.add('hidden');
    this.screenRoot.innerHTML = '';
  }

  openStarterWorkshop(mode: RogueGameMode = 'classic'): void {
    this.activeTab = 'starters';
    this.gameMode = mode;
    if (this.quickTrio.length === 0) {
      this.quickTrio = this.rogueManager.rollQuickStarterTrio();
    }
    this.clampSelectedToBudget();
    this.screenRoot.classList.remove('hidden');
    this.render();
  }

  openEggGacha(): void {
    this.activeTab = 'gacha';
    this.screenRoot.classList.remove('hidden');
    this.render();
  }

  private clampSelectedToBudget(): void {
    const limit = this.rogueManager.getBudgetLimit(this.gameMode);
    const kept: string[] = [];
    let sum = 0;
    for (const id of this.selectedStarters) {
      const c = this.rogueManager.getEffectiveStarterCost(id);
      if (kept.length < 6 && sum + c <= limit) {
        kept.push(id);
        sum += c;
      }
    }
    this.selectedStarters = kept;
  }

  private render(): void {
    const meta = SaveStorage.getMeta();
    const totalVouchers =
      (meta.vouchers.common || 0) + (meta.vouchers.plus || 0) + (meta.vouchers.premium || 0);

    const topTabsHtml = `
      <header class="panel-topbar">
        <button type="button" class="nav-back-btn" id="hub-back">← 主菜单</button>
        <div class="hub-top-tabs">
          <button type="button" class="hub-tab-btn ${this.activeTab === 'starters' ? 'active' : ''}" data-hub-tab="starters">
            🎒 选宠与糖果养成
          </button>
          <button type="button" class="hub-tab-btn ${this.activeTab === 'gacha' ? 'active' : ''}" data-hub-tab="gacha">
            🥚 扭蛋孵蛋 ${totalVouchers > 0 ? `<em class="mini-pill-num">${totalVouchers}</em>` : ''}
          </button>
        </div>
      </header>
    `;

    this.screenRoot.innerHTML = `
      <div class="full-screen-panel">
        ${topTabsHtml}
        ${this.activeTab === 'starters' ? this.buildStartersBodyHtml() : this.buildGachaBodyHtml()}
      </div>
    `;

    this.screenRoot.querySelector('#hub-back')?.addEventListener('click', () => {
      audioEngine.playUiSfx('cancel');
      this.hide();
      this.callbacks.onBackToMenu();
    });

    this.screenRoot.querySelectorAll<HTMLButtonElement>('[data-hub-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.activeTab = btn.dataset.hubTab as 'starters' | 'gacha';
        audioEngine.playUiSfx('select');
        this.render();
      });
    });

    if (this.activeTab === 'starters') {
      this.bindStartersEvents();
    } else {
      this.bindGachaEvents();
    }
  }

  // =========================================================================
  // Tab 1: 选宠构筑与糖果潜能工坊
  // =========================================================================
  private buildStartersBodyHtml(): string {
    const meta = SaveStorage.getMeta();
    const db = getRogueDexDatabase();
    const budgetLimit = this.rogueManager.getBudgetLimit(this.gameMode);
    const usedCost = this.selectedStarters.reduce(
      (sum, id) => sum + this.rogueManager.getEffectiveStarterCost(id),
      0,
    );

    const shinyCount = this.selectedStarters.filter((id) => {
      const upg = SaveStorage.getStarterUpgrade(id);
      return upg.shinyUnlocked && upg.useShiny;
    }).length + (this.gameMode === 'endless' ? 1 : 0);
    const previewLuck =
      shinyCount >= 5 ? 'SSS' : shinyCount === 4 ? 'SS' : shinyCount === 3 ? 'S' : shinyCount === 2 ? 'A' : shinyCount === 1 ? 'B+' : 'C';

    const unlockedSet = new Set<string>(meta.unlockedStarters.map((s) => toID(s)));
    const ribbonSet = new Set<string>((meta.ribbonsSpecies || []).map((s) => toID(s)));

    const filteredIds = Object.keys(db.species).filter((id) => {
      const entry = db.species[id];
      if (!entry.starter && !unlockedSet.has(id)) return false;
      const isUnlocked = unlockedSet.has(id);
      const upg = meta.starterUpgrades[id];
      const candies = meta.starterCandies[id] || 0;

      if (this.filterMode === 'unlocked' && !isUnlocked) return false;
      if (this.filterMode === 'shiny' && !upg?.shinyUnlocked) return false;
      if (this.filterMode === 'candy' && candies <= 0 && !upg?.awakened && !(upg?.costReduction > 0)) return false;
      if (this.filterMode === 'ribbon' && !ribbonSet.has(id)) return false;

      if (this.searchQuery) {
        return entry.zh.includes(this.searchQuery) || id.includes(this.searchQuery.toLowerCase());
      }
      return true;
    });

    // 排序：已选中优先 → 有闪光/糖果优先 → 按图鉴序
    filteredIds.sort((a, b) => {
      const pa = this.selectedStarters.includes(a) ? 1 : 0;
      const pb = this.selectedStarters.includes(b) ? 1 : 0;
      if (pa !== pb) return pb - pa;
      const ua = unlockedSet.has(a) ? 1 : 0;
      const ub = unlockedSet.has(b) ? 1 : 0;
      if (ua !== ub) return ub - ua;
      return (Dex.species.get(a).num || 9999) - (Dex.species.get(b).num || 9999);
    });

    const quickCardsHtml = this.quickTrio
      .map((id) => {
        const sp = Dex.species.get(id);
        const th = TYPE_THEMES[sp.types[0] || 'Normal'] || TYPE_THEMES.Normal;
        return `
          <button type="button" class="quick-trio-card" data-quick-id="${id}" style="border-bottom:3px solid ${th.bg}">
            <span style="${getPokemonMiniIconStyle(sp.name)}"></span>
            <strong>${getSpeciesZh(sp.name)}</strong>
            <small>${th.zh}系 · 一键开爬</small>
          </button>
        `;
      })
      .join('');

    const selectedRosterHtml =
      this.selectedStarters.length > 0
        ? this.selectedStarters
            .map((id) => {
              const upg = SaveStorage.getStarterUpgrade(id);
              const c = this.rogueManager.getEffectiveStarterCost(id);
              return `
                <div class="picked-starter-chip">
                  <span style="${getPokemonMiniIconStyle(id)}"></span>
                  <div>
                    <strong>${upg.shinyUnlocked && upg.useShiny ? '✦' : ''}${getSpeciesZh(id)}</strong>
                    <small>${c}费${upg.awakened ? '·觉醒' : ''}${upg.unlockedEggMoves.length > 0 ? `·蛋招×${upg.unlockedEggMoves.length}` : ''}</small>
                  </div>
                  <button type="button" class="chip-train-btn" data-train-id="${id}" title="糖果养成与蛋招式">🍬</button>
                  <button type="button" class="chip-rem-btn" data-rem-id="${id}" title="移出队伍">×</button>
                </div>
              `;
            })
            .join('')
        : `<div class="empty-roster-hint">点击下方宝可梦加入爬塔小队（最多 6 只，总费用不超过 ${budgetLimit} 费）</div>`;

    const gridHtml = filteredIds
      .slice(0, 72)
      .map((id) => {
        const unlocked = unlockedSet.has(id);
        const cost = this.rogueManager.getEffectiveStarterCost(id);
        const picked = this.selectedStarters.includes(id);
        const candies = meta.starterCandies[id] || 0;
        const upg = SaveStorage.getStarterUpgrade(id);
        const hasRibbon = ribbonSet.has(id);
        const canAdd =
          picked || (unlocked && this.selectedStarters.length < 6 && usedCost + cost <= budgetLimit);

        return `
          <div class="rogue-starter-cell ${picked ? 'is-picked' : ''} ${!unlocked ? 'is-locked' : ''}">
            <button
              type="button"
              class="rsc-main-tap"
              data-st-id="${id}"
              ${!canAdd && !picked ? 'disabled' : ''}
            >
              <span class="cost-badge ${upg.costReduction > 0 ? 'discounted' : ''}">${cost}费</span>
              ${upg.shinyUnlocked ? '<span class="shiny-corner" title="已解锁闪光">✦</span>' : hasRibbon ? '<span class="shiny-corner" title="经典200层殿堂缎带">🏆</span>' : ''}
              <span style="${getPokemonMiniIconStyle(id)}"></span>
              <strong>${getSpeciesZh(id)}</strong>
              <small>${!unlocked ? '未解锁' : upg.awakened ? '🔥已觉醒' : candies > 0 ? `🍬${candies}` : upg.unlockedEggMoves.length > 0 ? `📘蛋招×${upg.unlockedEggMoves.length}` : '可出战'}</small>
            </button>
            ${
              unlocked
                ? `<button type="button" class="rsc-gear-btn" data-train-id="${id}" title="糖果减费/觉醒/蛋招式">🍬养成</button>`
                : ''
            }
          </div>
        `;
      })
      .join('');

    return `
      <div class="format-seg-bar">
        <button type="button" class="seg-btn ${this.gameMode === 'classic' ? 'active' : ''}" data-mode-pick="classic">
          🧭 经典爬塔 (10费 · 200层宿敌道馆)
        </button>
        <button type="button" class="seg-btn ${this.gameMode === 'endless' ? 'active' : ''}" data-mode-pick="endless">
          ♾ 无尽刷塔 (15费 · 双打刷闪冲层)
        </button>
      </div>

      <section class="quick-trio-box">
        <div class="qt-head">
          <span>⚡ 随机平衡三选一（懒人单手即刻出发）：</span>
          <button type="button" class="deck-small-btn" id="rg-reroll-trio">🎲 换一批</button>
        </div>
        <div class="quick-trio-row">${quickCardsHtml}</div>
      </section>

      <section class="selected-roster-strip">
        ${selectedRosterHtml}
      </section>

      <section class="cost-builder-box">
        <div class="cb-head">
          <div>
            <strong>预算 ${usedCost}/${budgetLimit} 费 · 已选 ${this.selectedStarters.length}/6 · 🍀幸运 ${previewLuck}</strong>
          </div>
          <input type="text" id="rg-search" class="ed-input rg-search-in" value="${this.searchQuery}" placeholder="搜中文名…" />
        </div>

        <div class="filter-chips-bar">
          <button type="button" class="filter-chip ${this.filterMode === 'unlocked' ? 'active' : ''}" data-flt="unlocked">已解锁</button>
          <button type="button" class="filter-chip ${this.filterMode === 'shiny' ? 'active' : ''}" data-flt="shiny">✦闪光</button>
          <button type="button" class="filter-chip ${this.filterMode === 'candy' ? 'active' : ''}" data-flt="candy">🍬有糖果</button>
          <button type="button" class="filter-chip ${this.filterMode === 'ribbon' ? 'active' : ''}" data-flt="ribbon">🏆通关缎带</button>
          <button type="button" class="filter-chip ${this.filterMode === 'all' ? 'active' : ''}" data-flt="all">全图鉴初始</button>
        </div>

        <div class="rogue-starter-grid">${gridHtml || '<div class="empty-roster-hint">暂无符合筛选条件的初始宝可梦</div>'}</div>
      </section>

      <footer class="panel-footer">
        <button type="button" class="primary-action-btn" id="rg-start-custom" ${this.selectedStarters.length === 0 || usedCost > budgetLimit ? 'disabled' : ''}>
          开启${this.gameMode === 'endless' ? '无尽刷塔' : '经典200层'} (${this.selectedStarters.map(getSpeciesZh).join(' + ')}) →
        </button>
      </footer>
    `;
  }

  private bindStartersEvents(): void {
    this.screenRoot.querySelectorAll<HTMLButtonElement>('[data-mode-pick]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.gameMode = btn.dataset.modePick as RogueGameMode;
        this.clampSelectedToBudget();
        audioEngine.playUiSfx('select');
        this.render();
      });
    });

    this.screenRoot.querySelector('#rg-reroll-trio')?.addEventListener('click', () => {
      this.quickTrio = this.rogueManager.rollQuickStarterTrio();
      audioEngine.playUiSfx('select');
      this.render();
    });

    this.screenRoot.querySelectorAll<HTMLButtonElement>('[data-quick-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.quickId!;
        audioEngine.playUiSfx('confirm');
        this.hide();
        this.callbacks.onStartNewRogueRun([id], this.gameMode);
      });
    });

    this.screenRoot.querySelectorAll<HTMLButtonElement>('[data-flt]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.filterMode = btn.dataset.flt as StarterFilter;
        audioEngine.playUiSfx('select');
        this.render();
      });
    });

    this.screenRoot.querySelector('#rg-search')?.addEventListener('input', (e) => {
      this.searchQuery = (e.target as HTMLInputElement).value.trim();
      this.render();
      const inputEl = this.screenRoot.querySelector('#rg-search') as HTMLInputElement | null;
      if (inputEl) {
        inputEl.focus();
        inputEl.setSelectionRange(this.searchQuery.length, this.searchQuery.length);
      }
    });

    this.screenRoot.querySelectorAll<HTMLButtonElement>('[data-st-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.stId!;
        const idx = this.selectedStarters.indexOf(id);
        if (idx !== -1) {
          this.selectedStarters.splice(idx, 1);
        } else {
          const limit = this.rogueManager.getBudgetLimit(this.gameMode);
          const used = this.selectedStarters.reduce(
            (s, x) => s + this.rogueManager.getEffectiveStarterCost(x),
            0,
          );
          const cost = this.rogueManager.getEffectiveStarterCost(id);
          if (this.selectedStarters.length < 6 && used + cost <= limit) {
            this.selectedStarters.push(id);
          }
        }
        audioEngine.playUiSfx('select');
        this.render();
      });
    });

    this.screenRoot.querySelectorAll<HTMLButtonElement>('[data-rem-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.remId!;
        this.selectedStarters = this.selectedStarters.filter((x) => x !== id);
        audioEngine.playUiSfx('cancel');
        this.render();
      });
    });

    this.screenRoot.querySelectorAll<HTMLButtonElement>('[data-train-id]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.trainId!;
        audioEngine.playUiSfx('select');
        this.openCandyMasteryModal(id);
      });
    });

    this.screenRoot.querySelector('#rg-start-custom')?.addEventListener('click', () => {
      if (this.selectedStarters.length === 0) return;
      audioEngine.playUiSfx('confirm');
      this.hide();
      this.callbacks.onStartNewRogueRun([...this.selectedStarters], this.gameMode);
    });
  }

  /**
   * 单只初始宠【糖果减费 · 6V觉醒 · 蛋招式与闪光定制】弹窗
   */
  private openCandyMasteryModal(speciesId: string): void {
    const id = toID(speciesId);
    const sp = Dex.species.get(id);
    const existing = this.modalRoot.querySelector('#candy-mastery-modal');
    existing?.remove();

    const modal = document.createElement('div');
    modal.id = 'candy-mastery-modal';
    modal.className = 'sd-modal-backdrop';

    const renderModalBody = () => {
      const meta = SaveStorage.getMeta();
      const candies = meta.starterCandies[id] || 0;
      const upg = SaveStorage.getStarterUpgrade(id);
      const effCost = this.rogueManager.getEffectiveStarterCost(id);
      const costs = getCandyActionCosts(id);
      const allEggMoves = getSpeciesEggMoves(id);

      const eggMovesHtml = allEggMoves
        .map((mvName, idx) => {
          const unlocked = upg.unlockedEggMoves.includes(mvName);
          const dm = Dex.moves.get(mvName);
          const th = TYPE_THEMES[dm.type] || TYPE_THEMES.Normal;
          return `
            <div class="egg-move-pill ${unlocked ? 'unlocked' : 'locked'}" style="border-left:3px solid ${th.bg}">
              <div>
                <strong>${idx === 3 ? '👑 王牌蛋招：' : '📘 '}${getMoveZh(mvName)}</strong>
                <span>${th.zh} · 威力 ${dm.basePower || '变化'}</span>
              </div>
              <em>${unlocked ? '已装备开局' : '待孵蛋领悟'}</em>
            </div>
          `;
        })
        .join('');

      modal.innerHTML = `
        <div class="sd-sheet">
          <div class="sd-sheet-header">
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="${getPokemonMiniIconStyle(sp.name)}"></span>
              <div>
                <h3>${upg.shinyUnlocked && upg.useShiny ? '✦ ' : ''}${getSpeciesZh(sp.name)} · 糖果潜能</h3>
                <small style="color:#9bb0c9;">当前 ${effCost} 费 · 特性 ${getAbilityZh(sp.abilities[0])} · 持有糖果 🍬${candies}</small>
              </div>
            </div>
            <button type="button" class="sd-close-btn" id="cm-close">关闭</button>
          </div>

          ${
            upg.shinyUnlocked
              ? `
            <label class="checkbox-row" style="margin:8px 0;">
              <input type="checkbox" id="cm-toggle-shiny" ${upg.useShiny ? 'checked' : ''} />
              <span>✦ 启用闪光异色形态出战（为全队提供 +1 商店幸运等级！）</span>
            </label>
          `
              : `<p class="field-hint">提示：通过收服、每过5波主力参战或孵蛋均可获得该宝可梦专属糖果 🍬。</p>`
          }

          <div class="tp-sec-label" style="margin-top:8px;">专属遗传蛋招式池（解锁后第 1 波自动自带）：</div>
          <div class="egg-moves-grid">${eggMovesHtml}</div>

          <div class="tp-sec-label" style="margin-top:10px;">糖果永久强化：</div>
          <div class="candy-actions-stack">
            <button type="button" class="candy-upgrade-btn" id="cm-reduce" ${costs.reduceCostNext === null || candies < costs.reduceCostNext ? 'disabled' : ''}>
              <div>
                <strong>⬇ 永久降低出战费用 -1 费</strong>
                <span>已减 ${upg.costReduction}/2 费 · 让高费王牌轻松塞进 10 费小队</span>
              </div>
              <em>${costs.reduceCostNext === null ? '已满级' : `🍬 ${costs.reduceCostNext}`}</em>
            </button>

            <button type="button" class="candy-upgrade-btn" id="cm-awaken" ${costs.awakenCost === null || candies < costs.awakenCost ? 'disabled' : ''}>
              <div>
                <strong>🔥 觉醒潜能被动 & 6V 满个体精炼</strong>
                <span>永久锁定 31 满个体值、最优性格，且每波战后自动再生 10% HP</span>
              </div>
              <em>${costs.awakenCost === null ? '已觉醒' : `🍬 ${costs.awakenCost}`}</em>
            </button>

            <button type="button" class="candy-upgrade-btn" id="cm-buy-egg" ${candies < costs.buySpeciesEggCost ? 'disabled' : ''}>
              <div>
                <strong>🥚 兑换专属定向彩蛋（高闪光 + 悟蛋招）</strong>
                <span>放入孵蛋温箱，仅需推进 4 波破壳，1/12 超高闪光率并解锁新蛋招式</span>
              </div>
              <em>🍬 ${costs.buySpeciesEggCost}</em>
            </button>
          </div>
        </div>
      `;

      modal.querySelector('#cm-close')?.addEventListener('click', () => {
        modal.remove();
        this.render();
      });

      modal.querySelector('#cm-toggle-shiny')?.addEventListener('change', () => {
        EggGachaSystem.toggleStarterShinyPreference(id);
        audioEngine.playUiSfx('select');
        renderModalBody();
      });

      const handleSpend = (act: 'reduce-cost' | 'awaken' | 'buy-egg') => {
        const res = EggGachaSystem.spendStarterCandies(id, act);
        if (res.ok) {
          audioEngine.playUiSfx('heal');
          this.callbacks.onToast(res.message, 'good');
          renderModalBody();
        } else {
          audioEngine.playUiSfx('cancel');
          this.callbacks.onToast(res.message, 'warn');
        }
      };

      modal.querySelector('#cm-reduce')?.addEventListener('click', () => handleSpend('reduce-cost'));
      modal.querySelector('#cm-awaken')?.addEventListener('click', () => handleSpend('awaken'));
      modal.querySelector('#cm-buy-egg')?.addEventListener('click', () => handleSpend('buy-egg'));
    };

    renderModalBody();
    this.modalRoot.appendChild(modal);
  }

  // =========================================================================
  // Tab 2: 三大 UP 扭蛋机 & 孵蛋温箱
  // =========================================================================
  private buildGachaBodyHtml(): string {
    const meta = SaveStorage.getMeta();
    const curMachine = MACHINE_INFO[this.selectedMachine];

    const machineTabsHtml = (Object.keys(MACHINE_INFO) as GachaMachineType[])
      .map((m) => {
        const info = MACHINE_INFO[m];
        const active = this.selectedMachine === m;
        return `
          <button type="button" class="gacha-machine-tab ${active ? 'active' : ''}" data-machine="${m}" style="--mc-color:${info.accent}">
            <strong>${info.titleZh}</strong>
            <small>${info.badgeZh}</small>
          </button>
        `;
      })
      .join('');

    const eggsHtml =
      meta.eggs.length > 0
        ? meta.eggs
            .map((egg) => {
              const tMeta = EGG_TIER_META[egg.tier];
              const pct = Math.max(
                5,
                Math.round(((egg.totalWaves - egg.wavesRemaining) / Math.max(1, egg.totalWaves)) * 100),
              );
              const targetHint = egg.targetSpeciesId
                ? ` · 定向【${getSpeciesZh(egg.targetSpeciesId)}】`
                : '';
              return `
                <div class="egg-slot-card" style="border-left:4px solid ${tMeta.badgeColor}">
                  <div class="esc-row">
                    <span class="esc-emoji">${tMeta.emoji}</span>
                    <div class="esc-info">
                      <strong>${tMeta.zh}${targetHint}</strong>
                      <span>再闯关 ${egg.wavesRemaining} 波破壳（总需 ${egg.totalWaves} 波）</span>
                    </div>
                  </div>
                  <div class="spc-hp"><i style="width:${pct}%;background:${tMeta.badgeColor}"></i></div>
                </div>
              `;
            })
            .join('')
        : `<div class="empty-roster-hint">当前温箱暂无彩蛋，快在上方扭蛋机投入蛋券抽取吧！</div>`;

    return `
      <div class="gacha-screen-scroll">
        <div class="voucher-wallet-bar">
          <div class="vw-item"><span>🎫 单抽普通券</span><strong>×${meta.vouchers.common || 0}</strong></div>
          <div class="vw-item"><span>🎟 五连精良券</span><strong>×${meta.vouchers.plus || 0}</strong></div>
          <div class="vw-item"><span>👑 十连黄金券</span><strong>×${meta.vouchers.premium || 0}</strong></div>
        </div>

        <div class="gacha-machine-selector">${machineTabsHtml}</div>

        <section class="gacha-cabinet-card" style="border-color:${curMachine.accent}">
          <div class="gc-head">
            <h3>${curMachine.titleZh}</h3>
            <span class="gc-rate-pill" style="background:${curMachine.accent}">${curMachine.badgeZh}</span>
          </div>
          <p class="gc-desc">${curMachine.descZh}</p>

          <div class="gacha-pull-btns">
            <button type="button" class="gacha-pull-btn" data-pull="common" ${(meta.vouchers.common || 0) <= 0 ? 'disabled' : ''}>
              <strong>🎫 单抽 1 枚</strong>
              <span>消耗普通券 ×1</span>
            </button>
            <button type="button" class="gacha-pull-btn plus" data-pull="plus" ${(meta.vouchers.plus || 0) <= 0 ? 'disabled' : ''}>
              <strong>🎟 五连抽 (保底稀有)</strong>
              <span>消耗精良券 ×1</span>
            </button>
            <button type="button" class="gacha-pull-btn premium" data-pull="premium" ${(meta.vouchers.premium || 0) <= 0 ? 'disabled' : ''}>
              <strong>👑 十连抽 (保底史诗)</strong>
              <span>消耗黄金券 ×1</span>
            </button>
          </div>
        </section>

        <section class="hatchery-box">
          <div class="cb-head">
            <strong>🔥 孵蛋温箱 (${meta.eggs.length} 枚孵化中 · 累计孵出 ${meta.totalEggsHatched} 枚)</strong>
            <button type="button" class="deck-small-btn" id="btn-rush-eggs" ${meta.eggs.length === 0 || (meta.vouchers.common || 0) <= 0 ? 'disabled' : ''}>
              ⚡ 1张单抽券全员加速 -6波
            </button>
          </div>
          <p class="field-hint" style="margin-bottom:8px;">爬塔每获胜 1 波自动推进所有彩蛋孵化进度；也可消耗多余单抽券立即温箱加速破壳！</p>
          <div class="egg-slots-list">${eggsHtml}</div>
        </section>
      </div>
    `;
  }

  private bindGachaEvents(): void {
    this.screenRoot.querySelectorAll<HTMLButtonElement>('[data-machine]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.selectedMachine = btn.dataset.machine as GachaMachineType;
        audioEngine.playUiSfx('select');
        this.render();
      });
    });

    this.screenRoot.querySelectorAll<HTMLButtonElement>('[data-pull]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tier = btn.dataset.pull as VoucherTier;
        const res = EggGachaSystem.pullVoucher(this.selectedMachine, tier);
        if (res.ok) {
          audioEngine.playUiSfx('confirm');
          this.callbacks.onToast(res.message, 'good');
          this.render();
        } else {
          audioEngine.playUiSfx('cancel');
          this.callbacks.onToast(res.message, 'warn');
        }
      });
    });

    this.screenRoot.querySelector('#btn-rush-eggs')?.addEventListener('click', async () => {
      const res = EggGachaSystem.rushIncubationWithVoucher();
      if (!res.ok) {
        audioEngine.playUiSfx('cancel');
        this.callbacks.onToast(res.message, 'warn');
        return;
      }
      audioEngine.playUiSfx('heal');
      this.callbacks.onToast(res.message, 'good');
      this.render();
      if (res.hatched.length > 0) {
        await this.openEggHatchSummaryModal(res.hatched);
        this.render();
      }
    });
  }

  /**
   * 破壳孵化惊喜展示弹窗（主菜单温箱加速 & 战后波次自然破壳共用！）
   */
  openEggHatchSummaryModal(hatched: HatchedEggResult[]): Promise<void> {
    if (hatched.length === 0) return Promise.resolve();
    audioEngine.playUiSfx('confirm');

    return new Promise((resolve) => {
      const modal = document.createElement('div');
      modal.className = 'sd-modal-backdrop';

      const cardsHtml = hatched
        .map((h) => {
          const tMeta = EGG_TIER_META[h.eggTier];
          return `
            <div class="hatch-result-card" style="border-left:4px solid ${tMeta.badgeColor}">
              <span style="${getPokemonMiniIconStyle(h.speciesId)}"></span>
              <div class="hrc-body">
                <strong>
                  ${h.shiny ? '✦ 闪光异色！' : ''}${getSpeciesZh(h.speciesId)}
                  ${h.isNewUnlock ? '<em class="new-unlock-tag">新解锁初始!</em>' : ''}
                </strong>
                <span>
                  ${tMeta.zh} · 🍬糖果 +${h.candyGained}
                  ${h.newEggMove ? ` · 📘领悟蛋招【${getMoveZh(h.newEggMove)}】` : ''}
                </span>
              </div>
            </div>
          `;
        })
        .join('');

      modal.innerHTML = `
        <div class="sd-sheet">
          <div class="sd-sheet-header">
            <h3>🎉 咔嚓！${hatched.length} 枚宝可梦彩蛋破壳孵化！</h3>
          </div>
          <div class="hatch-results-list">${cardsHtml}</div>
          <button type="button" class="primary-action-btn" id="btn-hatch-ok" style="margin-top:12px;">太棒了！收下同伴与糖果</button>
        </div>
      `;

      modal.querySelector('#btn-hatch-ok')?.addEventListener('click', () => {
        audioEngine.playUiSfx('confirm');
        modal.remove();
        resolve();
      });

      this.modalRoot.appendChild(modal);
    });
  }
}
