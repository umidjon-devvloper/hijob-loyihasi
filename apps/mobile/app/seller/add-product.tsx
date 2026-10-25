/**
 * Seller "Yangi mahsulot" (new product) form.
 *
 * Posts a payload shaped exactly like NestJS's `CreateProductDto`:
 *   { titleRu, titleUz?, descriptionRu?, categoryId, basePriceUsd,
 *     coverUrl, attributes?, variants: [{color, colorHex, size, stock,
 *     sku, priceUsd?, images?}] }
 *
 * Images are uploaded first through `/seller/uploads` (multipart) and the
 * returned public URLs are embedded in `coverUrl` / `variants[].images`.
 */
import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Screen } from '../../src/components/Screen';
import { Text } from '../../src/components/Text';
import { useTheme } from '../../src/theme/ThemeProvider';
import { api } from '../../src/api/client';
import { errorMessage, errorTitle } from '../../src/lib/api-errors';
import { safeBack } from '../../src/lib/safe-back';
import { useUzsRate, usdToUzs, formatUzs } from '../../src/lib/currency';
import { SCENES, type SceneId } from '../../src/lib/scenes';

type CategoryId = 'scarves' | 'dresses' | 'shoes' | 'bags' | 'accessories';

const CATEGORIES: Array<{ id: CategoryId; labelUz: string; labelRu: string }> = [
  { id: 'scarves', labelUz: "Ro'mollar / hijoblar", labelRu: 'Платки / хиджабы' },
  { id: 'dresses', labelUz: "Ko'ylaklar / abayalar", labelRu: 'Платья / абайи' },
  { id: 'shoes', labelUz: 'Poyabzallar', labelRu: 'Обувь' },
  { id: 'bags', labelUz: 'Sumkalar', labelRu: 'Сумки' },
  { id: 'accessories', labelUz: 'Aksessuarlar', labelRu: 'Аксессуары' },
];

// Hijab-common palette the seller can tap through. Hex must be #RRGGBB to
// satisfy the backend regex. Adding a custom colour means typing the hex.
const COLOR_SWATCHES: Array<{ hex: string; label: string }> = [
  { hex: '#1A1A1A', label: 'Qora' },
  { hex: '#FBF7EA', label: 'Oq' },
  { hex: '#9A3C3C', label: 'Qizil' },
  { hex: '#2D3B5C', label: 'Ko\'k' },
  { hex: '#4B7A4B', label: 'Yashil' },
  { hex: '#B5CDA3', label: 'Och yashil' },
  { hex: '#B38B4A', label: 'Oltin' },
  { hex: '#8E8E76', label: 'Zaytun' },
  { hex: '#8F7E4F', label: 'Xaki' },
  { hex: '#D4C3A0', label: 'Qum' },
  { hex: '#B85C4A', label: 'Terakot' },
  { hex: '#F5894A', label: 'Apelsin' },
  { hex: '#E8B0B0', label: 'Pushti' },
  { hex: '#B097C6', label: 'Lavanda' },
  { hex: '#8B5CF6', label: 'Binafsha' },
  { hex: '#E8E3D4', label: 'Rang-barang' },
  { hex: '#D4B86A', label: 'Noodatiy' },
];

const SIZE_PRESETS: Record<CategoryId, string[]> = {
  scarves: ['one-size', '110x110', '140x140'],
  dresses: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
  shoes: ['35', '36', '37', '38', '39', '40', '41', '42'],
  bags: ['one-size'],
  accessories: ['one-size'],
};

interface Variant {
  color: string;
  colorHex: string;
  size: string;
  stock: string; // kept as string for TextInput, parsed on submit
  sku: string;
  priceUsd: string; // optional, blank = fall back to basePriceUsd
  images: string[];
}

const emptyVariant = (categoryId: CategoryId): Variant => ({
  color: 'Qora',
  colorHex: '#1A1A1A',
  size: SIZE_PRESETS[categoryId][0] || 'one-size',
  stock: '10',
  sku: '',
  priceUsd: '',
  images: [],
});

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 24) || 'product';

