import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';

export type LLMProvider = 'claude' | 'gemini' | 'openai';

interface LLMConfig {
  provider: LLMProvider;
  model: string;
}

const PROVIDER_CONFIGS: Record<LLMProvider, { model: string }> = {
  claude: { model: 'claude-sonnet-4-6-20250514' },
  gemini: { model: 'gemini-2.5-flash' },
  openai: { model: 'gpt-4o-mini' },
};

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
  const { system, user, maxTokens = 16384, temperature = 0 } = opts;

  if (provider === 'claude') {
    return chatClaude({ model, system, user, maxTokens, temperature });
  } else if (provider === 'openai') {
    return chatOpenAI({ model, system, user, maxTokens, temperature });
  } else {
    return chatGemini({ model, system, user, maxTokens, temperature });
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
  const response = await client.chat.completions.create({
    model: opts.model,
    max_tokens: opts.maxTokens,
    temperature: opts.temperature,
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.user },
    ],
  });

  const text = response.choices[0]?.message?.content;
  if (!text) {
    throw new Error('No text response from OpenAI');
  }
  return extractJSON(text);
}
