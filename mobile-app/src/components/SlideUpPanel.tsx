import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, type ViewStyle } from 'react-native';

/**
 * A panel that rises into place from below, and drops back out when dismissed.
 *
 * **On cost.** This animates `opacity` and `translateY` only, and every animation
 * here sets `useNativeDriver: true`. That combination is the reason it can't
 * cost frames: the values are handed to the native animation driver once, up
 * front, and the whole thing then runs on the UI thread. No JavaScript executes
 * per frame, so the JS thread being busy — a list rendering, a fetch resolving —
 * cannot stutter it, and the animation itself cannot stutter anything else.
 *
 * Native driver only accepts transforms and opacity. If you ever want to animate
 * a colour, a height, a border or a shadow here, it silently cannot use the
 * driver and would fall back to per-frame JS. Don't — animate a transform
 * instead, or the guarantee above stops being true.
 */

/** Rise distance, in dp. Enough to read as motion, short enough not to feel slow. */
const TRAVEL = 26;
/** Springs are described by feel rather than duration; this settles in ~320ms. */
const SPRING = { friction: 9, tension: 90 };
/** Dismissal is a plain fade-down — a spring on the way out reads as indecision. */
const EXIT_MS = 160;

export function SlideUpPanel({
  visible, replayKey, style, children,
}: {
  visible: boolean;
  /**
   * Change this to replay the entrance while the panel stays up — e.g. the id of
   * the selected marker, so tapping a different pin re-pops the card rather than
   * silently swapping its contents.
   */
  replayKey?: string | number;
  style?: ViewStyle;
  children: React.ReactNode;
}) {
  // Kept mounted a moment past `visible` so the exit has something to animate.
  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(visible ? 1 : 0)).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      progress.setValue(0);          // restart, so a replayKey change re-pops
      Animated.spring(progress, { toValue: 1, useNativeDriver: true, ...SPRING }).start();
      return;
    }

    Animated.timing(progress, {
      toValue: 0,
      duration: EXIT_MS,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => { if (finished) setMounted(false); });
  }, [visible, replayKey, progress]);

  if (!mounted) return null;

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [TRAVEL, 0] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
