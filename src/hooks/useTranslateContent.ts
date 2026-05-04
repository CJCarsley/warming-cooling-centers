import { useState, useEffect } from 'react';

export interface TranslateContentOptions {
  /** BCP-47 language code of the source text. Defaults to 'en'. */
  sourceLang?: string;
  /** When true, skip translation and return the original text as-is. */
  skipTranslation?: boolean;
}

export interface TranslateContentResult {
  translatedText: string;
  isLoading: boolean;
  error: string | null;
}

// Module-level cache shared across all hook instances.
// Key format: "sourceLang|targetLang|originalText"
const translationCache = new Map<string, string>();

function buildCacheKey(text: string, source: string, target: string): string {
  return `${source}|${target}|${text}`;
}

/**
 * Translates a single string value to the target language.
 *
 * Phase 1-4: pass-through — returns the original text immediately and
 * populates the cache so the future Lambda integration can hot-swap in.
 *
 * Phase 5 upgrade path: replace the TODO block below with an AWS Translate
 * Lambda call. The rest of the hook (caching, loading state, error handling,
 * skip logic) requires no changes.
 */
export function useTranslateContent(
  text: string | null | undefined,
  targetLang: string,
  options: TranslateContentOptions = {},
): TranslateContentResult {
  const { sourceLang = 'en', skipTranslation = false } = options;

  const [result, setResult] = useState<TranslateContentResult>({
    translatedText: text ?? '',
    isLoading: false,
    error: null,
  });

  useEffect(() => {
    const raw = text ?? '';
    const normalizedTarget = targetLang.split('-')[0];

    if (!raw || skipTranslation || normalizedTarget === sourceLang) {
      setResult({ translatedText: raw, isLoading: false, error: null });
      return;
    }

    const cacheKey = buildCacheKey(raw, sourceLang, normalizedTarget);
    const cached = translationCache.get(cacheKey);
    if (cached !== undefined) {
      setResult({ translatedText: cached, isLoading: false, error: null });
      return;
    }

    // ── TODO Phase 5 ──────────────────────────────────────────────────────────
    // Replace the pass-through below with an AWS Translate Lambda call:
    //
    // setResult({ translatedText: raw, isLoading: true, error: null });
    // fetch('/api/translate', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({ text: raw, sourceLang, targetLang: normalizedTarget }),
    // })
    //   .then((r) => r.json() as Promise<{ translatedText: string }>)
    //   .then(({ translatedText }) => {
    //     translationCache.set(cacheKey, translatedText);
    //     setResult({ translatedText, isLoading: false, error: null });
    //   })
    //   .catch((err: unknown) => {
    //     setResult({ translatedText: raw, isLoading: false, error: String(err) });
    //   });
    // ─────────────────────────────────────────────────────────────────────────

    translationCache.set(cacheKey, raw);
    setResult({ translatedText: raw, isLoading: false, error: null });
  }, [text, targetLang, sourceLang, skipTranslation]);

  return result;
}
