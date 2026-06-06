/**
 * Provider Presets — Pre-configured API provider templates.
 *
 * Similar to CC Switch's universalProviderPresets.
 * Users select a preset, fill in API key, and start using immediately.
 */

export interface ProviderPreset {
  id: string;
  name: string;
  provider: 'claude' | 'codex';
  baseUrl: string;
  model: string;
  description: string;
  icon?: string;
  color?: string;
  website?: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  // ── Anthropic Official ──
  {
    id: 'anthropic',
    name: 'Anthropic (Official)',
    provider: 'claude',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-20250514',
    description: 'Anthropic 官方 API',
    color: '#D97706',
    website: 'https://console.anthropic.com',
  },

  // ── DeepSeek ──
  {
    id: 'deepseek',
    name: 'DeepSeek',
    provider: 'claude',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
    description: 'DeepSeek 高性价比模型',
    color: '#4F46E5',
    website: 'https://platform.deepseek.com',
  },

  // ── OpenAI ──
  {
    id: 'openai',
    name: 'OpenAI',
    provider: 'codex',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    description: 'OpenAI GPT 系列模型',
    color: '#10A37F',
    website: 'https://platform.openai.com',
  },

  // ── Google Gemini ──
  {
    id: 'gemini',
    name: 'Google Gemini',
    provider: 'claude',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-2.5-pro',
    description: 'Google Gemini 系列模型',
    color: '#4285F4',
    website: 'https://aistudio.google.com',
  },

  // ── 阿里云百炼 ──
  {
    id: 'aliyun',
    name: '阿里云百炼',
    provider: 'claude',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-max',
    description: '阿里云 DashScope API（通义千问）',
    color: '#FF6A00',
    website: 'https://bailian.console.aliyun.com',
  },

  // ── 硅基流动 ──
  {
    id: 'siliconflow',
    name: '硅基流动',
    provider: 'claude',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'deepseek-ai/DeepSeek-V3',
    description: '硅基流动 API（聚合多模型）',
    color: '#7C3AED',
    website: 'https://cloud.siliconflow.cn',
  },

  // ── OpenRouter ──
  {
    id: 'openrouter',
    name: 'OpenRouter',
    provider: 'claude',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'anthropic/claude-sonnet-4',
    description: 'OpenRouter 聚合路由（100+ 模型）',
    color: '#6366F1',
    website: 'https://openrouter.ai',
  },

  // ── Groq ──
  {
    id: 'groq',
    name: 'Groq',
    provider: 'claude',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    description: 'Groq 超高速推理（LPU 芯片）',
    color: '#F97316',
    website: 'https://console.groq.com',
  },

  // ── Together AI ──
  {
    id: 'together',
    name: 'Together AI',
    provider: 'claude',
    baseUrl: 'https://api.together.xyz/v1',
    model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    description: 'Together AI 开源模型集群',
    color: '#0EA5E9',
    website: 'https://api.together.xyz',
  },

  // ── Novita AI ──
  {
    id: 'novita',
    name: 'Novita AI',
    provider: 'claude',
    baseUrl: 'https://api.novita.ai/v3/openai',
    model: 'deepseek/deepseek-v3-0324',
    description: 'Novita AI API（多模型支持）',
    color: '#8B5CF6',
    website: 'https://novita.ai',
  },

  // ── Chutes AI ──
  {
    id: 'chutes',
    name: 'Chutes AI',
    provider: 'claude',
    baseUrl: 'https://api.chutes.ai/v1',
    model: 'deepseek-ai/DeepSeek-V3-0324',
    description: 'Chutes AI（低成本推理）',
    color: '#EC4899',
    website: 'https://chutes.ai',
  },

  // ── Cloudflare Workers AI ──
  {
    id: 'cloudflare',
    name: 'Cloudflare Workers AI',
    provider: 'claude',
    baseUrl: 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1',
    model: '@cf/meta/llama-3.3-70b-instruct-fp16',
    description: 'Cloudflare Workers AI（边缘推理）',
    color: '#F48120',
    website: 'https://developers.cloudflare.com/workers-ai',
  },

  // ── Hugging Face Inference ──
  {
    id: 'huggingface',
    name: 'Hugging Face',
    provider: 'claude',
    baseUrl: 'https://api-inference.huggingface.co/v1',
    model: 'meta-llama/Llama-3.3-70B-Instruct',
    description: 'Hugging Face Inference API',
    color: '#FFD21E',
    website: 'https://huggingface.co',
  },

  // ── 自定义网关 ──
  {
    id: 'custom',
    name: '自定义网关',
    provider: 'claude',
    baseUrl: '',
    model: '',
    description: '自定义 API 网关配置',
    color: '#6B7280',
  },
];
