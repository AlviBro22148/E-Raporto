import { useCallback, useEffect, useState } from 'react';
import { Image, Linking, Platform, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRealtimeSubscription } from '../../src/RealtimeContext';
import { api, mediaUrl, type ReportDetail } from '../../src/api';
import { useAuth } from '../../src/AuthContext';
import { useFeedback } from '../../src/components/Feedback';
import { LeafletMap } from '../../src/components/LeafletMap';
import { ScrollLockingMapBox, useMapScrollLock } from '../../src/components/ScrollLockingMapBox';
import {
  Body, Button, Caption, Card, CategoryPill, ErrorState, Heading, Label, Loading, StatusPill,
  Title, formatDateTime, formatRelative,
} from '../../src/components/ui';
import { categoryName, patternNote, reportDescription, reportTitle, useLocale, useT } from '../../src/i18n';
import { historyEntryKind, radius, space, statusColor, type, useTheme } from '../../src/theme';

/**
 * Opens the report's coordinates in the device's native maps app.
 *
 * `geo:` on Android hands off to whatever the user has set as their maps app (usually Google Maps);
 * iOS has no `geo:` handler, so it gets the Google Maps universal link, which opens the installed
 * app if present and the web map otherwise. The https URL is also the fallback if either scheme is
 * unsupported — the button must never silently do nothing.
 */
async function openInMaps(lat: number, lng: number, label: string, onFailure: () => void) {
  const web = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  const native = Platform.select({
    android: `geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(label)})`,
    ios: `comgooglemaps://?q=${lat},${lng}&center=${lat},${lng}&zoom=17`,
    default: web,
  })!;

  try {
    if (await Linking.canOpenURL(native)) { await Linking.openURL(native); return; }
  } catch { /* fall through to the web map */ }

  try {
    await Linking.openURL(web);
  } catch {
    // Reported through a callback rather than raised here: this helper sits outside the component,
    // where the feedback hook isn't available.
    onFailure();
  }
}

