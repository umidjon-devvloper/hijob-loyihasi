import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../../src/components/Text';
import { useTheme } from '../../src/theme/ThemeProvider';
import { api } from '../../src/api/client';
import { errorMessage, errorTitle } from '../../src/lib/api-errors';
import { useTryonOnboarding, type BodyType } from '../../src/store/tryon-onboarding';
import { useTryonCollection, TRYON_ALLOWED_CATEGORIES } from '../../src/store/tryon-collection';
import { sceneById } from '../../src/lib/scenes';

interface Variant {
  id: string;
  color: string;
  colorHex: string;
  images: string[];
  renderedUrl?: string | null;
  // Facefusion result for THIS buyer, pre-rendered at onboarding time by
  // the backend queue. When present, the Primerka tab shows it verbatim —
  // no per-product face-swap network call. Catalog does not know about
  // this; it is merged client-side from GET /tryon/my-renders.
  userRenderedUrl?: string | null;
}

interface Product {
  id: string;
  sellerId: string;
  categoryId?: string;
  title: { ru: string; uz: string; en?: string };
  basePriceUsd: number;
  coverUrl: string;
  resultVariants?: Record<string, string> | null;
  attributes?: Record<string, unknown> | null;
  variants: Variant[];
}

const GLASS = 'rgba(38,32,24,0.55)';
// Default fitting-room backdrop: sits behind every hero and thumbnail so the
// screen never shows an empty/dark box. AI renders already contain this
// scene and cover it fully; plain product photos float on top of it.
const FITTING_ROOM = require('../../assets/fitting-room.jpg');
const GOLD_GRADIENT = ['#D9BC85', '#B8955A'] as const;

// "Yorug'lik" cycles a light wash over the fitting-room photo.
const LIGHTING = [
  { label: "Yorug'lik", overlay: null },
  { label: 'Yorqin', overlay: 'rgba(255,248,235,0.16)' },
  { label: 'Iliq', overlay: 'rgba(255,196,120,0.14)' },
  { label: 'Kechki', overlay: 'rgba(20,14,8,0.22)' },
] as const;

function heightBand(cm: number | null | undefined): 'short' | 'mid' | 'tall' {
  if (!cm || cm <= 160) return 'short';
  if (cm <= 170) return 'mid';
  return 'tall';
}

function pickBodyMatched(
  rv: Record<string, string> | null | undefined,
  bodyType: BodyType | null | undefined,
  heightCm: number | null | undefined,
): string | null {
  if (!rv) return null;
  const body = bodyType ?? 'medium';
  const band = heightBand(heightCm);
  return (
    rv[`${body}-${band}`] ?? rv[`${body}-mid`] ?? rv['medium-mid'] ?? Object.values(rv)[0] ?? null
  );
}

