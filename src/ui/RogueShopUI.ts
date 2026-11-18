import { Dex, type PokemonSet } from '@pkmn/sim';
import {
  STAT_LABELS_ZH,
  STATUS_LABELS_ZH,
  TYPE_THEMES,
  getWaveLevelCap,
  type BiomeConfig,
} from '../config/constants';
import { GYM_LEADERS_BY_BIOME } from '../config/presets';
import { audioEngine } from '../audio/AudioEngine';
import {
  getBiomeById,
  type BallTier,
  type PendingMoveLearn,
  type RewardDraftItem,
  type RogueRunManager,
  type WaveVictorySummary,
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
 * PokéRogue 原味战后双轨整备与构筑商店 (v2)：
 * 1. 野生满编替换 / 升级学招替换弹窗
 * 2. 顶部常驻金币补给行（含黄金诱饵双打）+ 圣物状态条
 * 3. 底部 3 张精灵球品质免费战利品三选一 + 【锁定胶囊】锁品质刷新
 * 4. 每 10 波关底通关后的【生态群系路线分支抉择】弹窗
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

  promptPartyFullCaptureIfNeeded(capturedSet: PokemonSet): Promise<void> {
    const run = this.rogueManager.getRun();
    if (!run) return Promise.resolve();

    if (run.party.length < 6) {
      this.rogueManager.addCapturedToParty(capturedSet);
      this.callbacks.onToast(`✨ ${getSpeciesZh(capturedSet.species)} 已加入爬塔小队！`, 'good');
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
            新收服了 <b>${getSpeciesZh(capturedSet.species)}</b> (Lv.${capturedSet.level || 5})！初始解锁与糖果奖励已永久入账。点击下方任一现有队员进行替换，或直接保留原阵容：
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
   * 每 10 波关底通关后弹出【下一章节生态群系路线选择】弹窗
   */
  private promptBiomeRouteIfNeeded(): Promise<void> {
    const run = this.rogueManager.getRun();
    const pendingIds = run?.pendingBiomeChoices;
    const choices: BiomeConfig[] =
      this.summary?.biomeChoices ||
      (pendingIds && pendingIds.length > 0 ? pendingIds.map((id) => getBiomeById(id)) : []);

    if (!run || choices.length <= 1) return Promise.resolve();

    const hasMap = run.relics.townMap > 0;

    return new Promise((resolve) => {
      const modal = document.createElement('div');
      modal.className = 'sd-modal-backdrop';

      const routeCardsHtml = choices
        .map((b) => {
          const gym = GYM_LEADERS_BY_BIOME[b.id];
          const typeTags = b.primaryTypes
            .slice(0, 4)
            .map((t) => {
              const th = TYPE_THEMES[t] || TYPE_THEMES.Normal;
              return `<span class="sd-type-badge" style="background:${th.bg}">${th.zh}</span>`;
            })
            .join('');
          return `
            <button type="button" class="biome-route-card" data-biome-id="${b.id}" style="border-left:4px solid ${b.skyTop}">
              <div class="brc-top">
                <strong>🗺 前往【${b.zhName}】</strong>
                <div class="brc-types">${typeTags}</div>
              </div>
              <div class="brc-sub">
                ${
                  hasMap && gym
                    ? `道馆/首领情报：${gym.titleZh} ${gym.zhName}（建议提前备好克制招式）`
                    : `主要栖息该属性野生宝可梦与群系霸主`
                }
              </div>
            </button>
          `;
        })
        .join('');

      modal.innerHTML = `
        <div class="sd-sheet">
          <div class="sd-sheet-header">
            <h3>🧭 第 ${run.wave - 1} 波关底突破 · 选择下一群系路线</h3>
          </div>
          <p class="sheet-desc">
            ${
              hasMap
                ? '🗺 你的【城镇地图】已展开全部 3 条生态岔路与驻守道馆主情报：'
                : '前方出现 2 条生态岔路（拾取【城镇地图】圣物可额外解锁第 3 路线与道馆情报）：'
            }
          </p>
          <div class="biome-routes-stack">${routeCardsHtml}</div>
        </div>
      `;

      modal.querySelectorAll<HTMLButtonElement>('[data-biome-id]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const picked = this.rogueManager.selectNextBiome(btn.dataset.biomeId!);
          audioEngine.playUiSfx('confirm');
          this.callbacks.onToast(`🧭 已踏入【${picked.zhName}】！`, 'info');
          modal.remove();
          resolve();
        });
      });

      this.modalRoot.appendChild(modal);
    });
  }

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
      hatchedEggs: [],
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

    const statusPills: string[] = [];
    for (const b of run.waveBuffs) {
      statusPills.push(`<span class="rogue-buff-pill">${STAT_LABELS_ZH[b.stat]}+${b.stages} (${b.wavesLeft}波)</span>`);
    }
    if (run.lureWavesLeft > 0) {
      statusPills.push(`<span class="rogue-buff-pill lure">🍯 双打诱饵 (${run.lureWavesLeft}波)</span>`);
    }
    if (run.relics.townMap > 0) {
      statusPills.push(`<span class="rogue-buff-pill">🗺 城镇地图</span>`);
    }
    if (run.relics.teraOrb > 0) {
      statusPills.push(`<span class="rogue-buff-pill">💎 太晶宝珠</span>`);
    }
    if (run.relics.lockCapsule > 0) {
      statusPills.push(`<span class="rogue-buff-pill">🔒 锁定胶囊</span>`);
    }

    const partyHtml = run.party
      .map((m, idx) => {
        const selected = m.uid === this.selectedMemberUid;
        const pct = Math.max(0, Math.min(100, Math.round((m.hp / m.maxhp) * 100)));
        const stBadge = m.status
          ? `<em class="mini-status" style="background:${STATUS_LABELS_ZH[m.status]?.color || '#777'}">${STATUS_LABELS_ZH[m.status]?.zh || m.status}</em>`
          : '';
        const teraZh = TYPE_THEMES[m.set.teraType || 'Normal']?.zh || '一般';
        return `
          <div class="shop-party-card ${selected ? 'is-selected' : ''} ${m.fainted ? 'is-fainted' : ''}" data-member-uid="${m.uid}">
            <div class="spc-row">
              <span style="${getPokemonMiniIconStyle(m.set.species)}"></span>
              <div class="spc-meta">
                <strong>${m.set.shiny ? '✦' : ''}${getSpeciesZh(m.set.species)} <small>Lv.${m.set.level}</small> ${stBadge}</strong>
                <span>${m.fainted ? '濒死待复活' : `HP ${m.hp}/${m.maxhp}`}${run.relics.teraOrb > 0 ? ` · 💎${teraZh}` : ''}${m.set.item ? ` · ${getItemZh(m.set.item)}` : ''}</span>
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
              <span>${tierInfo.zh}${run.rarityLocked ? ' 🔒已锁档' : ''}</span>
              ${item.needsTargetMember ? '<em>作用于选中队员</em>' : '<em>全队/全局生效</em>'}
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

    const voucherLine = this.summary?.voucherDropped
      ? `<b style="color:#fbbf24;">🎁 里程碑掉落：${this.summary.voucherDropped.labelZh}（已存入扭蛋机！）</b><br/>`
      : '';
    const clearLine = this.summary?.biomeCleared
      ? `<b>🎉 第 ${run.wave} 波关底击破！全队 HP/PP 已满额恢复，选完战利品后将选择下一生态群系！</b><br/>`
      : '';
    const expNotes =
      voucherLine || clearLine || this.summary?.expLogs.length
        ? `<div class="shop-exp-banner">${voucherLine}${clearLine}${(this.summary?.expLogs || []).slice(0, 3).join(' · ')}</div>`
        : '';

    this.screenRoot.innerHTML = `
      <div class="rogue-shop-screen">
        <header class="shop-topbar">
          <div>
            <h2>🏕 第 ${run.wave} 波整备 (${run.mode === 'endless' ? '无尽' : '经典200层'})</h2>
            <span class="shop-sub">下波上限 Lv.${cap} · 球库存 🔴${run.balls.pb} 🔵${run.balls.gb} 🟡${run.balls.ub} 🟣${run.balls.mb}</span>
          </div>
          <div class="shop-wallet">
            <span class="wallet-gold">₽ ${run.money}</span>
            <span class="wallet-luck" title="闪光队友与闪光护符提升战利品品质升级率">🍀 幸运 ${luckGrade}</span>
          </div>
        </header>

        ${expNotes}
        ${statusPills.length > 0 ? `<div class="shop-buffs-strip">${statusPills.join('')}</div>` : ''}

        <section class="shop-section">
          <div class="shop-sec-title">
            <span>① 点击选择使用道具的目标队员（可切换首发）</span>
          </div>
          <div class="shop-party-grid">${partyHtml}</div>
        </section>

        <section class="shop-section">
          <div class="shop-sec-title">
            <span>② 常驻金币补给（点击即生效，不结束本轮）</span>
          </div>
          <div class="gold-shop-strip">${shopRowHtml}</div>
        </section>

        <section class="shop-section shop-draft-section">
          <div class="shop-sec-title">
            <span>③ 战利品三选一（任选 1 项进入第 ${nextWave} 波）</span>
            <div style="display:flex;gap:6px;align-items:center;">
              ${
                run.relics.lockCapsule > 0
                  ? `<button type="button" class="lock-rarity-btn ${run.rarityLocked ? 'active' : ''}" id="btn-shop-lock">
                      ${run.rarityLocked ? '🔒 已锁品质' : '🔓 锁品质'}
                    </button>`
                  : ''
              }
              <button type="button" class="reroll-btn" id="btn-shop-reroll" ${run.money < rerollCost ? 'disabled' : ''}>
                🎲 刷新 ₽${rerollCost}
              </button>
            </div>
          </div>
          <div class="draft-cards-stack">${draftCardsHtml}</div>
        </section>

        <footer class="shop-footer">
          <button type="button" class="primary-action-btn secondary" id="btn-shop-save-exit">保存并回主菜单</button>
          <button type="button" class="primary-action-btn" id="btn-shop-skip">跳过奖励 → 第 ${nextWave} 波</button>
        </footer>
      </div>
    `;

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

    this.screenRoot.querySelector('#btn-shop-lock')?.addEventListener('click', () => {
      const res = this.rogueManager.toggleRarityLock();
      audioEngine.playUiSfx(res.ok ? 'select' : 'cancel');
      this.callbacks.onToast(res.message, res.ok ? 'info' : 'warn');
      this.renderShop();
    });

    this.screenRoot.querySelector('#btn-shop-reroll')?.addEventListener('click', () => {
      const prevTiers: BallTier[] = this.draftItems.map((x) => x.tier);
      const res = this.rogueManager.rollFreeRewardDraft(true, prevTiers);
      if (!res.ok) {
        audioEngine.playUiSfx('cancel');
        this.callbacks.onToast(res.reason || '无法刷新', 'warn');
        return;
      }
      audioEngine.playUiSfx('select');
      this.draftItems = res.items;
      this.renderShop();
    });

    this.screenRoot.querySelectorAll<HTMLButtonElement>('[data-draft-uid]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const chosen = this.draftItems.find((d) => d.uid === btn.dataset.draftUid);
        if (!chosen) return;
        const needRouteModal = Boolean(run.pendingBiomeChoices && run.pendingBiomeChoices.length > 1);
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
        if (needRouteModal) {
          await this.promptBiomeRouteIfNeeded();
        }
        this.hide();
        this.callbacks.onProceedNextWave();
      });
    });

    this.screenRoot.querySelector('#btn-shop-skip')?.addEventListener('click', async () => {
      const needRouteModal = Boolean(run.pendingBiomeChoices && run.pendingBiomeChoices.length > 1);
      this.rogueManager.claimRewardAndAdvance(null);
      audioEngine.playUiSfx('confirm');
      if (needRouteModal) {
        await this.promptBiomeRouteIfNeeded();
      }
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
