import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, type Category, type ReportPin } from '../../src/api';
import { useRealtimeSubscription } from '../../src/RealtimeContext';
import { LeafletMap, type MapMarker } from '../../src/components/LeafletMap';
import { SlideUpPanel } from '../../src/components/SlideUpPanel';
import { Button, Caption, ErrorState, Loading, StatusPill, formatRelative } from '../../src/components/ui';
import { categoryName, useLocale, useT } from '../../src/i18n';
import { MIN_TARGET, radius, shadow, space, type, useTheme } from '../../src/theme';

const ELBASAN = { lat: 41.1125, lng: 20.0822 };

export default function MapScreen() {
  const t = useTheme();
  const tr = useT();
  const locale = useLocale();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [center, setCenter] = useState(ELBASAN);
  const [pins, setPins] = useState<ReportPin[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReportPin | null>(null);
  // The card outlives `selected` by the length of its exit animation, so hold on
  // to the last pin — reading straight from `selected` would blank it mid-slide.
  const lastSelected = useRef<ReportPin | null>(null);
  if (selected) lastSelected.current = selected;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasLocation, setHasLocation] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [pinData, categoryData] = await Promise.all([api.mapPins({ limit: 300 }), api.categories()]);
      setPins(pinData);
      setCategories(categoryData);
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('map.loadError'));
    } finally {
      setLoading(false);
    }
  }, [tr]);

  useEffect(() => { void load(); }, [load]);

  // Refresh when the tab regains focus so a report filed a minute ago is already on the map.
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  // Any report anywhere can add, move or recolour a pin, so the map listens without an id filter.
  useRealtimeSubscription({ entity: 'report' }, () => { void load(); });

  // Location is requested once, foreground-only, and we stop as soon as we have a fix — a map that
  // keeps a GPS subscription open in the background is a battery cost the citizen never agreed to.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted' || cancelled) return;

      try {
        const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (cancelled) return;
        setHasLocation(true);
        setCenter({ lat: position.coords.latitude, lng: position.coords.longitude });
      } catch { /* keep the Elbasan default centre */ }
    })();

    return () => { cancelled = true; };
  }, []);

  const visible = activeCategory ? pins.filter(p => p.categoryCode === activeCategory) : pins;

  // Pins grow with confirmations so a problem forty people reported reads louder than one.
  const markers: MapMarker[] = useMemo(
    () => visible.map(pin => ({
      id: pin.id,
      lat: pin.lat,
      lng: pin.lng,
      color: pin.colorHex,
      size: Math.min(16 + Math.sqrt(Math.max(pin.confirmationCount, 1)) * 4.5, 34),
      label: `${pin.publicRef} — ${(pin.verifiedConfirmed && pin.status === 'Resolved' ? tr('status.ResolvedConfirmed') : tr(`status.${pin.status}`)) || pin.status}`,
    })),
    [visible, tr],
  );

  if (loading) return <Loading label={tr('map.loading')} />;
  if (error && pins.length === 0) return <ErrorState message={error} onRetry={() => { setLoading(true); void load(); }} />;

  return (
    <View style={{ flex: 1 }}>
      <LeafletMap
        markers={markers}
        center={center}
        zoom={hasLocation ? 15 : 13}
        fitToMarkers={!hasLocation}
        showZoomControls
        zoomPosition="bottomright"
        zoomInset={96}
        height="100%"
        style={{ flex: 1 }}
        onMarkerPress={id => setSelected(pins.find(p => p.id === id) ?? null)}
        onMapPress={() => setSelected(null)}
      />

      {/* Category filter sits at the top: it is browsed occasionally, unlike the report CTA below. */}
      <View style={{ position: 'absolute', top: space.sm, left: 0, right: 0, zIndex: 10, elevation: 10 }}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: space.lg, gap: space.sm }}
        >
          <FilterChip
            label={tr('map.all')}
            active={activeCategory === null}
            onPress={() => setActiveCategory(null)}
          />
          {categories.map(category => (
            <FilterChip
              key={category.id}
              label={categoryName(category, locale)}
              color={category.colorHex}
              active={activeCategory === category.code}
              onPress={() => setActiveCategory(c => (c === category.code ? null : category.code))}
            />
          ))}
        </ScrollView>
      </View>

      {lastSelected.current && (
        <SlideUpPanel
          visible={Boolean(selected)}
          // Re-pops the card when a different pin is tapped while it is already up.
          replayKey={selected?.id}
          style={{
            position: 'absolute',
            left: space.lg, right: space.lg,
            bottom: insets.bottom + MIN_TARGET + space.xl + space.lg,
            zIndex: 20, elevation: 20,
          }}
        >
          <Pressable
            onPress={() => router.push(`/report/${lastSelected.current!.id}`)}
            accessibilityRole="button"
            accessibilityLabel={tr('map.openReportA11y', { ref: lastSelected.current.publicRef })}
            style={{
              backgroundColor: t.surface,
              borderRadius: radius.lg,
              borderWidth: 1, borderColor: t.border,
              padding: space.lg,
              gap: space.sm,
              ...shadow(4),
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Text style={[type.caption, { color: t.ink3, fontVariant: ['tabular-nums'] }]}>
                {lastSelected.current.publicRef}
              </Text>
              <StatusPill status={lastSelected.current.status} small confirmed={lastSelected.current.verifiedConfirmed} />
            </View>
            <Caption>
              {tr('map.reported', { relative: formatRelative(lastSelected.current.createdAt, tr) })}
              {lastSelected.current.confirmationCount > 1 && tr('map.confirmedBy', { count: lastSelected.current.confirmationCount })}
            </Caption>
            <Text style={[type.callout, { color: t.brand2, fontWeight: '600' }]}>
              {tr('map.viewDetails')}
            </Text>
          </Pressable>
        </SlideUpPanel>
      )}

      {/*
        The primary CTA lives in the bottom quarter — the one place a thumb reaches without the hand
        shifting grip. This is the single action the whole app exists for, so nothing competes with it.
      */}
      <View
        style={{
          position: 'absolute',
          left: space.lg, right: space.lg,
          bottom: insets.bottom + space.lg,
          // Must out-elevate the WebView: on Android elevation drives native z-order, and this is
          // the one control the entire app exists for — it can never be the thing that gets hidden.
          zIndex: 30, elevation: 30,
        }}
      >
        <Button
          title={tr('map.reportCta')}
          icon={<Text style={{ fontSize: 17, color: '#fff' }}>＋</Text>}
          accessibilityHint={tr('map.reportCtaHint')}
          onPress={() => router.push('/report/new')}
          style={{ ...shadow(5), minHeight: MIN_TARGET + 6 }}
        />
      </View>
    </View>
  );
}

function FilterChip({ label, color, active, onPress }: {
  label: string; color?: string; active: boolean; onPress: () => void;
}) {
  const t = useTheme();
  const tr = useT();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={tr('map.filterA11y', { label })}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 6,
        minHeight: 36,
        paddingHorizontal: space.md,
        borderRadius: radius.pill,
        backgroundColor: active ? t.brand2 : t.surface,
        borderWidth: 1,
        borderColor: active ? t.brand2 : t.border,
        opacity: pressed ? 0.85 : 1,
        ...shadow(Platform.OS === 'android' ? 2 : 1),
      })}
    >
      {color && (
        <View
          style={{
            width: 8, height: 8, borderRadius: 2,
            backgroundColor: active ? '#FFFFFF' : color,
          }}
        />
      )}
      <Text style={[type.label, { color: active ? '#FFFFFF' : t.ink2 }]}>{label}</Text>
    </Pressable>
  );
}
