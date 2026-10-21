import { useState, useCallback } from 'react';
import { Alert, Image, Modal, Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { LinearGradient } from 'expo-linear-gradient';
import { Screen } from '../../src/components/Screen';
import { Text } from '../../src/components/Text';
import { useTheme } from '../../src/theme/ThemeProvider';
import { api } from '../../src/api/client';
import { errorMessage, errorTitle } from '../../src/lib/api-errors';
import { safeBack } from '../../src/lib/safe-back';

type CategoryId = 'scarves' | 'dresses' | 'bags' | 'accessories';
type SortKey = 'popularity' | 'price-asc' | 'price-desc' | 'rating';

const SORT_LABELS: Record<SortKey, { uz: string; ru: string }> = {
  popularity: { uz: "Ommaboplik bo'yicha", ru: 'По популярности' },
  'price-asc': { uz: "Narx: arzondan qimmatga", ru: 'Цена: от низкой' },
  'price-desc': { uz: "Narx: qimmatdan arzonga", ru: 'Цена: от высокой' },
  rating: { uz: "Reyting bo'yicha", ru: 'По рейтингу' },
};

interface Product {
  id: string;
  title: { ru: string; uz: string };
  basePriceUsd: number;
  coverUrl: string;
  seller: { brandName: string; rating: number; reviewsCount: number };
  // Needed so the "+" quick-add can pick the first variant without a
  // product-detail round trip.
  variants?: Array<{ id: string }>;
}

const CATEGORY_ICONS: Record<CategoryId, string> = {
  scarves: 'ribbon-outline',
  dresses: 'shirt-outline',
  bags: 'bag-handle-outline',
  accessories: 'diamond-outline',
};

// Hero cards for the category rail. Images were lifted from the website
// (public/images/category-*.webp) so the two surfaces read as one brand.
const CATEGORY_CARDS: Array<{ id: CategoryId; label: string; img: number }> = [
  { id: 'scarves', label: "Ro'mollar", img: require('../../assets/categories/scarves.webp') },
  { id: 'dresses', label: "Ko'ylaklar", img: require('../../assets/categories/dresses.webp') },
  { id: 'bags', label: 'Sumkalar', img: require('../../assets/categories/bags.webp') },
  { id: 'accessories', label: 'Aksessuarlar', img: require('../../assets/categories/accessories.webp') },
];

const COLORS: Array<{ key: string; hex: string }> = [
  { key: 'yellow', hex: '#F4D06F' },
  { key: 'white', hex: '#F8F5EE' },
  { key: 'beige', hex: '#D4C3A0' },
  { key: 'pink', hex: '#E8B0B0' },
  { key: 'gray', hex: '#B0AEA7' },
  { key: 'green', hex: '#7A8A5B' },
  { key: 'blue', hex: '#5F7A94' },
  { key: 'black', hex: '#1A1A1A' },
  { key: 'brown', hex: '#8B6E4E' },
  { key: 'burgundy', hex: '#722F37' },
];

export default function CatalogScreen() {
  const { t, i18n } = useTranslation();
  const { colors, theme } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ category?: CategoryId }>();
  const queryClient = useQueryClient();
  const lang = (i18n.language?.slice(0, 2) ?? 'uz') as 'uz' | 'ru';

  const [category, setCategory] = useState<CategoryId>(params.category ?? 'scarves');
  const [showFilters, setShowFilters] = useState(false);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('popularity');
  const [sortOpen, setSortOpen] = useState(false);

  const { data, isError } = useQuery({
    queryKey: ['products', category, selectedColor, sortKey],
    queryFn: async () =>
      (await api.get('/catalog/products', {
        params: {
          category,
          ...(selectedColor && { color: selectedColor }),
          sort: sortKey,
          pageSize: 20,
        },
      })).data,
  });

  const products: Product[] = (() => {
    const items: Product[] = data?.items ?? [];
    // Backend may not sort yet — apply a client-side pass so the user
    // sees a reaction even against an older API build.
    const copy = [...items];
    switch (sortKey) {
      case 'price-asc':
        return copy.sort((a, b) => a.basePriceUsd - b.basePriceUsd);
      case 'price-desc':
        return copy.sort((a, b) => b.basePriceUsd - a.basePriceUsd);
      case 'rating':
        return copy.sort(
          (a, b) => (b.seller?.rating ?? 0) - (a.seller?.rating ?? 0),
        );
      case 'popularity':
      default:
        return copy.sort(
          (a, b) =>
            (b.seller?.reviewsCount ?? 0) - (a.seller?.reviewsCount ?? 0),
        );
    }
  })();

  // Wishlist toggle — the catalog card hearts share one mutation to avoid
  // one in-flight request per card and keep wishlist count queries in sync.
  const addWishlist = useMutation({
    mutationFn: async (productId: string) =>
      (await api.post(`/wishlist/${productId}`)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile-wishlist-count'] });
      queryClient.invalidateQueries({ queryKey: ['wishlist'] });
    },
    onError: (e) => Alert.alert(errorTitle(), errorMessage(e)),
  });

  // Add first variant to cart — the card's "+" is a one-tap convenience;
  // size/color pickers live on the product detail screen.
  const addCart = useMutation({
    mutationFn: async (variantId: string) =>
      (await api.post('/cart', { variantId, quantity: 1 })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cart'] });
      const title = lang === 'ru' ? 'Готово' : 'Qo\'shildi';
      const msg = lang === 'ru' ? 'Товар добавлен в корзину' : 'Mahsulot savatga qo\'shildi';
      Alert.alert(title, msg);
    },
    onError: (e) => Alert.alert(errorTitle(), errorMessage(e)),
  });

  const renderProduct = useCallback(
    ({ item, index }: { item: Product; index: number }) => (
      <ProductCard
        product={item}
        index={index}
        onPress={() => router.push({ pathname: '/product/[id]', params: { id: item.id } })}
        onAddToWishlist={() => addWishlist.mutate(item.id)}
        onAddToCart={() => {
          const firstVariantId = item.variants?.[0]?.id;
          if (firstVariantId) addCart.mutate(firstVariantId);
        }}
        isLeft={index % 2 === 0}
      />
    ),
    // mutations are stable singletons from react-query; router captured once
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router],
  );

  const listHeader = (
    <>
      {/* Header */}
      <View
        style={{
          paddingHorizontal: 20,
          paddingTop: 8,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Pressable
          onPress={() => safeBack()}
          hitSlop={12}
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: colors.surfaceGlass,
            borderWidth: 1,
            borderColor: colors.ruleSoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="chevron-back" size={20} color={colors.oliveDeep} />
        </Pressable>
        <Text
          variant="displayLarge"
          color="oliveDeep"
          style={{ fontSize: 22, letterSpacing: -0.5 }}
        >
          24:31
        </Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable
            onPress={() => router.push('/wishlist')}
            hitSlop={8}
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: colors.surfaceGlass,
              borderWidth: 1,
              borderColor: colors.ruleSoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="heart-outline" size={20} color={colors.oliveDeep} />
          </Pressable>
          <Pressable
            onPress={() => router.push('/(tabs)/cart')}
            hitSlop={8}
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: colors.surfaceGlass,
              borderWidth: 1,
              borderColor: colors.ruleSoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="bag-outline" size={20} color={colors.oliveDeep} />
            <View
              style={{
                position: 'absolute',
                top: 8,
                right: 8,
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: colors.danger,
                borderWidth: 2,
                borderColor: colors.bg,
              }}
            />
          </Pressable>
        </View>
      </View>

      {/* Title */}
      <View style={{ paddingHorizontal: 20, marginTop: 16 }}>
        <Text variant="displayLarge" color="oliveDeep">
          {t(`catalog.${category === 'scarves' ? 'scarves' : 'dresses'}.title`)}
        </Text>
        <Text variant="bodySmall" color="muted" style={{ marginTop: 2 }}>
          {t(`catalog.${category === 'scarves' ? 'scarves' : 'dresses'}.subtitle`)}
        </Text>
      </View>

      {/* Category Rail — image cards (website parity) */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 16, gap: 12 }}
      >
        {CATEGORY_CARDS.map((c) => {
          const active = c.id === category;
          return (
            <Pressable
              key={c.id}
              onPress={() => setCategory(c.id)}
              style={{
                width: 128,
                height: 170,
                borderRadius: 18,
                overflow: 'hidden',
                borderWidth: active ? 2 : 1,
                borderColor: active ? colors.goldDark : colors.ruleSoft,
                backgroundColor: colors.surface2,
                shadowColor: '#000',
                shadowOpacity: active ? 0.18 : 0.08,
                shadowRadius: active ? 12 : 8,
                shadowOffset: { width: 0, height: 4 },
                elevation: active ? 6 : 3,
              }}
            >
              <Image
                source={c.img}
                style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' }}
                resizeMode="cover"
              />
              <LinearGradient
                colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.6)']}
                start={{ x: 0.5, y: 0.4 }}
                end={{ x: 0.5, y: 1 }}
                style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '55%' }}
              />
              <View
                style={{
                  position: 'absolute',
                  left: 10,
                  right: 10,
                  bottom: 10,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Ionicons
                  name={CATEGORY_ICONS[c.id] as any}
                  size={14}
                  color={active ? colors.goldSoft : 'rgba(255,255,255,0.9)'}
                />
                <Text
                  variant="bodySmall"
                  style={{
                    color: '#FFF',
                    fontWeight: '700',
                    fontFamily: theme.fontFamilies.display,
                    fontSize: 14,
                  }}
                >
                  {c.label}
                </Text>
              </View>
              {active && (
                <View
                  style={{
                    position: 'absolute',
                    top: 10,
                    right: 10,
                    width: 22,
                    height: 22,
                    borderRadius: 11,
                    backgroundColor: colors.goldDark,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons name="checkmark" size={14} color="#FFF" />
                </View>
              )}
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Filter + Sort */}
      <View style={{ flexDirection: 'row', paddingHorizontal: 20, gap: 10, marginBottom: 8 }}>
        <Pressable
          onPress={() => setShowFilters((v) => !v)}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingHorizontal: 14,
            height: 36,
            borderRadius: 18,
            backgroundColor: showFilters ? colors.oliveDeep : colors.surface,
            borderWidth: showFilters ? 0 : 1,
            borderColor: colors.rule,
          }}
        >
          <Ionicons
            name="options-outline"
            size={16}
            color={showFilters ? colors.goldSoft : colors.ink}
          />
          <Text
            variant="bodySmall"
            style={{ color: showFilters ? colors.goldSoft : colors.ink, fontWeight: '500' }}
          >
            {t('catalog.filters')}
          </Text>
          <Ionicons
            name={showFilters ? 'chevron-up' : 'chevron-down'}
            size={14}
            color={showFilters ? colors.goldSoft : colors.muted}
          />
        </Pressable>
        <Pressable
          onPress={() => setSortOpen(true)}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingHorizontal: 14,
            height: 36,
            borderRadius: 18,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.rule,
            flex: 1,
          }}
        >
          <Ionicons name="swap-vertical-outline" size={14} color={colors.muted} />
          <Text variant="bodySmall" color="ink" style={{ flex: 1 }}>
            {SORT_LABELS[sortKey][lang]}
          </Text>
          <Ionicons name="chevron-down" size={12} color={colors.muted} />
        </Pressable>
      </View>

      {/* Filter Panel */}
      {showFilters && (
        <View
          style={{
            marginHorizontal: 20,
            marginBottom: 12,
            padding: 14,
            backgroundColor: colors.surface,
            borderRadius: theme.radii.xl,
            borderWidth: 1,
            borderColor: colors.rule,
          }}
        >
          <View
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <Text variant="titleSmall" color="ink">
              {t('catalog.color')}
            </Text>
            {selectedColor && (
              <Pressable onPress={() => setSelectedColor(null)}>
                <Text variant="caption" color="oliveDeep" style={{ fontWeight: '500' }}>
                  {t('common.reset')}
                </Text>
              </Pressable>
            )}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 }}>
            {COLORS.map((c) => {
              const active = c.key === selectedColor;
              return (
                <Pressable
                  key={c.key}
                  onPress={() => setSelectedColor(active ? null : c.key)}
                  style={{ alignItems: 'center', gap: 4, width: 44 }}
                >
                  <View
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 18,
                      backgroundColor: c.hex,
                      borderWidth: active ? 2.5 : 1,
                      borderColor: active ? colors.oliveDeep : colors.rule,
                    }}
                  />
                  <Text
                    variant="caption"
                    style={{
                      color: active ? colors.oliveDeep : colors.muted,
                      fontSize: 9,
                      fontWeight: active ? '600' : '400',
                    }}
                  >
                    {t(`catalog.colors.${c.key}` as never, { defaultValue: c.key })}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}
    </>
  );

  return (
    <Screen>
      <View style={{ flex: 1 }}>
        <FlashList
          data={products}
          numColumns={2}
          estimatedItemSize={280}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingBottom: 24 }}
          ListHeaderComponent={listHeader}
          renderItem={renderProduct}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingTop: 60, gap: 12 }}>
              <Ionicons
                name={isError ? 'cloud-offline-outline' : 'search-outline'}
                size={48}
                color={colors.muted}
              />
              <Text variant="body" color="muted">
                {isError
                  ? (lang === 'ru' ? 'Не удалось загрузить товары' : "Mahsulotlar yuklanmadi")
                  : (lang === 'ru' ? 'Товары не найдены' : 'Mahsulot topilmadi')}
              </Text>
            </View>
          }
        />
      </View>
      <SortSheet
        open={sortOpen}
        current={sortKey}
        onPick={(k) => {
          setSortKey(k);
          setSortOpen(false);
        }}
        onClose={() => setSortOpen(false)}
        lang={lang}
      />
    </Screen>
  );
}

