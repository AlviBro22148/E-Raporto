import Svg, { Circle, Path } from 'react-native-svg';
import type { ColorValue } from 'react-native';

/**
 * The tab bar's own icon set — real vector paths, not Unicode text glyphs standing in for icons. Drawn
 * in the exact stroke language the rest of the product already uses (landing page, pitch deck): 24×24
 * viewBox, 1.8 stroke, round caps/joins, no fill except the odd solid dot. Keeping every tab icon on
 * this one shared vocabulary is what a mixed set of a color emoji next to three monochrome glyphs was
 * missing — one inconsistent icon reads as sloppier than the whole bar being plain.
 */
export type TabIconName = 'map' | 'reports' | 'bell' | 'profile';

const STROKE = 1.8;

export function TabIcon({
  name, size = 25, color, focused,
}: {
  name: TabIconName; size?: number; color: ColorValue; focused?: boolean;
}) {
  const stroke = color as string;

  return (
    <Svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      style={{ opacity: focused ? 1 : 0.75 }}
    >
      {name === 'map' && (
        <>
          <Path
            d="M12 21.5s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z"
            stroke={stroke} strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round"
          />
          <Circle cx={12} cy={10.5} r={2.6} stroke={stroke} strokeWidth={STROKE} />
        </>
      )}

      {name === 'reports' && (
        <>
          <Path
            d="M7 4.5h8.5L19 8v11a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 7 19Z"
            stroke={stroke} strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round"
          />
          <Path d="M15.2 4.6V8h3.4" stroke={stroke} strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round" />
          <Path d="M9.8 12h5" stroke={stroke} strokeWidth={STROKE} strokeLinecap="round" />
          <Path d="M9.8 15.4h5" stroke={stroke} strokeWidth={STROKE} strokeLinecap="round" />
        </>
      )}

      {name === 'bell' && (
        <>
          <Path
            d="M6 17c1-1.5 1.6-3.6 1.6-6.4a4.4 4.4 0 1 1 8.8 0c0 2.8.6 4.9 1.6 6.4Z"
            stroke={stroke} strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round"
          />
          <Path d="M10.1 19.8a1.9 1.9 0 0 0 3.8 0" stroke={stroke} strokeWidth={STROKE} strokeLinecap="round" />
        </>
      )}

      {name === 'profile' && (
        <>
          <Circle cx={12} cy={8} r={3.6} stroke={stroke} strokeWidth={STROKE} />
          <Path
            d="M4.6 20.4c.9-4 3.8-6.2 7.4-6.2s6.5 2.2 7.4 6.2"
            stroke={stroke} strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round"
          />
        </>
      )}
    </Svg>
  );
}
