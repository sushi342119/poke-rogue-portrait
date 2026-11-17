import type { BattleEngine, ParsedSideRequest } from '../core/BattleEngine';
import {
  buildAISnapshot,
  type AIDecisionResult,
  type TrainerPersonality,
} from './BattleSnapshot';
import { HeuristicTacticalAI } from './HeuristicTacticalAI';

export interface LLMProviderConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

export const DEFAULT_LLM_CONFIG: LLMProviderConfig = {
  enabled: false,
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
  timeoutMs: 8500,
};

function extractJsonObject(rawText: string): Record<string, unknown> | null {
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function buildChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (trimmed.endsWith('/chat/completions')) return trimmed;
  return `${trimmed}/chat/completions`;
}

/**
 * 外部大模型战术对抗适配器（支持 OpenAI / Gemini OpenAI 端点 / DeepSeek / Ollama 等）
 * 内置严格战争迷雾输入、合法指令掩码强校验与超时无缝回退 HeuristicTacticalAI
 */
export class LLMTacticalAI {
  private heuristic = new HeuristicTacticalAI();

  async decide(
    engine: BattleEngine,
    p2Req: ParsedSideRequest,
    config: LLMProviderConfig,
    personality: TrainerPersonality = 'rival',
  ): Promise<AIDecisionResult> {
    if (!config.enabled || !config.apiKey.trim() || personality === 'wild') {
      return this.heuristic.decide(engine, p2Req, personality);
    }

    const snap = buildAISnapshot(engine, p2Req);

    // Team Preview 快速选阵如果合法分支简单也允许大模型推理
    const systemPrompt = [
      '你是一名宝可梦对战（Pokémon Showdown 规则）大师级训练家 AI。',
      '请根据当前公开战场态势，为每个行动槽位从给定的 legalChoicesBySlot 列表中精确选择一条合法指令。',
      '严格只输出如下 JSON 对象（不要输出任何额外说明或 Markdown 代码块）：',
      '{"choices":["<槽位0合法指令>"],"thoughtSummary":"45字以内的中文高水平战术博弈推理摘要","speechBubble":"20字以内符合角色性格的中文训练家台词"}',
    ].join('\n');

    const userPayload = {
      turn: snap.turn,
      isDoubles: snap.isDoubles,
      weather: snap.weather || 'none',
      terrain: snap.terrain || 'none',
      trickRoom: snap.trickRoomActive,
      myActive: snap.aiActive.map((a) => ({
        species: a.zhName,
        hpPct: a.hpPercent,
        status: a.status,
        boosts: a.boosts,
        ability: a.ability,
        item: a.item,
        canTera: a.canTerastallize,
        moves: a.moves.filter((m) => !m.disabled).map((m) => `${m.index}:${m.zhName}(${m.type},${m.category},BP${m.basePower})`),
      })),
      myBench: snap.aiBench.map((b) => `${b.index}:${b.zhName}(HP${b.hpPercent}%,${b.ability})`),
      opponentVisible: snap.playerActive.map((o) => ({
        slot: o.slot,
        species: o.zhSpecies,
        hpPct: o.hpPercent,
        types: o.types,
        status: o.status,
        boosts: o.boosts,
        revealedAbility: o.revealedAbility,
        revealedMoves: o.revealedMoves,
        speRange: `${o.speedRange.minSpe}-${o.speedRange.maxSpe}`,
      })),
      legalChoicesBySlot: snap.legalChoicesBySlot,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(2000, config.timeoutMs || 8500));

    try {
      const resp = await fetch(buildChatCompletionsUrl(config.baseUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey.trim()}`,
        },
        body: JSON.stringify({
          model: config.model.trim() || 'gpt-4o-mini',
          temperature: 0.35,
          max_tokens: 260,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: JSON.stringify(userPayload) },
          ],
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);
      if (!resp.ok) {
        throw new Error(`LLM HTTP ${resp.status}`);
      }

      const data = (await resp.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content || '';
      const parsed = extractJsonObject(content);
      if (!parsed) {
        throw new Error('Invalid LLM JSON response');
      }

      const rawChoices = Array.isArray(parsed.choices)
        ? parsed.choices.map(String).join(', ')
        : typeof parsed.choice === 'string'
          ? parsed.choice
          : '';

      const safeChoice = engine.validateOrFallbackChoice(p2Req, rawChoices);
      const thought =
        typeof parsed.thoughtSummary === 'string' && parsed.thoughtSummary.trim()
          ? parsed.thoughtSummary.trim().slice(0, 80)
          : '大模型完成局势推演并锁定最优解。';
      const bubble =
        typeof parsed.speechBubble === 'string' && parsed.speechBubble.trim()
          ? parsed.speechBubble.trim().slice(0, 38)
          : '这一手博弈，你接得住吗？';

      return {
        choiceString: safeChoice,
        thoughtSummary: thought,
        speechBubble: bubble,
        source: 'llm',
      };
    } catch {
      clearTimeout(timer);
      const fb = this.heuristic.decide(engine, p2Req, personality);
      return {
        ...fb,
        thoughtSummary: `[离线启发式接管] ${fb.thoughtSummary}`,
        source: 'llm-fallback',
      };
    }
  }

  static async testConnection(config: LLMProviderConfig): Promise<{ ok: boolean; message: string }> {
    if (!config.apiKey.trim()) {
      return { ok: false, message: '请先填写 API Key' };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    try {
      const resp = await fetch(buildChatCompletionsUrl(config.baseUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey.trim()}`,
        },
        body: JSON.stringify({
          model: config.model.trim() || 'gpt-4o-mini',
          max_tokens: 24,
          messages: [{ role: 'user', content: '请回复：连接成功' }],
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!resp.ok) {
        return { ok: false, message: `HTTP ${resp.status}：请检查端点地址、Key 或模型名称` };
      }
      const json = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const reply = json.choices?.[0]?.message?.content?.trim() || 'OK';
      return { ok: true, message: `连通正常！模型响应：${reply.slice(0, 28)}` };
    } catch (err) {
      clearTimeout(timer);
      return { ok: false, message: `请求失败或跨域受阻：${(err as Error).message}` };
    }
  }
}
