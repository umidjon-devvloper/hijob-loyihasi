import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, Image, Linking, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../../src/components/Screen';
import { Text } from '../../src/components/Text';
import { useTheme } from '../../src/theme/ThemeProvider';
import { api } from '../../src/api/client';
import { safeBack } from '../../src/lib/safe-back';

interface OrderDetail {
  id: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  deliveryType: string;
  totalUsd: number;
  subtotalUsd: number;
  deliveryFeeUsd: number;
  createdAt: string;
  address: {
    city: string;
    district: string;
    street: string;
    building: string;
    latitude?: number | null;
    longitude?: number | null;
  } | null;
  items: Array<{
    title: string;
    color: string;
    size: string;
    quantity: number;
    priceUsd: number;
    image: string;
    sellerId: string | null;
    sellerBrand: string | null;
  }>;
  sellers?: Array<{
    id: string;
    brandName: string;
    logoUrl: string | null;
    chatId: string | null;
  }>;
  timeline: Array<{ key: string; label: string; reached: boolean; active: boolean }>;
}

export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, theme } = useTheme();
  const router = useRouter();

  const { data, isLoading, isError, refetch } = useQuery<OrderDetail>({
    queryKey: ['orders', id],
    queryFn: async () => (await api.get(`/orders/${id}`)).data,
    enabled: !!id,
    refetchInterval: 15_000,
  });

  if (isLoading) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <ActivityIndicator color={colors.oliveDeep} />
        </View>
      </Screen>
    );
  }

  if (isError || !data) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 24 }}>
          <Ionicons name="cloud-offline-outline" size={48} color={colors.muted} />
          <Text variant="body" color="muted" style={{ textAlign: 'center' }}>
            Buyurtma yuklanmadi
          </Text>
          <Pressable
            onPress={() => refetch()}
            style={{ marginTop: 8, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, backgroundColor: colors.oliveDeep }}
          >
            <Text variant="bodySmall" style={{ color: colors.goldSoft, fontWeight: '600' }}>
              Qaytadan urinish
            </Text>
          </Pressable>
          <Pressable onPress={() => safeBack()} style={{ marginTop: 4 }}>
            <Text variant="caption" color="muted">← Orqaga</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={
          <RefreshControl
            refreshing={false}
            onRefresh={() => refetch()}
            tintColor={colors.oliveDeep}
            colors={[colors.oliveDeep]}
          />
        }
      >
        <View
          style={{
            paddingTop: 8,
            paddingHorizontal: 20,
            paddingBottom: 20,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <Pressable onPress={() => safeBack()} hitSlop={12}>
            <Ionicons name="arrow-back" size={26} color={colors.ink} />
          </Pressable>
          <View>
            <Text variant="caption" color="muted">Buyurtma #{data.id.slice(0, 8)}</Text>
            <Text variant="displayMedium" color="oliveDeep">
              ${data.totalUsd.toFixed(0)}
            </Text>
          </View>
        </View>

        {/* Timeline */}
        <View
          style={{
            marginHorizontal: 16,
            padding: 20,
            borderRadius: theme.radii.lg,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.rule,
          }}
        >
          <Text variant="titleSmall" color="ink" style={{ marginBottom: 16 }}>
            Yetkazish holati
          </Text>
          {data.timeline.map((step, idx) => (
            <View key={step.key} style={{ flexDirection: 'row', gap: 12, marginBottom: 14 }}>
              <View style={{ alignItems: 'center' }}>
                <View
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 11,
                    backgroundColor: step.reached ? colors.gold : colors.rule,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {step.reached && <Ionicons name="checkmark" size={14} color={colors.surface} />}
                </View>
                {idx < data.timeline.length - 1 && (
                  <View
                    style={{
                      width: 2,
                      flex: 1,
                      backgroundColor: step.reached ? colors.gold : colors.rule,
                      minHeight: 20,
                    }}
                  />
                )}
              </View>
              <View style={{ flex: 1, paddingBottom: 4 }}>
                <Text
                  variant="bodySmall"
                  color={step.active ? 'oliveDeep' : step.reached ? 'ink' : 'muted'}
                  style={{ fontWeight: step.active ? '700' : '500' }}
                >
                  {step.label}
                </Text>
              </View>
            </View>
          ))}
        </View>

        {/* Items */}
        <View style={{ marginHorizontal: 16, marginTop: 12, gap: 12 }}>
          <Text variant="titleSmall" color="ink" style={{ paddingHorizontal: 4 }}>
            Tovarlar
          </Text>
          {data.items.map((it, i) => (
            <View
              key={i}
              style={{
                flexDirection: 'row',
                gap: 12,
                padding: 12,
                borderRadius: theme.radii.lg,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.rule,
              }}
            >
              <Image
                source={{ uri: it.image }}
                style={{ width: 72, height: 96, borderRadius: theme.radii.md }}
              />
              <View style={{ flex: 1, justifyContent: 'space-between' }}>
                <View>
                  <Text variant="titleSmall" color="ink">{it.title}</Text>
                  <Text variant="caption" color="muted">
                    {it.color} · {it.size} · ×{it.quantity}
                  </Text>
                </View>
                <Text variant="titleMedium" color="gold">
                  ${(it.priceUsd * it.quantity).toFixed(0)}
                </Text>
              </View>
            </View>
          ))}
        </View>

        {/* Sellers — one chat per shop in the basket */}
        {data.sellers && data.sellers.length > 0 && (
          <View style={{ marginHorizontal: 16, marginTop: 12 }}>
            <Text
              variant="caption"
              color="muted"
              style={{
                fontSize: 11,
                letterSpacing: 1,
                textTransform: 'uppercase',
                marginBottom: 8,
                paddingLeft: 4,
              }}
            >
              Sotuvchilar bilan aloqa
            </Text>
            <View style={{ gap: 8 }}>
              {data.sellers.map((s) => (
                <Pressable
                  key={s.id}
                  onPress={async () => {
                    try {
                      let chatId = s.chatId;
                      if (!chatId) {
                        const { data: chat } = await api.post(`/chats/open/${s.id}`);
                        chatId = chat?.id ?? null;
                      }
                      if (chatId) {
                        router.push({
                          pathname: '/chat/[id]',
                          params: { id: chatId },
                        } as any);
                      }
                    } catch {}
                  }}
                  style={{
                    padding: 14,
                    borderRadius: theme.radii.lg,
                    backgroundColor: colors.surface,
                    borderWidth: 1,
                    borderColor: colors.rule,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  {s.logoUrl ? (
                    <Image
                      source={{ uri: s.logoUrl }}
                      style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceAlt }}
                    />
                  ) : (
                    <View
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 20,
                        backgroundColor: colors.surfaceAlt,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Ionicons name="storefront-outline" size={18} color={colors.ink} />
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text variant="body" color="ink" style={{ fontWeight: '600' }}>
                      {s.brandName}
                    </Text>
                    <Text variant="caption" color="muted" style={{ fontSize: 12 }}>
                      {s.chatId ? 'Chatni ochish' : 'Yangi chat ochish'}
                    </Text>
                  </View>
                  <Ionicons name="chatbubble-outline" size={20} color={colors.gold} />
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {/* Address */}
        {data.address && (
          <View
            style={{
              marginHorizontal: 16,
              marginTop: 12,
              padding: 16,
              borderRadius: theme.radii.lg,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.rule,
              flexDirection: 'row',
              gap: 12,
            }}
          >
            <Ionicons name="location-outline" size={22} color={colors.gold} />
            <View style={{ flex: 1 }}>
              <Text variant="caption" color="muted">Yetkazish manzili</Text>
              <Text variant="body" color="ink" style={{ marginTop: 2 }}>
                {data.address.city}, {data.address.district}
              </Text>
              <Text variant="bodySmall" color="ink2">
                {data.address.street}, {data.address.building}
              </Text>
              {data.address.latitude != null && data.address.longitude != null && (
                <Pressable
                  onPress={() =>
                    Linking.openURL(
                      `https://maps.google.com/?q=${data.address!.latitude},${data.address!.longitude}`,
                    )
                  }
                  style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 4 }}
                >
                  <Ionicons name="map-outline" size={14} color={colors.gold} />
                  <Text variant="caption" style={{ fontSize: 12, color: colors.gold, fontWeight: '600' }}>
                    Xaritada ko'rish
                  </Text>
                </Pressable>
              )}
            </View>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
