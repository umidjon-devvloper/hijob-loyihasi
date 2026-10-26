import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Pressable, RefreshControl, ScrollView, View, Image, Animated, Dimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Screen } from '../../src/components/Screen';
import { Text } from '../../src/components/Text';
import { Logo } from '../../src/components/Logo';
import { useTheme } from '../../src/theme/ThemeProvider';
import { useAuth } from '../../src/store/auth';
import { useTryonCollection } from '../../src/store/tryon-collection';
import { sceneById } from '../../src/lib/scenes';
import { api } from '../../src/api/client';
import { errorMessage, errorTitle } from '../../src/lib/api-errors';

const { width: SCREEN_W } = Dimensions.get('window');
const SIDE = 20;

interface HomeFeed {
  stores: Array<{ id: string; brandName: string; logoUrl: string | null }>;
  categories: Array<{ id: string; nameRu: string; nameUz: string; iconUrl: string | null }>;
  newArrivals: Array<{
    id: string;
    title: { ru: string; uz: string };
    basePriceUsd: number;
    coverUrl: string;
    attributes?: Record<string, unknown> | null;
    seller?: { brandName: string; rating: number };
    variants: Array<{ id: string }>;
  }>;
}

const STORE_COLORS = ['#C9A96E', '#8A8D5B', '#B85450', '#5F7A94', '#D9A24B'];

// Same category hero images the website uses on its homepage, bundled with
// the app so there's no network dependency and the layout matches cross-
// platform. Slug → scarf type mapping mirrors apps/website/src/lib/categories.ts.
const CATEGORY_DATA = [
  // Scarves ↔ bags images were swapped — pashmina.webp actually shows a
  // bag and shifon.webp shows a hijab head, so re-point them here.
  { id: 'scarves', image: require('../../assets/category-shifon.webp') },
  { id: 'dresses', image: require('../../assets/category-dresses.webp') },
  { id: 'bags', image: require('../../assets/category-pashmina.webp') },
  { id: 'accessories', image: require('../../assets/category-accessories.webp') },
] as const;

const PLACEHOLDER_BG = ['#B5B891', '#E4CE9A', '#D4C3A0', '#C4C88C', '#D9D0BE', '#E8DFCC'];

type Ad = { id: string; imageUrl: string; linkUrl: string | null; title: string | null };

/**
 * Horizontal paginated carousel of admin-curated banners, shown as the
 * hero section just below the welcome header. If no admin ads exist,
 * returns null so the caller falls back to the static Virtual primerka
 * banner. Includes pagination dots that mirror the current page.
 */
function AdsCarousel({ onEmpty }: { onEmpty?: () => void } = {}) {
  const router = useRouter();
  const { colors, theme } = useTheme();
  const { data } = useQuery<Ad[]>({
    queryKey: ['ads'],
    queryFn: async () => {
      const res = await api.get<Ad[]>('/ads');
      return res.data ?? [];
    },
    staleTime: 5 * 60 * 1000,
  });
  const [page, setPage] = useState(0);

  if (!data || data.length === 0) {
    onEmpty?.();
    return null;
  }

  const screenW = Dimensions.get('window').width;
  const cardW = screenW - 2 * 20;

  return (
    <View style={{ marginTop: 20 }}>
      <ScrollView
        horizontal
        pagingEnabled
        decelerationRate="fast"
        snapToInterval={cardW + 12}
        snapToAlignment="start"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
        onMomentumScrollEnd={(e) => {
          const idx = Math.round(e.nativeEvent.contentOffset.x / (cardW + 12));
          if (idx !== page) setPage(idx);
        }}
      >
        {data.map((ad) => (
          <Pressable
            key={ad.id}
            onPress={() => {
              if (ad.linkUrl) router.push(ad.linkUrl as any);
            }}
            style={{
              width: cardW,
              aspectRatio: 16 / 9,
              borderRadius: theme.radii.xl,
              overflow: 'hidden',
              backgroundColor: colors.surface2,
            }}
          >
            <Image
              source={{ uri: ad.imageUrl }}
              style={{ width: '100%', height: '100%' }}
              resizeMode="cover"
            />
          </Pressable>
        ))}
      </ScrollView>
      {data.length > 1 && (
        <View
          style={{
            flexDirection: 'row',
            gap: 6,
            justifyContent: 'center',
            marginTop: 10,
          }}
        >
          {data.map((_, i) => (
            <View
              key={i}
              style={{
                width: i === page ? 20 : 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: i === page ? colors.oliveDeep : colors.rule,
              }}
            />
          ))}
        </View>
      )}
    </View>
  );
}

