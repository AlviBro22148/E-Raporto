import { useCallback, useEffect, useState } from 'react';
import {
  Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View,
} from 'react-native';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  api, mediaUrl, type Category, type CreateReportResponse, type DuplicateCandidate,
} from '../../src/api';
import { useFeedback } from '../../src/components/Feedback';
import { LeafletMap } from '../../src/components/LeafletMap';
import { ScrollLockingMapBox, useMapScrollLock } from '../../src/components/ScrollLockingMapBox';
import {
  AiVerdict, Body, Button, Caption, Card, CategoryPill, Heading, Label, StatusPill, Title,
  formatRelative,
} from '../../src/components/ui';
import { aiReasoning, categoryName, reportTitle, useLocale, useT } from '../../src/i18n';
import { isInsideElbasan } from '../../src/geo';
import { MIN_TARGET, radius, space, type, useTheme } from '../../src/theme';
import { useAfterTransition } from '../../src/useAfterTransition';

type Step = 'compose' | 'duplicates' | 'done';

/**
 * Where the location gate lands:
 *  · 'pending' — permission/fix still in flight.
 *  · 'ready' — got a fix, and it's inside Bashkia Elbasan. Reporting is allowed; see the pin-outside
 *    check separately below for the (freely draggable) report pin itself.
 *  · 'denied' | 'outside' | 'unavailable' — reporting is blocked; see the matching card in the render.
 * There is deliberately no default-Elbasan fallback here — a fix that never lands, or lands outside
 * the municipality, must block submission rather than silently substitute a pin nobody actually stood
 * near, which is exactly the gap the whole feature exists to close.
 */
type LocationStatus = 'pending' | 'ready' | 'denied' | 'outside' | 'unavailable';

/**
 * The citizen's core flow: photo → description → confirm the pin → submit.
 *
 * Three deliberate choices:
 *  · The location is confirmed on a map before submit, because a report on the wrong street is
 *    worse than no report — a crew gets dispatched to nothing.
 *  · The category is never asked as a required question. The classifier proposes one and the
 *    citizen sees it afterwards; making people pick from a taxonomy is where civic apps lose people.
 *  · A duplicate is offered, never enforced. If the citizen says "no, this is different", their
 *    report stands exactly as filed.
 */
