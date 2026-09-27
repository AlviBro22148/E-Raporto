import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from 'react';
import { en } from './en';
import { sq } from './sq';

export type Locale = 'sq' | 'en';

const STORAGE_KEY = 'e-raporto.locale';
const DEFAULT_LOCALE: Locale = 'sq';
const dictionaries = { sq, en };

function resolve(dict: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => {
    if (node == null || typeof node !== 'object') return undefined;
    return (node as Record<string, unknown>)[key];
  }, dict);
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (
    key in vars ? String(vars[key]) : match
  ));
}

export type TranslateFn = (key: string, vars?: Record<string, string | number>) => string;

function translate(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  const value = resolve(dictionaries[locale], key) ?? resolve(dictionaries[DEFAULT_LOCALE], key);
  if (typeof value !== 'string') return key;   // missing key — visible in dev, never a crash
  return interpolate(value, vars);
}

/**
 * A module-level mirror of the current locale, for the handful of call sites that need a translated
 * string outside a component tree (the Android notification-channel name, created once on first launch
 * before any screen has rendered). Kept in sync by the provider below; defaults to `sq` until the
 * stored preference loads, which matches the app's own default.
 */
let currentLocale: Locale = DEFAULT_LOCALE;

/** Usable outside React — see the module doc above. Prefer `useT()` inside components. */
export function t(key: string, vars?: Record<string, string | number>): string {
  return translate(currentLocale, key, vars);
}

interface I18nState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: TranslateFn;
}

const I18nContext = createContext<I18nState | null>(null);

/**
 * Wraps the whole app (see app/_layout.tsx) so every screen — citizen and staff alike — shares one
 * locale. The toggle itself lives only on the citizen profile screen, but the preference is a device
 * setting, not a per-account one: whatever this device is set to is what every screen renders in.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored === 'sq' || stored === 'en') {
          currentLocale = stored;
          setLocaleState(stored);
        }
      } catch { /* keep the default */ }
    })();
  }, []);

  const setLocale = useCallback((next: Locale) => {
    currentLocale = next;
    setLocaleState(next);
    void AsyncStorage.setItem(STORAGE_KEY, next);
  }, []);

  const t = useCallback<TranslateFn>((key, vars) => translate(locale, key, vars), [locale]);

  const value = useMemo<I18nState>(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

function useI18n(): I18nState {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used inside <I18nProvider>.');
  return context;
}

/** The translate function, reactive to locale changes. */
export function useT(): TranslateFn {
  return useI18n().t;
}

export function useLocale(): Locale {
  return useI18n().locale;
}

export function useSetLocale(): (locale: Locale) => void {
  return useI18n().setLocale;
}

/** Picks the locale-appropriate name off a bilingual category record; falls back to Albanian when an
 *  English name isn't on the wire yet (some lightweight category refs predate the `nameEn` field). */
export function categoryName(
  category: { nameSq: string; nameEn?: string | null } | null | undefined,
  locale: Locale,
): string {
  if (!category) return '';
  return (locale === 'en' && category.nameEn) ? category.nameEn : category.nameSq;
}

/** Picks the locale-appropriate report title. `titleEn` is null on the rule-based classification
 *  fallback (no AI, no translation) — falls back to the Albanian title in that case, same honest
 *  degradation as everywhere else translation can fail. */
export function reportTitle(
  report: { title: string; titleEn?: string | null } | null | undefined,
  locale: Locale,
): string {
  if (!report) return '';
  return (locale === 'en' && report.titleEn) ? report.titleEn : report.title;
}

/** Picks the locale-appropriate report description. Unlike title, the citizen's raw `description` can
 *  itself be in either language — `descriptionSq`/`descriptionEn` are the classifier's bilingual pair
 *  for it. Falls back to the raw text (whichever language it happens to be) when translation wasn't
 *  possible, rather than showing nothing. */
/** Picks the locale-appropriate AI classification reasoning. `reasoningEn` is null on the rule-based
 *  fallback — falls back to the Albanian sentence, same rule as `reportTitle`. */
export function aiReasoning(
  ai: { reasoning?: string | null; reasoningEn?: string | null } | null | undefined,
  locale: Locale,
): string | undefined {
  if (!ai) return undefined;
  return ((locale === 'en' && ai.reasoningEn) ? ai.reasoningEn : ai.reasoning) ?? undefined;
}

/** Picks the locale-appropriate systemic-pattern note. Unlike `aiReasoning`, this is a fixed sentence
 *  written in both languages server-side, not per-report AI output — but the selection rule is the
 *  same shape, so it lives alongside the other report-text helpers. */
export function patternNote(
  report: { patternNote?: string | null; patternNoteEn?: string | null } | null | undefined,
  locale: Locale,
): string | null | undefined {
  if (!report) return undefined;
  return (locale === 'en' && report.patternNoteEn) ? report.patternNoteEn : report.patternNote;
}

export function reportDescription(
  report: { description: string; descriptionSq?: string | null; descriptionEn?: string | null } | null | undefined,
  locale: Locale,
): string {
  if (!report) return '';
  const translated = locale === 'en' ? report.descriptionEn : report.descriptionSq;
  return translated ?? report.description;
}
