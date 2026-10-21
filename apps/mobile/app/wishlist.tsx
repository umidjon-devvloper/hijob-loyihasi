import { ActivityIndicator, Alert, Image, Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Screen } from '../src/components/Screen';
import { Text } from '../src/components/Text';
import { useTheme } from '../src/theme/ThemeProvider';
import { api } from '../src/api/client';
import { errorMessage, errorTitle } from '../src/lib/api-errors';
import { safeBack } from '../src/lib/safe-back';

interface WishlistEntry {
  productId: string;
  addedAt: string;
  product: {
    id: string;
    titleRu: string;
    titleUz: string;
    basePriceUsd: number;
    coverUrl: string | null;
    seller: { brandName: string } | null;
  };
}

export default function WishlistScreen() {
  const { colors, theme } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery<WishlistEntry[]>({
    queryKey: ['wishlist'],
    queryFn: async () => (await api.get<WishlistEntry[]>('/wishlist')).data,
  });

  const remove = useMutation({
    mutationFn: async (productId: string) => {
      await api.delete(`/wishlist/${productId}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wishlist'] }),
    onError: (e: any) => Alert.alert(errorTitle(), errorMessage(e)),
  });

  const addToCart = useMutation({
    mutationFn: async (productId: string) => {
      // Add the product's first variant to the cart. The backend's cart API
      // keys off variantId, so we fetch the product once to find a variant.
      const prod = (await api.get(`/catalog/products/${productId}`)).data as any;
      const variantId = prod?.variants?.[0]?.id;
      if (!variantId) throw new Error('Variant yo\'q');
      await api.post('/cart', { variantId, quantity: 1 });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cart'] });
      Alert.alert('✓', 'Savatga qo\'shildi');
    },
    onError: (e: any) => Alert.alert(errorTitle(), errorMessage(e)),
  });

  const items = data ?? [];

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 20, flexDirection: 'row', alignItems: 'center', gap: 16 }}>
          <Pressable
            onPress={() => safeBack()}
            style={{
              width: 40, height: 40, borderRadius: 20,
              backgroundColor: colors.surfaceGlass, borderWidth: 1, borderColor: colors.rule,
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Ionicons name="arrow-back" size={18} color={colors.ink} />
          </Pressable>
          <Text variant="displayLarge" color="oliveDeep" style={{ flex: 1, fontSize: 22, fontWeight: '700', fontFamily: theme.fontFamilies.display }}>
            Sevimlilar
          </Text>
          <View style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.rule, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4 }}>
            <Text variant="caption" color="muted" style={{ fontSize: 12, fontWeight: '500' }}>{items.length} ta</Text>
          </View>
        </View>

        {isLoading ? (
          <View style={{ padding: 40, alignItems: 'center' }}>
            <ActivityIndicator color={colors.oliveDeep} />
          </View>
        ) : isError ? (
          <EmptyState icon="cloud-offline-outline" title="Yuklab bo'lmadi" onRetry={() => refetch()} />
        ) : items.length === 0 ? (
          <EmptyState icon="heart-outline" title="Sevimlilar ro'yxati bo'sh" subtitle="Katalogdan yurakcha ustiga bosib qo'shing" />
        ) : (
          <View style={{ paddingHorizontal: 20, gap: 12 }}>
            {items.map((item) => (
              <Pressable
                key={item.productId}
                onPress={() => router.push(`/product/${item.productId}`)}
                style={{
                  flexDirection: 'row', gap: 12, padding: 14,
                  backgroundColor: colors.surface, borderRadius: 18,
                  borderWidth: 1, borderColor: colors.rule,
                }}
              >
                <View
                  style={{
                    width: 80, height: 90, borderRadius: 12,
                    backgroundColor: 'rgba(138,141,91,0.12)',
                    alignItems: 'center', justifyContent: 'center',
                    overflow: 'hidden',
                  }}
                >
                  {item.product.coverUrl ? (
                    <Image
                      source={{ uri: item.product.coverUrl }}
                      style={{ width: '100%', height: '100%' }}
                      resizeMode="cover"
                    />
                  ) : (
                    <Ionicons name="shirt-outline" size={28} color={colors.olive} />
                  )}
                </View>
                <View style={{ flex: 1, justifyContent: 'center' }}>
                  <Text variant="bodySmall" color="ink" style={{ fontSize: 14, fontWeight: '500', marginBottom: 2 }} numberOfLines={2}>
                    {item.product.titleRu}
                  </Text>
                  <Text variant="caption" color="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                    {item.product.seller?.brandName ?? ''}
                  </Text>
                  <Text variant="bodySmall" color="oliveDeep" style={{ fontSize: 14, fontWeight: '700' }}>
                    ${item.product.basePriceUsd.toFixed(2)}
                  </Text>
                </View>
                <View style={{ justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 }}>
                  <Pressable
                    onPress={() => remove.mutate(item.productId)}
                    hitSlop={8}
                    style={{
                      width: 32, height: 32, borderRadius: 16,
                      backgroundColor: 'rgba(184,84,80,0.08)',
                      alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <Ionicons name="heart" size={16} color={colors.danger} />
                  </Pressable>
                  <Pressable
                    onPress={() => addToCart.mutate(item.productId)}
                    hitSlop={8}
                    style={{
                      width: 32, height: 32, borderRadius: 16,
                      backgroundColor: 'rgba(54,57,36,0.06)',
                      alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <Ionicons name="bag-add-outline" size={16} color={colors.oliveDeep} />
                  </Pressable>
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

interface EmptyStateProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  onRetry?: () => void;
}

function EmptyState({ icon, title, subtitle, onRetry }: EmptyStateProps) {
  const { colors } = useTheme();
  return (
    <View style={{ padding: 40, alignItems: 'center', gap: 10 }}>
      <Ionicons name={icon} size={48} color={colors.muted} />
      <Text variant="body" color="ink" style={{ fontSize: 15, fontWeight: '600', textAlign: 'center' }}>
        {title}
      </Text>
      {subtitle && (
        <Text variant="caption" color="muted" style={{ fontSize: 12, textAlign: 'center' }}>
          {subtitle}
        </Text>
      )}
      {onRetry && (
        <Pressable
          onPress={onRetry}
          style={{
            marginTop: 8, paddingHorizontal: 16, paddingVertical: 10,
            borderRadius: 10, backgroundColor: colors.oliveDeep,
          }}
        >
          <Text variant="bodySmall" style={{ fontSize: 13, fontWeight: '600', color: colors.goldSoft }}>
            Qaytadan urinish
          </Text>
        </Pressable>
      )}
    </View>
  );
}