function SortSheet({
  open,
  current,
  onPick,
  onClose,
  lang,
}: {
  open: boolean;
  current: SortKey;
  onPick: (k: SortKey) => void;
  onClose: () => void;
  lang: 'uz' | 'ru';
}) {
  const { colors, theme } = useTheme();
  const keys: SortKey[] = ['popularity', 'price-asc', 'price-desc', 'rating'];
  return (
    <Modal
      transparent
      visible={open}
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        onPress={onClose}
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.35)',
          justifyContent: 'flex-end',
        }}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{
            backgroundColor: colors.surface,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            paddingTop: 16,
            paddingBottom: 32,
          }}
        >
          <View
            style={{
              alignSelf: 'center',
              width: 44,
              height: 4,
              borderRadius: 2,
              backgroundColor: colors.rule,
              marginBottom: 14,
            }}
          />
          <Text
            variant="body"
            color="oliveDeep"
            style={{
              fontSize: 16,
              fontWeight: '700',
              paddingHorizontal: 20,
              marginBottom: 10,
              fontFamily: theme.fontFamilies.display,
            }}
          >
            {lang === 'ru' ? 'Сортировка' : 'Saralash'}
          </Text>
          {keys.map((k) => {
            const active = k === current;
            return (
              <Pressable
                key={k}
                onPress={() => onPick(k)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingHorizontal: 20,
                  paddingVertical: 14,
                  backgroundColor: active ? `${colors.goldDark}14` : 'transparent',
                }}
              >
                <Text
                  variant="body"
                  color="ink"
                  style={{
                    fontSize: 14,
                    fontWeight: active ? '600' : '500',
                  }}
                >
                  {SORT_LABELS[k][lang]}
                </Text>
                {active && (
                  <Ionicons name="checkmark" size={18} color={colors.goldDark} />
                )}
              </Pressable>
            );
          })}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const PLACEHOLDER_BG = [
  '#B5B891', '#E4CE9A', '#D4C3A0', '#C4C88C', '#D9D0BE', '#E8DFCC',
];

