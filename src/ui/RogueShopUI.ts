import { Dex, type PokemonSet } from '@pkmn/sim';
import { STAT_LABELS_ZH, STATUS_LABELS_ZH, TYPE_THEMES, getWaveLevelCap } from '../config/constants';
import { audioEngine } from '../audio/AudioEngine';
import type {
  PendingMoveLearn,
  RewardDraftItem,
  RogueRunManager,
  WaveVictorySummary,
} from '../core/RogueRunManager';
import { getItemZh, getMoveZh, getSpeciesZh } from '../data/dexRegistry';
import { getItemPixelIconUrl, getPokemonMiniIconStyle } from '../data/spriteResolver';

export interface RogueShopCallbacks {
  onToast: (msg: string, tone?: 'info' | 'warn' | 'good') => void;
  onPlayEvolution: (toSpecies: string, shiny: boolean) => Promise<void>;
  onProceedNextWave: () => void;
  onExitToMenu: () => void;
}

const BALL_TIER_LABEL: Record<string, { zh: string; badgeCls: string }> = {
  pb: { zh: '普通 · 红白球级', badgeCls: 'tier-pb' },
  gb: { zh: '精良 · 超级球级', badgeCls: 'tier-gb' },
  ub: { zh: '稀有 · 高级球级', badgeCls: 'tier-ub' },
  mb: { zh: '传说 · 大师球级', badgeCls: 'tier-mb' },
};

/**
 * PokéRogue 原味战后双轨整备与构筑商店：
 * 1. 野生满编替换 / 升级学招替换弹窗
 * 2. 顶部常驻金币补给行（伤药 / 复活 / 万灵药 / PP补剂 / 神奇糖果）
 * 3. 底部 3 张精灵球品质免费战利品三选一 + 金币递增刷新 + 闪光幸运值加成 + 首发轮换
 */
export class RogueShopUI {
  private screenRoot: HTMLElement;
  private modalRoot: HTMLElement;
  private rogueManager: RogueRunManager;
  private callbacks: RogueShopCallbacks;

  private selectedMemberUid = '';
  private draftItems: RewardDraftItem[] = [];
  private summary: WaveVictorySummary | null = null;

  constructor(
    screenRoot: HTMLElement,
    modalRoot: HTMLElement,
    rogueManager: RogueRunManager,
    callbacks: RogueShopCallbacks,
  ) {
    this.screenRoot = screenRoot;
    this.modalRoot = modalRoot;
    this.rogueManager = rogueManager;
    this.callbacks = callbacks;
  }