export default function ReportDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const tr = useT();
  const locale = useLocale();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { citizen } = useAuth();
  const { notify } = useFeedback();

  const [data, setData] = useState<ReportDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const mapScrollLock = useMapScrollLock();

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      setData(await api.report(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('reportDetail.notFound'));
    } finally {
      setLoading(false);
    }
  }, [id, tr]);

  useEffect(() => { void load(); }, [load]);

  // Filtered by id: this screen shows one case, and refetching it because an unrelated report moved
  // would be a request per change across the whole municipality.
  useRealtimeSubscription({ entity: 'report', id }, () => { void load(); });

  const confirm = useCallback(async () => {
    if (!id) return;
    setConfirming(true);
    try {
      await api.confirm(id);
      await load();
      notify({
        tone: 'success',
        title: tr('reportDetail.confirmedThanksTitle'),
        message: tr('reportDetail.confirmedThanksMessage'),
      });
    } catch (err) {
      // The API refuses a second confirmation and confirming your own report — surface its wording
      // rather than a generic failure, then refresh so the button reflects the true state.
      notify({
        tone: 'error',
        title: tr('reportDetail.confirmFailedTitle'),
        message: err instanceof Error ? err.message : tr('common.retry'),
      });
      await load();
    } finally {
      setConfirming(false);
    }
  }, [id, load, notify, tr]);

  if (loading) return <Loading />;
  if (error || !data) {
    return <ErrorState message={error ?? tr('reportDetail.notFound')} onRetry={() => { setLoading(true); void load(); }} />;
  }

  const { report, statusHistory } = data;
  const isOpen = report.status !== 'Merged' && report.status !== 'Resolved' && report.status !== 'Rejected';
  const canConfirm = Boolean(citizen) && !report.isMine && isOpen && !report.hasConfirmed;

  return (
    <ScrollView
      scrollEnabled={mapScrollLock.scrollEnabled}
      contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.lg }}
    >
      <View style={{ gap: space.sm }}>
        <Text style={[type.caption, { color: t.ink3, fontVariant: ['tabular-nums'] }]}>
          {report.publicRef}
        </Text>
        <Title>{reportTitle(report, locale)}</Title>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          <StatusPill status={report.status} confirmed={report.verification?.outcome === 'Confirmed'} />
          {report.category && (
            <CategoryPill name={categoryName(report.category, locale)} color={report.category.colorHex} />
          )}
        </View>
        {/* No name, and this is the line that mattered most: the endpoint behind this screen is
            [AllowAnonymous], so what used to sit here — the reporter's full name — was readable by
            anyone at all, with no account, for every report on the map. A neighbour whose illegal
            building was reported could simply look up who reported it. */}
        <Caption>
          {tr('reportDetail.reportedLine', { who: report.isMine ? tr('reportDetail.reportedByMe') : tr('reportDetail.reportedByOther'), relative: formatRelative(report.createdAt, tr) })}
        </Caption>
      </View>

      {report.mergedIntoPublicRef && (
        <Card style={{ backgroundColor: t.surface2, gap: space.sm }}>
          <Body>
            {tr('reportDetail.mergedInto')} <Text style={{ fontWeight: '700' }}>{report.mergedIntoPublicRef}</Text>{tr('reportDetail.mergedIntoTail')}
          </Body>
          <Button
            title={tr('reportDetail.goToMain')}
            variant="secondary"
            onPress={() => router.replace(`/report/${report.mergedIntoReportId}`)}
          />
        </Card>
      )}

      <Card style={{ gap: space.xs, borderLeftWidth: 3, borderLeftColor: statusColor[report.status] }}>
        <Label>{tr('reportDetail.whereNow')}</Label>
        <Body>{tr(`statusHelp.${report.status}`)}</Body>
        {report.department && <Caption>{tr('reportDetail.responsibleDept', { name: report.department.name })}</Caption>}
      </Card>

      {/* Soft and deliberately vague: no connection-type verdict, no sibling report references, no
          confidence number — those stay staff-only. This just tells the citizen their report is being
          looked at as part of something bigger, which is worth knowing without needing to be explained. */}
      {report.patternNote && (
        <Card style={{ gap: space.xs, backgroundColor: t.surface2 }}>
          <Caption>◈ {patternNote(report, locale)}</Caption>
        </Card>
      )}

      {/*
        Verification. Three states, and each says something different about who is speaking:
        an open question addressed to the reporter, a verdict they have already given, or — for anyone
        else reading a resolved case — whether the closure has been checked by the person affected.
      */}
      {report.awaitingMyVerification ? (
        <Card style={{ gap: space.sm, borderLeftWidth: 3, borderLeftColor: t.warning }}>
          <Label>{tr('reportDetail.questionForYou')}</Label>
          <Body>
            {tr('reportDetail.questionBody')}
          </Body>
          <Button
            title={tr('reportDetail.verifyResolution')}
            onPress={() => router.push(`/verify/${report.id}`)}
            accessibilityHint={tr('reportDetail.verifyResolutionHint')}
          />
        </Card>
      ) : report.verification ? (
        <Card
          style={{
            gap: space.sm,
            borderLeftWidth: 3,
            borderLeftColor: report.verification.outcome === 'Confirmed' ? t.success : t.danger,
          }}
        >
          <Label>{tr('reportDetail.citizenVerification')}</Label>
          <Body>
            {report.verification.outcome === 'Confirmed'
              ? `${report.isMine ? tr('reportDetail.confirmedByMe') : tr('reportDetail.confirmedByReporter')}${tr('reportDetail.confirmedTail')}`
              : `${report.isMine ? tr('reportDetail.disputedByMe') : tr('reportDetail.disputedByReporter')}${tr('reportDetail.disputedTail')}`}
          </Body>
          {report.verification.comment && (
            <Body muted>“{report.verification.comment}”</Body>
          )}
          {report.verification.photoUrl && (
            <Image
              source={{ uri: mediaUrl(report.verification.photoUrl) }}
              style={{ width: '100%', height: 190, borderRadius: radius.md, backgroundColor: t.surface3 }}
              accessibilityLabel={tr('reportDetail.verificationPhotoA11y')}
              accessibilityIgnoresInvertColors
            />
          )}
          <Caption>
            {formatRelative(report.verification.createdAt, tr)}
            {report.verification.distanceMeters != null && (
              report.verification.isNearOriginalPin
                ? tr('reportDetail.verifiedNearOriginal', { m: Math.round(report.verification.distanceMeters) })
                : tr('reportDetail.verifiedDistance', { m: Math.round(report.verification.distanceMeters) })
            )}
          </Caption>
        </Card>
      ) : report.status === 'Resolved' ? (
        <Card style={{ gap: space.xs }}>
          <Label>{tr('reportDetail.citizenVerification')}</Label>
          <Caption>
            {tr('reportDetail.resolvedNotYetVerified')}
          </Caption>
        </Card>
      ) : null}

      {report.photos.length > 0 && (
        <Image
          source={{ uri: mediaUrl(report.photos[0].url) }}
          style={{ width: '100%', height: 220, borderRadius: radius.md, backgroundColor: t.surface3 }}
          accessibilityLabel={tr('reportDetail.reportedPhotoA11y')}
          accessibilityIgnoresInvertColors
        />
      )}

      <Card style={{ gap: space.sm }}>
        <Label>{tr('reportDetail.description')}</Label>
        <Body>{reportDescription(report, locale)}</Body>
        {report.addressText && <Caption>📍 {report.addressText}</Caption>}
      </Card>

      {/* Map is interactive: pannable and zoomable, with a handoff to the device's maps app for
          directions — a crew reading this needs to actually navigate there. */}
      <View style={{ gap: space.sm }}>
        <ScrollLockingMapBox
          onTouchActiveChange={mapScrollLock.onTouchActiveChange}
          style={{ borderRadius: radius.md, overflow: 'hidden', borderWidth: 1, borderColor: t.border }}
        >
          <LeafletMap
            height={220}
            zoom={17}
            showZoomControls
            center={{ lat: report.latitude, lng: report.longitude }}
            markers={[{
              id: report.id,
              lat: report.latitude,
              lng: report.longitude,
              color: report.category?.colorHex ?? t.brand2,
              size: 24,
              label: report.publicRef,
            }]}
          />
        </ScrollLockingMapBox>
        <Button
          title={tr('reportDetail.openInGoogleMaps')}
          variant="secondary"
          icon={<Text style={{ fontSize: 15 }}>📍</Text>}
          onPress={() => void openInMaps(report.latitude, report.longitude, reportTitle(report, locale), () => {
            notify({
              tone: 'error',
              title: tr('reportDetail.mapOpenFailedTitle'),
              message: tr('reportDetail.mapOpenFailedMessage'),
            });
          })}
          accessibilityHint={tr('reportDetail.openMapsHint')}
        />
      </View>

      {/*
        Confirmation. The button's state comes from the server (hasConfirmed / isMine), not from
        local optimism — so a user who already confirmed on another device still sees the truth.
      */}
      <Card style={{ gap: space.sm, alignItems: 'center' }}>
        <Heading>{tr('reportDetail.confirmationsCount', { count: report.confirmationCount })}</Heading>

        {report.isMine ? (
          <Caption style={{ textAlign: 'center' }}>
            {tr('reportDetail.ownReportNote')}
          </Caption>
        ) : report.hasConfirmed ? (
          <>
            <Caption style={{ textAlign: 'center', color: t.success }}>
              {tr('reportDetail.alreadyConfirmed')}
            </Caption>
            <Button title={tr('reportDetail.alreadyConfirmedButton')} variant="secondary" onPress={() => {}} disabled
              style={{ alignSelf: 'stretch' }} />
          </>
        ) : !isOpen ? (
          <Caption style={{ textAlign: 'center' }}>
            {tr('reportDetail.closedNoMoreConfirm')}
          </Caption>
        ) : (
          <>
            <Caption style={{ textAlign: 'center' }}>
              {tr('reportDetail.confirmPrompt')}
            </Caption>
            <Button
              title={tr('reportDetail.confirmButton')}
              variant="secondary"
              onPress={confirm}
              loading={confirming}
              disabled={!canConfirm}
              style={{ alignSelf: 'stretch' }}
              accessibilityHint={tr('reportDetail.confirmButtonHint')}
            />
          </>
        )}
      </Card>

      <Card style={{ gap: space.md }}>
        <Label>{tr('reportDetail.history')}</Label>
        {statusHistory.map((entry, index) => {
          const kind = historyEntryKind(entry);
          const dotColor = kind === 'confirmed' ? t.success : kind === 'disputed' ? t.danger : (statusColor[entry.toStatus] ?? t.ink3);
          return (
          <View key={entry.id} style={{ flexDirection: 'row', gap: space.md }}>
            <View style={{ alignItems: 'center' }}>
              <View
                style={{
                  width: 10, height: 10, borderRadius: 5, marginTop: 5,
                  backgroundColor: dotColor,
                }}
              />
              {index < statusHistory.length - 1 && (
                <View style={{ width: 1, flex: 1, minHeight: 26, backgroundColor: t.border }} />
              )}
            </View>
            <View style={{ flex: 1, paddingBottom: space.md, gap: 2 }}>
              <Text style={[type.bodyStrong, { color: t.ink }]}>
                {/* A same-status annotation row (citizen confirmed/disputed) shows what actually
                    happened instead of the misleadingly plain "Resolved". Every real transition
                    keeps its real label. */}
                {kind === 'confirmed' ? tr('status.ResolvedConfirmed')
                  : kind === 'disputed' ? tr('status.ResolvedDisputed')
                  : tr(`status.${entry.toStatus}`) || entry.toStatus}
              </Text>
              {entry.note && (
                <Text style={[type.callout, { color: t.ink2 }]}>
                  {locale === 'en' && entry.noteEn ? entry.noteEn : entry.note}
                </Text>
              )}
              <Caption>{entry.changedByLabel} · {formatDateTime(entry.createdAt, locale)}</Caption>
            </View>
          </View>
          );
        })}
      </Card>

      <Caption style={{ textAlign: 'center' }}>
        {tr('reportDetail.created', { relative: formatRelative(report.createdAt, tr) })}
        {report.resolvedAt && tr('reportDetail.resolvedTail', { relative: formatRelative(report.resolvedAt, tr) })}
      </Caption>
    </ScrollView>
  );
}