function ProductCard({
  product,
  index,
  onPress,
  onAddToWishlist,
  onAddToCart,
  isLeft,
}: {
  product: Product;
  index: number;
  onPress: () => void;
  onAddToWishlist: () => void;
  onAddToCart: () => void;
  isLeft: boolean;
}) {
  const { colors, theme } = useTheme();
  const [imgError, setImgError] = useState(!product.coverUrl);
  const bg = PLACEHOLDER_BG[index % PLACEHOLDER_BG.length];

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        marginRight: isLeft ? 6 : 16,
        marginLeft: isLeft ? 16 : 6,
        marginBottom: 12,
        backgroundColor: colors.surface,
        borderRadius: 20,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: colors.rule,
        opacity: pressed ? 0.92 : 1,
      })}
    >
      {/* Image */}
      <View style={{ height: 200, backgroundColor: bg, position: 'relative' }}>
        {!imgError && product.coverUrl ? (
          <Image
            source={{ uri: product.coverUrl }}
            style={{ width: '100%', height: '100%' }}
            resizeMode="cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="ribbon-outline" size={40} color="rgba(255,255,255,0.35)" />
          </View>
        )}
        {/* Wishlist */}
        <Pressable
          onPress={(e) => {
            e.stopPropagation?.();
            onAddToWishlist();
          }}
          hitSlop={8}
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            width: 30,
            height: 30,
            borderRadius: 15,
            backgroundColor: 'rgba(255,255,255,0.8)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="heart-outline" size={16} color={colors.ink} />
        </Pressable>
        {/* TRY-ON Badge */}
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
      <View style={{ padding: 10, gap: 4 }}>
        <Text variant="bodySmall" color="ink" numberOfLines={1}>
          {product.title.ru}
        </Text>

        <Text variant="caption" color="muted" style={{ fontSize: 11 }}>
          {product.seller.brandName} · <Text variant="caption" style={{ color: colors.gold, fontSize: 11 }}>★</Text> {product.seller.rating}
        </Text>

        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 2,
          }}
        >
          <Text variant="titleSmall" color="oliveDeep" style={{ fontWeight: '700' }}>
            ${product.basePriceUsd}
          </Text>
          <Pressable
            onPress={(e) => {
              e.stopPropagation?.();
              onAddToCart();
            }}
            hitSlop={8}
            style={{
              width: 28,
              height: 28,
              borderRadius: 14,
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
}
