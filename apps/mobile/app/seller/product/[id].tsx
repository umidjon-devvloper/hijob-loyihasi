/**
 * Seller-side product detail screen.
 *
 * Lists the product's cover/variants/stock + status chip for the latest
 * "dress the mannequin" style-job the seller has submitted. From here the
 * seller can trigger a new dress job for this product by supplying the
 * mannequin + hijab URLs (same contract as the web dashboard).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Screen } from '../../../src/components/Screen';
import { Text } from '../../../src/components/Text';
import { useTheme } from '../../../src/theme/ThemeProvider';
import { api } from '../../../src/api/client';
import { errorMessage, errorTitle } from '../../../src/lib/api-errors';
import { safeBack } from '../../../src/lib/safe-back';

type JobStatus = 'pending' | 'running' | 'done' | 'failed';
interface StyleJob {
  id: string;
  productId: string;
  status: JobStatus;
  mannequinUrl: string;
  hijabUrl: string;
  tyingStyle: string;
  colorHex: string;
  resultUrl: string | null;
  resultVariants: Record<string, string> | null;
  errorMessage: string | null;
  attempts: number;
  createdAt: string;
}

// Must match DEFAULT_SIZES order in services/api/.../mannequin-templates.service.ts
const VARIANT_LABELS: Array<{ key: string; label: string; range: string }> = [
  { key: 'slim-short',   label: "Ozg'in",   range: '150-160 sm' },
  { key: 'slim-mid',     label: "Ozg'in",   range: '161-170 sm' },
  { key: 'slim-tall',    label: "Ozg'in",   range: '171-185 sm' },
  { key: 'medium-short', label: "O'rtacha", range: '150-160 sm' },
  { key: 'medium-mid',   label: "O'rtacha", range: '161-170 sm' },
  { key: 'medium-tall',  label: "O'rtacha", range: '171-185 sm' },
  { key: 'full-short',   label: "To'la",    range: '150-160 sm' },
  { key: 'full-mid',     label: "To'la",    range: '161-170 sm' },
  { key: 'full-tall',    label: "To'la",    range: '171-185 sm' },
];

export default function SellerProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors, theme } = useTheme();

  const productQuery = useQuery({
    queryKey: ['seller-product', id],
    queryFn: async () => (await api.get(`/catalog/products/${id}`)).data,
    enabled: !!id,
  });

  const [job, setJob] = useState<StyleJob | null>(null);
  const [hijabUrl, setHijabUrl] = useState('');
  const [uploadingHijab, setUploadingHijab] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approved, setApproved] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const styledImageUrl = productQuery.data?.styledImageUrl ?? null;
  // "Approved" is really "the product's catalog image already matches this
  // job's result" — meaning the seller has pressed Tasdiqlash before.
  const alreadyApproved =
    !!styledImageUrl && !!job?.resultUrl && styledImageUrl === job.resultUrl;

  const approveStyled = useCallback(async () => {
    if (!id) return;
    try {
      setApproving(true);
      await api.post(`/seller/products/${id}/approve-styled`);
      setApproved(true);
      // Re-fetch the product so the new styledImageUrl / published status
      // appears in-place.
      productQuery.refetch();
    } catch (e: any) {
      Alert.alert('Xato', e?.response?.data?.message ?? e?.message ?? 'Tasdiqlab bo\'lmadi');
    } finally {
      setApproving(false);
    }
  }, [id, productQuery]);

  // Load latest job once and whenever we submit a new one.
  const refreshJob = useCallback(async () => {
    try {
      const { data } = await api.get(`/seller/products/${id}/dress-mannequin`);
      setJob(data);
    } catch {
      // 404 means no job yet — leave null.
    }
  }, [id]);

  useEffect(() => {
    if (id) void refreshJob();
  }, [id, refreshJob]);

  // Poll while job is pending / running, stop when settled.
  useEffect(() => {
    const active = job && (job.status === 'pending' || job.status === 'running');
    if (!active) {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      return;
    }
    if (pollRef.current) return;
    pollRef.current = setInterval(refreshJob, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [job?.status, job?.id, refreshJob]);

  const uploadOne = useCallback(async (uri: string): Promise<string | null> => {
    const name = uri.split('/').pop() || 'img.jpg';
    const ext = name.split('.').pop()?.toLowerCase() ?? 'jpg';
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    const form = new FormData();
    form.append('files', { uri, name, type: mime } as unknown as Blob);
    const { data } = await api.post('/seller/uploads', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60_000,
    });
    const files = (data?.files ?? data) as Array<{ url: string }>;
    return Array.isArray(files) && files[0]?.url ? files[0].url : null;
  }, []);

  const pickAndUploadHijab = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Ruxsat kerak', 'Galereyaga ruxsat bering.');
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
    });
    if (picked.canceled || !picked.assets?.[0]) return;
    setUploadingHijab(true);
    try {
      const url = await uploadOne(picked.assets[0].uri);
      if (url) setHijabUrl(url);
    } catch (e: unknown) {
      Alert.alert('Yuklab bo\'lmadi', (e as Error).message ?? 'xatolik');
    } finally {
      setUploadingHijab(false);
    }
  }, [uploadOne]);

  const submitDressJob = useCallback(async () => {
    if (!hijabUrl) {
      Alert.alert('Hijob rasmi kerak', 'Hijob yoki ro\'mol rasmini yuklang.');
      return;
    }
    setSubmitting(true);
    try {
      // mannequinUrl bo'sh — backend standart manekin'ga tushuradi.
      const { data } = await api.post(`/seller/products/${id}/dress-mannequin`, {
        hijabUrl,
        tyingStyle: 'classical',
        colorHex: '#8A8D5B',
      });
      setJob(data);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: unknown } }; message?: string };
      Alert.alert(errorTitle(), errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }, [id, hijabUrl]);

  if (productQuery.isLoading) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator color={colors.gold} />
        </View>
      </Screen>
    );
  }
  if (productQuery.isError || !productQuery.data) {
    return (
      <Screen>
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={44} color={colors.danger} />
          <Text variant="body" color="ink" style={{ marginTop: 10 }}>
            Mahsulot topilmadi
          </Text>
          <Pressable onPress={() => safeBack()} style={{ marginTop: 16 }}>
            <Text variant="label" color="gold" style={{ fontWeight: '600' }}>
              Orqaga
            </Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  const p = productQuery.data as {
    id: string;
    title: { ru?: string; uz?: string };
    categoryId: string;
    basePriceUsd: number;
    coverUrl: string;
    variants: Array<{ id: string; color: string; colorHex: string; size: string; stock: number }>;
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Pressable onPress={() => safeBack()} hitSlop={12}>
            <Ionicons name="arrow-back" size={24} color={colors.ink} />
          </Pressable>
          <Text variant="titleMedium" color="ink" numberOfLines={1} style={{ flex: 1, marginHorizontal: 12 }}>
            {p.title?.ru ?? p.title?.uz ?? 'Mahsulot'}
          </Text>
          <View style={{ width: 24 }} />
        </View>

        {/* Cover */}
        <Image source={{ uri: p.coverUrl }} style={styles.cover} />

        {/* Meta row */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.rule }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View>
              <Text variant="caption" color="muted">Kategoriya</Text>
              <Text variant="body" color="ink" style={{ fontWeight: '600', marginTop: 2 }}>{p.categoryId}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text variant="caption" color="muted">Narx</Text>
              <Text variant="titleSmall" color="gold" style={{ marginTop: 2 }}>${p.basePriceUsd}</Text>
            </View>
          </View>
        </View>

        {/* Variants */}
        <Text variant="label" color="muted" style={styles.sectionLabel}>
          Variantlar ({p.variants?.length ?? 0})
        </Text>
        {(p.variants ?? []).map((v) => (
          <View key={v.id} style={[styles.variantRow, { backgroundColor: colors.surface, borderColor: colors.rule }]}>
            <View style={[styles.variantSwatch, { backgroundColor: v.colorHex, borderColor: colors.rule }]} />
            <View style={{ flex: 1 }}>
              <Text variant="body" color="ink" style={{ fontWeight: '600' }}>{v.color}</Text>
              <Text variant="caption" color="muted">O'lcham {v.size} · zaxira {v.stock}</Text>
            </View>
          </View>
        ))}

        {/* Dress-mannequin section */}
        <Text variant="label" color="muted" style={styles.sectionLabel}>
          Mannequin'ga kiyintir
        </Text>
        <Text variant="caption" color="muted" style={{ marginBottom: 10 }}>
          Faqat hijob/mahsulot rasmini yuklang. Standart manekinga avtomatik moslanadi va natija katalogga qo'yiladi.
        </Text>

        <View style={{ marginBottom: 8 }}>
          <UploadSlot
            label="Hijob / Mahsulot rasmi"
            url={hijabUrl}
            loading={uploadingHijab}
            onPick={pickAndUploadHijab}
            colors={colors}
          />
        </View>

        <Pressable
          onPress={submitDressJob}
          disabled={!hijabUrl || submitting || job?.status === 'pending' || job?.status === 'running'}
          style={[
            styles.submit,
            {
              backgroundColor:
                hijabUrl && !submitting ? colors.oliveDeep : colors.muted,
              opacity:
                job?.status === 'pending' || job?.status === 'running' ? 0.6 : 1,
            },
          ]}
        >
          {submitting ? (
            <ActivityIndicator color={colors.surface} />
          ) : (
            <Text variant="body" color="surface" style={{ fontWeight: '700' }}>
              Navbatga yuborish
            </Text>
          )}
        </Pressable>

        {job && (
          <View style={[styles.statusCard, { backgroundColor: colors.surface, borderColor: colors.rule }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {(job.status === 'pending' || job.status === 'running') && (
                <ActivityIndicator color={colors.gold} size="small" />
              )}
              {job.status === 'done' && <Ionicons name="checkmark-circle" size={20} color={colors.success} />}
              {job.status === 'failed' && <Ionicons name="alert-circle" size={20} color={colors.danger} />}
              <Text variant="body" color="ink" style={{ fontWeight: '600' }}>
                {job.status === 'pending' ? 'Navbatda…' :
                 job.status === 'running' ? 'Jarayonda…' :
                 job.status === 'done'
                   ? (alreadyApproved || approved
                       ? 'Katalogda · Primerka faol'
                       : '9 variant tayyor — tasdiqlang')
                   : 'Xato'}
              </Text>
            </View>
            {job.errorMessage && (
              <Text variant="caption" color="danger" style={{ marginTop: 6 }}>
                {job.errorMessage}
              </Text>
            )}
            {job.status === 'done' && job.resultVariants && (
              <View style={{ marginTop: 10 }}>
                <Text variant="caption" color="muted" style={{ marginBottom: 8 }}>
                  9 ta variant — har bir tana turi × bo'y uchun
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {VARIANT_LABELS.map((v) => {
                    const url = job.resultVariants?.[v.key];
                    if (!url) return null;
                    return (
                      <View
                        key={v.key}
                        style={{
                          width: '31%',
                          borderWidth: 1,
                          borderColor: colors.rule,
                          borderRadius: 10,
                          backgroundColor: colors.surface,
                          overflow: 'hidden',
                        }}
                      >
                        <Image
                          source={{ uri: url }}
                          style={{ width: '100%', aspectRatio: 3 / 4, backgroundColor: '#1b1b14' }}
                          resizeMode="contain"
                        />
                        <View style={{ padding: 6 }}>
                          <Text variant="caption" style={{ fontSize: 11, fontWeight: '600', color: colors.ink }}>
                            {v.label}
                          </Text>
                          <Text variant="caption" color="muted" style={{ fontSize: 10 }}>
                            {v.range}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}
            {job.status === 'done' && !job.resultVariants && job.resultUrl && (
              <Image source={{ uri: job.resultUrl }} style={styles.resultImage} />
            )}
            {job.status === 'done' && (alreadyApproved || approved) && (
              <View
                style={{
                  marginTop: 12,
                  padding: 10,
                  borderRadius: 10,
                  backgroundColor: `${colors.success}18`,
                  borderWidth: 1,
                  borderColor: `${colors.success}55`,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                <Text variant="body" style={{ color: colors.success, fontWeight: '600', flex: 1 }}>
                  Katalogga qo'yildi · Primerka faol
                </Text>
              </View>
            )}
            {job.status === 'done' && !alreadyApproved && !approved && (
              <Pressable
                onPress={approveStyled}
                disabled={approving}
                style={{
                  marginTop: 12,
                  paddingVertical: 14,
                  borderRadius: 12,
                  backgroundColor: colors.oliveDeep,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  opacity: approving ? 0.7 : 1,
                }}
              >
                {approving ? (
                  <ActivityIndicator color={colors.goldSoft} />
                ) : (
                  <Ionicons name="checkmark-circle" size={18} color={colors.goldSoft} />
                )}
                <Text variant="body" style={{ color: colors.goldSoft, fontWeight: '700' }}>
                  {approving ? 'Tasdiqlanmoqda…' : 'Tasdiqlash — katalogga qo\'y'}
                </Text>
              </Pressable>
            )}
            <Text variant="caption" color="muted" style={{ marginTop: 6 }}>
              {new Date(job.createdAt).toLocaleString()} · urinishlar: {job.attempts}
            </Text>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

function UploadSlot({
  label,
  url,
  loading,
  onPick,
  colors,
}: {
  label: string;
  url: string;
  loading: boolean;
  onPick: () => void;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <View style={{ flex: 1 }}>
      <Text variant="caption" color="muted" style={{ marginBottom: 6 }}>{label}</Text>
      <Pressable
        onPress={onPick}
        style={[styles.slotBox, { backgroundColor: colors.surface2, borderColor: colors.rule }]}
      >
        {loading ? (
          <ActivityIndicator color={colors.gold} />
        ) : url ? (
          <Image source={{ uri: url }} style={StyleSheet.absoluteFill} resizeMode="contain" />
        ) : (
          <Ionicons name="image-outline" size={28} color={colors.muted} />
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 20, paddingBottom: 60 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  cover: { width: '100%', height: 240, borderRadius: 14, backgroundColor: '#00000010' },
  card: { marginTop: 14, borderRadius: 12, borderWidth: 1, padding: 14 },
  sectionLabel: { marginTop: 20, marginBottom: 8 },
  variantRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 8,
  },
  variantSwatch: { width: 36, height: 36, borderRadius: 18, borderWidth: 1 },
  uploadRow: { flexDirection: 'row', gap: 10 },
  slotBox: {
    aspectRatio: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  submit: {
    marginTop: 14,
    paddingVertical: 14,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusCard: { marginTop: 14, borderRadius: 12, borderWidth: 1, padding: 14 },
  resultImage: { width: '100%', height: 240, borderRadius: 10, marginTop: 10, backgroundColor: '#00000010' },
});