  /**
   * 若野生收服时队伍已满 6 只，先让玩家选择替换哪只旧成员或放弃入队
   */
  promptPartyFullCaptureIfNeeded(capturedSet: PokemonSet): Promise<void> {
    const run = this.rogueManager.getRun();
    if (!run) return Promise.resolve();

    if (run.party.length < 6) {
      this.rogueManager.addCapturedToParty(capturedSet);
      this.callbacks.onToast(`✨ ${getSpeciesZh(capturedSet.species)} 已加入队伍！`, 'good');
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const modal = document.createElement('div');
      modal.className = 'sd-modal-backdrop';
      modal.innerHTML = `
        <div class="sd-sheet">
          <div class="sd-sheet-header">
            <h3>🔴 队伍已满 6 只 · 选择替换入队</h3>
          </div>
          <p class="sheet-desc">
            新收服了 <b>${getSpeciesZh(capturedSet.species)}</b> (Lv.${capturedSet.level || 5})！图鉴与糖果奖励已永久解锁。点击下方任一现有队员进行替换，或直接保留原阵容：
          </p>
          <div class="party-replace-list">
            ${run.party
              .map(
                (m, idx) => `
              <button type="button" class="replace-member-btn" data-rep-idx="${idx}">
                <span style="${getPokemonMiniIconStyle(m.set.species)}"></span>
                <div>
                  <strong>${getSpeciesZh(m.set.species)} <small>Lv.${m.set.level}</small></strong>
                  <span>HP ${m.hp}/${m.maxhp} · ${m.set.moves.map(getMoveZh).join('/')}</span>
                </div>
                <em>替换</em>
              </button>
            `,
              )
              .join('')}
          </div>
          <button type="button" class="primary-action-btn secondary" id="btn-skip-capture-join">保留现有 6 只阵容</button>
        </div>
      `;

      modal.querySelectorAll<HTMLButtonElement>('[data-rep-idx]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = Number(btn.dataset.repIdx);
          this.rogueManager.addCapturedToParty(capturedSet, idx);
          audioEngine.playUiSfx('confirm');
          modal.remove();
          this.callbacks.onToast(`✨ ${getSpeciesZh(capturedSet.species)} 已替换入队！`, 'good');
          resolve();
        });
      });

      modal.querySelector('#btn-skip-capture-join')?.addEventListener('click', () => {
        audioEngine.playUiSfx('cancel');
        modal.remove();
        resolve();
      });

      this.modalRoot.appendChild(modal);
    });
  }

  /**
   * 依次处理所有待决定的新招式学习替换（升级学招 & 商店招式学习器共用）
   */
  async processMoveLearnQueue(queue: PendingMoveLearn[]): Promise<void> {
    for (const item of queue) {
      await this.promptSingleMoveLearn(item);
    }
  }

  private promptSingleMoveLearn(learn: PendingMoveLearn): Promise<void> {
    const run = this.rogueManager.getRun();
    const member = run?.party.find((m) => m.uid === learn.memberUid);
    if (!member) return Promise.resolve();

    const newMv = Dex.moves.get(learn.newMoveId);
    const newTheme = TYPE_THEMES[newMv.type] || TYPE_THEMES.Normal;

    return new Promise((resolve) => {
      const modal = document.createElement('div');
      modal.className = 'sd-modal-backdrop';
      modal.innerHTML = `
        <div class="sd-sheet">
          <div class="sd-sheet-header">
            <h3>📘 ${learn.speciesZh} 想要学习新招式！</h3>
          </div>
          <div class="new-move-highlight" style="border-color:${newTheme.bg}">
            <div class="nmh-head">
              <strong>新招式：${learn.newMoveZh}</strong>
              <span class="sd-type-badge" style="background:${newTheme.bg}">${newTheme.zh} · ${newMv.category === 'Physical' ? '物理' : newMv.category === 'Special' ? '特殊' : '变化'}</span>
            </div>
            <div class="nmh-sub">威力 ${newMv.basePower || '—'} · 命中 ${newMv.accuracy === true ? '必中' : `${newMv.accuracy}%`} · PP ${newMv.pp}</div>
          </div>

          <p class="sheet-desc">点击下方要遗忘的旧招式完成替换，或放弃学习：</p>
          <div class="move-replace-grid">
            ${member.set.moves
              .map((mId, idx) => {
                const dm = Dex.moves.get(mId);
                const th = TYPE_THEMES[dm.type] || TYPE_THEMES.Normal;
                return `
                  <button type="button" class="move-replace-card" data-slot-idx="${idx}" style="border-left:4px solid ${th.bg}">
                    <strong>遗忘：${getMoveZh(mId)}</strong>
                    <span>${th.zh} · 威力 ${dm.basePower || '—'} · PP ${dm.pp}</span>
                  </button>
                `;
              })
              .join('')}
          </div>
          <button type="button" class="primary-action-btn secondary" id="btn-skip-learn">放弃学习【${learn.newMoveZh}】</button>
        </div>
      `;

      modal.querySelectorAll<HTMLButtonElement>('[data-slot-idx]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const slotIdx = Number(btn.dataset.slotIdx);
          this.rogueManager.replaceMemberMove(learn.memberUid, slotIdx, learn.newMoveId);
          audioEngine.playUiSfx('confirm');
          this.callbacks.onToast(`${learn.speciesZh} 学会了【${learn.newMoveZh}】！`, 'good');
          modal.remove();
          resolve();
        });
      });

      modal.querySelector('#btn-skip-learn')?.addEventListener('click', () => {
        audioEngine.playUiSfx('cancel');
        modal.remove();
        resolve();
      });

      this.modalRoot.appendChild(modal);
    });
  }

  /**
   * 打开战后双轨商店主界面
   */
  async openPostWaveShop(summary: WaveVictorySummary): Promise<void> {
    this.summary = summary;
    const run = this.rogueManager.getRun();
    if (!run) return;

    for (const evo of summary.evolutions) {
      await this.callbacks.onPlayEvolution(evo.toSpecies, evo.shiny);
    }

    if (summary.pendingMoveLearns.length > 0) {
      await this.processMoveLearnQueue(summary.pendingMoveLearns);
    }

    this.selectedMemberUid = run.party[0]?.uid || '';
    const rolled = this.rogueManager.rollFreeRewardDraft(false);
    this.draftItems = rolled.items;

    this.screenRoot.classList.remove('hidden');
    this.renderShop();
  }

  openSavedShopIfInPhase(): void {
    const run = this.rogueManager.getRun();
    if (!run) return;
    this.summary = {
      moneyGained: 0,
      expLogs: ['已恢复上次未完成的波次整备商店'],
      evolutions: [],
      pendingMoveLearns: [],
      biomeCleared: false,
    };
    this.selectedMemberUid = run.party[0]?.uid || '';
    this.draftItems = this.rogueManager.rollFreeRewardDraft(false).items;
    this.screenRoot.classList.remove('hidden');
    this.renderShop();
  }

  hide(): void {
    this.screenRoot.classList.add('hidden');
    this.screenRoot.innerHTML = '';
  }

  private renderShop(): void {
    const run = this.rogueManager.getRun();
    if (!run) return;

    const nextWave = run.wave + 1;
    const cap = getWaveLevelCap(nextWave);
    const luckGrade = this.rogueManager.getPartyLuckGrade();
    const rerollCost = this.rogueManager.getRerollCost();
    const catalog = this.rogueManager.getShopBuyCatalog();

    const activeBuffPills = run.waveBuffs
      .map(
        (b) =>
          `<span class="rogue-buff-pill">${STAT_LABELS_ZH[b.stat]}+${b.stages} (${b.wavesLeft}波)</span>`,
      )
      .join('');

    const partyHtml = run.party
      .map((m, idx) => {
        const selected = m.uid === this.selectedMemberUid;
        const pct = Math.max(0, Math.min(100, Math.round((m.hp / m.maxhp) * 100)));
        const stBadge = m.status
          ? `<em class="mini-status" style="background:${STATUS_LABELS_ZH[m.status]?.color || '#777'}">${STATUS_LABELS_ZH[m.status]?.zh || m.status}</em>`
          : '';
        return `
          <div class="shop-party-card ${selected ? 'is-selected' : ''} ${m.fainted ? 'is-fainted' : ''}" data-member-uid="${m.uid}">
            <div class="spc-row">
              <span style="${getPokemonMiniIconStyle(m.set.species)}"></span>
              <div class="spc-meta">
                <strong>${m.set.shiny ? '✦' : ''}${getSpeciesZh(m.set.species)} <small>Lv.${m.set.level}</small> ${stBadge}</strong>
                <span>${m.fainted ? '濒死待复活' : `HP ${m.hp}/${m.maxhp}`}${m.set.item ? ` · ${getItemZh(m.set.item)}` : ''}</span>
              </div>
              ${
                idx === 0
                  ? '<span class="lead-tag">首发</span>'
                  : !m.fainted
                    ? `<button type="button" class="set-lead-btn" data-lead-idx="${idx}">设首发</button>`
                    : ''
              }
            </div>
            <div class="spc-hp"><i style="width:${pct}%"></i></div>
          </div>
        `;
      })
      .join('');

    const shopRowHtml = catalog
      .map((item) => {
        const canAfford = run.money >= item.cost;
        return `
          <button type="button" class="gold-shop-btn ${!canAfford ? 'is-disabled' : ''}" data-buy-id="${item.id}" title="${item.desc}">
            <img src="${getItemPixelIconUrl(item.iconSlug)}" alt="${item.zhName}" loading="lazy" />
            <strong>${item.zhName}</strong>
            <span class="gold-price">₽${item.cost}</span>
          </button>
        `;
      })
      .join('');

    const draftCardsHtml = this.draftItems
      .map((item) => {
        const tierInfo = BALL_TIER_LABEL[item.tier] || BALL_TIER_LABEL.pb;
        return `
          <button type="button" class="draft-reward-card ${tierInfo.badgeCls}" data-draft-uid="${item.uid}">
            <div class="drc-ball-header">
              <img class="drc-ball-icon" src="./assets/pr/pokeball/${item.tier}.png" alt="${item.tier}" />
              <span>${tierInfo.zh}</span>
              ${item.needsTargetMember ? '<em>作用于选中队员</em>' : '<em>全队生效</em>'}
            </div>
            <div class="drc-main">
              <img class="drc-item-icon" src="${getItemPixelIconUrl(item.iconSlug)}" alt="${item.zhName}" />
              <div class="drc-text">
                <strong>${item.zhName}</strong>
                <p>${item.desc}</p>
              </div>
            </div>
          </button>
        `;
      })
      .join('');

    const expNotes = this.summary?.expLogs.length
      ? `<div class="shop-exp-banner">${this.summary.biomeCleared ? `<b>🎉 第 ${run.wave} 波关底击破！全队 HP/PP 已全满恢复，即将进入【${this.summary.nextBiomeZh}】！</b><br/>` : ''}${this.summary.expLogs.slice(0, 3).join(' · ')}</div>`
      : '';

    this.screenRoot.innerHTML = `
      <div class="rogue-shop-screen">
        <header class="shop-topbar">
          <div>
            <h2>🏕 第 ${run.wave} 波获胜整备</h2>
            <span class="shop-sub">下波等级上限 Lv.${cap} · 球库存 🔴${run.balls.pb} 🔵${run.balls.gb} 🟡${run.balls.ub} 🟣${run.balls.mb}</span>
          </div>
          <div class="shop-wallet">
            <span class="wallet-gold">₽ ${run.money}</span>
            <span class="wallet-luck" title="队伍闪光宝可梦提升战利品品质升级率">🍀 幸运 ${luckGrade}</span>
          </div>
        </header>

        ${expNotes}
        ${activeBuffPills ? `<div class="shop-buffs-strip">持续强化：${activeBuffPills}</div>` : ''}

        <section class="shop-section">
          <div class="shop-sec-title">
            <span>① 点击选择使用道具的目标队员（可切换下波首发）</span>
          </div>
          <div class="shop-party-grid">${partyHtml}</div>
        </section>

        <section class="shop-section">
          <div class="shop-sec-title">
            <span>② 常驻金币补给商店（点击即对选中队员使用，不结束本轮）</span>
          </div>
          <div class="gold-shop-strip">${shopRowHtml}</div>
        </section>

        <section class="shop-section shop-draft-section">
          <div class="shop-sec-title">
            <span>③ 免费战利品三选一（任选 1 项立即进入第 ${nextWave} 波）</span>
            <button type="button" class="reroll-btn" id="btn-shop-reroll" ${run.money < rerollCost ? 'disabled' : ''}>
              🎲 刷新 ₽${rerollCost}
            </button>
          </div>
          <div class="draft-cards-stack">${draftCardsHtml}</div>
        </section>

        <footer class="shop-footer">
          <button type="button" class="primary-action-btn secondary" id="btn-shop-save-exit">保存并返回菜单</button>
          <button type="button" class="primary-action-btn" id="btn-shop-skip">跳过奖励 → 第 ${nextWave} 波</button>
        </footer>
      </div>
    `;

    // 队员选中与设首发
    this.screenRoot.querySelectorAll<HTMLElement>('[data-member-uid]').forEach((card) => {
      card.addEventListener('click', (e) => {
        const leadBtn = (e.target as HTMLElement).closest('[data-lead-idx]') as HTMLElement | null;
        if (leadBtn) {
          e.stopPropagation();
          const idx = Number(leadBtn.dataset.leadIdx);
          this.rogueManager.swapLeadMember(idx);
          audioEngine.playUiSfx('select');
          this.renderShop();
          return;
        }
        this.selectedMemberUid = card.dataset.memberUid!;
        audioEngine.playUiSfx('select');
        this.renderShop();
      });
    });

    // 常驻金币购买
    this.screenRoot.querySelectorAll<HTMLButtonElement>('[data-buy-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const itemId = btn.dataset.buyId!;
        const res = this.rogueManager.buyShopItem(itemId, this.selectedMemberUid);
        if (res.ok) {
          audioEngine.playUiSfx('heal');
          this.callbacks.onToast(res.message, 'good');
          this.renderShop();
        } else {
          audioEngine.playUiSfx('cancel');
          this.callbacks.onToast(res.message, 'warn');
        }
      });
    });

    // 金币刷新三选一
    this.screenRoot.querySelector('#btn-shop-reroll')?.addEventListener('click', () => {
      const res = this.rogueManager.rollFreeRewardDraft(true);
      if (!res.ok) {
        audioEngine.playUiSfx('cancel');
        this.callbacks.onToast(res.reason || '无法刷新', 'warn');
        return;
      }
      audioEngine.playUiSfx('select');
      this.draftItems = res.items;
      this.renderShop();
    });

    // 领取免费三选一并进入下一波
    this.screenRoot.querySelectorAll<HTMLButtonElement>('[data-draft-uid]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const chosen = this.draftItems.find((d) => d.uid === btn.dataset.draftUid);
        if (!chosen) return;
        const res = this.rogueManager.claimRewardAndAdvance(chosen, this.selectedMemberUid);
        if (!res.ok) {
          audioEngine.playUiSfx('cancel');
          this.callbacks.onToast(res.message, 'warn');
          return;
        }
        audioEngine.playUiSfx('confirm');
        this.callbacks.onToast(res.message, 'good');

        if (res.evolved) {
          this.hide();
          await this.callbacks.onPlayEvolution(res.evolved.toSpecies, res.evolved.shiny);
        }
        if (res.pendingTmMove) {
          await this.processMoveLearnQueue([res.pendingTmMove]);
        }
        this.hide();
        this.callbacks.onProceedNextWave();
      });
    });

    this.screenRoot.querySelector('#btn-shop-skip')?.addEventListener('click', () => {
      this.rogueManager.claimRewardAndAdvance(null);
      audioEngine.playUiSfx('confirm');
      this.hide();
      this.callbacks.onProceedNextWave();
    });

    this.screenRoot.querySelector('#btn-shop-save-exit')?.addEventListener('click', () => {
      audioEngine.playUiSfx('cancel');
      this.hide();
      this.callbacks.onExitToMenu();
    });
  }
}