export default function TryOnScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const tryonHydrated = useTryonOnboarding((s) => s.hydrated);
  const tryonCompleted = useTryonOnboarding((s) => s.completed);
  const storeId = useTryonOnboarding((s) => s.storeId);
  const bodyType = useTryonOnboarding((s) => s.bodyType);
  const heightCm = useTryonOnboarding((s) => s.heightCm);

  useFocusEffect(
    useCallback(() => {
      if (tryonHydrated && !tryonCompleted) {
        router.replace('/(tryon-onboarding)/height');
      }
    }, [tryonHydrated, tryonCompleted, router]),
  );

  // Items the buyer collected across different shops. Only clothing
  // categories are accepted at add time (bags/accessories can't be worn
  // on a mannequin), so no further filtering is needed here.
  const collectionItems = useTryonCollection((s) => s.items);
  const removeFromCollection = useTryonCollection((s) => s.remove);
  const productIds = useMemo(() => collectionItems.map((i) => i.productId), [collectionItems]);

  // Fetch each collected product. We hit the detail endpoint in parallel
  // because the list endpoint has no "ids in" filter today — the collection
  // is capped by UI (10-20 items) so this is cheap.
  const collectionQuery = useQuery<Product[]>({
    queryKey: ['tryon-collection-products', productIds.join(',')],
    queryFn: async () => {
      if (productIds.length === 0) return [];
      const results = await Promise.all(
        productIds.map(async (pid) => {
          try {
            const { data } = await api.get(`/catalog/products/${pid}`);
            return data as Product;
          } catch {
            return null;
          }
        }),
      );
      return results.filter((p): p is Product => !!p);
    },
    enabled: !!tryonCompleted && productIds.length > 0,
    staleTime: 60_000,
  });

  // Legacy single-store catalogue: only used as a fallback when the
  // collection is empty, so the Primerka tab still shows the chosen
  // store's items on first visit.
  const productsQuery = useQuery<{ items: Product[] }>({
    queryKey: ['tryon-store-products', storeId],
    queryFn: async () =>
      (
        await api.get('/catalog/products', {
          params: { sellerId: storeId, pageSize: 30 },
        })
      ).data,
    enabled: !!tryonCompleted && !!storeId && productIds.length === 0,
  });

  const products = useMemo(() => {
    if ((collectionQuery.data?.length ?? 0) > 0) {
      // Only clothing categories make sense here; the store already filters,
      // but legacy items may have slipped through.
      return (collectionQuery.data ?? []).filter((p) =>
        TRYON_ALLOWED_CATEGORIES.has((p as any).categoryId ?? 'scarves'),
      );
    }
    return (productsQuery.data?.items ?? []).filter((p) =>
      TRYON_ALLOWED_CATEGORIES.has((p as any).categoryId ?? 'scarves'),
    );
  }, [collectionQuery.data, productsQuery.data]);

  const wishlistQuery = useQuery<Array<{ productId: string }>>({
    queryKey: ['wishlist'],
    queryFn: async () => (await api.get('/wishlist')).data,
    enabled: !!tryonCompleted,
  });
  const wished = useMemo(
    () => new Set((wishlistQuery.data ?? []).map((w) => w.productId)),
    [wishlistQuery.data],
  );

  const cartQuery = useQuery<{ itemCount?: number; items?: Array<{ quantity: number }> }>({
    queryKey: ['cart'],
    queryFn: async () => (await api.get('/cart')).data,
    enabled: !!tryonCompleted,
  });
  const cartCount =
    cartQuery.data?.itemCount ??
    (cartQuery.data?.items ?? []).reduce((sum, i) => sum + i.quantity, 0);

  // Colour chips come from the store's own variant colours.
  const colorChips = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of products) {
      for (const v of p.variants ?? []) {
        if (v.color && !seen.has(v.color)) seen.set(v.color, v.colorHex);
      }
    }
    return [...seen.entries()].map(([name, hex]) => ({ name, hex }));
  }, [products]);
  const [colorFilter, setColorFilter] = useState<string | null>(null);
  // Drop a stale filter whose colour disappeared from the catalogue — e.g.
  // the chip row got hidden under the single-colour threshold or the seller
  // unpublished the last product of that colour. Without this the user can
  // land on an empty strip with no way back short of restarting the app.
  useEffect(() => {
    if (!colorFilter) return;
    if (!colorChips.some((c) => c.name === colorFilter)) {
      setColorFilter(null);
    }
  }, [colorFilter, colorChips]);
  const visible = useMemo(
    () =>
      colorFilter
        ? products.filter((p) => p.variants?.some((v) => v.color === colorFilter))
        : products,
    [products, colorFilter],
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = visible.find((p) => p.id === selectedId) ?? visible[0] ?? null;
  // Variant matching the active colour chip (falls back to the first one).
  const selectedVariant =
    selected?.variants?.find((v) => v.color === colorFilter) ?? selected?.variants?.[0] ?? null;

  const [lightIdx, setLightIdx] = useState(0);
  const lighting = LIGHTING[lightIdx] ?? LIGHTING[0];
  // Zoom toggle — scarves default to the close-up (head + hijab) framing
  // the user asked for; everything else defaults to the full-figure
  // framing. Either way the buyer can toggle via the side action.
  const [zoomedIn, setZoomedIn] = useState<boolean | null>(null);
  const isScarf = ((selected as any)?.categoryId ?? '') === 'scarves';
  const effectiveZoom = zoomedIn ?? isScarf;

  // Pre-rendered face-swapped mannequins keyed by variant id. The backend
  // queue (user-face-renders) builds one per variant the buyer could land
  // on — the overlay path makes new ones in ~1.5 s once the first facefusion
  // run has cached the user's stamp, so the colour-matched render usually
  // beats the user to the tab.
  const myRendersQuery = useQuery<{
    hasSelfie: boolean;
    renders: Array<{ variantId: string; url: string }>;
    pending: number;
    running: number;
    failed: number;
  }>({
    queryKey: ['tryon-my-renders'],
    queryFn: async () => (await api.get('/tryon/my-renders')).data,
    enabled: !!tryonCompleted,
    // Always refetch when the Primerka tab becomes active and treat the
    // cached list as immediately stale — otherwise re-queued renders that
    // completed in the background (e.g. after a seller unpublished-then-
    // republished a variant) stay invisible until the user kills the app.
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    staleTime: 0,
    refetchInterval: (query) => {
      const d = query.state.data;
      if (!d) return 4000; // first load — poll until we know the queue is empty
      return d.pending > 0 || d.running > 0 ? 4000 : false;
    },
  });
  const renderByVariant = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of myRendersQuery.data?.renders ?? []) m.set(r.variantId, r.url);
    return m;
  }, [myRendersQuery.data]);

  // Hero priority: use the colour-matched variant's render so the big
  // image agrees with the active colour chip. Falls back along the usual
  // chain if that specific variant hasn't been rendered yet.
  const hero = useMemo(() => {
    if (!selected) return null;
    // Try the active-colour variant first, then any already-rendered
    // variant for this product.
    const colourVariant =
      selected.variants?.find((v) => v.color === colorFilter) ?? null;
    const colourRender = colourVariant ? renderByVariant.get(colourVariant.id) : null;
    if (colourRender) return { uri: colourRender, scene: true };
    for (const v of selected.variants ?? []) {
      const u = renderByVariant.get(v.id);
      if (u) return { uri: u, scene: true };
    }
    const matched = pickBodyMatched(selected.resultVariants, bodyType, heightCm);
    if (matched) return { uri: matched, scene: true };
    return selected.coverUrl ? { uri: selected.coverUrl, scene: false } : null;
  }, [selected, colorFilter, renderByVariant, bodyType, heightCm]);

  const wishMutation = useMutation({
    mutationFn: async ({ productId, on }: { productId: string; on: boolean }) =>
      on ? api.post(`/wishlist/${productId}`) : api.delete(`/wishlist/${productId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wishlist'] });
      qc.invalidateQueries({ queryKey: ['profile-wishlist-count'] });
    },
    onError: (e) => Alert.alert(errorTitle(), errorMessage(e)),
  });

  const [justAdded, setJustAdded] = useState<string | null>(null);
  useEffect(() => {
    if (!justAdded) return;
    const t = setTimeout(() => setJustAdded(null), 1600);
    return () => clearTimeout(t);
  }, [justAdded]);

  const cartMutation = useMutation({
    mutationFn: async (variantId: string) => api.post('/cart', { variantId, quantity: 1 }),
    onSuccess: (_res, variantId) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setJustAdded(variantId);
      qc.invalidateQueries({ queryKey: ['cart'] });
    },
    onError: (e) => Alert.alert(errorTitle(), errorMessage(e)),
  });

  if (!tryonHydrated || !tryonCompleted) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.surface,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ActivityIndicator color={colors.gold} />
      </View>
    );
  }

  const bodyLabel = bodyType === 'slim' ? "Ozg'in" : bodyType === 'full' ? "To'la" : "O'rtacha";

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      {/* Header */}
      <View
        style={{
          paddingTop: insets.top + 6,
          paddingBottom: 10,
          paddingHorizontal: 16,
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: colors.surface,
        }}
      >
        <Pressable
          onPress={() => router.push('/(tryon-onboarding)/store')}
          hitSlop={12}
          style={{ width: 40, height: 40, justifyContent: 'center' }}
        >
          <Ionicons name="storefront-outline" size={22} color={colors.ink} />
        </Pressable>
        <View
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          <MaterialCommunityIcons name="hanger" size={24} color={colors.goldDark} />
          <Text
            style={{
              fontFamily: 'PlayfairDisplay',
              fontSize: 20,
              fontWeight: '700',
              letterSpacing: 1.6,
              color: colors.goldDark,
            }}
          >
            PRIMERKA
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 14 }}>
          <HeaderIcon
            icon="heart-outline"
            count={wished.size}
            onPress={() => router.push('/wishlist')}
          />
          <HeaderIcon
            icon="bag-outline"
            count={cartCount}
            onPress={() => router.push('/(tabs)/cart')}
          />
        </View>
      </View>

      {/* Hero card — flex:1 with minHeight:0 so it SHRINKS when the
          chips + thumbnails strip needs its space (the strip has
          flexShrink:0 below so it stays whole and the hero gives up
          height first). Otherwise the strip got pushed below the tab
          bar on shorter devices. */}
      <View
        style={{
          flex: 1,
          minHeight: 0,
          marginHorizontal: 14,
          marginBottom: 12,
          borderRadius: 24,
          backgroundColor: colors.surface2,
          shadowColor: '#000',
          shadowOpacity: 0.14,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 6 },
          elevation: 6,
        }}
      >
        <View
          style={{
            flex: 1,
            borderRadius: 24,
            overflow: 'hidden',
            borderWidth: 1,
            borderColor: colors.ruleSoft,
          }}
        >
          {/* Fitting-room backdrop sits behind the mannequin render in
              the normal (uzoqlashtirilgan) view. Hidden when the hero is
              zoomed in so the enlarged mannequin fills the whole frame
              and the backdrop doesn't peek through around the edges. */}
          {!effectiveZoom && (
            <Image
              source={FITTING_ROOM}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                width: '100%',
                height: '100%',
              }}
              resizeMode="cover"
            />
          )}
          {!selected ? (
            <View
              style={{
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
                paddingHorizontal: 40,
              }}
            >
              {productsQuery.isLoading ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <View
                  style={{
                    alignItems: 'center',
                    paddingHorizontal: 18,
                    paddingVertical: 14,
                    borderRadius: 18,
                    backgroundColor: GLASS,
                  }}
                >
                  <Ionicons name="shirt-outline" size={32} color="#FFF" />
                  <Text style={{ color: '#FFF', marginTop: 8, textAlign: 'center' }}>
                    {colorFilter ? "Bu rangda mahsulot yo'q" : "Bu do'konda hali mahsulot yo'q"}
                  </Text>
                </View>
              )}
            </View>
          ) : (
            <>
              {hero && (
                <Image
                  source={{ uri: hero.uri }}
                  style={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    left: 0,
                    right: 0,
                    // Zoom: scale up and shift the image DOWN just enough to
                    // bring the head/scarf area to the vertical centre of
                    // the hero without pushing the figure off the bottom.
                    // Backdrop is hidden above so we don't see any empty
                    // frame around the scaled mannequin.
                    transform: effectiveZoom
                      ? [{ scale: 1.5 }, { translateY: 120 }]
                      : [],
                  }}
                  resizeMode={effectiveZoom ? 'cover' : 'contain'}
                />
              )}
              {lighting.overlay && (
                <View
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: lighting.overlay,
                  }}
                />
              )}

              {/* Floating side actions */}
              <View style={{ position: 'absolute', top: 18, right: 14, gap: 12 }}>
                <SideAction
                  icon="camera-outline"
                  label={'Yuzni\nyangilash'}
                  onPress={() => {
                    // Wipe the user's existing renders + queued jobs so the
                    // next prepare() call rebuilds the whole catalogue from
                    // the fresh selfie instead of serving stale mannequins.
                    api.post('/tryon/reset').catch(() => {});
                    qc.invalidateQueries({ queryKey: ['tryon-my-renders'] });
                    router.push('/(tryon-onboarding)/face');
                  }}
                />
                <SideAction
                  icon="sunny-outline"
                  label={lighting.label}
                  onPress={() => setLightIdx((i) => (i + 1) % LIGHTING.length)}
                />
                <SideAction
                  icon={effectiveZoom ? 'contract-outline' : 'expand-outline'}
                  label={effectiveZoom ? 'Uzoqlashtirish' : 'Yaqinlashtirish'}
                  onPress={() => setZoomedIn(!effectiveZoom)}
                />
              </View>

              {/* Title + fit info */}
              <Pressable
                onPress={() =>
                  router.push({ pathname: '/product/[id]', params: { id: selected.id } })
                }
                style={{
                  position: 'absolute',
                  left: 14,
                  bottom: 40,
                  maxWidth: '62%',
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 14,
                  backgroundColor: GLASS,
                }}
              >
                <Text numberOfLines={1} style={{ color: '#FFF', fontSize: 13, fontWeight: '700' }}>
                  {selected.title?.uz ?? selected.title?.ru}
                </Text>
                <Text style={{ color: 'rgba(255,255,255,0.78)', fontSize: 10, marginTop: 2 }}>
                  {bodyLabel} · {heightCm ?? '—'} sm uchun kiydirildi
                </Text>
              </Pressable>

              {/* First-time face bake badge — appears while the user has
                  no finished renders yet but the queue is already working
                  (pending or running). Disappears automatically on the
                  first successful render. */}
              {myRendersQuery.data &&
                (myRendersQuery.data.renders?.length ?? 0) === 0 &&
                ((myRendersQuery.data.pending ?? 0) > 0 ||
                  (myRendersQuery.data.running ?? 0) > 0) && (
                  <View
                    style={{
                      position: 'absolute',
                      top: 18,
                      alignSelf: 'center',
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 8,
                      paddingHorizontal: 14,
                      paddingVertical: 8,
                      borderRadius: 999,
                      backgroundColor: 'rgba(26,22,18,0.75)',
                    }}
                  >
                    <ActivityIndicator size="small" color={colors.goldSoft} />
                    <Text style={{ color: colors.goldSoft, fontSize: 12, fontWeight: '600' }}>
                      AI yuzingizni manekenga qo'yyapti…
                    </Text>
                  </View>
                )}
            </>
          )}
        </View>
      </View>

      {/* Bottom sheet */}
      <View
        style={{
          flexShrink: 0,
          marginTop: 0,
          paddingTop: 16,
          paddingBottom: 14,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          backgroundColor: colors.surface,
          shadowColor: '#000',
          shadowOpacity: 0.08,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: -4 },
          elevation: 8,
        }}
      >
        {/* Colour chips — only shown when the store actually has more than
            one colour published, otherwise the row is just a Hammasi chip
            that cannot filter anything and a filter button that reads as
            inert. Clamping colorFilter to a still-present colour means a
            stale filter from an earlier reload can't ghost the strip. */}
        {colorChips.length >= 2 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 8, alignItems: 'center' }}
          >
            <Chip label="Hammasi" active={!colorFilter} onPress={() => setColorFilter(null)} />
            {colorChips.map((c) => (
              <Chip
                key={c.name}
                label={c.name}
                dot={c.hex}
                active={colorFilter === c.name}
                onPress={() => setColorFilter(colorFilter === c.name ? null : c.name)}
              />
            ))}
            <Pressable
              onPress={() => router.push('/(tryon-onboarding)/height')}
              hitSlop={8}
              style={{
                width: 38,
                height: 38,
                borderRadius: 19,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.surface2,
              }}
            >
              <Ionicons name="options-outline" size={18} color={colors.ink} />
            </Pressable>
          </ScrollView>
        ) : (
          <View
            style={{
              paddingHorizontal: 16,
              flexDirection: 'row',
              justifyContent: 'flex-end',
              alignItems: 'center',
            }}
          >
            <Pressable
              onPress={() => router.push('/(tryon-onboarding)/height')}
              hitSlop={8}
              style={{
                width: 38,
                height: 38,
                borderRadius: 19,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.surface2,
              }}
            >
              <Ionicons name="options-outline" size={18} color={colors.ink} />
            </Pressable>
          </View>
        )}

        {/* Product strip */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12, gap: 10 }}
        >
          {visible.map((p) => {
            const variant = p.variants?.find((v) => v.color === colorFilter) ?? p.variants?.[0];
            return (
              <ProductThumb
                key={p.id}
                product={p}
                active={p.id === selected?.id}
                wished={wished.has(p.id)}
                added={!!variant && justAdded === variant.id}
                bodyType={bodyType}
                heightCm={heightCm}
                userRenderUrl={variant ? (renderByVariant.get(variant.id) ?? null) : null}
                onPress={() => setSelectedId(p.id)}
                onWish={() => wishMutation.mutate({ productId: p.id, on: !wished.has(p.id) })}
                onCart={() => variant && cartMutation.mutate(variant.id)}
              />
            );
          })}
        </ScrollView>

        {/* Add to cart */}
        <Pressable
          disabled={!selectedVariant || cartMutation.isPending}
          onPress={() => selectedVariant && cartMutation.mutate(selectedVariant.id)}
          style={{ marginHorizontal: 16, opacity: selectedVariant ? 1 : 0.5 }}
        >
          <LinearGradient
            colors={GOLD_GRADIENT}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              height: 56,
              borderRadius: 28,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
            }}
          >
            {cartMutation.isPending ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <>
                <Ionicons
                  name={
                    selectedVariant && justAdded === selectedVariant.id
                      ? 'checkmark'
                      : 'cart-outline'
                  }
                  size={22}
                  color="#FFF"
                />
                <Text style={{ color: '#FFF', fontSize: 17, fontWeight: '600' }}>
                  {selectedVariant && justAdded === selectedVariant.id
                    ? "Savatga qo'shildi"
                    : `Savatga qo'shish${selected ? ` · $${selected.basePriceUsd}` : ''}`}
                </Text>
              </>
            )}
          </LinearGradient>
        </Pressable>
      </View>
    </View>
  );
}

