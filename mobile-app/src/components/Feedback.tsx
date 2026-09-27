import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '../i18n';
import { ToneIcon, type Tone } from './ToneIcon';
import { Button } from './ui';
import { radius, space, type, useTheme } from '../theme';

/**
 * The app's feedback layer: transient toasts, and confirmation dialogs that block on an answer.
 *
 * This replaces `Alert.alert` everywhere. The system alert is a stock OS dialog — it can't carry the
 * app's typography, spacing or status colours, it looks different on every Android skin, and even a
 * one-line "saved" acknowledgement arrives as a modal the user has to dismiss. Routing all of it
 * through here means success notices get out of the way on their own, and the destructive
 * confirmations that genuinely deserve a modal are the only things that still interrupt.
 *
 * Tone is never carried by colour alone: each one has its own icon silhouette and its own wording.
 */

export type { Tone };

export interface NotifyOptions {
  title: string;
  message?: string;
  tone?: Tone;
}

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** `danger` styles the confirm button as destructive — sign-out, merges, anything irreversible. */
  tone?: 'danger' | 'default';
}

interface FeedbackApi {
  notify: (options: NotifyOptions) => void;
  /** Resolves true if the user confirmed, false if they cancelled or dismissed. */
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const FeedbackContext = createContext<FeedbackApi | null>(null);

export function useFeedback(): FeedbackApi {
  const context = useContext(FeedbackContext);
  if (!context) throw new Error('useFeedback must be used inside <FeedbackProvider>');
  return context;
}

/** How long a toast stays up. Errors linger — they carry information worth reading twice. */
const VISIBLE_MS: Record<Tone, number> = {
  success: 2800,
  info: 3200,
  warning: 4200,
  error: 4800,
};

// ─────────────────────────── Toast ───────────────────────────

function Toast({ options, onDismiss }: { options: NotifyOptions; onDismiss: () => void }) {
  const t = useTheme();
  const tr = useT();
  const insets = useSafeAreaInsets();
  const tone = options.tone ?? 'info';

  // Two values rather than one: the slide should overshoot slightly and settle, while the fade must
  // not — a bouncing opacity reads as a flicker.
  const slide = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const dismissed = useRef(false);

  const close = useCallback(() => {
    if (dismissed.current) return;
    dismissed.current = true;
    Animated.parallel([
      Animated.timing(slide, {
        toValue: 0, duration: 180, easing: Easing.in(Easing.cubic), useNativeDriver: true,
      }),
      Animated.timing(fade, {
        toValue: 0, duration: 150, easing: Easing.linear, useNativeDriver: true,
      }),
    ]).start(({ finished }) => { if (finished) onDismiss(); });
  }, [slide, fade, onDismiss]);

  useEffect(() => {
    Animated.parallel([
      Animated.spring(slide, {
        toValue: 1, useNativeDriver: true, friction: 8, tension: 70,
      }),
      Animated.timing(fade, {
        toValue: 1, duration: 160, easing: Easing.out(Easing.quad), useNativeDriver: true,
      }),
    ]).start();

    const timer = setTimeout(close, VISIBLE_MS[tone]);
    return () => clearTimeout(timer);
  }, [slide, fade, close, tone]);

  const accent = tone === 'success' ? t.success
    : tone === 'error' ? t.danger
    : tone === 'warning' ? t.warning
    : t.brand2;

  return (
    <Animated.View
      style={{
        position: 'absolute',
        top: insets.top + space.sm,
        left: space.md,
        right: space.md,
        opacity: fade,
        transform: [
          { translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) },
          { scale: slide.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
        ],
      }}
    >
      <Pressable
        onPress={close}
        accessibilityRole="alert"
        accessibilityLabel={`${options.title}${options.message ? `. ${options.message}` : ''}`}
        accessibilityHint={tr('feedback.dismissHint')}
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: space.md,
          padding: space.md,
          borderRadius: radius.md,
          backgroundColor: t.surface,
          borderWidth: 1,
          borderColor: t.border,
          // The accent stripe repeats what the icon already says, for a cue that survives a glance.
          borderLeftWidth: 3,
          borderLeftColor: accent,
          // Toasts float over content, so they need to read as lifted on both platforms.
          elevation: 8,
          shadowColor: '#000',
          shadowOpacity: 0.22,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
        }}
      >
        <View style={{ marginTop: 1 }}>
          <ToneIcon tone={tone} color={accent} size={20} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[type.bodyStrong, { color: t.ink }]}>{options.title}</Text>
          {options.message && (
            <Text style={[type.callout, { color: t.ink2 }]}>{options.message}</Text>
          )}
        </View>
      </Pressable>
    </Animated.View>
  );
}

// ─────────────────────────── Confirm dialog ───────────────────────────

