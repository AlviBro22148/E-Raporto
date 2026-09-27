import { Platform, useColorScheme } from 'react-native';

/**
 * The mobile half of the E-Raporto design system.
 *
 * Same brand and same category palette as the dashboard — the category colours are validated for
 * colour-vision deficiency and served by the API, so a pin on this map and a bar on the staff chart
 * are literally the same value. Status colours are always paired with a text label; nothing in this
 * app is conveyed by colour alone.
 */

interface Scheme {
  bg: string; surface: string; surface2: string; surface3: string;
  border: string; borderStrong: string;
  ink: string; ink2: string; ink3: string;
  brand: string; brand2: string; brandSoft: string; onBrand: string;
  danger: string; warning: string; success: string;
}

export const palette: { light: Scheme; dark: Scheme } = {
  light: {
    bg: '#F4F6F8',
    surface: '#FFFFFF',
    surface2: '#FAFBFC',
    surface3: '#EEF1F5',
    border: '#DDE2E8',
    borderStrong: '#C4CCD6',
    ink: '#14181F',
    ink2: '#48525F',
    ink3: '#6B7684',
    brand: '#0B2545',
    brand2: '#1D4E89',
    brandSoft: '#DBE7F5',
    onBrand: '#FFFFFF',
    danger: '#B91C1C',
    warning: '#B45309',
    success: '#15803D',
  },
  dark: {
    bg: '#0E1116',
    surface: '#171B22',
    surface2: '#1C212A',
    surface3: '#232935',
    border: '#2A3240',
    borderStrong: '#3A4553',
    ink: '#E8ECF1',
    ink2: '#A8B3C1',
    ink3: '#7D8899',
    brand: '#0B2545',
    brand2: '#4C8FD4',
    brandSoft: '#16304F',
    onBrand: '#FFFFFF',
    danger: '#F87171',
    warning: '#FBBF24',
    success: '#4ADE80',
  },
};

export type Colors = Scheme;

/** Status colours, mirrored from the dashboard. Always rendered next to their label. */
export const statusColor: Record<string, string> = {
  Submitted: '#64748B',
  InReview: '#0369A1',
  Assigned: '#7E22CE',
  InProgress: '#B45309',
  Resolved: '#15803D',
  Rejected: '#9F1239',
  Merged: '#475569',
};

/**
 * Some status-history rows aren't a real transition — the backend writes a same-status "annotation"
 * row (`fromStatus === toStatus`) when a citizen confirms or disputes a resolution, since the report's
 * actual status doesn't change either way (see ReportsController.VerifyResolution). Left alone, that
 * row renders as a plain "Resolved" entry even for a dispute, which reads as good news it isn't.
 *
 * Detects which kind of annotation a row is from its backend-generated note, which always starts with
 * one of exactly two fixed Albanian sentences (never user-authored) — reliable per-row, unlike keying
 * off "the last entry", which breaks once a case is disputed, reopened, and resolved again.
 */
export function historyEntryKind(entry: { fromStatus?: string | null; toStatus: string; note?: string | null }): 'confirmed' | 'disputed' | null {
  if (!entry.fromStatus || entry.fromStatus !== entry.toStatus) return null;
  if (entry.note?.startsWith('Qytetari konfirmoi')) return 'confirmed';
  if (entry.note?.startsWith('Qytetari kontestoi')) return 'disputed';
  return null;
}

// Plain-language status/priority labels moved to src/i18n (status.*, statusHelp.*, priority.* keys) —
// they are user-facing copy, not design tokens, and now vary by locale.

/** 4pt base scale — every gap and padding in the app is a step on this ladder. */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 8, md: 12, lg: 18, pill: 999 } as const;

export const type = {
  display: { fontSize: 28, fontWeight: '700', letterSpacing: -0.4 },
  title: { fontSize: 21, fontWeight: '700', letterSpacing: -0.3 },
  heading: { fontSize: 17, fontWeight: '600', letterSpacing: -0.2 },
  body: { fontSize: 15.5, fontWeight: '400', lineHeight: 22 },
  bodyStrong: { fontSize: 15.5, fontWeight: '600' },
  callout: { fontSize: 14, fontWeight: '400', lineHeight: 20 },
  label: { fontSize: 12.5, fontWeight: '600', letterSpacing: 0.2 },
  caption: { fontSize: 11.5, fontWeight: '500' },
} as const;

/**
 * Minimum touch target. 44pt on iOS and 48dp on Android are the platform floors, not suggestions —
 * every Pressable in this app is sized against this constant rather than eyeballed.
 */
export const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };
export const MIN_TARGET = Platform.OS === 'ios' ? 44 : 48;

export function useTheme(): Colors & { scheme: 'light' | 'dark' } {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return { ...palette[scheme], scheme };
}

export const shadow = (elevation: number) =>
  Platform.select({
    ios: {
      shadowColor: '#0B1220',
      shadowOpacity: 0.10 + elevation * 0.015,
      shadowRadius: elevation * 2,
      shadowOffset: { width: 0, height: elevation },
    },
    android: { elevation },
    default: {},
  });
