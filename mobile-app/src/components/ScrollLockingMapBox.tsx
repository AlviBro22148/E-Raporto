import { useState } from 'react';
import { View } from 'react-native';

/**
 * Wraps an interactive `LeafletMap` so it can be panned/zoomed without also scrolling the page
 * around it.
 *
 * The map is a native WebView, not a React Native view — Leaflet's own drag/pinch handling lives
 * entirely inside its DOM, invisible to React Native's touch system. An ancestor `ScrollView` doesn't
 * know or care about that: on Android in particular, it intercepts any vertical drag once it crosses
 * the touch-move slop, regardless of what the WebView underneath wants to do with it. The result is
 * exactly the bug this fixes — trying to pan the map instead scrolls the whole screen.
 *
 * The reliable, dependency-free fix is to disable the ancestor `ScrollView` for the duration of any
 * touch that starts on the map, via its `scrollEnabled` prop. `onTouchStart` fires the instant a
 * finger lands inside this view, before Android's native interception would otherwise kick in.
 */
export function ScrollLockingMapBox({
  children, onTouchActiveChange, style,
}: {
  children: React.ReactNode;
  /** Called with `true` on touch-down inside the map, `false` on release/cancel. Wire this to the
   *  surrounding `ScrollView`'s `scrollEnabled` prop. */
  onTouchActiveChange: (active: boolean) => void;
  style?: object;
}) {
  return (
    <View
      style={style}
      onTouchStart={() => onTouchActiveChange(true)}
      onTouchEnd={() => onTouchActiveChange(false)}
      onTouchCancel={() => onTouchActiveChange(false)}
    >
      {children}
    </View>
  );
}

/** Local state + the two props a `ScrollView` and a `ScrollLockingMapBox` each need to cooperate. */
export function useMapScrollLock() {
  const [scrollEnabled, setScrollEnabled] = useState(true);
  return { scrollEnabled, onTouchActiveChange: (active: boolean) => setScrollEnabled(!active) };
}
