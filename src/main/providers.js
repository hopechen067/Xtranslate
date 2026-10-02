'use strict';

// 大模型预设。用户选好预设后 baseUrl / model 仍可自由修改。
// kind: 'openai' = OpenAI 兼容 /chat/completions；'anthropic' = Anthropic /v1/messages
const PROVIDERS = [
  { id: 'deepseek', name: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', models: ['deepseek-chat'], keyUrl: 'https://platform.deepseek.com/api_keys' },
  { id: 'qwen', name: '通义千问（阿里云百炼）', kind: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', models: ['qwen-plus', 'qwen-turbo', 'qwen-max'], keyUrl: 'https://bailian.console.aliyun.com/' },
  { id: 'moonshot', name: 'Kimi（月之暗面）', kind: 'openai', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k', models: ['moonshot-v1-8k'], keyUrl: 'https://platform.moonshot.cn/console/api-keys' },
  { id: 'zhipu', name: '智谱 GLM', kind: 'openai', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', models: ['glm-4-flash', 'glm-4-plus'], keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys' },
  { id: 'anthropic', name: 'Claude（Anthropic）', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-haiku-4-5', models: ['claude-haiku-4-5', 'claude-sonnet-5-5'], keyUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'openai', name: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', models: ['gpt-4.1-mini', 'gpt-4.1'], keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'openrouter', name: 'OpenRouter', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'deepseek/deepseek-chat', models: [], keyUrl: 'https://openrouter.ai/keys' },
  { id: 'ollama', name: 'Ollama（本地）', kind: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:7b', models: [], keyOptional: true },
  { id: 'custom', name: '自定义（OpenAI 兼容）', kind: 'openai', baseUrl: '', model: '', models: [] },
];

function getProvider(id) {
  return PROVIDERS.find((p) => p.id === id) || PROVIDERS.find((p) => p.id === 'custom');
}

module.exports = { PROVIDERS, getProvider };
