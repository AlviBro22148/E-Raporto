import { useEffect, useState } from 'react';
import { useNavigation } from 'expo-router';

/**
 * True once this screen's entering animation has actually finished.
 *
 * Use it to hold back anything expensive to *create* until the navigator has
 * stopped animating — a WebView above all, which is heavy native work on the UI
 * thread and visibly drops frames if it happens mid-transition.
 *
 * `InteractionManager.runAfterInteractions` is the usual answer and is the wrong
 * one here: it waits on interaction handles opened from JavaScript, and
 * expo-router's stack animates in react-native-screens' native code without
 * opening any. With nothing registered it resolves on the next tick and defers
 * nothing at all — which is exactly how an earlier attempt at this silently did
 * nothing.
 *
 * The native stack does emit transitionStart/transitionEnd on the navigation
 * object, so this waits on those. A screen that arrives without animating — the
 * initial route, a tab switch — emits neither, so a short probe reads "nothing
 * started" as "there is no transition to wait for" and releases immediately
 * rather than stalling on a timeout that was never relevant.
 */
export function useAfterTransition(): boolean {
  const navigation = useNavigation();
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let started = false;

    const finish = () => { if (!cancelled) setSettled(true); };

    // `as never`: expo-router types navigation as the union of every navigator's
    // events, and these two belong only to the stack.
    const stopStart = navigation.addListener('transitionStart' as never, (() => { started = true; }) as never);
    const stopEnd = navigation.addListener('transitionEnd' as never, finish as never);

    // Nothing began animating almost immediately => this screen isn't animating in.
    const probe = setTimeout(() => { if (!started) finish(); }, 80);
    // Never leave a caller waiting forever on an event that didn't arrive.
    const safetyNet = setTimeout(finish, 1200);

    return () => {
      cancelled = true;
      clearTimeout(probe);
      clearTimeout(safetyNet);
      stopStart();
      stopEnd();
    };
  }, [navigation]);

  return settled;
}