export default function HomeScreen() {
  const { t, i18n } = useTranslation();
  const { colors, theme } = useTheme();
  const router = useRouter();
  const { user } = useAuth();
  const tryonCount = useTryonCollection((s) => s.items.length);
  const lang = i18n.language as 'ru' | 'uz';

  const queryClient = useQueryClient();

  // Reuse the ads query here so we know whether to render the Virtual
  // primerka fallback hero below the carousel. Same queryKey as the
  // AdsCarousel component means it hits the cache instead of re-fetching.
  const { data: adsData } = useQuery<Ad[]>({
    queryKey: ['ads'],
    queryFn: async () => (await api.get<Ad[]>('/ads')).data ?? [],
    staleTime: 5 * 60 * 1000,
  });
  const adsExist = (adsData?.length ?? 0) > 0;

  // Surface network/API failures to the UI instead of silently swapping in
  // mock rows — a mocked home feed hides real breakage (bad token, backend
  // down, schema drift) behind an impression of working data.
  const { data, isLoading, isError, refetch } = useQuery<HomeFeed>({
    queryKey: ['home'],
    queryFn: async () => (await api.get('/catalog/home')).data,
  });

  const addWishlist = useMutation({
    mutationFn: async (productId: string) =>
      (await api.post(`/wishlist/${productId}`)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile-wishlist-count'] });
      queryClient.invalidateQueries({ queryKey: ['wishlist'] });
    },
    onError: (e) => Alert.alert(errorTitle(), errorMessage(e)),
  });

  const addCart = useMutation({
    mutationFn: async (variantId: string) =>
      (await api.post('/cart', { variantId, quantity: 1 })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cart'] });
      Alert.alert(
        lang === 'ru' ? 'Готово' : "Qo'shildi",
        lang === 'ru' ? 'Товар добавлен в корзину' : "Mahsulot savatga qo'shildi",
      );
    },
    onError: (e) => Alert.alert(errorTitle(), errorMessage(e)),
  });

  const stores = data?.stores ?? [];

  // TZ Phase 4: swap the "Yangi kelgan kiyimlar" strip for products from the
  // buyer's nearest stores. Falls back to the home-feed newArrivals when the
  // nearby endpoint has nothing (first run / no sellers nearby).
  const nearbyQuery = useQuery<{ items: typeof data extends { newArrivals: infer A } ? A : never[] }>({
    queryKey: ['home-nearby'],
    queryFn: async () => (await api.get('/catalog/nearby-products')).data,
  });
  const arrivals = (nearbyQuery.data?.items?.length ? nearbyQuery.data.items : data?.newArrivals) ?? [];

  const topStoresQuery = useQuery<Array<{
    id: string;
    brandName: string;
    logoUrl: string | null;
    rating: number;
    reviewsCount: number;
    verified: boolean;
    isTop: boolean;
    isPremium: boolean;
    city: string | null;
  }>>({
    queryKey: ['home-top-stores'],
    queryFn: async () => (await api.get('/catalog/top-stores')).data,
  });
  const topStores = topStoresQuery.data ?? [];

  // Backend offline / token invalid — tell the user instead of leaving them
  // with an empty "Welcome" shell and no visible stores or arrivals.
  if (isError) {
    return (
      <Screen gradient>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 }}>
          <Ionicons name="cloud-offline-outline" size={48} color={colors.muted} />
          <Text variant="body" color="ink" style={{ fontSize: 15, fontWeight: '600', textAlign: 'center' }}>
            {lang === 'ru' ? 'Не удалось загрузить ленту' : "Ma'lumotlar yuklanmadi"}
          </Text>
          <Text variant="caption" color="muted" style={{ fontSize: 13, textAlign: 'center' }}>
            {lang === 'ru' ? 'Проверьте подключение и попробуйте ещё раз.' : "Internet ulanishini tekshirib, qayta urining."}
          </Text>
          <Pressable
            onPress={() => refetch()}
            style={{
              marginTop: 8, paddingHorizontal: 20, paddingVertical: 12,
              borderRadius: 12, backgroundColor: colors.oliveDeep,
            }}
          >
            <Text variant="bodySmall" style={{ fontSize: 13, fontWeight: '600', color: colors.goldSoft }}>
              {lang === 'ru' ? 'Повторить' : 'Qaytadan urinish'}
            </Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  return (
    <Screen gradient>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={false}
            onRefresh={() => {
              queryClient.invalidateQueries({ queryKey: ['home'] });
              refetch();
            }}
            tintColor={colors.oliveDeep}
            colors={[colors.oliveDeep]}
          />
        }
      >
        {/* ── Header ── */}
        <View
          style={{
            paddingHorizontal: SIDE,
            paddingTop: 4,
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <View style={{ width: 40 }}>
            <Pressable
              onPress={() => router.push('/settings')}
              hitSlop={12}
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: colors.surfaceGlass,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 1,
                borderColor: colors.ruleSoft,
              }}
            >
              <Ionicons name="menu-outline" size={20} color={colors.ink} />
            </Pressable>
          </View>

          <Logo size={44} />

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Pressable
              onPress={() => router.push('/(tabs)/tryon' as any)}
              hitSlop={8}
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: colors.surfaceGlass,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 1,
                borderColor: colors.ruleSoft,
              }}
            >
              <Ionicons name="sparkles-outline" size={18} color={colors.ink} />
              {tryonCount > 0 ? (
                <View
                  style={{
                    position: 'absolute',
                    top: -6,
                    right: -6,
                    minWidth: 20,
                    height: 20,
                    paddingHorizontal: 5,
                    borderRadius: 10,
                    backgroundColor: '#C8102E',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: 2,
                    borderColor: colors.surface,
                  }}
                >
                  <Text
                    allowFontScaling={false}
                    style={{
                      fontSize: 11,
                      lineHeight: 13,
                      fontWeight: '800',
                      color: '#FFFFFF',
                      textAlign: 'center',
                    }}
                  >
                    {tryonCount > 9 ? '9+' : String(tryonCount)}
                  </Text>
                </View>
              ) : null}
            </Pressable>
            <Pressable
              onPress={() => router.push('/search')}
              hitSlop={8}
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: colors.surfaceGlass,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 1,
                borderColor: colors.ruleSoft,
              }}
            >
              <Ionicons name="search-outline" size={18} color={colors.ink} />
            </Pressable>
            <Pressable
              onPress={() => router.push('/notifications')}
              hitSlop={8}
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: colors.surfaceGlass,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 1,
                borderColor: colors.ruleSoft,
              }}
            >
              <Ionicons name="notifications-outline" size={18} color={colors.ink} />
            </Pressable>
          </View>
        </View>

        {/* ── Welcome ── */}
        <View style={{ paddingHorizontal: SIDE, marginTop: 20 }}>
          <Text
            variant="bodySmall"
            color="muted"
            style={{ letterSpacing: 2, textTransform: 'uppercase', fontSize: 11 }}
          >
            {lang === 'ru' ? 'Добро пожаловать' : 'Xush kelibsiz'}
          </Text>
          <Text
            variant="displayLarge"
            color="oliveDeep"
            style={{ marginTop: 4, fontSize: 30, lineHeight: 36 }}
          >
            {user?.fullName
              ? `${lang === 'ru' ? 'Привет' : 'Salom'}, ${user.fullName.split(' ')[0]}`
              : (lang === 'ru' ? 'Откройте свой стиль' : "O'z uslubingizni toping")}
          </Text>
        </View>

        {/* ── Hero carousel ── admin-curated banners replace the static
            Virtual primerka hero when they exist; otherwise the hero
            below is the fallback so the home screen never has a hole. */}
        <AdsCarousel />
        {!adsExist && (
          <Pressable
            onPress={() => router.push('/(tabs)/tryon')}
            style={{ marginHorizontal: SIDE, marginTop: 20 }}
          >
            <LinearGradient
              colors={[colors.oliveDeep, '#4E5230']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{
                borderRadius: theme.radii['2xl'],
                padding: 20,
                flexDirection: 'row',
                alignItems: 'center',
                overflow: 'hidden',
                minHeight: 110,
              }}
            >
              <View style={{ flex: 1, gap: 8 }}>
                <View
                  style={{
                    backgroundColor: colors.gold,
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    borderRadius: theme.radii.sm,
                    alignSelf: 'flex-start',
                  }}
                >
                  <Text variant="caption" style={{ color: '#fff', fontWeight: '700', fontSize: 10, letterSpacing: 1 }}>
                    AI POWERED
                  </Text>
                </View>
                <Text
                  variant="titleMedium"
                  style={{ color: colors.goldSoft, fontSize: 18, lineHeight: 24 }}
                >
                  {lang === 'ru' ? 'Виртуальная\nпримерка' : 'Virtual\nprimerka'}
                </Text>
                <Text
                  variant="caption"
                  style={{ color: 'rgba(228,206,154,0.7)', fontSize: 11, lineHeight: 15 }}
                >
                  {lang === 'ru'
                    ? 'Примерьте перед покупкой'
                    : "Xarid qilishdan oldin kiyib ko'ring"}
                </Text>
              </View>
              <View
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 36,
                  backgroundColor: 'rgba(201,169,110,0.15)',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 1.5,
                  borderColor: 'rgba(201,169,110,0.3)',
                }}
              >
                <Ionicons name="body-outline" size={34} color={colors.goldSoft} />
              </View>
            </LinearGradient>
          </Pressable>
        )}

        {/* ── Stores ── */}
        <View style={{ marginTop: 28 }}>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              paddingHorizontal: SIDE,
            }}
          >
            <Text variant="titleMedium" color="oliveDeep" style={{ fontSize: 18 }}>
              {t('home.stores')}
            </Text>
            <Pressable
              onPress={() => router.push('/stores')}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
            >
              <Text variant="caption" color="gold" style={{ fontWeight: '600' }}>
                {t('home.allStores')}
              </Text>
              <Ionicons name="arrow-forward" size={14} color={colors.gold} />
            </Pressable>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: SIDE, paddingTop: 14, paddingBottom: 4, gap: 14 }}
          >
            {stores.map((store, idx) => {
              const ringColor = STORE_COLORS[idx % STORE_COLORS.length];
              return (
                <Pressable
                  key={store.id}
                  onPress={() =>
                    router.push({ pathname: '/shop/[id]', params: { id: store.id } })
                  }
                  style={{ alignItems: 'center', gap: 6, width: 72 }}
                >
                  {/* Ring */}
                  <View
                    style={{
                      width: 64,
                      height: 64,
                      borderRadius: 32,
                      borderWidth: 2.5,
                      borderColor: ringColor,
                      padding: 3,
                    }}
                  >
                    <View
                      style={{
                        flex: 1,
                        borderRadius: 28,
                        backgroundColor: colors.surface,
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'hidden',
                      }}
                    >
                      {store.logoUrl ? (
                        <Image
                          source={{ uri: store.logoUrl }}
                          style={{ width: '100%', height: '100%' }}
                          resizeMode="cover"
                        />
                      ) : (
                        <Text
                          variant="titleSmall"
                          style={{
                            color: ringColor,
                            fontWeight: '800',
                            fontSize: 14,
                            letterSpacing: 0.5,
                          }}
                        >
                          {store.brandName.slice(0, 2).toUpperCase()}
                        </Text>
                      )}
                    </View>
                  </View>
                  <Text
                    variant="caption"
                    color="ink"
                    numberOfLines={1}
                    style={{ fontSize: 10, fontWeight: '500', textAlign: 'center' }}
                  >
                    {store.brandName.split(' ')[0]}
                  </Text>
                </Pressable>
              );
            })}

            {/* Add store */}
            <Pressable
              onPress={() => router.push('/(tabs)/catalog')}
              style={{ alignItems: 'center', gap: 6, width: 72 }}
            >
              <View
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 32,
                  borderWidth: 1.5,
                  borderColor: colors.rule,
                  borderStyle: 'dashed',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="add" size={22} color={colors.muted} />
              </View>
              <Text variant="caption" color="muted" style={{ fontSize: 10 }}>
                {lang === 'ru' ? 'Ещё' : "Qo'shish"}
              </Text>
            </Pressable>
          </ScrollView>
        </View>

        {/* ── Categories ── */}
        <View style={{ marginTop: 24 }}>
          <View style={{ paddingHorizontal: SIDE, marginBottom: 14 }}>
            <Text variant="titleMedium" color="oliveDeep" style={{ fontSize: 18 }}>
              {lang === 'ru' ? 'Категории' : 'Kategoriyalar'}
            </Text>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: SIDE, gap: 12 }}
          >
            {CATEGORY_DATA.map((cat) => (
              <Pressable
                key={cat.id}
                onPress={() =>
                  router.push({ pathname: '/(tabs)/catalog', params: { category: cat.id } })
                }
                style={({ pressed }) => ({
                  width: (SCREEN_W - SIDE * 2 - 36) / 4,
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <View
                  style={{
                    aspectRatio: 3 / 4,
                    borderRadius: theme.radii.xl,
                    overflow: 'hidden',
                    position: 'relative',
                    ...theme.shadows.sm,
                  }}
                >
                  <Image
                    source={cat.image}
                    style={{ width: '100%', height: '100%' }}
                    resizeMode="cover"
                  />
                  {/* Website parity: dark gradient from the bottom so the
                      caption below reads well regardless of the photo. */}
                  <LinearGradient
                    colors={['transparent', 'rgba(0,0,0,0.55)']}
                    start={{ x: 0, y: 0.4 }}
                    end={{ x: 0, y: 1 }}
                    style={{ position: 'absolute', left: 0, right: 0, bottom: 0, top: 0 }}
                  />
                  <Text
                    variant="caption"
                    numberOfLines={1}
                    style={{
                      position: 'absolute',
                      left: 6,
                      right: 6,
                      bottom: 6,
                      color: '#fff',
                      fontWeight: '600',
                      fontSize: 11,
                      textAlign: 'center',
                    }}
                  >
                    {t(`home.categories.${cat.id}` as never, { defaultValue: cat.id })}
                  </Text>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        {/* ── TOP + Premium stores strip (TZ Phase 4) ── */}
        {topStores.length > 0 && (
          <View style={{ marginTop: 24 }}>
            <View style={{ paddingHorizontal: SIDE, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="star" size={16} color={colors.gold} />
                <Text variant="titleMedium" color="oliveDeep" style={{ fontSize: 18 }}>
                  {lang === 'ru' ? 'Избранные магазины' : "Tanlangan do'konlar"}
                </Text>
              </View>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: SIDE, paddingTop: 12, gap: 10 }}
            >
              {topStores.map((s) => {
                const premium = s.isPremium;
                return (
                  <Pressable
                    key={s.id}
                    onPress={() => router.push({ pathname: '/shop/[id]', params: { id: s.id } })}
                    style={{
                      width: 180,
                      padding: 14,
                      borderRadius: 18,
                      borderWidth: premium ? 2 : 1,
                      borderColor: premium ? colors.gold : colors.rule,
                      backgroundColor: premium ? colors.oliveDeep : colors.surface,
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <View style={{
                        width: 44, height: 44, borderRadius: 22,
                        backgroundColor: premium ? colors.gold : colors.oliveDeep,
                        alignItems: 'center', justifyContent: 'center',
                        overflow: 'hidden',
                      }}>
                        <Text variant="displayLarge" style={{ fontFamily: theme.fontFamilies.display, fontSize: 18, color: premium ? colors.oliveDeep : colors.goldSoft, fontWeight: '700' }}>
                          {s.brandName.slice(0, 1).toUpperCase()}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          <Text variant="caption" style={{
                            fontSize: 9,
                            fontWeight: '800',
                            letterSpacing: 1,
                            color: premium ? colors.gold : colors.oliveDeep,
                          }}>
                            {premium ? 'PREMIUM' : 'TOP'}
                          </Text>
                        </View>
                        <Text numberOfLines={1} variant="body" style={{
                          fontSize: 13,
                          fontWeight: '700',
                          color: premium ? colors.goldSoft : colors.ink,
                          marginTop: 2,
                        }}>
                          {s.brandName}
                        </Text>
                      </View>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 10 }}>
                      <Ionicons name="star" size={11} color={colors.gold} />
                      <Text variant="caption" style={{ fontSize: 11, color: premium ? 'rgba(245,241,232,0.7)' : colors.muted }}>
                        {s.rating.toFixed(1)} · {s.reviewsCount}
                      </Text>
                      {s.city && (
                        <Text variant="caption" style={{ fontSize: 11, color: premium ? 'rgba(245,241,232,0.5)' : colors.muted }}>
                          · {s.city}
                        </Text>
                      )}
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* ── Nearby products (replaces New Arrivals, TZ Phase 4) ── */}
        <View style={{ marginTop: 28 }}>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              paddingHorizontal: SIDE,
            }}
          >
            <Text variant="titleMedium" color="oliveDeep" style={{ fontSize: 18 }}>
              {lang === 'ru' ? 'Магазины рядом' : "Yaqin atrofdagi do'konlar"}
            </Text>
            <Pressable
              onPress={() => router.push('/(tabs)/catalog')}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
            >
              <Text variant="caption" color="gold" style={{ fontWeight: '600' }}>
                {t('common.seeAll')}
              </Text>
              <Ionicons name="arrow-forward" size={14} color={colors.gold} />
            </Pressable>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: SIDE, paddingTop: 14, gap: 14 }}
          >
            {arrivals.map((p, idx) => {
              const bg = PLACEHOLDER_BG[idx % PLACEHOLDER_BG.length];
              return (
                <Pressable
                  key={p.id}
                  onPress={() =>
                    router.push({ pathname: '/product/[id]', params: { id: p.id } })
                  }
                  style={({ pressed }) => ({
                    width: 170,
                    backgroundColor: colors.surface,
                    borderRadius: 20,
                    overflow: 'hidden',
                    borderWidth: 1,
                    borderColor: colors.rule,
                    opacity: pressed ? 0.92 : 1,
                  })}
                >
                  {/* Image */}
                  <View style={{ height: 210, backgroundColor: bg, position: 'relative' }}>
                    {(() => {
                      const scene = sceneById((p.attributes as any)?.sceneId);
                      if (!scene) return null;
                      return (
                        <Image
                          source={scene.source}
                          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' }}
                          resizeMode="cover"
                        />
                      );
                    })()}
                    {p.coverUrl ? (
                      <Image
                        source={{ uri: p.coverUrl }}
                        style={{ width: '100%', height: '100%' }}
                        resizeMode="contain"
                      />
                    ) : (
                      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name="ribbon-outline" size={36} color="rgba(255,255,255,0.3)" />
                      </View>
                    )}
                    {/* Wishlist */}
                    <Pressable
                      onPress={(e) => {
                        e.stopPropagation?.();
                        addWishlist.mutate(p.id);
                      }}
                      hitSlop={8}
                      style={{
                        position: 'absolute',
                        top: 10,
                        right: 10,
                        width: 32,
                        height: 32,
                        borderRadius: 16,
                        backgroundColor: 'rgba(0,0,0,0.45)',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Ionicons name="heart-outline" size={16} color="#fff" />
                    </Pressable>
                    {/* Try-on badge */}
                    <View
                      style={{
                        position: 'absolute',
                        top: 10,
                        left: 10,
                        backgroundColor: colors.olive,
                        paddingHorizontal: 10,
                        paddingVertical: 4,
                        borderRadius: 999,
                      }}
                    >
                      <Text
                        variant="caption"
                        style={{ color: '#fff', fontSize: 9, fontWeight: '700', letterSpacing: 0.5 }}
                      >
                        TRY-ON
                      </Text>
                    </View>
                  </View>

                  {/* Info */}
                  <View style={{ padding: 12, gap: 4 }}>
                    {p.seller && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <View
                          style={{
                            width: 16,
                            height: 16,
                            borderRadius: 8,
                            backgroundColor: colors.olive,
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Text
                            variant="caption"
                            style={{ color: '#fff', fontSize: 7, fontWeight: '800' }}
                          >
                            {p.seller.brandName[0]}
                          </Text>
                        </View>
                        <Text
                          variant="caption"
                          color="muted"
                          numberOfLines={1}
                          style={{ fontSize: 10 }}
                        >
                          {p.seller.brandName}
                        </Text>
                        <View
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 2,
                            marginLeft: 'auto',
                          }}
                        >
                          <Ionicons name="star" size={9} color={colors.gold} />
                          <Text variant="caption" color="muted" style={{ fontSize: 9 }}>
                            {p.seller.rating}
                          </Text>
                        </View>
                      </View>
                    )}
                    <Text variant="bodySmall" color="ink" numberOfLines={1}>
                      {lang === 'ru' ? p.title.ru : (p.title.uz ?? p.title.ru)}
                    </Text>
                    <View
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginTop: 2,
                      }}
                    >
                      <Text
                        variant="titleSmall"
                        color="oliveDeep"
                        style={{ fontWeight: '700', fontSize: 16 }}
                      >
                        ${p.basePriceUsd}
                      </Text>
                      <Pressable
                        onPress={(e) => {
                          e.stopPropagation?.();
                          const vid = p.variants?.[0]?.id;
                          if (vid) addCart.mutate(vid);
                        }}
                        hitSlop={6}
                        style={{
                          width: 30,
                          height: 30,
                          borderRadius: 15,
                          backgroundColor: colors.olive,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Ionicons name="add" size={16} color="#fff" />
                      </Pressable>
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

      </ScrollView>
    </Screen>
  );
}
