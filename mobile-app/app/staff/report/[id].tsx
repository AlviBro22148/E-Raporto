import { useCallback, useEffect, useState } from 'react';
import {
  Image, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Text, TextInput, View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRealtimeSubscription } from '../../../src/RealtimeContext';
import {
  api, mediaUrl, type Category, type ReportDetail, type ReportStatus,
} from '../../../src/api';
import { useFeedback } from '../../../src/components/Feedback';
import { LeafletMap } from '../../../src/components/LeafletMap';
import {
  Body, Button, Caption, Card, CategoryPill, ErrorState, Heading, Label, Loading, StatusPill,
  Title, formatDateTime, formatRelative,
} from '../../../src/components/ui';
import { aiReasoning, categoryName, reportDescription, reportTitle, useLocale, useT } from '../../../src/i18n';
import { historyEntryKind, MIN_TARGET, radius, space, statusColor, type, useTheme } from '../../../src/theme';

export default function StaffReportDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const t = useTheme();
  const tr = useT();
  const locale = useLocale();
  const insets = useSafeAreaInsets();
  const { notify } = useFeedback();

  const [data, setData] = useState<ReportDetail | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const [detail, cats] = await Promise.all([api.staffReport(id), api.categories()]);
      setData(detail);
      setCategories(cats);
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('staffReportDetail.notFound'));
    } finally {
      setLoading(false);
    }
  }, [id, tr]);

  useEffect(() => { void load(); }, [load]);

  // Same case, two clerks: this is what stops one of them acting on a status the other already changed.
  useRealtimeSubscription({ entity: 'report', id }, () => { void load(); });

  async function changeStatus(status: ReportStatus) {
    if (!id) return;
    setBusy(true);
    try {
      await api.staffChangeStatus(id, status, note.trim() || undefined);
      setNote('');
      await load();
    } catch (err) {
      notify({
        tone: 'error',
        title: tr('staffReportDetail.statusChangeFailedTitle'),
        message: err instanceof Error ? err.message : tr('common.retry'),
      });
    } finally {
      setBusy(false);
    }
  }

  /**
   * Downloads the dossier, then hands it straight to the OS share sheet — from there the clerk can
   * save it to Files, open it in Word, or email it. A .docx sitting in the app's cache directory with
   * no way to reach anything else would be useless on a phone.
   */
  async function downloadDossier() {
    if (!id || !data) return;
    setDownloading(true);
    try {
      const uri = await api.downloadDossier(id, data.report.publicRef);

      if (!(await Sharing.isAvailableAsync())) {
        notify({
          tone: 'warning',
          title: tr('staffReportDetail.dossierReadyTitle'),
          message: tr('staffReportDetail.dossierNoSharingMessage'),
        });
        return;
      }

      await Sharing.shareAsync(uri, {
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        dialogTitle: tr('staffReportDetail.dossierShareTitle', { ref: data.report.publicRef }),
        UTI: 'org.openxmlformats.wordprocessingml.document',
      });
    } catch (err) {
      notify({
        tone: 'error',
        title: tr('staffReportDetail.dossierFailedTitle'),
        message: err instanceof Error ? err.message : tr('common.retry'),
      });
    } finally {
      setDownloading(false);
    }
  }

  async function overrideCategory(categoryId: string) {
    if (!id) return;
    setBusy(true);
    try {
      await api.staffOverrideCategory(id, categoryId);
      await load();
    } catch (err) {
      notify({
        tone: 'error',
        title: tr('staffReportDetail.statusChangeFailedTitle'),
        message: err instanceof Error ? err.message : tr('common.retry'),
      });
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loading />;
  if (error || !data) {
    return <ErrorState message={error ?? tr('staffReportDetail.notFound')} onRetry={() => { setLoading(true); void load(); }} />;
  }

  const { report, statusHistory, allowedNextStatuses, pattern } = data;
  const ai = report.ai;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView
      contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.lg }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ gap: space.sm }}>
        <Text style={[type.caption, { color: t.ink3, fontVariant: ['tabular-nums'] }]}>{report.publicRef}</Text>
        <Title>{reportTitle(report, locale)}</Title>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          <StatusPill status={report.status} confirmed={report.verification?.outcome === 'Confirmed'} />
          {report.category && <CategoryPill name={categoryName(report.category, locale)} color={report.category.colorHex} />}
          {report.isSlaBreached && (
            <View style={{
              paddingVertical: 4, paddingHorizontal: 10, borderRadius: radius.pill,
              backgroundColor: `${t.danger}1A`, borderWidth: 1, borderColor: `${t.danger}55`,
            }}>
              <Text style={[type.label, { color: t.danger }]}>{tr('staffReportDetail.slaBreached')}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Reporter — deliberately nothing identifying. Staff used to see a name, an email and a phone
          number here; they now see only that an account stands behind the report. The handle itself is
          shown on one screen in the whole app (duplicate review) and not on this one, because nothing
          a clerk does from here is a decision about *who* filed it. */}
      <Card style={{ gap: space.xs }}>
        <Label>{tr('staffReportDetail.reporter')}</Label>
        <Body>{tr('staffReportDetail.reporterRegistered')}</Body>
        <Caption>{tr('staffReportDetail.confirmationsFromOthers', { count: report.confirmationCount })}</Caption>
        <Caption style={{ color: t.ink3 }}>
          {tr('staffReportDetail.pseudonymousNote')}
        </Caption>
      </Card>

      {report.photos.length > 0 && (
        <Image
          source={{ uri: mediaUrl(report.photos[0].url) }}
          style={{ width: '100%', height: 220, borderRadius: radius.md, backgroundColor: t.surface3 }}
          accessibilityLabel={tr('staffReportDetail.reportedPhotoA11y')}
          accessibilityIgnoresInvertColors
        />
      )}

      <Card style={{ gap: space.sm }}>
        <Label>{tr('staffReportDetail.description')}</Label>
        <Body>{reportDescription(report, locale)}</Body>
        {report.addressText && <Caption>📍 {report.addressText}</Caption>}
      </Card>

      <View style={{ gap: space.sm }}>
        <View style={{ borderRadius: radius.md, overflow: 'hidden', borderWidth: 1, borderColor: t.border }}>
          <LeafletMap
            height={200}
            zoom={17}
            showZoomControls
            center={{ lat: report.latitude, lng: report.longitude }}
            markers={[{
              id: report.id, lat: report.latitude, lng: report.longitude,
              color: report.category?.colorHex ?? t.brand2, size: 24, label: report.publicRef,
            }]}
          />
        </View>
        <Button
          title={tr('staffReportDetail.openInGoogleMaps')}
          variant="secondary"
          onPress={() => {
            const web = `https://www.google.com/maps/search/?api=1&query=${report.latitude},${report.longitude}`;
            const native = Platform.select({
              android: `geo:${report.latitude},${report.longitude}?q=${report.latitude},${report.longitude}`,
              ios: `comgooglemaps://?q=${report.latitude},${report.longitude}`,
              default: web,
            })!;
            Linking.canOpenURL(native)
              .then(ok => Linking.openURL(ok ? native : web))
              .catch(() => Linking.openURL(web));
          }}
        />
      </View>

      {/* The AI panel: what it said, how sure, which engine — and the override right beside it. */}
      <Card style={{ gap: space.sm }}>
        <Label>{tr('staffReportDetail.aiEvaluation')}</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          <Caption>{ai.source === 'Llm' ? tr('staffReportDetail.aiWithAi') : ai.source === 'Manual' ? tr('staffReportDetail.aiManual') : tr('staffReportDetail.aiRuleBased')}</Caption>
          {ai.model && <Caption>· {ai.model}</Caption>}
        </View>

        {ai.confidence != null && (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: t.surface3, overflow: 'hidden' }}>
                <View style={{
                  width: `${Math.round(ai.confidence * 100)}%`, height: '100%',
                  backgroundColor: ai.isLowConfidence ? t.warning : ai.confidence < 0.85 ? t.brand2 : t.success,
                }} />
              </View>
              <Text style={[type.bodyStrong, { color: t.ink }]}>{Math.round(ai.confidence * 100)}%</Text>
            </View>
            {ai.isLowConfidence && (
              <Caption style={{ color: t.warning }}>
                {tr('staffReportDetail.aiBelowThreshold')}
              </Caption>
            )}
          </>
        )}

        {ai.reasoning && <Body muted>{aiReasoning(ai, locale)}</Body>}
        {ai.isOverridden && <Caption>{tr('staffReportDetail.aiOverridden')}</Caption>}

        <Label>{tr('staffReportDetail.correctCategory')}</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {categories.map(c => {
            const active = report.category?.id === c.id;
            return (
              <Pressable
                key={c.id}
                disabled={busy || active}
                onPress={() => overrideCategory(c.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={({ pressed }) => ({
                  flexDirection: 'row', alignItems: 'center', gap: 6,
                  minHeight: 38, paddingHorizontal: space.md, borderRadius: radius.pill,
                  backgroundColor: active ? `${c.colorHex}22` : t.surface2,
                  borderWidth: 1, borderColor: active ? c.colorHex : t.border,
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: c.colorHex }} />
                <Text style={[type.label, { color: active ? t.ink : t.ink2 }]}>{categoryName(c, locale)}</Text>
              </Pressable>
            );
          })}
        </View>
      </Card>

      {/* The root-cause counterpart to duplicate detection: a duplicate says "same physical problem",
          this says "different problems that may share a cause or point at a wider condition". Nothing
          here changes this report — acting on the pattern itself happens on its own tab. */}
      {pattern && (
        <Card style={{ gap: space.sm }}>
          <Label>{tr('staffReportDetail.patternTitle')}</Label>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            <Caption>
              {pattern.connectionType ? tr(`connection.${pattern.connectionType}`) : tr('staffReportDetail.patternNoSynthesis')}
            </Caption>
            <Caption>{tr('staffReportDetail.patternMembers', { count: pattern.memberCount })}</Caption>
            {pattern.confidence != null && <Caption>{tr('staffReportDetail.patternConfidence', { pct: Math.round(pattern.confidence * 100) })}</Caption>}
          </View>
          {pattern.summarySq && <Body muted>{pattern.summarySq}</Body>}
          <Button
            title={tr('staffReportDetail.reviewInPatterns')}
            variant="secondary"
            onPress={() => router.push('/(staff)/patterns')}
          />
        </Card>
      )}

      {/* A closed case is also a record that has to leave the system — printed, archived, or attached
          to a work order. It leads the actions once the case is resolved. */}
      {report.status === 'Resolved' && (
        <Card style={{ gap: space.sm }}>
          <Label>{tr('staffReportDetail.dossierTitle')}</Label>
          <Body muted>
            {tr('staffReportDetail.dossierBody')}
          </Body>
          <Button
            title={downloading ? tr('staffReportDetail.dossierGenerating') : tr('staffReportDetail.dossierDownload')}
            onPress={downloadDossier}
            loading={downloading}
            disabled={downloading}
            accessibilityHint={tr('staffReportDetail.dossierDownloadHint')}
            style={{ minHeight: MIN_TARGET }}
          />
        </Card>
      )}

      {/* A closed case gets one action, not the full status panel — and it is named for what it does.
          Rendered from the generic status list it would read the "Assigned" label, which tells a clerk
          nothing about the fact that they are reopening a finished case. */}
      <Card style={{ gap: space.md }}>
        <Label>{report.status === 'Resolved' ? tr('staffReportDetail.reopenCase') : tr('staffReportDetail.changeStatus')}</Label>

        {report.status === 'Resolved' && (
          <Body muted>
            {tr('staffReportDetail.reopenBody')}
          </Body>
        )}

        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder={report.status === 'Resolved' ? tr('staffReportDetail.reopenNotePlaceholder') : tr('staffReportDetail.changeNotePlaceholder')}
          placeholderTextColor={t.ink3}
          multiline
          textAlignVertical="top"
          accessibilityLabel={report.status === 'Resolved' ? tr('staffReportDetail.reopenNoteA11y') : tr('staffReportDetail.changeNoteA11y')}
          style={{
            minHeight: 80, backgroundColor: t.surface2, borderRadius: radius.md,
            borderWidth: 1, borderColor: t.borderStrong, padding: space.md, color: t.ink, ...type.body,
          }}
        />
        {allowedNextStatuses.length === 0 ? (
          <Caption>{tr('staffReportDetail.finalState')}</Caption>
        ) : report.status === 'Resolved' ? (
          <Button
            title={tr('staffReportDetail.reopenButton')}
            variant="secondary"
            onPress={() => changeStatus('Assigned')}
            disabled={busy || !allowedNextStatuses.includes('Assigned')}
            accessibilityHint={tr('staffReportDetail.reopenButtonHint')}
            style={{ minHeight: MIN_TARGET }}
          />
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {allowedNextStatuses.map(s => (
              <Button
                key={s}
                title={tr(`status.${s}`) || s}
                variant="secondary"
                onPress={() => changeStatus(s)}
                disabled={busy}
                style={{ minHeight: MIN_TARGET }}
              />
            ))}
          </View>
        )}
      </Card>

      <Card style={{ gap: space.md }}>
        <Label>{tr('staffReportDetail.history')}</Label>
        {statusHistory.map((entry, index) => {
          const kind = historyEntryKind(entry);
          const dotColor = kind === 'confirmed' ? t.success : kind === 'disputed' ? t.danger : (statusColor[entry.toStatus] ?? t.ink3);
          return (
          <View key={entry.id} style={{ flexDirection: 'row', gap: space.md }}>
            <View style={{ alignItems: 'center' }}>
              <View style={{
                width: 10, height: 10, borderRadius: 5, marginTop: 5,
                backgroundColor: dotColor,
              }} />
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

      <Caption style={{ textAlign: 'center' }}>{tr('staffReportDetail.created', { relative: formatRelative(report.createdAt, tr) })}</Caption>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
