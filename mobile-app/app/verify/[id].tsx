import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, mediaUrl, type PendingVerification, type VerificationOutcome } from '../../src/api';
import { useVerifications } from '../../src/VerificationContext';
import { useFeedback } from '../../src/components/Feedback';
import {
  Body, Button, Caption, Card, Label, Loading, Title, formatRelative,
} from '../../src/components/ui';
import { reportTitle, useLocale, useT } from '../../src/i18n';
import { MIN_TARGET, radius, space, type, useTheme } from '../../src/theme';

/**
 * The one screen in this app where the citizen judges the municipality rather than the other way round.
 *
 * The whole design is built around not flattering the answer. The two verdicts are given identical
 * visual weight — same size, same row, neither pre-selected — because a "yes" that is one tap easier
 * than a "no" produces a verified-resolution rate that means nothing. Evidence is optional for the same
 * reason: requiring a photo to disagree would quietly filter out every citizen with a dead battery, no
 * signal, or a fix they can see from their window, and each of those is a real "no" that would go
 * unrecorded.
 */
export default function VerifyResolutionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const tr = useT();
  const locale = useLocale();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { notify } = useFeedback();
  const { pending, markAnswered, refresh } = useVerifications();

  const [outcome, setOutcome] = useState<VerificationOutcome | null>(null);
  const [comment, setComment] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [item, setItem] = useState<PendingVerification | null>(null);
  const [loading, setLoading] = useState(true);

  const fromQueue = useMemo(() => pending.find(p => p.reportId === id) ?? null, [pending, id]);

  // The queue is the fast path — it is already loaded when the screen is pushed at the citizen. Falling
  // back to a fetch matters for the other entry point: tapping through from the report detail screen,
  // where this device may never have loaded the queue at all.
  useEffect(() => {
    if (fromQueue) { setItem(fromQueue); setLoading(false); return; }
    if (!id) return;

    let cancelled = false;
    (async () => {
      try {
        const detail = await api.report(id);
        if (cancelled) return;
        const { report } = detail;
        setItem({
          reportId: report.id,
          publicRef: report.publicRef,
          title: report.title,
          titleEn: report.titleEn,
          categoryNameSq: report.category?.nameSq,
          categoryColorHex: report.category?.colorHex,
          photoUrl: report.photos[0]?.url,
          latitude: report.latitude,
          longitude: report.longitude,
          addressText: report.addressText,
          departmentShortName: report.department?.shortName,
          resolutionNote: null,
          createdAt: report.createdAt,
          resolvedAt: report.resolvedAt ?? report.updatedAt,
        });
      } catch { /* rendered as the not-found state below */ }
      finally { if (!cancelled) setLoading(false); }
    })();

    return () => { cancelled = true; };
  }, [fromQueue, id]);

  // Location is taken quietly in the background and never gates the answer. It is context for the clerk
  // reading the case file — "this photo was taken 8 m from the pin" — not a condition of being heard.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted' || cancelled) return;
        const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (!cancelled) {
          setCoords({ latitude: position.coords.latitude, longitude: position.coords.longitude });
        }
      } catch { /* no fix; the answer still counts */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const pickPhoto = useCallback(async (fromCamera: boolean) => {
    const permission = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      notify({
        tone: 'warning',
        title: tr('verify.permissionNeededTitle'),
        message: fromCamera ? tr('verify.cameraPermission') : tr('verify.galleryPermission'),
      });
      return;
    }

    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      quality: 0.65,
      allowsEditing: false,
    };

    const picked = fromCamera
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);

    if (!picked.canceled && picked.assets[0]) setPhotoUri(picked.assets[0].uri);
  }, [notify]);

  const submit = useCallback(async () => {
    if (!id || !outcome) return;
    setSubmitting(true);

    try {
      // Uploaded first, exactly as in the report flow: a failed photo must cost the citizen the photo,
      // never the answer they came here to give.
      let photoUrl: string | undefined;
      if (photoUri) {
        try {
          photoUrl = (await api.uploadPhoto(photoUri)).url;
        } catch {
          notify({
            tone: 'warning',
            title: tr('verify.photoFailedTitle'),
            message: tr('verify.photoFailedMessage'),
          });
        }
      }

      await api.verifyResolution(id, {
        outcome,
        comment: comment.trim() || undefined,
        photoUrl,
        latitude: coords?.latitude,
        longitude: coords?.longitude,
      });

      markAnswered(id);
      notify({
        tone: outcome === 'Confirmed' ? 'success' : 'info',
        title: outcome === 'Confirmed' ? tr('verify.confirmedThanksTitle') : tr('verify.savedTitle'),
        message: outcome === 'Confirmed' ? tr('verify.confirmedMessage') : tr('verify.disputedMessage'),
      });

      router.replace(`/report/${id}`);
    } catch (err) {
      notify({
        tone: 'error',
        title: tr('verify.sendFailedTitle'),
        message: err instanceof Error ? err.message : tr('common.retry'),
      });
      // The server may have refused because the case moved on (reopened, merged, already answered on
      // another device). Re-reading the queue is what makes the screen agree with reality again.
      void refresh();
    } finally {
      setSubmitting(false);
    }
  }, [id, outcome, comment, photoUri, coords, notify, markAnswered, refresh, router, tr]);

  if (loading) return <Loading label={tr('verify.opening')} />;

  if (!item) {
    return (
      <View style={{ flex: 1, padding: space.lg, justifyContent: 'center', gap: space.md }}>
        <Title style={{ textAlign: 'center' }}>{tr('verify.inactiveTitle')}</Title>
        <Body muted style={{ textAlign: 'center' }}>
          {tr('verify.inactiveBody')}
        </Body>
        <Button title={tr('verify.close')} variant="secondary" onPress={() => router.back()} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
    >
      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxl, gap: space.xl }}
        keyboardShouldPersistTaps="handled"
      >
        {/* The claim being checked, stated as a claim and attributed. "Bashkia thotë" rather than
            "u zgjidh": the citizen cannot answer honestly about a fact they have been handed as
            settled. */}
        <View style={{ gap: space.sm }}>
          <Text style={[type.caption, { color: t.ink3, fontVariant: ['tabular-nums'] }]}>
            {item.publicRef}
          </Text>
          <Title>{tr('verify.title')}</Title>
          <Body muted>
            {item.departmentShortName
              ? tr('verify.markedByDept', { dept: item.departmentShortName, relative: formatRelative(item.resolvedAt, tr) })
              : tr('verify.markedByMunicipality', { relative: formatRelative(item.resolvedAt, tr) })}
            {tr('verify.onlyYouCanTell')}
          </Body>
        </View>

        <Card style={{ gap: space.sm }}>
          <Label>{tr('verify.youReported')}</Label>
          <Body>{reportTitle(item, locale)}</Body>
          {item.addressText && <Caption>📍 {item.addressText}</Caption>}
          {item.photoUrl && (
            <Image
              source={{ uri: mediaUrl(item.photoUrl) }}
              style={{
                width: '100%', height: 190, borderRadius: radius.md,
                backgroundColor: t.surface3, marginTop: space.xs,
              }}
              accessibilityLabel={tr('verify.reportedPhotoA11y')}
              accessibilityIgnoresInvertColors
            />
          )}
          {item.resolutionNote && (
            <View style={{
              backgroundColor: t.surface2, borderRadius: radius.sm, padding: space.md, gap: 2,
            }}>
              <Label>{tr('verify.municipalityNote')}</Label>
              <Caption>{item.resolutionNote}</Caption>
            </View>
          )}
        </Card>

        {/* The verdict. Two equal buttons on one row, neither preselected. */}
        <View style={{ gap: space.sm }}>
          <Label>{tr('verify.yourAnswer')}</Label>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <VerdictButton
              label={tr('verify.yesFixed')}
              selected={outcome === 'Confirmed'}
              tint={t.success}
              onPress={() => setOutcome('Confirmed')}
            />
            <VerdictButton
              label={tr('verify.noStill')}
              selected={outcome === 'Disputed'}
              tint={t.danger}
              onPress={() => setOutcome('Disputed')}
            />
          </View>
          {outcome === 'Disputed' && (
            <Caption>
              {tr('verify.disputeNote')}
            </Caption>
          )}
        </View>

        {/* Evidence appears only once there is a verdict to attach it to: asking for a photo before the
            citizen has said anything is asking them to do work for a question they have not answered. */}
        {outcome && (
          <>
            <View style={{ gap: space.sm }}>
              <Label>{tr('verify.photoOfNow')}</Label>
              {photoUri ? (
                <View style={{ gap: space.sm }}>
                  <Image
                    source={{ uri: photoUri }}
                    style={{
                      width: '100%', height: 210, borderRadius: radius.md, backgroundColor: t.surface3,
                    }}
                    accessibilityLabel={tr('verify.newPhotoA11y')}
                    accessibilityIgnoresInvertColors
                  />
                  <View style={{ flexDirection: 'row', gap: space.sm }}>
                    <Button title={tr('verify.change')} variant="secondary" onPress={() => pickPhoto(true)} style={{ flex: 1 }} />
                    <Button title={tr('verify.remove')} variant="ghost" onPress={() => setPhotoUri(null)} style={{ flex: 1 }} />
                  </View>
                </View>
              ) : (
                <View style={{ flexDirection: 'row', gap: space.sm }}>
                  <Button
                    title={tr('verify.takeNow')}
                    icon={<Text style={{ fontSize: 16, color: '#fff' }}>◉</Text>}
                    onPress={() => pickPhoto(true)}
                    style={{ flex: 1 }}
                  />
                  <Button title={tr('verify.fromGallery')} variant="secondary" onPress={() => pickPhoto(false)} style={{ flex: 1 }} />
                </View>
              )}
              <Caption>
                {coords ? tr('verify.photoNowHintWithLocation') : tr('verify.photoNowHintNoLocation')}
              </Caption>
            </View>

            <View style={{ gap: space.sm }}>
              <Label>{tr('verify.addSomething')}</Label>
              <TextInput
                value={comment}
                onChangeText={setComment}
                multiline
                textAlignVertical="top"
                placeholder={outcome === 'Confirmed' ? tr('verify.commentPlaceholderConfirmed') : tr('verify.commentPlaceholderDisputed')}
                placeholderTextColor={t.ink3}
                accessibilityLabel={tr('verify.commentA11y')}
                style={{
                  minHeight: 100,
                  backgroundColor: t.surface,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: t.borderStrong,
                  padding: space.md,
                  color: t.ink,
                  ...type.body,
                }}
              />
            </View>
          </>
        )}
      </ScrollView>

      <View
        style={{
          padding: space.lg,
          paddingBottom: insets.bottom + space.md,
          backgroundColor: t.surface,
          borderTopWidth: 1,
          borderTopColor: t.border,
          gap: space.sm,
        }}
      >
        <Button
          title={tr('verify.submit')}
          onPress={submit}
          disabled={!outcome || submitting}
          loading={submitting}
          accessibilityHint={tr('verify.submitHint')}
          style={{ minHeight: MIN_TARGET + 6 }}
        />
        {/* Never "Cancel". The question stays owed and will be asked again next time the app opens —
            saying so is more honest than implying the citizen can decline it away. */}
        <Button title={tr('verify.later')} variant="ghost" onPress={() => router.back()} />
      </View>
    </KeyboardAvoidingView>
  );
}

function VerdictButton({ label, selected, tint, onPress }: {
  label: string; selected: boolean; tint: string; onPress: () => void;
}) {
  const t = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: MIN_TARGET + 16,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: space.sm,
        borderRadius: radius.md,
        backgroundColor: selected ? `${tint}1F` : t.surface,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? tint : t.borderStrong,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Text
        style={[type.bodyStrong, { color: selected ? tint : t.ink, textAlign: 'center' }]}
        numberOfLines={2}
      >
        {label}
      </Text>
    </Pressable>
  );
}