function HeaderIcon({
  icon,
  count,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  count: number;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} hitSlop={10}>
      <Ionicons name={icon} size={24} color={colors.ink} />
      {count > 0 && (
        <View
          style={{
            position: 'absolute',
            top: -6,
            right: -8,
            minWidth: 18,
            height: 18,
            paddingHorizontal: 4,
            borderRadius: 9,
            backgroundColor: colors.danger,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: '#FFF', fontSize: 10, fontWeight: '700' }}>
            {count > 99 ? '99+' : count}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

function SideAction({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        width: 76,
        paddingVertical: 14,
        borderRadius: 38,
        backgroundColor: GLASS,
        alignItems: 'center',
        gap: 6,
      }}
    >
      <Ionicons name={icon} size={24} color="#FFF" />
      <Text style={{ color: '#FFF', fontSize: 10.5, textAlign: 'center', lineHeight: 13 }}>
        {label}
      </Text>
    </Pressable>
  );
}

function Chip({
  label,
  dot,
  active,
  onPress,
}: {
  label: string;
  dot?: string;
  active: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        height: 38,
        paddingHorizontal: 16,
        borderRadius: 19,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: active ? colors.goldDark : colors.surface2,
      }}
    >
      {dot && !active && (
        <View
          style={{
            width: 10,
            height: 10,
            borderRadius: 5,
            backgroundColor: dot,
            borderWidth: 1,
            borderColor: 'rgba(0,0,0,0.12)',
          }}
        />
      )}
      <Text
        style={{
          color: active ? '#FFF' : colors.ink,
          fontSize: 13,
          fontWeight: active ? '600' : '500',
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function ProductThumb({
  product,
  active,
  wished,
  added,
  bodyType,
  heightCm,
  userRenderUrl,
  onPress,
  onWish,
  onCart,
}: {
  product: Product;
  active: boolean;
  wished: boolean;
  added: boolean;
  bodyType: BodyType | null | undefined;
  heightCm: number | null | undefined;
  userRenderUrl: string | null;
  onPress: () => void;
  onWish: () => void;
  onCart: () => void;
}) {
  const { colors } = useTheme();
  // Prefer the buyer's rendered variant so the thumbnail matches the hero.
  // Falls back to the body-matched render → first-variant preview → cover.
  const matched =
    userRenderUrl ?? pickBodyMatched(product.resultVariants, bodyType, heightCm);
  const thumb = matched ?? product.variants?.[0]?.renderedUrl ?? product.coverUrl;
  return (
    <Pressable
      onPress={onPress}
      style={{
        width: 96,
        aspectRatio: 3 / 4,
        borderRadius: 14,
        overflow: 'hidden',
        borderWidth: 2,
        borderColor: active ? colors.gold : 'transparent',
        backgroundColor: colors.surface2,
      }}
    >
      <Image
        source={FITTING_ROOM}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          width: '100%',
          height: '100%',
        }}
        resizeMode="cover"
      />
      {thumb && (() => {
        const isScarf = (product.categoryId ?? '') === 'scarves';
        return (
          <Image
            source={{ uri: thumb }}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              right: 0,
              // Shift down so the head anchors to the top of the thumbnail
              // instead of the body cropping into view.
              transform: isScarf ? [{ scale: 1.9 }, { translateY: 50 }] : [],
            }}
            resizeMode="cover"
          />
        );
      })()}
      {/* Heart / cart affordances used to sit on the thumbnail but they
          duplicated the primary CTAs already visible on the hero — the
          thumbnail now stays a pure "switch to this product" tap target. */}
    </Pressable>
  );
}
