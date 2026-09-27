import { Component, type ReactNode } from 'react';
import { Text, useColorScheme, View } from 'react-native';
import { t as translate } from '../i18n';
import { MIN_TARGET, palette, radius, space, type } from '../theme';
import { Button } from './ui';

/**
 * The app's last line of defence. Without this, an unhandled error anywhere in the render tree — a
 * malformed API response, a null a screen didn't guard against — unmounts the whole tree and leaves a
 * blank white screen with no way back in except force-quitting the app. That is a much worse failure
 * mode for a civic-reporting app than a plain "something went wrong, try again" card.
 *
 * A class component because `componentDidCatch`/`getDerivedStateFromError` are the only React error-
 * catching mechanism that exists — there is no hook equivalent, so this is one of the rare places in
 * this codebase that cannot be a function component. `useTheme()` needs its own hook context, which a
 * class component doesn't have either, so this reads the exported `palette` directly instead — it only
 * needs to look reasonable in the two known colour schemes, not react live to a mid-crash theme change.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // No crash-reporting service is wired up yet (out of scope here) — this at least leaves a trace
    // in device logs / `adb logcat` / Xcode console instead of the failure being completely silent.
    console.error('Unhandled error caught by ErrorBoundary:', error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return <ErrorFallback onRetry={this.reset} />;
  }
}

function ErrorFallback({ onRetry }: { onRetry: () => void }) {
  // A function component nested inside is free to use hooks — only the boundary itself can't.
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const t = palette[scheme];

  return (
    <View
      style={{
        flex: 1, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center',
        padding: space.xl, gap: space.md,
      }}
    >
      <View
        style={{
          width: 64, height: 64, borderRadius: radius.lg,
          backgroundColor: `${t.danger}1F`, alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Text style={{ fontSize: 30 }}>⚠</Text>
      </View>
      <Text style={[type.title, { color: t.ink, textAlign: 'center' }]}>{translate('errorBoundary.title')}</Text>
      <Text style={[type.body, { color: t.ink3, textAlign: 'center' }]}>
        {translate('errorBoundary.body')}
      </Text>
      <Button title={translate('errorBoundary.retry')} onPress={onRetry} style={{ minHeight: MIN_TARGET + 6, minWidth: 200 }} />
    </View>
  );
}
