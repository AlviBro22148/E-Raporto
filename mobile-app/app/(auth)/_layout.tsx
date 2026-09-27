import { Stack } from 'expo-router';

/**
 * Auth screens carry their own branded header, so the navigator chrome stays out of the way.
 *
 * This is a nested stack, so it does not inherit the root stack's options — sign-in to sign-up would
 * have kept the platform default slide while every other transition in the app faded. Same animation
 * restated here, for the same reason it's native: no per-frame JavaScript.
 */
export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false, animation: 'fade_from_bottom' }} />;
}