function ConfirmDialog({
  options, onResolve,
}: {
  options: ConfirmOptions;
  onResolve: (confirmed: boolean) => void;
}) {
  const t = useTheme();
  const tr = useT();
  const enter = useRef(new Animated.Value(0)).current;
  const settled = useRef(false);

  useEffect(() => {
    Animated.spring(enter, {
      toValue: 1, useNativeDriver: true, friction: 9, tension: 80,
    }).start();
  }, [enter]);

  // Play the exit before answering, so the dialog is never yanked off screen mid-gesture.
  const resolve = useCallback((confirmed: boolean) => {
    if (settled.current) return;
    settled.current = true;
    Animated.timing(enter, {
      toValue: 0, duration: 140, easing: Easing.in(Easing.cubic), useNativeDriver: true,
    }).start(() => onResolve(confirmed));
  }, [enter, onResolve]);

  const destructive = options.tone === 'danger';

  return (
    <Modal
      transparent
      // The animation is ours; the Modal only provides the layer and the Android back button.
      animationType="none"
      statusBarTranslucent
      onRequestClose={() => resolve(false)}
    >
      <Animated.View
        style={{
          flex: 1,
          backgroundColor: 'rgba(4, 8, 14, 0.6)',
          justifyContent: 'center',
          padding: space.lg,
          opacity: enter,
        }}
      >
        {/* Tapping the backdrop cancels — the same affordance as the Cancel button, not a shortcut
            past the decision. */}
        <Pressable
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          onPress={() => resolve(false)}
          accessibilityRole="button"
          accessibilityLabel={options.cancelLabel ?? tr('feedback.cancel')}
        />

        <Animated.View
          accessibilityViewIsModal
          style={{
            gap: space.md,
            padding: space.lg,
            borderRadius: radius.lg,
            backgroundColor: t.surface,
            borderWidth: 1,
            borderColor: t.border,
            elevation: 16,
            shadowColor: '#000',
            shadowOpacity: 0.3,
            shadowRadius: 22,
            shadowOffset: { width: 0, height: 8 },
            transform: [
              { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) },
              { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) },
            ],
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md }}>
            <View style={{ marginTop: 2 }}>
              <ToneIcon tone={destructive ? 'warning' : 'info'} color={destructive ? t.danger : t.brand2} size={22} />
            </View>
            <View style={{ flex: 1, gap: space.xs }}>
              <Text style={[type.heading, { color: t.ink }]}>{options.title}</Text>
              {options.message && (
                <Text style={[type.callout, { color: t.ink2 }]}>{options.message}</Text>
              )}
            </View>
          </View>

          <View style={{ gap: space.sm }}>
            <Button
              title={options.confirmLabel ?? tr('feedback.continueLabel')}
              variant={destructive ? 'danger' : 'primary'}
              onPress={() => resolve(true)}
            />
            <Button
              title={options.cancelLabel ?? tr('feedback.cancel')}
              variant="secondary"
              onPress={() => resolve(false)}
            />
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

// ─────────────────────────── Provider ───────────────────────────

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<{ options: NotifyOptions; key: number } | null>(null);
  const [pending, setPending] = useState<ConfirmOptions | null>(null);
  const nextKey = useRef(0);
  // The resolver lives in a ref rather than in state: settling a promise is a side effect, and a
  // state updater is allowed to run more than once.
  const resolver = useRef<((confirmed: boolean) => void) | null>(null);

  // The key remounts the Toast, so a second notify arriving over a visible one restarts the
  // animation and its timer rather than inheriting the first one's remaining time.
  const notify = useCallback((options: NotifyOptions) => {
    nextKey.current += 1;
    setToast({ options, key: nextKey.current });
  }, []);

  const confirm = useCallback((options: ConfirmOptions) => (
    new Promise<boolean>(resolve => {
      // A second confirm() opening over an unanswered one would strand the first caller awaiting a
      // promise nothing can settle, so answer it as a cancel before taking over the slot.
      resolver.current?.(false);
      resolver.current = resolve;
      setPending(options);
    })
  ), []);

  const handleResolve = useCallback((confirmed: boolean) => {
    const resolve = resolver.current;
    resolver.current = null;
    setPending(null);
    resolve?.(confirmed);
  }, []);

  return (
    <FeedbackContext.Provider value={{ notify, confirm }}>
      {children}

      {/* box-none so the toast's own surface stays tappable while the screen underneath it doesn't
          lose a single touch to this layer. */}
      <View
        pointerEvents="box-none"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      >
        {toast && (
          <Toast
            key={toast.key}
            options={toast.options}
            onDismiss={() => setToast(current => (current?.key === toast.key ? null : current))}
          />
        )}
      </View>

      {pending && <ConfirmDialog options={pending} onResolve={handleResolve} />}
    </FeedbackContext.Provider>
  );
}
