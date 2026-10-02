'use strict';

// 大模型预设。用户选好预设后 baseUrl / model 仍可自由修改。
// kind: 'openai' = OpenAI 兼容 /chat/completions；'anthropic' = Anthropic /v1/messages
// models[].free: 'free' = 长期免费；'quota' = 新用户赠送额度，用完收费
// models[].extra: 合并进请求体的额外参数，主要用来关掉思考——翻译不需要推理，开着只会慢
// 资料核对于 2026-10，免费政策变动快，以各家官网为准。
const NO_THINK_GLM = { thinking: { type: 'disabled' } };
const NO_THINK_OPENROUTER = { reasoning: { enabled: false } };

const PROVIDERS = [
  {
    id: 'zhipu', name: '智谱 GLM · 免费', kind: 'openai', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.7-flash',
    keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys', note: '国内直连，长期免费',
    models: [
      { id: 'glm-4.7-flash', free: 'free', note: '推荐', extra: NO_THINK_GLM },
      { id: 'glm-4-flash-250414', free: 'free' },
    ],
  },
  {
    id: 'siliconflow', name: '硅基流动 · 免费', kind: 'openai', baseUrl: 'https://api.siliconflow.cn/v1', model: 'THUDM/GLM-4-9B-0414',
    keyUrl: 'https://cloud.siliconflow.cn/account/ak', note: '国内直连，免费模型需实名认证',
    models: [
      { id: 'THUDM/GLM-4-9B-0414', free: 'free', note: '推荐' },
      { id: 'Qwen/Qwen3-8B', free: 'free', extra: { enable_thinking: false } },
      { id: 'Qwen/Qwen2.5-7B-Instruct', free: 'free' },
    ],
  },
  {
    id: 'gemini', name: 'Google Gemini · 免费', kind: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash-lite',
    keyUrl: 'https://aistudio.google.com/apikey', note: '国内需代理；免费层的内容可能被用于改进模型',
    models: [
      { id: 'gemini-2.5-flash-lite', free: 'free', note: '推荐' },
      { id: 'gemini-3.5-flash-lite', free: 'free' },
    ],
  },
  {
    id: 'groq', name: 'Groq · 免费', kind: 'openai', baseUrl: 'https://api.groq.com/openai/v1', model: 'qwen/qwen3.8-27b',
    keyUrl: 'https://console.groq.com/keys', note: '国内需代理，速度极快，免费层有每日限额',
    models: [
      { id: 'qwen/qwen3.8-27b', free: 'free', note: '推荐', extra: { reasoning_effort: 'none' } },
      { id: 'openai/gpt-oss-20b', free: 'free', extra: { reasoning_effort: 'low' } },
    ],
  },
  {
    id: 'cerebras', name: 'Cerebras · 免费', kind: 'openai', baseUrl: 'https://api.cerebras.ai/v1', model: 'qwen-3.8-27b',
    keyUrl: 'https://cloud.cerebras.ai/', note: '国内需代理，速度极快，免费层每分钟 5 次',
    models: [
      { id: 'qwen-3.8-27b', free: 'free', note: '推荐', extra: { reasoning_effort: 'none' } },
      { id: 'gpt-oss-120b', free: 'free', extra: { reasoning_effort: 'low' } },
    ],
  },
  {
    id: 'openrouter', name: 'OpenRouter · 有免费模型', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'google/gemma-4-31b-it:free',
    keyUrl: 'https://openrouter.ai/keys', note: '免费模型每天有次数限制，高峰期可能排队',
    models: [
      // 顺序即备用顺序（取前面的当备用）：前两个来自不同上游，一家限流时换另一家；
      // nemotron 快但会译错词，放最后，不给别的模型当备用
      { id: 'google/gemma-4-31b-it:free', free: 'free', note: '推荐', extra: NO_THINK_OPENROUTER },
      { id: 'qwen/qwen3.8-27b:free', free: 'free', note: '推荐', extra: NO_THINK_OPENROUTER },
      { id: 'google/gemma-4-26b-a4b-it:free', free: 'free', extra: NO_THINK_OPENROUTER },
      { id: 'nvidia/nemotron-3.5-lightning:free', free: 'free', note: '最快', extra: NO_THINK_OPENROUTER },
      { id: 'deepseek/deepseek-chat' },
    ],
  },
  {
    id: 'qwen', name: '通义千问（阿里云百炼）', kind: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-turbo',
    keyUrl: 'https://bailian.console.aliyun.com/', note: '新用户每个模型送 100 万 token（90 天）',
    models: [
      { id: 'qwen-turbo', free: 'quota', note: '推荐' },
      { id: 'qwen-flash' },
      { id: 'qwen-plus', free: 'quota' },
    ],
  },
  {
    id: 'deepseek', name: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash',
    keyUrl: 'https://platform.deepseek.com/api_keys', note: '按量付费，很便宜',
    models: [
      { id: 'deepseek-flash', note: '已关闭思考', extra: NO_THINK_GLM },
    ],
  },
  {
    id: 'moonshot', name: 'Kimi（月之暗面）', kind: 'openai', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k', keyUrl: 'https://platform.moonshot.cn/console/api-keys',
    models: [{ id: 'moonshot-v1-8k' }],
  },
  {
    id: 'anthropic', name: 'Claude（Anthropic）', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-haiku-4-5', keyUrl: 'https://console.anthropic.com/settings/keys',
    models: [{ id: 'claude-haiku-4-5' }, { id: 'claude-sonnet-5-5' }],
  },
  {
    id: 'openai', name: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', keyUrl: 'https://platform.openai.com/api-keys',
    models: [{ id: 'gpt-4.1-mini' }, { id: 'gpt-4.1' }],
  },
  { id: 'ollama', name: 'Ollama（本地）', kind: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:7b', models: [], keyOptional: true },
  { id: 'custom', name: '自定义（OpenAI 兼容）', kind: 'openai', baseUrl: '', model: '', models: [] },
];

function isFreeModel(model) {
  return /:free$/.test(String(model));
}

function getProvider(id) {
  return PROVIDERS.find((p) => p.id === id) || PROVIDERS.find((p) => p.id === 'custom');
}

// 当前服务商预设里这个模型要附带的请求参数；自定义模型名没有
function modelExtra(providerId, model) {
  const provider = getProvider(providerId);
  const entry = (provider.models || []).find((m) => m.id === model);
  if (provider.id === 'openrouter' && isFreeModel(model)) {
    // 免费模型经常被上游限流：带上另外两个免费模型，OpenRouter 会自动换着试（最多 3 个）
    const backups = provider.models.filter((m) => m.free === 'free' && m.id !== model).map((m) => m.id);
    return { ...((entry && entry.extra) || NO_THINK_OPENROUTER), models: [model, ...backups].slice(0, 3) };
  }
  return (entry && entry.extra) || {};
}

module.exports = { PROVIDERS, getProvider, modelExtra, isFreeModel, NO_THINK_OPENROUTER };
