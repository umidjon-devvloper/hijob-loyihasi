import { useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Modal, Pressable, RefreshControl, ScrollView, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../../src/components/Screen';
import { Text } from '../../src/components/Text';
import { useTheme } from '../../src/theme/ThemeProvider';
import { api } from '../../src/api/client';
import { sceneById, SCENES, type SceneId } from '../../src/lib/scenes';
import * as ImagePicker from 'expo-image-picker';

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
  sceneId?: string | null;
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
  const [editing, setEditing] = useState<SellerProduct | null>(null);
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
          text: L('Tahrirlash', 'Редактировать', 'Edit', 'تعديل'),
          onPress: () => setEditing(item),
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
                  width: 72,
                  height: 96,
                  borderRadius: 12,
                  backgroundColor: PLACEHOLDER_BG[index % PLACEHOLDER_BG.length],
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  overflow: 'hidden',
                  position: 'relative',
                }}
              >
                {(() => {
                  const scene = sceneById(item.sceneId);
                  if (!scene) return null;
                  return (
                    <Image
                      source={scene.source}
                      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' }}
                      resizeMode="cover"
                    />
                  );
                })()}
                {item.coverUrl ? (
                  <Image
                    source={{ uri: item.coverUrl }}
                    style={{ width: '100%', height: '100%' }}
                    resizeMode="contain"
                  />
                ) : (
                  <Ionicons name="ribbon-outline" size={24} color="rgba(255,255,255,0.35)" />
                )}
                {/* Dot showing the current scene (gold = picked, grey = none) */}
                <View
                  style={{
                    position: 'absolute',
                    bottom: 4,
                    right: 4,
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: sceneById(item.sceneId) ? colors.gold : 'rgba(0,0,0,0.25)',
                    borderWidth: 1.5,
                    borderColor: colors.surface,
                  }}
                />
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

      {editing && (
        <EditProductModal
          product={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await queryClient.invalidateQueries({ queryKey: ['seller', 'products'] });
          }}
          L={L}
        />
      )}
    </Screen>
  );
}

const CATEGORIES = [
  { id: 'scarves', label: { uz: "Ro'mol", ru: 'Платок', en: 'Scarf', ar: 'طرحة' } },
  { id: 'dresses', label: { uz: "Ko'ylak", ru: 'Платье', en: 'Dress', ar: 'فستان' } },
  { id: 'shoes',   label: { uz: 'Poyabzal', ru: 'Обувь', en: 'Shoes', ar: 'أحذية' } },
  { id: 'bags',    label: { uz: 'Sumka', ru: 'Сумка', en: 'Bag', ar: 'حقيبة' } },
  { id: 'accessories', label: { uz: 'Aksessuar', ru: 'Аксессуар', en: 'Accessory', ar: 'إكسسوار' } },
] as const;

const BODY_FITS = [
  { id: 'slim',    label: { uz: "Ozg'in",  ru: 'Худая',   en: 'Slim',    ar: 'نحيف' } },
  { id: 'regular', label: { uz: "O'rtacha", ru: 'Средняя', en: 'Regular', ar: 'متوسط' } },
  { id: 'plus',    label: { uz: "To'la",   ru: 'Полная',  en: 'Plus',    ar: 'ممتلئ' } },
] as const;

interface FullVariant {
  id?: string;
  color: string;
  colorHex: string;
  size: string;
  stock: number;
  priceUsd: number | null;
  images: string[];
  remove?: boolean;
  isNew?: boolean;
}

