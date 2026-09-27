import { View } from 'react-native';

export type Tone = 'success' | 'error' | 'warning' | 'info';

/**
 * The badge that marks a toast's tone.
 *
 * Drawn from plain Views rather than an icon library or emoji: the app ships no SVG renderer, and an
 * emoji arrives pre-coloured at a size the device's font decides, so it can never take the accent
 * colour or sit on the text's baseline. Four rectangles can.
 *
 * Each tone gets its own mark — a tick, a cross, a bang, an i — so the meaning survives without
 * colour, which is the same rule the status pills and badges follow.
 */
export function ToneIcon({ tone, color, size = 20 }: { tone: Tone; color: string; size?: number }) {
  const bar = Math.max(1.8, size * 0.1);

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: bar * 0.85,
        borderColor: color,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {tone === 'success' && (
        // A tick is two bars of different lengths, met at a right angle and rotated.
        <View style={{ width: size * 0.5, height: size * 0.3, marginTop: -size * 0.04 }}>
          <View
            style={{
              position: 'absolute', left: 0, top: size * 0.13,
              width: size * 0.2, height: bar, borderRadius: bar,
              backgroundColor: color, transform: [{ rotate: '45deg' }],
            }}
          />
          <View
            style={{
              position: 'absolute', left: size * 0.12, top: size * 0.08,
              width: size * 0.34, height: bar, borderRadius: bar,
              backgroundColor: color, transform: [{ rotate: '-45deg' }],
            }}
          />
        </View>
      )}

      {tone === 'error' && (
        <View style={{ width: size * 0.42, height: size * 0.42, alignItems: 'center', justifyContent: 'center' }}>
          <View
            style={{
              position: 'absolute', width: size * 0.42, height: bar, borderRadius: bar,
              backgroundColor: color, transform: [{ rotate: '45deg' }],
            }}
          />
          <View
            style={{
              position: 'absolute', width: size * 0.42, height: bar, borderRadius: bar,
              backgroundColor: color, transform: [{ rotate: '-45deg' }],
            }}
          />
        </View>
      )}

      {/* A bang and an i are the same two parts in the opposite order. */}
      {(tone === 'warning' || tone === 'info') && (
        <View style={{ alignItems: 'center', gap: size * 0.07 }}>
          {tone === 'info' && (
            <View style={{ width: bar, height: bar, borderRadius: bar, backgroundColor: color }} />
          )}
          <View style={{ width: bar, height: size * 0.3, borderRadius: bar, backgroundColor: color }} />
          {tone === 'warning' && (
            <View style={{ width: bar, height: bar, borderRadius: bar, backgroundColor: color }} />
          )}
        </View>
      )}
    </View>
  );
}
