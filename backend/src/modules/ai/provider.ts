/**
 * The AI provider interface (stage 7.1). Zentro talks to a model only through this, so the provider can change without touching
 * the rest. The first provider is Anthropic's Messages API. The key is read from the server's own settings at the moment of a call
 * and is never stored, logged, returned or put into an error.
 */
export interface AiCompletionRequest {
  system: string;
  user: string;
  maxTokens: number;
  timeoutMs: number;
}
export interface AiCompletion { text: string; model: string; tokensIn: number | null; tokensOut: number | null }

/** Why a call failed, in words that are safe to show. `code` is stable; the message never contains a response body or a key. */
export class AiProviderError extends Error {
  constructor(readonly code: "ai_timeout" | "ai_busy" | "ai_unavailable", message: string) {
    super(message);
  }
}

export interface AiProvider {
  readonly name: string;
  /** True when the provider could be called at all (for Anthropic: the key setting is present). Never reveals the key. */
  isConfigured(): boolean;
  complete(req: AiCompletionRequest): Promise<AiCompletion>;
}

export const ANTHROPIC_MODEL = "claude-sonnet-5-5";
const ENDPOINT = "https://api.anthropic.com/v1/messages";

export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic";
  constructor(private readonly env: NodeJS.ProcessEnv = process.env, private readonly fetchImpl: typeof fetch = fetch) {}

  isConfigured(): boolean {
    return (this.env.ANTHROPIC_API_KEY ?? "").trim() !== "";
  }

  async complete(req: AiCompletionRequest): Promise<AiCompletion> {
    const key = (this.env.ANTHROPIC_API_KEY ?? "").trim();
    if (!key) throw new AiProviderError("ai_unavailable", "AI is not connected.");
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), req.timeoutMs);
    try {
      const res = await this.fetchImpl(ENDPOINT, {
        method: "POST",
        signal: ctl.signal,
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: req.maxTokens, system: req.system, messages: [{ role: "user", content: req.user }] }),
      });
      if (res.status === 429 || res.status === 529) throw new AiProviderError("ai_busy", "The AI service is busy right now. Try again in a minute.");
      if (!res.ok) throw new AiProviderError("ai_unavailable", "The AI service could not answer. Try again later.");
      const body = (await res.json()) as { content?: { type: string; text?: string }[]; model?: string; usage?: { input_tokens?: number; output_tokens?: number } };
      const text = (body.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n").trim();
      if (!text) throw new AiProviderError("ai_unavailable", "The AI service gave an empty answer. Try again.");
      return { text, model: body.model ?? ANTHROPIC_MODEL, tokensIn: body.usage?.input_tokens ?? null, tokensOut: body.usage?.output_tokens ?? null };
    } catch (e) {
      if (e instanceof AiProviderError) throw e;
      if ((e as { name?: string })?.name === "AbortError") throw new AiProviderError("ai_timeout", "The AI service took too long. Try a shorter question or try again.");
      throw new AiProviderError("ai_unavailable", "The AI service could not be reached. Try again later.");
    } finally {
      clearTimeout(timer);
    }
  }
}