function EditProductModal({
  product,
  onClose,
  onSaved,
  L,
}: {
  product: SellerProduct;
  onClose: () => void;
  onSaved: () => void;
  L: (uz: string, ru: string, en: string, ar: string) => string;
}) {
  const { colors, theme } = useTheme();
  const lang = 'uz' as const;

  // Fetch the full product so we can edit title_uz/ru, description, variants.
  const { data: full, isLoading } = useQuery<any>({
    queryKey: ['seller-product-full', product.id],
    queryFn: async () => (await api.get(`/catalog/products/${product.id}`)).data,
  });

  const [titleUz, setTitleUz] = useState('');
  const [titleRu, setTitleRu] = useState('');
  const [descriptionRu, setDescriptionRu] = useState('');
  const [priceUsd, setPriceUsd] = useState(String(product.basePriceUsd));
  const [categoryId, setCategoryId] = useState<string>('scarves');
  const [bodyFit, setBodyFit] = useState<'slim' | 'regular' | 'plus' | null>(null);
  const [sceneId, setSceneId] = useState<SceneId | null>((product.sceneId as SceneId) ?? null);
  const [variants, setVariants] = useState<FullVariant[]>([]);
  // Raw cover (what the seller uploaded) — this is what gets replaced
  // when the seller picks a new image, and what we PATCH back.
  const [coverUrl, setCoverUrl] = useState<string | null>(product.coverUrl);
  // Styled mannequin image (what the buyer sees) — rendered on top of
  // the scene so the preview matches the catalogue card, not the raw
  // product shot. Fetched alongside the full product.
  const [styledUrl, setStyledUrl] = useState<string | null>(product.coverUrl);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [saving, setSaving] = useState(false);

  // Hydrate from the fetched product once it arrives.
  const [hydrated, setHydrated] = useState(false);
  if (full && !hydrated) {
    setTitleUz(full.title?.uz ?? '');
    setTitleRu(full.title?.ru ?? '');
    setDescriptionRu(full.description ?? '');
    setPriceUsd(String(full.basePriceUsd));
    setCategoryId(full.categoryId ?? 'scarves');
    setBodyFit(full.bodyFit ?? null);
    setSceneId((full.attributes?.sceneId as SceneId) ?? null);
    setCoverUrl(full.rawCoverUrl ?? full.coverUrl ?? null);
    setStyledUrl(full.styledImageUrl ?? full.coverUrl ?? null);
    setVariants(
      (full.variants ?? []).map((v: any) => ({
        id: v.id,
        color: v.color ?? '',
        colorHex: v.colorHex ?? '#000000',
        size: v.size ?? '',
        stock: v.stock ?? 0,
        priceUsd: v.priceUsd ?? null,
        images: v.images ?? [],
      })),
    );
    setHydrated(true);
  }

  const pickCover = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
    });
    if (picked.canceled || !picked.assets?.[0]) return;
    setUploadingCover(true);
    try {
      const uri = picked.assets[0].uri;
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
      if (files?.[0]?.url) setCoverUrl(files[0].url);
    } catch (e: any) {
      Alert.alert(L('Xato', 'Ошибка', 'Error', 'خطأ'), e?.message ?? 'xatolik');
    } finally {
      setUploadingCover(false);
    }
  };

  const addVariant = () => {
    setVariants((vs) => [
      ...vs,
      { color: '', colorHex: '#000000', size: 'M', stock: 0, priceUsd: null, images: [], isNew: true },
    ]);
  };

  const updateVariant = (idx: number, patch: Partial<FullVariant>) => {
    setVariants((vs) => vs.map((v, i) => (i === idx ? { ...v, ...patch } : v)));
  };

  const removeVariant = (idx: number) => {
    setVariants((vs) => {
      const row = vs[idx];
      if (!row) return vs;
      if (row.isNew) return vs.filter((_, i) => i !== idx);
      return vs.map((v, i) => (i === idx ? { ...v, remove: true } : v));
    });
  };

  const visibleVariants = variants.filter((v) => !v.remove);

  const save = async () => {
    const price = Number(priceUsd);
    if (!priceUsd || Number.isNaN(price) || price <= 0) {
      Alert.alert(L('Xato', 'Ошибка', 'Error', 'خطأ'), L('Narx noto\'g\'ri', 'Неверная цена', 'Invalid price', 'سعر غير صحيح'));
      return;
    }
    try {
      setSaving(true);
      await api.patch(`/seller/products/${product.id}`, {
        titleUz: titleUz.trim(),
        titleRu: titleRu.trim() || titleUz.trim(),
        descriptionRu: descriptionRu.trim(),
        basePriceUsd: price,
        categoryId,
        bodyFit,
        coverUrl: coverUrl ?? undefined,
        sceneId,
        variants: variants.map((v) => ({
          id: v.id,
          color: v.color,
          colorHex: v.colorHex,
          size: v.size,
          stock: v.stock,
          priceUsd: v.priceUsd,
          images: v.images,
          remove: v.remove,
        })),
      });
      onSaved();
    } catch (e: any) {
      Alert.alert(L('Xato', 'Ошибка', 'Error', 'خطأ'), e?.response?.data?.message ?? e?.message ?? 'xatolik');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
        <View
          style={{
            backgroundColor: colors.bg,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            maxHeight: '92%',
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: 20,
              borderBottomWidth: 1,
              borderBottomColor: colors.rule,
            }}
          >
            <Text
              variant="displayLarge"
              color="oliveDeep"
              style={{ fontSize: 18, fontWeight: '700', fontFamily: theme.fontFamilies.display }}
            >
              {L('Tahrirlash', 'Редактировать', 'Edit', 'تعديل')}
            </Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={24} color={colors.ink} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
            {/* Big live preview — mannequin on the picked scene */}
            <View
              style={{
                width: '100%',
                aspectRatio: 3 / 4,
                borderRadius: 16,
                overflow: 'hidden',
                backgroundColor: colors.surface2,
                marginBottom: 20,
              }}
            >
              {sceneById(sceneId) && (
                <Image
                  source={sceneById(sceneId)!.source}
                  style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' }}
                  resizeMode="cover"
                />
              )}
              {(styledUrl ?? coverUrl) && (
                <Image
                  source={{ uri: styledUrl ?? coverUrl! }}
                  style={{ width: '100%', height: '100%' }}
                  resizeMode="contain"
                />
              )}
            </View>

            {/* Scene thumbnails — visible pick */}
            <Text
              variant="caption"
              color="muted"
              style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 }}
            >
              {L('Orqa fon', 'Фон', 'Backdrop', 'الخلفية')}
            </Text>
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 24 }}>
              {SCENES.map((s) => {
                const active = s.id === sceneId;
                return (
                  <Pressable
                    key={s.id}
                    onPress={() => setSceneId(s.id)}
                    style={{
                      flex: 1,
                      borderRadius: 12,
                      borderWidth: active ? 3 : 1,
                      borderColor: active ? colors.gold : colors.rule,
                      overflow: 'hidden',
                    }}
                  >
                    <Image source={s.source} style={{ width: '100%', height: 90 }} resizeMode="cover" />
                    <View
                      style={{
                        paddingVertical: 6,
                        alignItems: 'center',
                        backgroundColor: colors.surface,
                      }}
                    >
                      <Text style={{ fontSize: 11, fontWeight: '600', color: colors.ink }}>
                        {s.label.uz}
                      </Text>
                    </View>
                    {active && (
                      <View
                        style={{
                          position: 'absolute',
                          top: 6,
                          right: 6,
                          backgroundColor: colors.gold,
                          borderRadius: 10,
                          padding: 2,
                        }}
                      >
                        <Ionicons name="checkmark" size={12} color={colors.ink} />
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>

            {/* Cover image upload */}
            <Text
              variant="caption"
              color="muted"
              style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}
            >
              {L('Asosiy rasm', 'Главное фото', 'Cover', 'الصورة الرئيسية')}
            </Text>
            <Pressable
              onPress={pickCover}
              disabled={uploadingCover}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                paddingVertical: 10,
                borderRadius: 12,
                borderWidth: 1,
                borderStyle: 'dashed',
                borderColor: colors.rule,
                marginBottom: 16,
              }}
            >
              {uploadingCover ? (
                <ActivityIndicator color={colors.oliveDeep} size="small" />
              ) : (
                <Ionicons name="image-outline" size={18} color={colors.ink} />
              )}
              <Text style={{ fontSize: 13, color: colors.ink, fontWeight: '600' }}>
                {L('Yangi rasm tanlash', 'Выбрать фото', 'Pick new image', 'اختر صورة')}
              </Text>
            </Pressable>

            {/* Title UZ + RU */}
            <Text
              variant="caption"
              color="muted"
              style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}
            >
              {L("Nomi (O'zbek)", 'Название (узбекский)', 'Title (UZ)', 'الاسم (الأوزبكية)')}
            </Text>
            <TextInput
              value={titleUz}
              onChangeText={setTitleUz}
              style={inputStyle(colors)}
            />
            <Text
              variant="caption"
              color="muted"
              style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6, marginTop: 12 }}
            >
              {L('Nomi (Rus)', 'Название (русский)', 'Title (RU)', 'الاسم (الروسية)')}
            </Text>
            <TextInput
              value={titleRu}
              onChangeText={setTitleRu}
              style={inputStyle(colors)}
            />

            {/* Description */}
            <Text
              variant="caption"
              color="muted"
              style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6, marginTop: 12 }}
            >
              {L('Tavsif', 'Описание', 'Description', 'الوصف')}
            </Text>
            <TextInput
              value={descriptionRu}
              onChangeText={setDescriptionRu}
              multiline
              style={{ ...inputStyle(colors), minHeight: 80, textAlignVertical: 'top' }}
            />

            {/* Price */}
            <Text
              variant="caption"
              color="muted"
              style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6, marginTop: 12 }}
            >
              {L('Narx (USD)', 'Цена (USD)', 'Price (USD)', 'السعر (USD)')}
            </Text>
            <TextInput
              value={priceUsd}
              onChangeText={setPriceUsd}
              keyboardType="decimal-pad"
              style={inputStyle(colors)}
            />

            {/* Category chips */}
            <Text
              variant="caption"
              color="muted"
              style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6, marginTop: 16 }}
            >
              {L('Kategoriya', 'Категория', 'Category', 'الفئة')}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {CATEGORIES.map((c) => {
                const active = c.id === categoryId;
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => setCategoryId(c.id)}
                    style={{
                      paddingHorizontal: 14,
                      paddingVertical: 8,
                      borderRadius: 20,
                      backgroundColor: active ? colors.oliveDeep : colors.surface,
                      borderWidth: 1,
                      borderColor: active ? colors.oliveDeep : colors.rule,
                    }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: '600', color: active ? colors.goldSoft : colors.ink }}>
                      {c.label.uz}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* Body fit chips */}
            <Text
              variant="caption"
              color="muted"
              style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6, marginTop: 16 }}
            >
              {L('Jussa', 'Фигура', 'Body fit', 'الجسم')}
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
              {BODY_FITS.map((b) => {
                const active = b.id === bodyFit;
                return (
                  <Pressable
                    key={b.id}
                    onPress={() => setBodyFit(active ? null : (b.id as any))}
                    style={{
                      paddingHorizontal: 14,
                      paddingVertical: 8,
                      borderRadius: 20,
                      backgroundColor: active ? colors.oliveDeep : colors.surface,
                      borderWidth: 1,
                      borderColor: active ? colors.oliveDeep : colors.rule,
                    }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: '600', color: active ? colors.goldSoft : colors.ink }}>
                      {b.label.uz}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Variants editor */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, marginBottom: 8 }}>
              <Text
                variant="caption"
                color="muted"
                style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' }}
              >
                {L('Variantlar', 'Варианты', 'Variants', 'الخيارات')} ({visibleVariants.length})
              </Text>
              <Pressable onPress={addVariant} hitSlop={8}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: colors.gold }}>
                  + {L("Qo'shish", 'Добавить', 'Add', 'إضافة')}
                </Text>
              </Pressable>
            </View>

            {variants.map((v, idx) => {
              if (v.remove) return null;
              return (
                <View
                  key={v.id ?? `new-${idx}`}
                  style={{
                    padding: 12,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: colors.rule,
                    backgroundColor: colors.surface,
                    marginBottom: 10,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: v.colorHex, borderWidth: 1, borderColor: colors.rule }} />
                    <TextInput
                      value={v.color}
                      onChangeText={(x) => updateVariant(idx, { color: x })}
                      placeholder={L('Rang nomi', 'Цвет', 'Color', 'اللون')}
                      placeholderTextColor={colors.muted}
                      style={{ ...inputStyle(colors), marginBottom: 0, flex: 1 }}
                    />
                    <TextInput
                      value={v.colorHex}
                      onChangeText={(x) => updateVariant(idx, { colorHex: x })}
                      placeholder="#000000"
                      placeholderTextColor={colors.muted}
                      autoCapitalize="none"
                      style={{ ...inputStyle(colors), marginBottom: 0, width: 100 }}
                    />
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                    <TextInput
                      value={v.size}
                      onChangeText={(x) => updateVariant(idx, { size: x })}
                      placeholder={L("O'lcham", 'Размер', 'Size', 'الحجم')}
                      placeholderTextColor={colors.muted}
                      style={{ ...inputStyle(colors), marginBottom: 0, flex: 1 }}
                    />
                    <TextInput
                      value={String(v.stock)}
                      onChangeText={(x) => updateVariant(idx, { stock: Number(x) || 0 })}
                      keyboardType="number-pad"
                      placeholder={L('Zaxira', 'Остаток', 'Stock', 'المخزون')}
                      placeholderTextColor={colors.muted}
                      style={{ ...inputStyle(colors), marginBottom: 0, flex: 1 }}
                    />
                    <TextInput
                      value={v.priceUsd != null ? String(v.priceUsd) : ''}
                      onChangeText={(x) => updateVariant(idx, { priceUsd: x ? Number(x) : null })}
                      keyboardType="decimal-pad"
                      placeholder="USD"
                      placeholderTextColor={colors.muted}
                      style={{ ...inputStyle(colors), marginBottom: 0, flex: 1 }}
                    />
                  </View>
                  <Pressable
                    onPress={() => removeVariant(idx)}
                    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8 }}
                  >
                    <Ionicons name="trash-outline" size={14} color={colors.danger} />
                    <Text style={{ fontSize: 12, color: colors.danger, fontWeight: '600' }}>
                      {L("O'chirish", 'Удалить', 'Delete', 'حذف')}
                    </Text>
                  </Pressable>
                </View>
              );
            })}

            <Pressable
              onPress={save}
              disabled={saving || isLoading}
              style={{
                height: 52,
                borderRadius: 16,
                backgroundColor: colors.oliveDeep,
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'row',
                gap: 8,
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? (
                <ActivityIndicator color={colors.goldSoft} />
              ) : (
                <Text style={{ fontSize: 15, fontWeight: '700', color: colors.goldSoft }}>
                  {L('Saqlash', 'Сохранить', 'Save', 'حفظ')}
                </Text>
              )}
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function inputStyle(colors: any) {
  return {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.rule,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
    color: colors.ink,
    marginBottom: 0,
  } as const;
}
