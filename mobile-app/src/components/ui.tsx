import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ReactNode } from 'react';
import { categoryName, useLocale, useT, type TranslateFn } from '../i18n';
import { HIT_SLOP, MIN_TARGET, radius, shadow, space, statusColor, type, useTheme } from '../theme';

/* ── Text ────────────────────────────────────────────────────────────────── */

export function Title({ children, style }: { children: ReactNode; style?: object }) {
  const t = useTheme();
  return <Text style={[type.title, { color: t.ink }, style]}>{children}</Text>;
}

export function Heading({ children, style }: { children: ReactNode; style?: object }) {
  const t = useTheme();
  return <Text style={[type.heading, { color: t.ink }, style]}>{children}</Text>;
}

export function Body({ children, muted, style, numberOfLines }: {
  children: ReactNode; muted?: boolean; style?: object; numberOfLines?: number;
}) {
  const t = useTheme();
  return (
    <Text numberOfLines={numberOfLines} style={[type.body, { color: muted ? t.ink3 : t.ink }, style]}>
      {children}
    </Text>
  );
}

export function Caption({ children, style, numberOfLines }: {
  children: ReactNode; style?: object; numberOfLines?: number;
}) {
  const t = useTheme();
  return (
    <Text numberOfLines={numberOfLines} style={[type.caption, { color: t.ink3 }, style]}>
      {children}
    </Text>
  );
}

export function Label({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <Text style={[type.label, { color: t.ink3, textTransform: 'uppercase', marginBottom: space.xs }]}>
      {children}
    </Text>
  );
}

/* ── Buttons ─────────────────────────────────────────────────────────────── */

/**
 * Every button is at least MIN_TARGET tall (44pt iOS / 48dp Android) and gives visual feedback
 * within a frame of the touch — a press with no response reads as a broken app on a phone.
 */
export function Button({
  title, onPress, variant = 'primary', disabled, loading, icon, style, accessibilityHint,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  style?: object;
  accessibilityHint?: string;
}) {
  const t = useTheme();

  const background = variant === 'primary' ? t.brand2
    : variant === 'danger' ? t.danger
    : variant === 'ghost' ? 'transparent'
    : t.surface;

  const foreground = variant === 'primary' || variant === 'danger' ? '#FFFFFF' : t.ink;
  const borderColor = variant === 'secondary' ? t.borderStrong
    : variant === 'ghost' ? 'transparent'
    : background;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      android_ripple={{ color: 'rgba(255,255,255,0.18)', borderless: false }}
      style={({ pressed }) => [
        {
          minHeight: MIN_TARGET,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: space.sm,
          paddingHorizontal: space.lg,
          borderRadius: radius.md,
          backgroundColor: background,
          borderWidth: 1,
          borderColor,
          opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
          transform: [{ scale: pressed ? 0.985 : 1 }],
        },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={foreground} size="small" />
        : (<>{icon}<Text style={[type.bodyStrong, { color: foreground }]}>{title}</Text></>)}
    </Pressable>
  );
}

/* ── Surfaces ────────────────────────────────────────────────────────────── */

export function Card({ children, style, onPress, accessibilityLabel }: {
  children: ReactNode; style?: object; onPress?: () => void; accessibilityLabel?: string;
}) {
  const t = useTheme();
  const base = {
    backgroundColor: t.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.border,
    padding: space.lg,
    ...shadow(1),
  };

  if (!onPress) return <View style={[base, style]}>{children}</View>;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      android_ripple={{ color: t.surface3 }}
      style={({ pressed }) => [base, { opacity: pressed ? 0.9 : 1 }, style]}
    >
      {children}
    </Pressable>
  );
}

/* ── Badges ──────────────────────────────────────────────────────────────── */

/** Dot + label. Never colour alone — a colourblind or low-vision user reads the same information. */
/** `confirmed`: the reporter's verdict on THIS report's current resolution was "Confirmed" — pass
 *  `report.verification?.outcome === 'Confirmed'` / `item.verificationOutcome === 'Confirmed'`.
 *  Only changes the badge text (Resolved -> ResolvedConfirmed); the underlying status, the colour,
 *  and every workflow/filter/history label elsewhere keep reading the real "Resolved" value. */
export function StatusPill({ status, small, confirmed }: { status: string; small?: boolean; confirmed?: boolean }) {
  const t = useT();
  const color = statusColor[status] ?? '#64748B';
  const label = (confirmed && status === 'Resolved' ? t('status.ResolvedConfirmed') : t(`status.${status}`)) || status;

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={t('common.statusA11y', { label })}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        alignSelf: 'flex-start',
        paddingVertical: small ? 3 : 5,
        paddingHorizontal: small ? 9 : 11,
        borderRadius: radius.pill,
        backgroundColor: `${color}1A`,
        borderWidth: 1,
        borderColor: `${color}59`,
      }}
    >
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }} />
      <Text style={[small ? type.caption : type.label, { color }]}>{label}</Text>
    </View>
  );
}

