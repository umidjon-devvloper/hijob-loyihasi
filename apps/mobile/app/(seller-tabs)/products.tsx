import { useState } from 'react';
import { Alert, FlatList, Image, Pressable, RefreshControl, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../../src/components/Screen';
import { Text } from '../../src/components/Text';
import { useTheme } from '../../src/theme/ThemeProvider';
import { api } from '../../src/api/client';

// Backend product status enum (prisma ProductStatus). "published" is what the
// UI used to call "live"; "archived" and "rejected" are grouped under
// "pending" so the filter chip set stays manageable.
type BackendStatus = 'draft' | 'pending' | 'published' | 'archived' | 'rejected';
type FilterKey = 'all' | 'draft' | 'pending' | 'published';

interface SellerProduct {
  id: string;
  titleRu: string;
  titleUz: string | null;
  basePriceUsd: number;
  coverUrl: string | null;
  status: BackendStatus;
  variantCount: number;
  totalStock: number;
}

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'Barchasi' },
  { key: 'published', label: 'Live' },
  { key: 'draft', label: 'Draft' },
  { key: 'pending', label: 'Kutmoqda' },
];

const STATUS_STYLE: Record<BackendStatus, { bg: string; color: string; label: string }> = {
  published: { bg: 'rgba(122,138,91,0.12)', color: '#7A8A5B', label: 'Live' },
  draft: { bg: 'rgba(133,126,110,0.1)', color: '#857E6E', label: 'Draft' },
  pending: { bg: 'rgba(217,162,75,0.12)', color: '#D9A24B', label: 'Kutmoqda' },
  archived: { bg: 'rgba(133,126,110,0.1)', color: '#857E6E', label: 'Arxiv' },
  rejected: { bg: 'rgba(184,84,80,0.08)', color: '#B85450', label: 'Rad' },
};

const PLACEHOLDER_BG = ['#EDE5D0', '#D9D0BE', '#E4CE9A', '#D9D0BE', '#EDE5D0'];

