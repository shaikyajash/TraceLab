import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';

export type LLMProvider = 'claude' | 'gemini' | 'openai';

interface LLMConfig {
  provider: LLMProvider;
  model: string;
}

const PROVIDER_CONFIGS: Record<LLMProvider, { model: string }> = {
  claude: { model: 'claude-opus-4-6' },
  gemini: { model: 'gemini-flash-latest' },
  openai: { model: 'gpt-5.4-2026-03-05' },
};

// Gemini free tier: 2 req/min → enforce 31s minimum gap between calls
let lastGeminiCallAt = 0;
let geminiQueue = Promise.resolve();

function withGeminiRateLimit<T>(fn: () => Promise<T>): Promise<T> {
  geminiQueue = geminiQueue.then(async () => {
    const elapsed = Date.now() - lastGeminiCallAt;
    const wait = 31_000 - elapsed;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastGeminiCallAt = Date.now();
  });
  return geminiQueue.then(fn) as Promise<T>;
}

// OpenAI TPM serialisation — serialize all calls so we never overlap within the same minute

// Parse "Please try again in 3.55s" from a 429 error message
function parseRetryAfterMs(message: string): number {
  const m = message.match(/try again in (\d+(?:\.\d+)?)s/i);
  return m ? Math.ceil(parseFloat(m[1]) * 1000) + 500 : 62_000;
}

async function withOpenAIRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const is429 = msg.includes('429') || msg.toLowerCase().includes('rate limit');
      if (is429 && attempt < maxRetries) {
        const wait = parseRetryAfterMs(msg);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw err;
    }
  }
  throw new Error('OpenAI retry limit exceeded');
}

// Runtime override — set by API routes per-request
let runtimeProvider: LLMProvider | null = null;

export function setProvider(provider: LLMProvider) {
  runtimeProvider = provider;
}

export function getConfig(): LLMConfig {
  const provider = runtimeProvider || ((process.env.LLM_PROVIDER || 'claude') as LLMProvider);
  if (!PROVIDER_CONFIGS[provider]) {
    throw new Error(`Unknown LLM_PROVIDER: ${provider}. Use "claude", "gemini", or "openai".`);
  }
  return { provider, model: PROVIDER_CONFIGS[provider].model };
}

export function getModelName(): string {
  const { provider, model } = getConfig();
  return `${provider}:${model}`;
}

function extractJSON(text: string): string {
  // Try markdown fences first (greedy to handle multiple)
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();

  // Try to find the first { ... } or [ ... ] JSON block
  const jsonStart = text.indexOf('{');
  const arrStart = text.indexOf('[');
  const start = jsonStart >= 0 && (arrStart < 0 || jsonStart < arrStart) ? jsonStart : arrStart;
  if (start >= 0) {
    const bracket = text[start];
    const closeBracket = bracket === '{' ? '}' : ']';
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === bracket) depth++;
      else if (text[i] === closeBracket) depth--;
      if (depth === 0) return text.substring(start, i + 1).trim();
    }
  }

  return text.trim();
}

export async function chat(opts: {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<string> {
  const { provider, model } = getConfig();
  // gpt-5 family: 128k max output tokens; reasoning models use tokens internally
  const isGpt5 = /^gpt-5/i.test(model);
  const isReasoning = /^o\d/i.test(model);
  const defaultMaxTokens = isGpt5 ? 128_000 : isReasoning ? 65_536 : 16_384;
  const { system, user, maxTokens = defaultMaxTokens, temperature = 0 } = opts;

  if (provider === 'claude') {
    return chatClaude({ model, system, user, maxTokens, temperature });
  } else if (provider === 'openai') {
    // Retry handles 429s; no queue needed — 500k TPM allows parallel requests
    return withOpenAIRetry(() => chatOpenAI({ model, system, user, maxTokens, temperature }));
  } else {
    return withGeminiRateLimit(() => chatGemini({ model, system, user, maxTokens, temperature }));
  }
}

async function chatClaude(opts: {
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  temperature: number;
}): Promise<string> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens,
    temperature: opts.temperature,
    system: opts.system,
    messages: [{ role: 'user', content: opts.user }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Claude');
  }
  return extractJSON(textBlock.text);
}

async function chatGemini(opts: {
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  temperature: number;
}): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is required when using Gemini');
  }

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: opts.model,
    contents: opts.user,
    config: {
      systemInstruction: opts.system,
      maxOutputTokens: opts.maxTokens,
      temperature: opts.temperature,
      responseMimeType: 'application/json',
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error('No text response from Gemini');
  }
  return extractJSON(text);
}

async function chatOpenAI(opts: {
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  temperature: number;
}): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is required when using OpenAI');
  }

  const client = new OpenAI({ apiKey });

  // Some OpenAI models reject temperature (reasoning family + GPT-5 family).
  const disallowTemperature = /^o\d/i.test(opts.model) || /^gpt-5/i.test(opts.model);
  const response = await client.responses.create({
    model: opts.model,
    input: [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.user },
    ],
    ...(disallowTemperature
      ? {}
      : {
          temperature: opts.temperature,
          text: { format: { type: 'json_object' as const } },
        }),
  });

  const text = response.output_text;
  if (!text) {
    throw new Error('No text response from OpenAI');
  }
  return extractJSON(text);
}