export default function AddProductScreen() {
  const { colors, theme } = useTheme();
  const router = useRouter();

  const [titleRu, setTitleRu] = useState('');
  const [titleUz, setTitleUz] = useState('');
  const [descriptionRu, setDescriptionRu] = useState('');
  const [categoryId, setCategoryId] = useState<CategoryId>('scarves');
  const [bodyFit, setBodyFit] = useState<'slim' | 'regular' | 'plus' | null>(null);
  const [basePriceUsd, setBasePriceUsd] = useState('');
  // Seller can type the price in USD or UZS; backend stores USD, so when
  // UZS is picked we divide by the live rate at submit time.
  const [priceCurrency, setPriceCurrency] = useState<'usd' | 'uzs'>('uzs');
  const [basePriceUzs, setBasePriceUzs] = useState('');
  const uzsRate = useUzsRate();
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [variants, setVariants] = useState<Variant[]>([emptyVariant('scarves')]);
  const [showCategory, setShowCategory] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  // Podium backdrop the buyer sees behind the mannequin on the Primerka
  // tab + product hero. Stored inside Product.attributes.sceneId so no
  // schema migration is needed.
  const [sceneId, setSceneId] = useState<SceneId>('beige');

  // Resolves the current USD price regardless of which currency the
  // seller is typing in. UZS entries are divided by the live rate.
  const resolvedUsdPrice = useMemo(() => {
    if (priceCurrency === 'usd') return Number(basePriceUsd);
    const uzs = Number(basePriceUzs);
    if (!Number.isFinite(uzs) || uzsRate <= 0) return NaN;
    return uzs / uzsRate;
  }, [priceCurrency, basePriceUsd, basePriceUzs, uzsRate]);

  const canSubmit = useMemo(() => {
    if (titleRu.trim().length < 3) return false;
    if (!coverUrl) return false;
    if (!Number.isFinite(resolvedUsdPrice) || resolvedUsdPrice < 1) return false;
    if (variants.length === 0) return false;
    for (const v of variants) {
      if (!v.color.trim()) return false;
      if (!/^#[0-9A-Fa-f]{6}$/.test(v.colorHex)) return false;
      if (!v.size.trim()) return false;
      const stock = Number(v.stock);
      if (!Number.isInteger(stock) || stock < 0) return false;
    }
    return true;
  }, [titleRu, coverUrl, resolvedUsdPrice, variants]);

  const uploadImages = useCallback(
    async (uris: string[]): Promise<string[]> => {
      const form = new FormData();
      uris.forEach((uri, i) => {
        const name = uri.split('/').pop() || `img-${i}.jpg`;
        const ext = name.split('.').pop()?.toLowerCase() ?? 'jpg';
        const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
        form.append('files', {
          uri,
          name,
          type: mime,
        } as unknown as Blob);
      });
      const { data } = await api.post('/seller/uploads', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 60_000,
      });
      // Backend returns { files: [{ name, key, url, ... }] }.
      const files = (data?.files ?? data) as Array<{ url: string }>;
      if (!Array.isArray(files)) throw new Error('Upload response did not include file list');
      return files.map((d) => d.url);
    },
    [],
  );

  const pickCover = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Ruxsat kerak', "Rasm tanlash uchun galereyaga ruxsat bering.");
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
      allowsEditing: false,
    });
    if (picked.canceled || !picked.assets?.[0]) return;
    setUploadingCover(true);
    try {
      const [url] = await uploadImages([picked.assets[0].uri]);
      if (url) setCoverUrl(url);
    } catch (e: unknown) {
      Alert.alert('Yuklab bo\'lmadi', (e as Error).message ?? 'xatolik');
    } finally {
      setUploadingCover(false);
    }
  }, [uploadImages]);

  const pickVariantImages = useCallback(
    async (index: number) => {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return;
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.9,
        allowsMultipleSelection: true,
        selectionLimit: 5,
      });
      if (picked.canceled || !picked.assets?.length) return;
      try {
        const urls = await uploadImages(picked.assets.map((a) => a.uri));
        setVariants((vs) =>
          vs.map((v, i) => (i === index ? { ...v, images: [...v.images, ...urls] } : v)),
        );
      } catch (e: unknown) {
        Alert.alert('Yuklab bo\'lmadi', (e as Error).message ?? 'xatolik');
      }
    },
    [uploadImages],
  );

  const updateVariant = (index: number, patch: Partial<Variant>) =>
    setVariants((vs) => vs.map((v, i) => (i === index ? { ...v, ...patch } : v)));

  const removeVariant = (index: number) =>
    setVariants((vs) => (vs.length <= 1 ? vs : vs.filter((_, i) => i !== index)));

  const addVariant = () => setVariants((vs) => [...vs, emptyVariant(categoryId)]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        titleRu: titleRu.trim(),
        titleUz: titleUz.trim() || undefined,
        descriptionRu: descriptionRu.trim() || undefined,
        categoryId,
        bodyFit: bodyFit ?? undefined,
        basePriceUsd: Math.round(resolvedUsdPrice * 100) / 100,
        coverUrl: coverUrl!,
        attributes: { sceneId },
        variants: variants.map((v, i) => ({
          color: v.color.trim(),
          colorHex: v.colorHex,
          size: v.size.trim(),
          stock: Number(v.stock || 0),
          sku: (v.sku.trim() || `${slugify(titleRu)}-${v.size}-${i + 1}`).toUpperCase(),
          priceUsd: v.priceUsd ? Number(v.priceUsd) : undefined,
          images: v.images.length ? v.images : undefined,
        })),
      };
      const { data } = await api.post('/seller/products', payload);
      return data as { id: string };
    },
    onSuccess: () => {
      Alert.alert('Tayyor', 'Mahsulot qo\'shildi (draft). Tasdiqdan keyin ko\'rinadi.', [
        { text: 'OK', onPress: () => router.replace('/(seller-tabs)/products') },
      ]);
    },
    onError: (e: unknown) => {
      Alert.alert(errorTitle(), errorMessage(e));
    },
  });

  const currentCategoryLabel =
    CATEGORIES.find((c) => c.id === categoryId)?.labelUz ?? categoryId;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={() => safeBack()} hitSlop={12}>
            <Ionicons name="arrow-back" size={24} color={colors.ink} />
          </Pressable>
          <Text variant="titleMedium" color="ink">
            Yangi mahsulot
          </Text>
          <View style={{ width: 24 }} />
        </View>

        {/* Cover image */}
        <Text variant="label" color="muted" style={styles.sectionLabel}>
          Asosiy rasm
        </Text>
        <Pressable
          onPress={pickCover}
          style={[
            styles.coverBox,
            { backgroundColor: colors.surface2, borderColor: colors.rule },
          ]}
        >
          {uploadingCover ? (
            <ActivityIndicator color={colors.gold} />
          ) : coverUrl ? (
            <Image source={{ uri: coverUrl }} style={styles.coverImage} />
          ) : (
            <View style={{ alignItems: 'center' }}>
              <Ionicons name="image-outline" size={36} color={colors.muted} />
              <Text variant="caption" color="muted" style={{ marginTop: 6 }}>
                Rasm tanlash
              </Text>
            </View>
          )}
        </Pressable>

        {/* Titles + description */}
        <Field label="Nomi (Rus)" value={titleRu} onChangeText={setTitleRu} placeholder="Хиджаб «Нежность»" />
        <Field label="Nomi (O'zbek)" value={titleUz} onChangeText={setTitleUz} placeholder="Hijob «Nazokat»" />
        <Field
          label="Tavsif"
          value={descriptionRu}
          onChangeText={setDescriptionRu}
          placeholder="Yumshoq shifon mato, 110×110 sm"
          multiline
        />

        {/* Category picker */}
        <Text variant="label" color="muted" style={styles.sectionLabel}>
          Kategoriya
        </Text>
        <Pressable
          onPress={() => setShowCategory(true)}
          style={[
            styles.picker,
            { backgroundColor: colors.surface2, borderColor: colors.rule },
          ]}
        >
          <Text variant="body" color="ink">
            {currentCategoryLabel}
          </Text>
          <Ionicons name="chevron-down" size={18} color={colors.muted} />
        </Pressable>

        {/* Body fit — ozg'iz / o'rtacha / to'la (ixtiyoriy) */}
        <Text variant="label" color="muted" style={styles.sectionLabel}>
          Jussa (ixtiyoriy)
        </Text>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
          {([
            { key: null, label: 'Hamma uchun' },
            { key: 'slim' as const, label: "Ozg'iz" },
            { key: 'regular' as const, label: "O'rtacha" },
            { key: 'plus' as const, label: "To'la" },
          ]).map((b, i) => {
            const active = bodyFit === b.key;
            return (
              <Pressable
                key={i}
                onPress={() => setBodyFit(b.key)}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: active ? colors.oliveDeep : colors.rule,
                  backgroundColor: active ? colors.oliveDeep : colors.surface2,
                  alignItems: 'center',
                }}
              >
                <Text
                  variant="caption"
                  style={{
                    color: active ? colors.goldSoft : colors.ink,
                    fontSize: 11,
                    fontWeight: '600',
                  }}
                >
                  {b.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Price with currency toggle */}
        <Text variant="label" color="muted" style={styles.sectionLabel}>
          Narx
        </Text>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
          <Pressable
            onPress={() => setPriceCurrency('uzs')}
            style={{
              flex: 1, paddingVertical: 10, borderRadius: 10,
              backgroundColor: priceCurrency === 'uzs' ? colors.oliveDeep : colors.surface2,
              borderWidth: 1,
              borderColor: priceCurrency === 'uzs' ? colors.oliveDeep : colors.rule,
              alignItems: 'center',
            }}
          >
            <Text variant="caption" style={{
              color: priceCurrency === 'uzs' ? colors.goldSoft : colors.ink,
              fontWeight: '600', fontSize: 12,
            }}>So'm (UZS)</Text>
          </Pressable>
          <Pressable
            onPress={() => setPriceCurrency('usd')}
            style={{
              flex: 1, paddingVertical: 10, borderRadius: 10,
              backgroundColor: priceCurrency === 'usd' ? colors.oliveDeep : colors.surface2,
              borderWidth: 1,
              borderColor: priceCurrency === 'usd' ? colors.oliveDeep : colors.rule,
              alignItems: 'center',
            }}
          >
            <Text variant="caption" style={{
              color: priceCurrency === 'usd' ? colors.goldSoft : colors.ink,
              fontWeight: '600', fontSize: 12,
            }}>Dollar (USD)</Text>
          </Pressable>
        </View>
        {priceCurrency === 'uzs' ? (
          <>
            <Field
              label="Narx (so'm)"
              value={basePriceUzs}
              onChangeText={(t) => setBasePriceUzs(t.replace(/[^0-9]/g, ''))}
              placeholder="250000"
              keyboardType="number-pad"
            />
            {basePriceUzs && uzsRate > 0 && (
              <Text variant="caption" color="muted" style={{ marginTop: -4, marginBottom: 8, fontSize: 11 }}>
                ≈ ${(Number(basePriceUzs) / uzsRate).toFixed(2)} (kurs: {uzsRate.toLocaleString('ru-RU')} so'm/USD)
              </Text>
            )}
          </>
        ) : (
          <>
            <Field
              label="Narx (USD)"
              value={basePriceUsd}
              onChangeText={(t) => setBasePriceUsd(t.replace(/[^0-9.]/g, ''))}
              placeholder="22"
              keyboardType="decimal-pad"
            />
            {basePriceUsd && uzsRate > 0 && (
              <Text variant="caption" color="muted" style={{ marginTop: -4, marginBottom: 8, fontSize: 11 }}>
                ≈ {formatUzs(usdToUzs(Number(basePriceUsd), uzsRate))}
              </Text>
            )}
          </>
        )}

        {/* Mannequin podium backdrop — three studio scenes the buyer sees
            on the Primerka tab + product hero. Default: 'beige'. */}
        <Text variant="label" color="muted" style={{ marginTop: 20, marginBottom: 8 }}>
          Orqa fon (podium)
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 10, paddingVertical: 2 }}
        >
          {SCENES.map((s) => {
            const active = s.id === sceneId;
            return (
              <Pressable
                key={s.id}
                onPress={() => setSceneId(s.id)}
                style={{
                  width: 110,
                  borderRadius: 14,
                  borderWidth: active ? 3 : 1,
                  borderColor: active ? colors.gold : colors.rule,
                  overflow: 'hidden',
                  backgroundColor: colors.surface,
                }}
              >
                <Image
                  source={s.source}
                  style={{ width: '100%', height: 130 }}
                  resizeMode="cover"
                />
                <View
                  style={{
                    paddingVertical: 6,
                    paddingHorizontal: 8,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <Text
                    variant="caption"
                    style={{ fontSize: 11, fontWeight: '600', color: colors.ink }}
                  >
                    {s.label.uz}
                  </Text>
                  {active && (
                    <Ionicons name="checkmark-circle" size={16} color={colors.gold} />
                  )}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Variants */}
        <View style={styles.variantsHeader}>
          <Text variant="label" color="muted">
            Variantlar ({variants.length})
          </Text>
          <Pressable onPress={addVariant} hitSlop={10}>
            <Text variant="label" color="gold" style={{ fontWeight: '600' }}>
              + Qo'shish
            </Text>
          </Pressable>
        </View>

        {variants.map((v, i) => (
          <View
            key={i}
            style={[styles.variantCard, { backgroundColor: colors.surface, borderColor: colors.rule }]}
          >
            <View style={styles.variantHeaderRow}>
              <Text variant="label" color="ink" style={{ fontWeight: '600' }}>
                Variant {i + 1}
              </Text>
              {variants.length > 1 && (
                <Pressable onPress={() => removeVariant(i)} hitSlop={8}>
                  <Ionicons name="trash-outline" size={18} color={colors.danger} />
                </Pressable>
              )}
            </View>

            {/* Color swatches */}
            <Text variant="caption" color="muted" style={{ marginBottom: 6 }}>
              Rang
            </Text>
            <View style={styles.swatchRow}>
              {COLOR_SWATCHES.map((sw) => {
                const active = v.colorHex === sw.hex;
                return (
                  <Pressable
                    key={sw.hex}
                    onPress={() => updateVariant(i, { color: sw.label, colorHex: sw.hex })}
                    style={[
                      styles.swatch,
                      { backgroundColor: sw.hex, borderColor: active ? colors.gold : colors.rule, borderWidth: active ? 3 : 1 },
                    ]}
                  />
                );
              })}
            </View>

            {/* Size pills */}
            <Text variant="caption" color="muted" style={{ marginTop: 10, marginBottom: 6 }}>
              O'lcham
            </Text>
            <View style={styles.sizeRow}>
              {SIZE_PRESETS[categoryId].map((s) => {
                const active = v.size === s;
                return (
                  <Pressable
                    key={s}
                    onPress={() => updateVariant(i, { size: s })}
                    style={[
                      styles.sizePill,
                      {
                        backgroundColor: active ? colors.oliveDeep : colors.surface2,
                        borderColor: active ? colors.oliveDeep : colors.rule,
                      },
                    ]}
                  >
                    <Text
                      variant="caption"
                      color={active ? 'surface' : 'ink'}
                      style={{ fontWeight: '600' }}
                    >
                      {s}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Stock + optional price */}
            <View style={styles.row2}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Field
                  label="Zaxira"
                  value={v.stock}
                  onChangeText={(t) => updateVariant(i, { stock: t.replace(/[^0-9]/g, '') })}
                  keyboardType="number-pad"
                  compact
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label="Narx (ixt.)"
                  value={v.priceUsd}
                  onChangeText={(t) => updateVariant(i, { priceUsd: t.replace(/[^0-9.]/g, '') })}
                  keyboardType="decimal-pad"
                  placeholder="asos narx"
                  compact
                />
              </View>
            </View>

            {/* Images */}
            <Text variant="caption" color="muted" style={{ marginTop: 10, marginBottom: 6 }}>
              Variant rasmlari
            </Text>
            <View style={styles.imageRow}>
              {v.images.map((url) => (
                <Image key={url} source={{ uri: url }} style={styles.variantThumb} />
              ))}
              <Pressable
                onPress={() => pickVariantImages(i)}
                style={[styles.variantThumbAdd, { borderColor: colors.rule, backgroundColor: colors.surface2 }]}
              >
                <Ionicons name="add" size={28} color={colors.muted} />
              </Pressable>
            </View>
          </View>
        ))}

        {/* Submit */}
        <Pressable
          onPress={() => canSubmit && createMutation.mutate()}
          disabled={!canSubmit || createMutation.isPending}
          style={[
            styles.submit,
            {
              backgroundColor: canSubmit ? colors.oliveDeep : colors.muted,
              opacity: createMutation.isPending ? 0.6 : 1,
            },
          ]}
        >
          {createMutation.isPending ? (
            <ActivityIndicator color={colors.surface} />
          ) : (
            <Text variant="body" color="surface" style={{ fontWeight: '700' }}>
              Mahsulotni saqlash
            </Text>
          )}
        </Pressable>

        <Text variant="caption" color="muted" style={{ textAlign: 'center', marginTop: 10, marginBottom: 20 }}>
          Saqlash tugmasi faol bo'lishi uchun: nom, kategoriya, narx, asosiy rasm va kamida bitta variant kerak.
        </Text>
      </ScrollView>

      {/* Category modal */}
      <Modal visible={showCategory} transparent animationType="fade" onRequestClose={() => setShowCategory(false)}>
        <Pressable style={styles.modalScrim} onPress={() => setShowCategory(false)}>
          <View style={[styles.modalSheet, { backgroundColor: colors.surface }]}>
            <Text variant="titleSmall" color="ink" style={{ marginBottom: 8 }}>
              Kategoriya tanlang
            </Text>
            {CATEGORIES.map((c) => {
              const active = c.id === categoryId;
              return (
                <Pressable
                  key={c.id}
                  onPress={() => {
                    setCategoryId(c.id);
                    setVariants((vs) =>
                      vs.map((v) =>
                        SIZE_PRESETS[c.id].includes(v.size) ? v : { ...v, size: SIZE_PRESETS[c.id][0]! },
                      ),
                    );
                    setShowCategory(false);
                  }}
                  style={[styles.modalRow, { borderColor: colors.rule }]}
                >
                  <View>
                    <Text variant="body" color="ink">{c.labelUz}</Text>
                    <Text variant="caption" color="muted">{c.labelRu}</Text>
                  </View>
                  {active && <Ionicons name="checkmark-circle" size={22} color={colors.gold} />}
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </Screen>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  multiline,
  compact,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'number-pad' | 'decimal-pad';
  multiline?: boolean;
  compact?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ marginTop: compact ? 0 : 14 }}>
      <Text variant="caption" color="muted" style={{ marginBottom: 6 }}>
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        keyboardType={keyboardType ?? 'default'}
        multiline={multiline}
        style={[
          styles.input,
          {
            backgroundColor: colors.surface2,
            borderColor: colors.rule,
            color: colors.ink,
            minHeight: multiline ? 80 : 44,
            textAlignVertical: multiline ? 'top' : 'center',
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 20, paddingBottom: 60 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  sectionLabel: { marginTop: 14, marginBottom: 6 },
  coverBox: {
    height: 200,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  coverImage: { width: '100%', height: '100%' },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
  },
  picker: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  variantsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 24, marginBottom: 10 },
  variantCard: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 12 },
  variantHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  swatchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  swatch: { width: 32, height: 32, borderRadius: 16 },
  sizeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  sizePill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  row2: { flexDirection: 'row', marginTop: 10 },
  imageRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  variantThumb: { width: 64, height: 64, borderRadius: 8 },
  variantThumbAdd: {
    width: 64,
    height: 64,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  submit: {
    marginTop: 24,
    paddingVertical: 15,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalScrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: { padding: 20, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 40 },
  modalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
});