export function CategoryPill({ name, color, small }: { name: string; color: string; small?: boolean }) {
  const t = useTheme();
  const tr = useT();
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={tr('common.categoryA11y', { name })}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        alignSelf: 'flex-start',
        paddingVertical: small ? 3 : 5,
        paddingHorizontal: small ? 9 : 11,
        borderRadius: radius.pill,
        backgroundColor: t.surface3,
        borderWidth: 1,
        borderColor: t.border,
      }}
    >
      <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: color }} />
      <Text style={[small ? type.caption : type.label, { color: t.ink2 }]}>{name}</Text>
    </View>
  );
}

/* ── States ──────────────────────────────────────────────────────────────── */

export function Loading({ label }: { label?: string }) {
  const t = useTheme();
  return (
    <View style={{ padding: space.xxl, alignItems: 'center', gap: space.md }}>
      <ActivityIndicator color={t.brand2} />
      {label && <Caption>{label}</Caption>}
    </View>
  );
}

export function EmptyState({ icon, title, hint, action }: {
  icon?: string; title: string; hint?: string; action?: ReactNode;
}) {
  const t = useTheme();
  return (
    <View style={{ padding: space.xxl, alignItems: 'center', gap: space.sm }}>
      {icon && <Text style={{ fontSize: 40, marginBottom: space.xs }}>{icon}</Text>}
      <Heading style={{ textAlign: 'center' }}>{title}</Heading>
      {hint && (
        <Text style={[type.callout, { color: t.ink3, textAlign: 'center', maxWidth: 300 }]}>{hint}</Text>
      )}
      {action && <View style={{ marginTop: space.md }}>{action}</View>}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const t = useTheme();
  const tr = useT();
  return (
    <View style={{ padding: space.xl, alignItems: 'center', gap: space.md }}>
      <Text style={{ fontSize: 32 }}>⚠️</Text>
      <Text style={[type.body, { color: t.ink, textAlign: 'center' }]}>{message}</Text>
      {onRetry && <Button title={tr('common.retry')} variant="secondary" onPress={onRetry} />}
    </View>
  );
}

/* ── The AI honesty surface ──────────────────────────────────────────────── */

/**
 * Shown to the citizen right after they submit. It names the category the system chose, how sure it
 * was, and — when confidence is low — says plainly that a person will look at it. Claiming certainty
 * we do not have would be the easiest way to lose a citizen's trust the first time we get it wrong.
 */
export function AiVerdict({
  categoryNameSq, categoryNameEn, confidence, source, isLowConfidence, reasoning,
}: {
  categoryNameSq: string; categoryNameEn: string; confidence: number; source: string;
  isLowConfidence: boolean; reasoning?: string;
}) {
  const t = useTheme();
  const tr = useT();
  const locale = useLocale();
  const pct = Math.round(confidence * 100);
  const tone = isLowConfidence ? t.warning : confidence < 0.85 ? t.brand2 : t.success;

  return (
    <View
      style={{
        backgroundColor: t.surface2,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: t.border,
        padding: space.lg,
        gap: space.sm,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Text style={{ fontSize: 15 }}>✦</Text>
        <Text style={[type.label, { color: t.ink3, textTransform: 'uppercase' }]}>
          {source === 'Llm' ? tr('ai.withAi') : tr('ai.automatic')}
        </Text>
      </View>

      <Text style={[type.heading, { color: t.ink }]}>{locale === 'en' && categoryNameEn ? categoryNameEn : categoryNameSq}</Text>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <View
          accessibilityRole="progressbar"
          accessibilityLabel={tr('ai.confidenceA11y', { pct })}
          style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: t.surface3, overflow: 'hidden' }}
        >
          <View style={{ width: `${pct}%`, height: '100%', backgroundColor: tone }} />
        </View>
        <Text style={[type.bodyStrong, { color: tone }]}>{pct}%</Text>
      </View>

      <Text style={[type.callout, { color: t.ink2 }]}>
        {isLowConfidence ? tr('ai.lowConfidenceNote') : tr('ai.confidentNote')}
      </Text>

      {reasoning && (
        <Text style={[type.caption, { color: t.ink3, fontStyle: 'italic' }]}>{reasoning}</Text>
      )}
    </View>
  );
}

/* ── Formatting ──────────────────────────────────────────────────────────── */

/** Takes the caller's own `t` (from `useT()`) rather than a hook, so it stays a plain function callable
 *  from anywhere a component already has one — not another hook rule to remember at each call site. */
export function formatRelative(iso: string, t: TranslateFn): string {
  const deltaMs = new Date(iso).getTime() - Date.now();
  const past = deltaMs < 0;
  const minutes = Math.abs(deltaMs) / 60000;

  if (minutes < 1) return t('time.now');
  const [value, unitKey] =
    minutes < 60 ? [Math.round(minutes), 'min']
    : minutes < 1440 ? [Math.round(minutes / 60), 'hours']
    : minutes < 43200 ? [Math.round(minutes / 1440), 'days']
    : [Math.round(minutes / 43200), 'months'];
  const unit = t(`time.${unitKey}`);

  return past ? t('time.ago', { value, unit }) : t('time.in', { value, unit });
}

export function formatDateTime(iso: string, locale: ReturnType<typeof useLocale>): string {
  return new Date(iso).toLocaleString(locale === 'en' ? 'en-GB' : 'sq-AL', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export { HIT_SLOP, space, radius, type, useTheme };
