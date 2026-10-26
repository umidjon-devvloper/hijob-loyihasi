import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ActivityIndicator, Alert, Image, Pressable, RefreshControl, Share, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../../src/components/Screen';
import { Text } from '../../src/components/Text';
import { useTheme } from '../../src/theme/ThemeProvider';
import { api } from '../../src/api/client';
import { safeBack } from '../../src/lib/safe-back';
import { formatUsdAsUzs, useUzsRate } from '../../src/lib/currency';
import { useTryonCollection, TRYON_ALLOWED_CATEGORIES } from '../../src/store/tryon-collection';
import { sceneById } from '../../src/lib/scenes';

interface ProductDetail {
  id: string;
  sellerId: string;
  categoryId: string;
  title: { ru: string; uz: string };
  basePriceUsd: number;
  coverUrl: string;
  gallery: string[];
  attributes?: Record<string, unknown> | null;
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

interface BodyParamsResponse {
  heightCm: number;
  weightKg: number;
  preferredSize: string;
}

const IMAGE_BG = ['#E4CE9A', '#D9D0BE', '#C9A96E', '#A88848'];

export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, theme, scheme } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const uzsRate = useUzsRate();

  const { data, isLoading, isError, refetch } = useQuery<ProductDetail>({
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

  // Face-swap used to run automatically on this page; it was moved to the
  // dedicated Primerka tab where the pre-rendered mannequins live. The
  // product page now shows the seller's own product photo so the buyer sees
  // the hijab as photographed, not a face-swapped try-on.

  const addToTryon = useTryonCollection((s) => s.add);
  const removeFromTryon = useTryonCollection((s) => s.remove);
  const tryonItems = useTryonCollection((s) => s.items);
  const inTryon = tryonItems.some((i) => i.productId === id);

  const addToCart = useMutation({
    mutationFn: async (variantId: string) => {
      await api.post('/cart', { variantId, quantity: 1 });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cart'] });
      Alert.alert('✓', 'Savatga qo\'shildi');
    },
  });

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
  // Show the seller's own product photo. The face-swapped / body-matched
  // renders live on the Primerka tab; this page is for product info.
  const heroImageUrl = product.coverUrl ?? currentVariant?.renderedUrl;

  return (
    <Screen>
      <View style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ paddingBottom: 24 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={false}
              onRefresh={() => refetch()}
              tintColor={colors.oliveDeep}
              colors={[colors.oliveDeep]}
            />
          }
        >
          {/* Product Image Area — 3:4 aspect so the full product shot
              (head to hem) is always visible without cropping. The seller's
              chosen podium backdrop (attributes.sceneId) is drawn behind
              the product photo so the listing reads as a studio shot. */}
          <View style={{ width: '100%', aspectRatio: 3 / 4, position: 'relative', backgroundColor: colors.surface2 }}>
            {(() => {
              const scene = sceneById((product.attributes as any)?.sceneId);
              if (!scene) return null;
              return (
                <Image
                  source={scene.source}
                  style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' }}
                  resizeMode="cover"
                />
              );
            })()}
            {heroImageUrl ? (
              <Image
                source={{ uri: heroImageUrl }}
                style={{ width: '100%', height: '100%' }}
                resizeMode="contain"
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
                <Ionicons name="chevron-back" size={18} color={colors.ink} />
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
                  <Ionicons name="share-outline" size={18} color={colors.ink} />
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

            {/* Carousel Dots */}
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
              {[0, 1, 2].map((i) => (
                <View
                  key={i}
                  style={{
                    width: i === activeImage ? 24 : 8,
                    height: 4,
                    borderRadius: 999,
                    backgroundColor:
                      i === activeImage ? colors.oliveDeep : 'rgba(54,57,36,0.3)',
                  }}
                />
              ))}
            </View>
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
              {formatUsdAsUzs(product.basePriceUsd, uzsRate)}
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

            {/* Try-On CTA Card — gated by category: only clothing goes to Primerka */}
            {TRYON_ALLOWED_CATEGORIES.has(product.categoryId) && (
              <Pressable
                onPress={() => {
                  if (inTryon) {
                    removeFromTryon(product.id);
                  } else {
                    addToTryon({
                      productId: product.id,
                      variantId: product.variants?.[0]?.id ?? null,
                      sellerId: product.sellerId,
                      categoryId: product.categoryId,
                    });
                    // Fire-and-forget: make sure the backend has queued a
                    // face-render job for every variant of this product, in
                    // case the seller published it after the buyer onboarded
                    // and the fanout job missed them.
                    api.post(`/tryon/enqueue-product/${product.id}`).catch(() => {});
                  }
                }}
                style={{
                  backgroundColor: inTryon ? colors.gold : colors.oliveDeep,
                  borderRadius: 16,
                  padding: 18,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 14,
                  marginBottom: 10,
                }}
              >
                <Ionicons
                  name={inTryon ? 'checkmark-circle' : 'sparkles-outline'}
                  size={30}
                  color={inTryon ? colors.ink : colors.goldSoft}
                />
                <View style={{ flex: 1 }}>
                  <Text
                    variant="bodySmall"
                    style={{
                      fontSize: 14,
                      fontWeight: '600',
                      color: inTryon ? colors.ink : colors.goldSoft,
                      marginBottom: 3,
                    }}
                  >
                    {inTryon ? 'Primerka ro\'yxatida ✓' : 'Primerka ro\'yxatiga qo\'shish'}
                  </Text>
                  <Text
                    variant="caption"
                    style={{
                      fontSize: 12,
                      color: inTryon ? 'rgba(0,0,0,0.55)' : 'rgba(228,206,154,0.5)',
                      lineHeight: 16,
                    }}
                  >
                    {inTryon
                      ? 'Bosib — ro\'yxatdan olib tashlang'
                      : 'Boshqa do\'konlardagilar bilan birga ko\'ring'}
                  </Text>
                </View>
                <Ionicons
                  name={inTryon ? 'close' : 'add-circle'}
                  size={22}
                  color={inTryon ? colors.ink : colors.goldSoft}
                />
              </Pressable>
            )}

            {/* Open Primerka tab */}
            <Pressable
              onPress={() => router.push('/(tabs)/tryon')}
              style={{
                borderWidth: 1,
                borderColor: colors.rule,
                borderRadius: 14,
                paddingVertical: 12,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                marginBottom: 22,
              }}
            >
              <Ionicons name="body-outline" size={18} color={colors.ink} />
              <Text variant="bodySmall" style={{ fontSize: 13, fontWeight: '600', color: colors.ink }}>
                Primerka xonasini ochish
              </Text>
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
            <Ionicons name="body-outline" size={20} color={colors.ink} />
            <Text
              variant="bodySmall"
              style={{ fontSize: 14, fontWeight: '600', color: colors.ink }}
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
  const { colors, scheme } = useTheme();
  return (
    <Screen>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={scheme === 'dark' ? colors.gold : colors.oliveDeep} />
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