export default function SellerProductsScreen() {
  const { colors, theme } = useTheme();
  const router = useRouter();
  const { i18n } = useTranslation();
  const isRu = (i18n.language?.slice(0, 2) ?? 'uz') === 'ru';
  const lang = (i18n.language?.slice(0, 2) ?? 'uz') as 'uz' | 'ru' | 'en' | 'ar';
  const L = (uz: string, ru: string, en: string, ar: string) => ({ uz, ru, en, ar }[lang] ?? uz);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');
  const queryClient = useQueryClient();

  const openProductMenu = (item: SellerProduct) => {
    Alert.alert(
      item.titleRu || item.titleUz || L('Mahsulot', 'Товар', 'Product', 'منتج'),
      L('Nima qilmoqchisiz?', 'Что хотите сделать?', 'What would you like to do?', 'ماذا تريد أن تفعل؟'),
      [
        {
          text: L('Ko\'rish', 'Открыть', 'Open', 'فتح'),
          onPress: () => router.push(`/seller/product/${item.id}` as any),
        },
        {
          text: L('Narx', 'Цена', 'Price', 'السعر'),
          onPress: () => promptEdit(item),
        },
        {
          text: L('Orqa fon', 'Фон', 'Backdrop', 'الخلفية'),
          onPress: () => promptScene(item),
        },
        {
          text: L('O\'chirish', 'Удалить', 'Delete', 'حذف'),
          style: 'destructive',
          onPress: () => confirmDelete(item),
        },
        { text: L('Bekor', 'Отмена', 'Cancel', 'إلغаء'), style: 'cancel' },
      ],
    );
  };

  const promptScene = (item: SellerProduct) => {
    Alert.alert(
      L('Orqa fonni tanlang', 'Выберите фон', 'Pick a backdrop', 'اختر الخلفية'),
      item.titleRu || '',
      [
        {
          text: L('Zumrad ko\'k', 'Голубой', 'Blue', 'أزرق'),
          onPress: () => applyScene(item.id, 'blue'),
        },
        {
          text: L('Zaytun', 'Оливковый', 'Olive', 'زيتوني'),
          onPress: () => applyScene(item.id, 'olive'),
        },
        {
          text: L('Krem', 'Бежевый', 'Beige', 'بيج'),
          onPress: () => applyScene(item.id, 'beige'),
        },
        { text: L('Bekor', 'Отмена', 'Cancel', 'إلغаء'), style: 'cancel' },
      ],
    );
  };

  const applyScene = async (productId: string, sceneId: 'blue' | 'olive' | 'beige') => {
    try {
      await api.patch(`/seller/products/${productId}`, { sceneId });
      await queryClient.invalidateQueries({ queryKey: ['seller', 'products'] });
    } catch (e: any) {
      Alert.alert(L('Xato', 'Ошибка', 'Error', 'خطأ'), e?.response?.data?.message ?? e?.message ?? 'xatolik');
    }
  };

  const promptEdit = (item: SellerProduct) => {
    Alert.prompt?.(
      L('Narx (USD)', 'Цена (USD)', 'Price (USD)', 'السعر (USD)'),
      L('Yangi narxni kiriting', 'Введите новую цену', 'Enter the new price', 'أدخل السعر الجديد'),
      [
        { text: L('Bekor', 'Отмена', 'Cancel', 'إلغاء'), style: 'cancel' },
        {
          text: L('Saqlash', 'Сохранить', 'Save', 'حفظ'),
          onPress: async (value?: string) => {
            const price = Number(value);
            if (!value || Number.isNaN(price) || price <= 0) {
              Alert.alert(L('Xato', 'Ошибка', 'Error', 'خطأ'), L('Narx noto\'g\'ri', 'Неверная цена', 'Invalid price', 'سعر غير صحيح'));
              return;
            }
            try {
              await api.patch(`/seller/products/${item.id}`, { basePriceUsd: price });
              await queryClient.invalidateQueries({ queryKey: ['seller', 'products'] });
            } catch (e: any) {
              Alert.alert(L('Xato', 'Ошибка', 'Error', 'خطأ'), e?.response?.data?.message ?? e?.message ?? 'xatolik');
            }
          },
        },
      ],
      'plain-text',
      String(item.basePriceUsd),
    );
  };

  const confirmDelete = (item: SellerProduct) => {
    Alert.alert(
      L('O\'chirishni tasdiqlang', 'Подтвердите удаление', 'Confirm deletion', 'تأكيد الحذف'),
      L(
        'Bu mahsulot katalogdan olib tashlanadi. Bekor qilib bo\'lmaydi.',
        'Товар будет убран из каталога. Отменить нельзя.',
        'This product will be removed from the catalog. Cannot be undone.',
        'سيتم إزالة المنتج من الكتالوج. لا يمكن التراجع.',
      ),
      [
        { text: L('Bekor', 'Отмена', 'Cancel', 'إلغاء'), style: 'cancel' },
        {
          text: L('O\'chirish', 'Удалить', 'Delete', 'حذف'),
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/seller/products/${item.id}`);
              await queryClient.invalidateQueries({ queryKey: ['seller', 'products'] });
            } catch (e: any) {
              Alert.alert(L('Xato', 'Ошибка', 'Error', 'خطأ'), e?.response?.data?.message ?? e?.message ?? 'xatolik');
            }
          },
        },
      ],
    );
  };

  // Backend returns the full list; we filter client-side so switching tabs
  // is instant and the badge counts stay in sync with real data.
  const { data: products, refetch } = useQuery<SellerProduct[]>({
    queryKey: ['seller', 'products'],
    queryFn: async () => (await api.get<SellerProduct[]>('/seller/products')).data,
    staleTime: 15_000,
  });

  const items = (products ?? []).filter(
    (p) =>
      (filter === 'all' || p.status === filter) &&
      (!search || p.titleRu.toLowerCase().includes(search.toLowerCase())),
  );

  return (
    <Screen>
      {/* Header */}
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingHorizontal: 20,
          paddingTop: 8,
          paddingBottom: 16,
        }}
      >
        <View>
          <Text
            variant="displayLarge"
            color="oliveDeep"
            style={{
              fontFamily: theme.fontFamilies.display,
              fontSize: 26,
              fontWeight: '700',
            }}
          >
            {L('Mahsulotlar', 'Товары', 'Products', 'المنتجات')}
          </Text>
          <Text variant="bodySmall" color="muted" style={{ fontSize: 13, marginTop: 2 }}>
            {items.length} {L('ta mahsulot', 'товара', 'products', 'منتج')}
          </Text>
        </View>
        <Pressable
          onPress={() => router.push('/seller/add-product' as any)}
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: colors.oliveDeep,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="add" size={20} color={colors.goldSoft} />
        </Pressable>
      </View>

      {/* Search */}
      <View style={{ paddingHorizontal: 20, paddingBottom: 12 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            paddingHorizontal: 14,
            paddingVertical: 12,
            backgroundColor: colors.surface,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: colors.rule,
          }}
        >
          <Ionicons name="search-outline" size={18} color={colors.muted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder={L('Qidirish...', 'Поиск...', 'Search...', 'بحث...')}
            placeholderTextColor={colors.muted}
            style={{ flex: 1, fontSize: 14, color: colors.ink, padding: 0 }}
          />
        </View>
      </View>

      {/* Filter Pills */}
      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingBottom: 12 }}>
        {FILTERS.map((f) => {
          const active = f.key === filter;
          return (
            <Pressable
              key={f.key}
              onPress={() => setFilter(f.key)}
              style={{
                paddingHorizontal: 14,
                paddingVertical: 6,
                borderRadius: 20,
                backgroundColor: active ? colors.oliveDeep : colors.surface,
                borderWidth: active ? 0 : 1,
                borderColor: colors.rule,
              }}
            >
              <Text
                variant="caption"
                style={{
                  fontSize: 12,
                  fontWeight: '500',
                  color: active ? colors.goldSoft : colors.muted,
                }}
              >
                {f.key === 'all'
                  ? L('Barchasi', 'Все', 'All', 'الكل')
                  : f.key === 'pending'
                  ? L('Kutmoqda', 'Ожидает', 'Pending', 'قيد الانتظار')
                  : f.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Product List */}
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24, gap: 10 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={false}
            onRefresh={() => refetch()}
            tintColor={colors.oliveDeep}
            colors={[colors.oliveDeep]}
          />
        }
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingTop: 60, gap: 12 }}>
            <Ionicons name="pricetag-outline" size={48} color={colors.muted} />
            <Text variant="body" color="muted">
              {L('Mahsulot topilmadi', 'Товары не найдены', 'No products found', 'لم يتم العثور على منتجات')}
            </Text>
          </View>
        }
        renderItem={({ item, index }) => {
          const st = STATUS_STYLE[item.status] ?? STATUS_STYLE.draft;
          return (
            <Pressable
              onPress={() => router.push(`/seller/product/${item.id}` as any)}
              onLongPress={() => openProductMenu(item)}
              delayLongPress={300}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                padding: 12,
                backgroundColor: colors.surface,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: colors.rule,
                opacity: pressed ? 0.92 : 1,
              })}
            >
              <View
                style={{
                  width: 60,
                  height: 60,
                  borderRadius: 12,
                  backgroundColor: PLACEHOLDER_BG[index % PLACEHOLDER_BG.length],
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  overflow: 'hidden',
                }}
              >
                {item.coverUrl ? (
                  <Image source={{ uri: item.coverUrl }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                ) : (
                  <Ionicons name="ribbon-outline" size={24} color="rgba(255,255,255,0.35)" />
                )}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text
                  variant="bodySmall"
                  color="ink"
                  numberOfLines={1}
                  style={{ fontSize: 14, fontWeight: '500' }}
                >
                  {item.titleRu || item.titleUz || "Nomsiz mahsulot"}
                </Text>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                    marginTop: 4,
                  }}
                >
                  <Text
                    variant="bodySmall"
                    color="oliveDeep"
                    style={{
                      fontFamily: theme.fontFamilies.display,
                      fontSize: 16,
                      fontWeight: '600',
                    }}
                  >
                    ${item.basePriceUsd.toFixed(2)}
                  </Text>
                  <Text variant="caption" color="muted" style={{ fontSize: 11 }}>
                    · {item.variantCount} variant
                  </Text>
                </View>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    marginTop: 4,
                  }}
                >
                  <View
                    style={{
                      backgroundColor: st.bg,
                      borderRadius: 10,
                      paddingHorizontal: 7,
                      paddingVertical: 2,
                    }}
                  >
                    <Text
                      variant="caption"
                      style={{ fontSize: 10, fontWeight: '500', color: st.color }}
                    >
                      {st.label}
                    </Text>
                  </View>
                  <Text variant="caption" color="muted" style={{ fontSize: 10 }}>
                    Zaxira: {item.totalStock}
                  </Text>
                </View>
              </View>
              <Pressable
                onPress={(e) => {
                  e.stopPropagation?.();
                  openProductMenu(item);
                }}
                hitSlop={10}
                style={{ padding: 6, marginLeft: 2 }}
              >
                <Ionicons name="ellipsis-vertical" size={18} color={colors.muted} />
              </Pressable>
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}