export default function NewReportScreen() {
  const t = useTheme();
  const tr = useT();
  const locale = useLocale();
  const router = useRouter();
  const { notify } = useFeedback();
  const insets = useSafeAreaInsets();

  const [step, setStep] = useState<Step>('compose');
  const [description, setDescription] = useState('');
  const [address, setAddress] = useState('');
  // Once the citizen edits the address themselves, the pin stops rewriting it — their landmark
  // ("përballë shkollës") is more useful to a crew than any geocoder's street name.
  const [addressEdited, setAddressEdited] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [categoryHint, setCategoryHint] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  // The draggable report pin — only meaningful once locationStatus is 'ready'.
  const [coords, setCoords] = useState({ latitude: 0, longitude: 0 });
  // The live GPS fix, captured once and never moved — the presence proof sent alongside the pin.
  const [deviceCoords, setDeviceCoords] = useState({ latitude: 0, longitude: 0 });
  const [locationStatus, setLocationStatus] = useState<LocationStatus>('pending');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CreateReportResponse | null>(null);
  const mapScrollLock = useMapScrollLock();

  /*
    This screen's own expensive work also waits for the modal to finish sliding in.
    A high-accuracy GPS fix, a reverse-geocode and a categories fetch all firing at
    once during the animation is the rest of what made this screen feel heavy — and
    none of it is needed in the first frame: the pin has a sensible Elbasan default
    until the fix lands. (The map defers itself; see LeafletMap.)
  */
  const settled = useAfterTransition();

  useEffect(() => {
    if (!settled) return;
    api.categories().then(setCategories).catch(() => { /* optional */ });
  }, [settled]);

  // Reverse geocoding is best-effort throughout: a nice-to-have label, never a blocker.
  const fillAddressFrom = useCallback(async (point: { latitude: number; longitude: number }) => {
    try {
      const [place] = await Location.reverseGeocodeAsync(point);
      if (!place) return;
      const label = [place.street, place.name, place.district, place.city]
        .filter(Boolean)
        .filter((value, index, all) => all.indexOf(value) === index)   // geocoders repeat themselves
        .join(', ')
        .slice(0, 120);
      if (label) setAddress(label);
    } catch { /* leave whatever is there */ }
  }, []);

  // One foreground fix, then we stop. Pre-filling the pin removes the most common reason a citizen
  // abandons the form, but it is always adjustable below.
  //
  // No Elbasan-center fallback on failure: reporting is gated on proving you're inside the municipality
  // right now, so a permission denial, a failed fix, or a fix that lands outside Bashkia Elbasan all
  // have to block submission rather than quietly hand back a pin nobody actually stood near.
  const fetchLocation = useCallback(async () => {
    setLocationStatus('pending');
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { setLocationStatus('denied'); return; }

      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const fix = { latitude: position.coords.latitude, longitude: position.coords.longitude };

      if (!isInsideElbasan(fix.latitude, fix.longitude)) { setLocationStatus('outside'); return; }

      setDeviceCoords(fix);
      setCoords(fix);
      setLocationStatus('ready');
      await fillAddressFrom(fix);
    } catch {
      setLocationStatus('unavailable');
    }
  }, [fillAddressFrom]);

  useEffect(() => {
    if (settled) void fetchLocation();
    // Deliberately only on the transition settling — fetchLocation itself is re-created whenever
    // fillAddressFrom's identity changes, and re-running the GPS fix on that would fight the citizen's
    // own retry button below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled]);

  const pickPhoto = useCallback(async (fromCamera: boolean) => {
    const permission = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      notify({
        tone: 'warning',
        title: tr('reportNew.permissionNeededTitle'),
        message: fromCamera ? tr('reportNew.cameraPermission') : tr('reportNew.galleryPermission'),
      });
      return;
    }

    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      quality: 0.65,          // a report photo does not need to be 8 MB over mobile data
      allowsEditing: false,
    };

    const picked = fromCamera
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);

    if (!picked.canceled && picked.assets[0]) setPhotoUri(picked.assets[0].uri);
  }, [notify]);

  const submit = useCallback(async () => {
    if (description.trim().length < 10) {
      notify({
        tone: 'warning',
        title: tr('reportNew.descriptionTooShortTitle'),
        message: tr('reportNew.descriptionTooShortMessage'),
      });
      return;
    }

    setSubmitting(true);
    try {
      // Upload first so a failed photo never costs the citizen their typed description.
      let photoUrls: string[] = [];
      if (photoUri) {
        try {
          const uploaded = await api.uploadPhoto(photoUri);
          photoUrls = [uploaded.url];
        } catch {
          notify({
            tone: 'warning',
            title: tr('reportNew.photoFailedTitle'),
            message: tr('reportNew.photoFailedMessage'),
          });
        }
      }

      const response = await api.createReport({
        description: description.trim(),
        latitude: coords.latitude,
        longitude: coords.longitude,
        deviceLatitude: deviceCoords.latitude,
        deviceLongitude: deviceCoords.longitude,
        addressText: address.trim() || undefined,
        photoUrls,
        categoryCodeHint: categoryHint ?? undefined,
      });

      setResult(response);
      setStep(response.duplicateCandidates.length > 0 ? 'duplicates' : 'done');
    } catch (err) {
      notify({
        tone: 'error',
        title: tr('reportNew.submitFailedTitle'),
        message: err instanceof Error ? err.message : tr('common.retry'),
      });
    } finally {
      setSubmitting(false);
    }
  }, [description, address, photoUri, coords, deviceCoords, categoryHint, notify, tr]);

  const mergeInto = useCallback(async (candidate: DuplicateCandidate) => {
    if (!result) return;
    setSubmitting(true);
    try {
      const parent = await api.confirmDuplicate(result.report.id, candidate.reportId);
      router.replace(`/report/${parent.id}`);
    } catch (err) {
      notify({
        tone: 'error',
        title: tr('reportNew.mergeFailedTitle'),
        message: err instanceof Error ? err.message : tr('common.retry'),
      });
      setSubmitting(false);
    }
  }, [result, router, notify, tr]);

  /* ── Duplicate offer ──────────────────────────────────────────────────── */
  if (step === 'duplicates' && result) {
    return (
      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.lg }}
      >
        <View style={{ gap: space.sm }}>
          <Title>{tr('reportNew.duplicateTitle')}</Title>
          <Body muted>
            {result.duplicateCandidates.length === 1 ? tr('reportNew.duplicateBodyOne') : tr('reportNew.duplicateBodyMany', { count: result.duplicateCandidates.length })}
            {tr('reportNew.duplicateBodyTail')}
          </Body>
        </View>

        {result.duplicateCandidates.map(candidate => (
          <Card key={candidate.candidateId} style={{ gap: space.md }}>
            <View style={{ flexDirection: 'row', gap: space.md }}>
              {candidate.thumbnailUrl && (
                <Image
                  source={{ uri: mediaUrl(candidate.thumbnailUrl) }}
                  style={{ width: 68, height: 68, borderRadius: radius.sm }}
                  accessibilityIgnoresInvertColors
                />
              )}
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={[type.caption, { color: t.ink3 }]}>{candidate.publicRef}</Text>
                <Text style={[type.bodyStrong, { color: t.ink }]} numberOfLines={2}>{reportTitle(candidate, locale)}</Text>
                <StatusPill status={candidate.status} small />
              </View>
            </View>

            {/* The score is shown in plain language, not as a black-box percentage. */}
            <View
              style={{
                backgroundColor: t.surface2, borderRadius: radius.sm,
                padding: space.md, gap: 2,
              }}
            >
              <Caption>
                {tr('reportNew.matchDistance', { distance: Math.round(candidate.distanceMeters), score: Math.round(candidate.score * 100) })}
              </Caption>
              <Caption>{tr('reportNew.matchReported', { relative: formatRelative(candidate.createdAt, tr) })}
                {candidate.confirmationCount > 1 && tr('reportNew.matchConfirmations', { count: candidate.confirmationCount })}
              </Caption>
            </View>

            <Button
              title={tr('reportNew.sameProblem')}
              onPress={() => mergeInto(candidate)}
              loading={submitting}
              accessibilityHint={tr('reportNew.sameProblemHint')}
            />
          </Card>
        ))}

        <Button
          title={tr('reportNew.differentProblem')}
          variant="secondary"
          onPress={() => setStep('done')}
          accessibilityHint={tr('reportNew.differentProblemHint')}
        />
        <Caption style={{ textAlign: 'center' }}>
          {tr('reportNew.savedRegardless')}
        </Caption>
      </ScrollView>
    );
  }

  /* ── Success ──────────────────────────────────────────────────────────── */
  if (step === 'done' && result) {
    const { report, classification } = result;
    return (
      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.lg }}
      >
        <View style={{ alignItems: 'center', gap: space.sm, paddingTop: space.lg }}>
          <View
            style={{
              width: 64, height: 64, borderRadius: 32,
              backgroundColor: `${t.success}1F`, alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 30 }}>✓</Text>
          </View>
          <Title style={{ textAlign: 'center' }}>{tr('reportNew.sentTitle')}</Title>
          <Text style={[type.body, { color: t.ink2, textAlign: 'center' }]}>
            {tr('reportNew.sentBody')}{' '}
            <Text style={{ fontWeight: '700', color: t.ink }}>{report.publicRef}</Text>{tr('reportNew.sentBodyTail')}
          </Text>
        </View>

        <AiVerdict
          categoryNameSq={classification.categoryNameSq}
          categoryNameEn={classification.categoryNameEn}
          confidence={classification.confidence}
          source={classification.source}
          isLowConfidence={classification.isLowConfidence}
          reasoning={aiReasoning(classification, locale)}
        />

        {report.department && (
          <Card style={{ gap: space.xs }}>
            <Label>{tr('reportNew.routedTo')}</Label>
            <Heading>{report.department.name}</Heading>
            <Caption>{tr('reportNew.slaTarget', { hours: report.department.slaHours })}</Caption>
          </Card>
        )}

        <View style={{ gap: space.sm }}>
          <Button title={tr('reportNew.viewMyReport')} onPress={() => router.replace(`/report/${report.id}`)} />
          <Button title={tr('reportNew.close')} variant="secondary" onPress={() => router.replace('/(tabs)')} />
        </View>
      </ScrollView>
    );
  }

  /* ── Compose ──────────────────────────────────────────────────────────── */
  const pinInside = locationStatus === 'ready' && isInsideElbasan(coords.latitude, coords.longitude);
  const canSubmit = description.trim().length >= 10 && locationStatus === 'ready' && pinInside && !submitting;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
    >
      <ScrollView
        scrollEnabled={mapScrollLock.scrollEnabled}
        contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxl, gap: space.xl }}
        keyboardShouldPersistTaps="handled"
      >
        {/* 1 — Photo */}
        <View style={{ gap: space.sm }}>
          <Label>{tr('reportNew.stepPhoto')}</Label>
          {photoUri ? (
            <View style={{ gap: space.sm }}>
              <Image
                source={{ uri: photoUri }}
                style={{ width: '100%', height: 210, borderRadius: radius.md, backgroundColor: t.surface3 }}
                accessibilityLabel={tr('reportNew.photoSelectedA11y')}
                accessibilityIgnoresInvertColors
              />
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                <Button title={tr('reportNew.change')} variant="secondary" onPress={() => pickPhoto(true)} style={{ flex: 1 }} />
                <Button title={tr('reportNew.remove')} variant="ghost" onPress={() => setPhotoUri(null)} style={{ flex: 1 }} />
              </View>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button
                title={tr('reportNew.takePhoto')}
                icon={<Text style={{ fontSize: 16, color: '#fff' }}>◉</Text>}
                onPress={() => pickPhoto(true)}
                style={{ flex: 1 }}
              />
              <Button title={tr('reportNew.fromGallery')} variant="secondary" onPress={() => pickPhoto(false)} style={{ flex: 1 }} />
            </View>
          )}
        </View>

        {/* 2 — Description */}
        <View style={{ gap: space.sm }}>
          <Label>{tr('reportNew.stepDescription')}</Label>
          <TextInput
            value={description}
            onChangeText={setDescription}
            multiline
            textAlignVertical="top"
            placeholder={tr('reportNew.descriptionPlaceholder')}
            placeholderTextColor={t.ink3}
            accessibilityLabel={tr('reportNew.descriptionA11y')}
            style={{
              minHeight: 116,
              backgroundColor: t.surface,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: t.borderStrong,
              padding: space.md,
              color: t.ink,
              ...type.body,
            }}
          />
          <Caption>
            {description.trim().length < 10 ? tr('reportNew.descriptionHintShort') : tr('reportNew.descriptionHintOk')}
          </Caption>
        </View>

        {/* Optional hint — advisory, never required. */}
        {categories.length > 0 && (
          <View style={{ gap: space.sm }}>
            <Label>{tr('reportNew.stepCategory')}</Label>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {categories.map(category => {
                const active = categoryHint === category.code;
                return (
                  <Pressable
                    key={category.id}
                    onPress={() => setCategoryHint(c => (c === category.code ? null : category.code))}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={categoryName(category, locale)}
                    style={({ pressed }) => ({
                      flexDirection: 'row', alignItems: 'center', gap: 6,
                      minHeight: 38, paddingHorizontal: space.md,
                      borderRadius: radius.pill,
                      backgroundColor: active ? `${category.colorHex}22` : t.surface,
                      borderWidth: 1,
                      borderColor: active ? category.colorHex : t.border,
                      opacity: pressed ? 0.85 : 1,
                    })}
                  >
                    <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: category.colorHex }} />
                    <Text style={[type.label, { color: active ? t.ink : t.ink2 }]}>{categoryName(category, locale)}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        {/* 3 — Location. Gated on proving you're inside Bashkia Elbasan right now — reporting from
            outside the municipality is blocked outright, with no default pin to fall back on. */}
        <View style={{ gap: space.sm }}>
          <Label>{tr('reportNew.stepLocation')}</Label>

          {locationStatus === 'pending' && (
            <Card style={{ alignItems: 'center', gap: space.sm, paddingVertical: space.xl }}>
              <Caption>{tr('reportNew.locating')}</Caption>
            </Card>
          )}

          {(locationStatus === 'denied' || locationStatus === 'outside' || locationStatus === 'unavailable') && (
            <Card style={{ gap: space.sm }}>
              <Heading>
                {locationStatus === 'denied' && tr('reportNew.locationDeniedTitle')}
                {locationStatus === 'outside' && tr('reportNew.locationOutsideTitle')}
                {locationStatus === 'unavailable' && tr('reportNew.locationUnavailableTitle')}
              </Heading>
              <Body muted>
                {locationStatus === 'denied' && tr('reportNew.locationDeniedMessage')}
                {locationStatus === 'outside' && tr('reportNew.locationOutsideMessage')}
                {locationStatus === 'unavailable' && tr('reportNew.locationUnavailableMessage')}
              </Body>
              <Button title={tr('reportNew.retryLocation')} variant="secondary" onPress={() => void fetchLocation()} />
            </Card>
          )}

          {locationStatus === 'ready' && (
            <>
              <ScrollLockingMapBox
                onTouchActiveChange={mapScrollLock.onTouchActiveChange}
                style={{ borderRadius: radius.md, overflow: 'hidden', borderWidth: 1, borderColor: t.border }}
              >
                <LeafletMap
                  height={280}
                  zoom={17}
                  showZoomControls
                  center={{ lat: coords.latitude, lng: coords.longitude }}
                  // The pin is intentionally free to drag anywhere on the map — only the device fix
                  // above proved presence inside the municipality. A citizen who found a problem and
                  // had to rush off submits later from wherever they ended up, dragging the pin back
                  // to the spot; capping the drag distance from the fix would break exactly that.
                  pin={{ lat: coords.latitude, lng: coords.longitude, color: pinInside ? t.brand2 : t.danger }}
                  onPinMove={next => {
                    const moved = { latitude: next.lat, longitude: next.lng };
                    setCoords(moved);
                    if (!addressEdited) void fillAddressFrom(moved);
                  }}
                />
              </ScrollLockingMapBox>
              <Caption style={!pinInside ? { color: t.danger } : undefined}>
                {!pinInside
                  ? tr('reportNew.pinOutsideWarning')
                  : addressEdited
                    ? tr('reportNew.addressEditedHint')
                    : tr('reportNew.addressAutoHint')}
              </Caption>
            </>
          )}

          <TextInput
            value={address}
            onChangeText={text => { setAddress(text); setAddressEdited(true); }}
            placeholder={tr('reportNew.addressPlaceholder')}
            placeholderTextColor={t.ink3}
            accessibilityLabel={tr('reportNew.addressA11y')}
            style={{
              minHeight: MIN_TARGET,
              backgroundColor: t.surface,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: t.borderStrong,
              paddingHorizontal: space.md,
              color: t.ink,
              ...type.body,
            }}
          />
        </View>
      </ScrollView>

      {/* Submit is pinned to the bottom rather than at the end of the scroll — it must be reachable
          the moment the form is valid, without hunting for it. */}
      <View
        style={{
          padding: space.lg,
          paddingBottom: insets.bottom + space.md,
          backgroundColor: t.surface,
          borderTopWidth: 1,
          borderTopColor: t.border,
        }}
      >
        <Button
          title={tr('reportNew.submit')}
          onPress={submit}
          disabled={!canSubmit}
          loading={submitting}
          accessibilityHint={tr('reportNew.submitHint')}
          style={{ minHeight: MIN_TARGET + 6 }}
        />
      </View>
    </KeyboardAvoidingView>
  );
}
