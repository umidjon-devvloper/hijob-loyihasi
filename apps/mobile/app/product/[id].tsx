import { useEffect, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ActivityIndicator, Alert, Image, Pressable, Share, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../../src/components/Screen';
import { Text } from '../../src/components/Text';
import { useTheme } from '../../src/theme/ThemeProvider';
import { api } from '../../src/api/client';
import { hasLocalFace, localFaceUri } from '../../src/lib/face-local-cache';
import { errorMessage, errorTitle } from '../../src/lib/api-errors';
import { safeBack } from '../../src/lib/safe-back';
import { useTryonOnboarding } from '../../src/store/tryon-onboarding';

interface ProductDetail {
  id: string;
  title: { ru: string; uz: string };
  basePriceUsd: number;
  coverUrl: string;
  gallery: string[];
  description: string;
  seller: { brandName: string; rating: number; reviewsCount: number };
  colors: Array<{ key: string; hex: string; label: string }>;
  sizes: string[];
  resultVariants?: Record<string, string> | null;
  variants: Array<{
    id: string;
    color: string;
    colorHex: string;
    size: string;
    priceUsd: number;
    stock: number;
    images: string[];
    renderedUrl?: string | null;
  }>;
}

function heightBand(cm: number | null | undefined): 'short' | 'mid' | 'tall' {
  if (!cm || cm <= 160) return 'short';
  if (cm <= 170) return 'mid';
  return 'tall';
}

function pickBodyMatchedUrl(
  resultVariants: Record<string, string> | null | undefined,
  bodyType: 'slim' | 'medium' | 'full' | null | undefined,
  heightCm: number | null | undefined,
): string | null {
  if (!resultVariants) return null;
  const body = bodyType ?? 'medium';
  const band = heightBand(heightCm);
  return (
    resultVariants[`${body}-${band}`] ??
    resultVariants[`${body}-mid`] ??
    resultVariants['medium-mid'] ??
    Object.values(resultVariants)[0] ??
    null
  );
}

interface BodyParamsResponse {
  heightCm: number;
  weightKg: number;
  preferredSize: string;
}

const IMAGE_BG = ['#E4CE9A', '#D9D0BE', '#C9A96E', '#A88848'];

export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, theme } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const buyerBodyType = useTryonOnboarding((s) => s.bodyType);
  const buyerHeightCm = useTryonOnboarding((s) => s.heightCm);

  const { data, isLoading, isError } = useQuery<ProductDetail>({
    queryKey: ['product', id],
    queryFn: async () => (await api.get(`/catalog/products/${id}`)).data,
    enabled: !!id,
  });

  // Buyer's own body params — drive the default size pick so the hero image
  // shows the mannequin+scarf render matching the viewer's height.
  const { data: body } = useQuery<BodyParamsResponse | null>({
    queryKey: ['body-params'],
    queryFn: async () => {
      try {
        const { data } = await api.get<BodyParamsResponse>('/onboarding/body');
        return data;
      } catch {
        return null;
      }
    },
    staleTime: 60_000,
  });

  const [selectedColor, setSelectedColor] = useState(0);
  const [selectedSize, setSelectedSize] = useState(1);
  const [liked, setLiked] = useState(true);
  const [activeImage, setActiveImage] = useState(0);
  const [canFaceSwap, setCanFaceSwap] = useState(false);
  const [personalizedUrl, setPersonalizedUrl] = useState<string | null>(null);
  const [swapping, setSwapping] = useState(false);

  // Check whether we have a cached selfie for the "Mendagi ko'rinishi"
  // button; if the user never finished face onboarding, the button hides.
  useEffect(() => {
    hasLocalFace().then(setCanFaceSwap).catch(() => setCanFaceSwap(false));
  }, []);

  // Auto-swap was triggering /tryon/faceswap on every open which, when
  // facefusion is unavailable, returned a crude InsightFace fallback that
  // pasted the raw selfie somewhere on the mannequin instead of swapping
  // the face. The client-side selfie overlay below gives the buyer the
  // same identity cue without that risk; the "Mendagi ko'rinishi" button
  // still runs the server swap on demand when the pipeline is healthy.
  const autoSwappedForVariantRef = useRef<string | null>(null);
  // Keep the ref alive so TypeScript doesn't flag it after we removed the
  // auto-swap useEffect.
  void autoSwappedForVariantRef;

  const addToCart = useMutation({
    mutationFn: async (variantId: string) => {
      await api.post('/cart', { variantId, quantity: 1 });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cart'] });
      Alert.alert('✓', 'Savatga qo\'shildi');
    },
  });

  const tryItOnMe = async (variantId: string) => {
    setSwapping(true);
    try {
      const form = new FormData();
      form.append('variantId', variantId);
      // Pass the buyer's body profile so the backend picks the matching
      // mannequin render from the 9-variant grid before face-swapping.
      if (buyerBodyType) form.append('bodyType', buyerBodyType);
      if (buyerHeightCm != null) form.append('heightCm', String(buyerHeightCm));
      form.append('face', {
        uri: localFaceUri(),
        name: 'face.jpg',
        type: 'image/jpeg',
      } as unknown as Blob);
      const { data } = await api.post('/tryon/faceswap', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 60_000,
      });
      setPersonalizedUrl(data.resultUrl);
    } catch (e: any) {
      Alert.alert(errorTitle(), errorMessage(e));
    } finally {
      setSwapping(false);
    }
  };

  // Nothing to render while the request is in flight or the product is
  // missing; surfacing a mock here would hide stale/broken ids and let the
  // user tap "Buy" on fake variants.
  if (isLoading) return <LoadingState />;
  if (isError || !data) return <ErrorState onBack={() => safeBack()} />;
  const product = data;

  const productColors = product.colors ?? [];
  const productSizes = product.sizes ?? [];
  const currentColor = productColors[selectedColor];

  // Pick the variant that matches the buyer's own size (from onboarding body
  // params). Falls back to M, then to the first variant if nothing matches.
  const buyerSize = (body?.preferredSize ?? 'M').toLowerCase();
  const matchByBuyerSize =
    product.variants?.find((v) => (v.size ?? '').toLowerCase() === buyerSize) ??
    product.variants?.find((v) => (v.size ?? '').toLowerCase() === 'm') ??
    product.variants?.[0];
  const currentVariant = matchByBuyerSize;
  // Pick the body-matched (bodyType × height-band) render from the 9-variant
  // grid produced by the extension. Falls back to the per-size legacy render
  // → then the seller cover. The face-swap preview wins over everything.
  const bodyMatchedUrl = pickBodyMatchedUrl(
    product.resultVariants,
    buyerBodyType,
    buyerHeightCm,
  );
  const heroImageUrl =
    personalizedUrl ?? bodyMatchedUrl ?? currentVariant?.renderedUrl ?? product.coverUrl;

  // Image strip for the pager. Starts with the hero we actually display,
  // then every unique gallery / variant image after it. Hiding the dots
  // when only one image exists is just `images.length > 1` below.
  const galleryImages = (() => {
    const seen = new Set<string>();
    const out: string[] = [];
    const push = (u: string | null | undefined) => {
      if (!u || seen.has(u)) return;
      seen.add(u);
      out.push(u);
    };
    push(heroImageUrl);
    for (const u of product.gallery ?? []) push(u);
    for (const v of product.variants ?? []) {
      for (const u of v.images ?? []) push(u);
    }
    return out;
  })();
  const visibleImage = galleryImages[activeImage] ?? heroImageUrl;

  return (
    <Screen>
      <View style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ paddingBottom: 24 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Product Image Area */}
          <View style={{ width: '100%', height: 400, position: 'relative' }}>
            {visibleImage ? (
              <Image
                source={{ uri: visibleImage }}
                style={{ width: '100%', height: '100%' }}
                resizeMode="cover"
              />
            ) : (
              <View
                style={{
                  flex: 1,
                  backgroundColor: IMAGE_BG[activeImage % IMAGE_BG.length],
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="ribbon-outline" size={64} color="rgba(255,255,255,0.35)" />
              </View>
            )}

            {/* Buyer's selfie, rounded and anchored at the mannequin's head.
                Hidden once a successful server face-swap has set
                personalizedUrl (that URL already carries the swapped face). */}
            {canFaceSwap && !personalizedUrl && (
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  top: '7%',
                  left: 0,
                  right: 0,
                  alignItems: 'center',
                }}
              >
                <View
                  style={{
                    width: 76,
                    height: 76,
                    borderRadius: 999,
                    overflow: 'hidden',
                    borderWidth: 2,
                    borderColor: 'rgba(255,255,255,0.6)',
                    backgroundColor: '#000',
                    shadowColor: '#000',
                    shadowOpacity: 0.35,
                    shadowRadius: 10,
                    shadowOffset: { width: 0, height: 3 },
                    elevation: 6,
                  }}
                >
                  <Image
                    source={{ uri: localFaceUri() }}
                    style={{ width: '100%', height: '100%' }}
                    resizeMode="cover"
                  />
                </View>
              </View>
            )}

            {/* "Mendagi ko'rinishi" face-swap trigger — only when the user
                finished face onboarding and the product has a variant to
                swap against. Hides itself after a successful swap so the
                hero image stays as the personalized render. */}
            {canFaceSwap && currentVariant && !personalizedUrl && (
              <Pressable
                onPress={() => tryItOnMe(currentVariant.id)}
                disabled={swapping}
                style={{
                  position: 'absolute',
                  bottom: 16,
                  right: 16,
                  backgroundColor: colors.oliveDeep,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  borderRadius: 20,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  opacity: swapping ? 0.7 : 1,
                }}
              >
                {swapping ? (
                  <ActivityIndicator color={colors.goldSoft} size="small" />
                ) : (
                  <Ionicons name="person" size={16} color={colors.goldSoft} />
                )}
                <Text variant="caption" style={{ fontSize: 12, fontWeight: '600', color: colors.goldSoft }}>
                  {swapping ? 'Qoyilyapti…' : 'Mendagi ko\'rinishi'}
                </Text>
              </Pressable>
            )}
            {personalizedUrl && (
              <View
                style={{
                  position: 'absolute',
                  top: 56,
                  left: 16,
                  backgroundColor: 'rgba(54,57,36,0.85)',
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: 12,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Ionicons name="sparkles" size={12} color={colors.goldSoft} />
                <Text variant="caption" style={{ fontSize: 11, fontWeight: '600', color: colors.goldSoft }}>
                  Sizning ko'rinishingiz
                </Text>
              </View>
            )}

            {/* Top Controls */}
            <View
              style={{
                position: 'absolute',
                top: 16,
                left: 16,
                right: 16,
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Pressable
                onPress={() => safeBack()}
                hitSlop={12}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 999,
                  backgroundColor: colors.surfaceGlass,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="chevron-back" size={18} color={colors.oliveDeep} />
              </Pressable>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable
                  onPress={() => {
                    const title = product?.title?.uz ?? product?.title?.ru ?? '24:31';
                    const url = product?.coverUrl ?? '';
                    // Native share sheet works out of the box across iOS/Android
                    // without needing an extra permission or module.
                    Share.share({
                      title,
                      message: url ? `${title}\n${url}` : title,
                      url,
                    }).catch(() => {});
                  }}
                  hitSlop={8}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 999,
                    backgroundColor: colors.surfaceGlass,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons name="share-outline" size={18} color={colors.oliveDeep} />
                </Pressable>
                <Pressable
                  onPress={() => setLiked((v) => !v)}
                  hitSlop={8}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 999,
                    backgroundColor: colors.surfaceGlass,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons
                    name={liked ? 'heart' : 'heart-outline'}
                    size={18}
                    color={liked ? colors.danger : colors.oliveDeep}
                  />
                </Pressable>
              </View>
            </View>

            {/* Carousel Dots — only when there are actually several images */}
            {galleryImages.length > 1 && (
            <View
              style={{
                position: 'absolute',
                bottom: 16,
                alignSelf: 'center',
                flexDirection: 'row',
                gap: 6,
                left: 0,
                right: 0,
                justifyContent: 'center',
              }}
            >
              {galleryImages.map((_, i) => (
                <Pressable
                  key={i}
                  onPress={() => setActiveImage(i)}
                  hitSlop={8}
                >
                <View
                  style={{
                    width: i === activeImage ? 24 : 8,
                    height: 4,
                    borderRadius: 999,
                    backgroundColor:
                      i === activeImage ? colors.oliveDeep : 'rgba(54,57,36,0.3)',
                  }}
                />
                </Pressable>
              ))}
            </View>
            )}
          </View>

          {/* Product Content */}
          <View style={{ paddingHorizontal: 20, paddingTop: 20 }}>
            {/* Brand Row */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                marginBottom: 10,
              }}
            >
              <View
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 999,
                  backgroundColor: colors.olive,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text
                  variant="caption"
                  style={{ fontSize: 11, fontWeight: '600', color: '#FDFAF3' }}
                >
                  {product.seller.brandName.slice(0, 1)}
                </Text>
              </View>
              <Text variant="bodySmall" color="muted" style={{ fontSize: 13, flex: 1 }}>
                {product.seller.brandName}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                <Ionicons name="star" size={14} color={colors.gold} />
                <Text
                  variant="bodySmall"
                  color="ink"
                  style={{ fontSize: 13, fontWeight: '500' }}
                >
                  {product.seller.rating}
                </Text>
              </View>
            </View>

            {/* Title */}
            <Text
              variant="displayLarge"
              color="oliveDeep"
              style={{
                fontFamily: theme.fontFamilies.display,
                fontSize: 24,
                fontWeight: '700',
                lineHeight: 29,
                marginBottom: 8,
              }}
            >
              {product.title.uz ?? product.title.ru}
            </Text>

            {/* Price */}
            <Text
              variant="displayLarge"
              color="oliveDeep"
              style={{
                fontFamily: theme.fontFamilies.display,
                fontSize: 28,
                fontWeight: '700',
                marginBottom: 16,
              }}
            >
              ${product.basePriceUsd}
            </Text>

            {/* Divider */}
            <View
              style={{
                height: 1,
                backgroundColor: colors.rule,
                marginBottom: 18,
              }}
            />

            {/* Color Selector */}
            <View style={{ marginBottom: 20 }}>
              <Text variant="bodySmall" color="ink" style={{ fontSize: 13, fontWeight: '500', marginBottom: 10 }}>
                Rang: <Text variant="bodySmall" color="muted" style={{ fontSize: 13 }}>{currentColor?.label}</Text>
              </Text>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                {productColors.map((c, i) => (
                  <Pressable
                    key={c.key}
                    onPress={() => setSelectedColor(i)}
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 999,
                      backgroundColor: c.hex,
                      borderWidth: i === selectedColor ? 2.5 : c.key === 'white' ? 1 : 2.5,
                      borderColor:
                        i === selectedColor
                          ? colors.oliveDeep
                          : c.key === 'white'
                            ? colors.rule
                            : 'transparent',
                    }}
                  />
                ))}
              </View>
            </View>

            {/* Size Selector */}
            <View style={{ marginBottom: 22 }}>
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 10,
                }}
              >
                <Text variant="bodySmall" color="ink" style={{ fontSize: 13, fontWeight: '500' }}>
                  O'lcham
                </Text>
                <Pressable
                  onPress={() =>
                    Alert.alert(
                      "O'lcham jadvali",
                      "Ro'mol: 110×110 sm · 115×115 sm\nKo'ylak: S / M / L / XL\nSumka va aksessuarlar: one-size",
                    )
                  }
                >
                  <Text variant="bodySmall" style={{ fontSize: 12, color: colors.gold }}>
                    O'lcham jadvali
                  </Text>
                </Pressable>
              </View>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {productSizes.map((size, i) => {
                  const active = i === selectedSize;
                  return (
                    <Pressable
                      key={size}
                      onPress={() => setSelectedSize(i)}
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: 12,
                        backgroundColor: active ? colors.oliveDeep : colors.surface,
                        borderWidth: active ? 0 : 1,
                        borderColor: colors.rule,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Text
                        variant="bodySmall"
                        style={{
                          fontSize: 14,
                          fontWeight: active ? '600' : '500',
                          color: active ? colors.goldSoft : colors.ink,
                        }}
                      >
                        {size}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Try-On CTA Card */}
            <Pressable
              onPress={() => router.push('/(tabs)/tryon')}
              style={{
                backgroundColor: colors.oliveDeep,
                borderRadius: 16,
                padding: 18,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 14,
                marginBottom: 22,
              }}
            >
              <Ionicons name="body-outline" size={36} color={colors.goldSoft} />
              <View style={{ flex: 1 }}>
                <Text
                  variant="bodySmall"
                  style={{ fontSize: 14, fontWeight: '600', color: colors.goldSoft, marginBottom: 3 }}
                >
                  AI bilan kiyib ko'ring
                </Text>
                <Text
                  variant="caption"
                  style={{ fontSize: 12, color: 'rgba(228,206,154,0.5)', lineHeight: 16 }}
                >
                  Sotib olishdan oldin virtual primerka
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.goldSoft} />
            </Pressable>

            {/* Description */}
            <View style={{ marginBottom: 20 }}>
              <Text
                variant="bodySmall"
                color="ink"
                style={{ fontSize: 14, fontWeight: '600', marginBottom: 8 }}
              >
                Tavsif
              </Text>
              <Text
                variant="bodySmall"
                color="muted"
                style={{ fontSize: 13, lineHeight: 21 }}
              >
                {product.description ?? ''}
              </Text>
            </View>

            {/* Delivery Info */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                paddingVertical: 14,
              }}
            >
              <Ionicons name="car-outline" size={20} color={colors.ink} />
              <Text
                variant="bodySmall"
                color="ink"
                style={{ fontSize: 13, flex: 1 }}
              >
                1-2 kun ichida yetkazib berish
              </Text>
              <View
                style={{
                  backgroundColor: 'rgba(122,138,91,0.12)',
                  borderRadius: 999,
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                }}
              >
                <Text
                  variant="caption"
                  style={{ fontSize: 11, fontWeight: '600', color: '#7A8A5B' }}
                >
                  Bepul
                </Text>
              </View>
            </View>
          </View>
        </ScrollView>

        {/* Bottom Action Bar */}
        <View
          style={{
            backgroundColor: colors.surface,
            borderTopWidth: 1,
            borderTopColor: colors.rule,
            paddingHorizontal: 16,
            paddingTop: 12,
            paddingBottom: 28,
            flexDirection: 'row',
            gap: 10,
          }}
        >
          <Pressable
            onPress={() => router.push('/(tabs)/tryon')}
            style={{
              flex: 1,
              height: 52,
              borderRadius: 14,
              backgroundColor: colors.surfaceAlt,
              borderWidth: 1,
              borderColor: colors.rule,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            <Ionicons name="body-outline" size={20} color={colors.oliveDeep} />
            <Text
              variant="bodySmall"
              style={{ fontSize: 14, fontWeight: '600', color: colors.oliveDeep }}
            >
              Sinab ko'rish
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              const v = product.variants?.[0];
              if (v) addToCart.mutate(v.id);
            }}
            style={({ pressed }) => ({
              flex: 1.3,
              height: 52,
              borderRadius: 14,
              backgroundColor: colors.oliveDeep,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              opacity: pressed ? 0.9 : 1,
            })}
          >
            <Ionicons name="bag-outline" size={20} color={colors.goldSoft} />
            <Text
              variant="bodySmall"
              style={{ fontSize: 14, fontWeight: '600', color: colors.goldSoft }}
            >
              Savatga qo'shish
            </Text>
          </Pressable>
        </View>
      </View>
    </Screen>
  );
}

function LoadingState() {
  const { colors } = useTheme();
  return (
    <Screen>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.oliveDeep} />
      </View>
    </Screen>
  );
}

function ErrorState({ onBack }: { onBack: () => void }) {
  const { colors } = useTheme();
  return (
    <Screen>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 }}>
        <Ionicons name="cloud-offline-outline" size={48} color={colors.muted} />
        <Text variant="body" color="ink" style={{ fontSize: 15, fontWeight: '600', textAlign: 'center' }}>
          Mahsulotni yuklab bo'lmadi
        </Text>
        <Text variant="caption" color="muted" style={{ fontSize: 12, textAlign: 'center' }}>
          Tarmoqni tekshiring va qaytadan urining.
        </Text>
        <Pressable
          onPress={onBack}
          style={{
            marginTop: 8, paddingHorizontal: 16, paddingVertical: 10,
            borderRadius: 10, backgroundColor: colors.oliveDeep,
          }}
        >
          <Text variant="bodySmall" style={{ fontSize: 13, fontWeight: '600', color: colors.goldSoft }}>
            Orqaga
          </Text>
        </Pressable>
      </View>
    </Screen>
  );
}
