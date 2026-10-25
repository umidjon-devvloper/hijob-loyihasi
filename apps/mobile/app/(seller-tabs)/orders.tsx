import { useState } from 'react';
import { Alert, FlatList, Image, Linking, Pressable, RefreshControl, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../../src/components/Screen';
import { Text } from '../../src/components/Text';
import { useTheme } from '../../src/theme/ThemeProvider';
import { api } from '../../src/api/client';
import { errorMessage, errorTitle } from '../../src/lib/api-errors';

type OrderStatus = 'new' | 'preparing' | 'shipping' | 'delivered';

interface OrderItem {
  name: string;
  color?: string;
  size?: string;
  qty: number;
  imageUrl?: string;
}

interface SellerOrder {
  id: string;
  code: string;
  customerName: string;
  customerPhone?: string | null;
  time: string;
  items: OrderItem[];
  total: number;
  status: OrderStatus;
  tracking?: string;
  deliveryType?: string;
  address?: string | null;
  location?: { latitude: number; longitude: number } | null;
  mapsUrl?: string | null;
  chatId?: string | null;
}

const STATUS_LABELS: Record<OrderStatus, Record<'uz' | 'ru' | 'en' | 'ar', string>> = {
  new: { uz: 'Yangi', ru: 'Новый', en: 'New', ar: 'جديد' },
  preparing: { uz: 'Tayyorlanm.', ru: 'Готовится', en: 'Preparing', ar: 'قيد التجهيز' },
  shipping: { uz: "Yo'lda", ru: 'В пути', en: 'Shipping', ar: 'في الطريق' },
  delivered: { uz: 'Yetkazildi', ru: 'Доставлено', en: 'Delivered', ar: 'تم التسليم' },
};

const STATUS_COLORS: Record<OrderStatus, { bg: string; color: string }> = {
  new: { bg: 'rgba(217,162,75,0.12)', color: '#D9A24B' },
  preparing: { bg: 'rgba(122,138,91,0.12)', color: '#7A8A5B' },
  shipping: { bg: 'rgba(95,122,148,0.12)', color: '#5F7A94' },
  delivered: { bg: 'rgba(122,138,91,0.12)', color: '#7A8A5B' },
};

const ITEM_BG = ['#EDE5D0', '#D9D0BE', '#EDE5D0', '#D9D0BE'];

export default function SellerOrdersScreen() {
  const { colors, theme } = useTheme();
  const { i18n } = useTranslation();
  const qc = useQueryClient();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<OrderStatus>('new');
  const isRu = (i18n.language?.slice(0, 2) ?? 'uz') === 'ru';
  const lang = (i18n.language?.slice(0, 2) ?? 'uz') as 'uz' | 'ru' | 'en' | 'ar';
  const L = (uz: string, ru: string, en: string, ar: string) =>
    ({ uz, ru, en, ar }[lang] ?? uz);
  const STATUS_TABS: { key: OrderStatus; label: string }[] = (
    ['new', 'preparing', 'shipping', 'delivered'] as const
  ).map((k) => ({ key: k, label: STATUS_LABELS[k][lang] ?? STATUS_LABELS[k].uz }));

  // Fetch once; filter in memory by tab so the badge counts stay in sync
  // without extra round trips.
  const { data: orders, refetch } = useQuery<SellerOrder[]>({
    queryKey: ['seller', 'orders'],
    queryFn: async () => (await api.get<SellerOrder[]>('/seller/orders')).data,
    staleTime: 15_000,
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: 'accept' | 'reject' | 'ship' | 'deliver' }) =>
      api.patch(`/seller/orders/${id}/status`, { action }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['seller', 'orders'] });
      qc.invalidateQueries({ queryKey: ['seller', 'stats'] });
    },
    onError: (e: any) => {
      Alert.alert(
        L('Xatolik', 'Ошибка', 'Error', 'خطأ'),
        e?.response?.data?.message ?? e?.message ?? L('Qayta urining', 'Повторите позже', 'Try again later', 'حاول لاحقًا'),
      );
    },
  });
  const act = (id: string, action: 'accept' | 'reject' | 'ship' | 'deliver') =>
    statusMutation.mutate({ id, action });

  const all = orders ?? [];
  const filtered = all.filter((o) => o.status === activeTab);
  const counts: Record<OrderStatus, number> = {
    new: all.filter((o) => o.status === 'new').length,
    preparing: all.filter((o) => o.status === 'preparing').length,
    shipping: all.filter((o) => o.status === 'shipping').length,
    delivered: all.filter((o) => o.status === 'delivered').length,
  };

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
            {L('Buyurtmalar', 'Заказы', 'Orders', 'الطلبات')}
          </Text>
          <Text variant="bodySmall" color="muted" style={{ fontSize: 13, marginTop: 2 }}>
            {counts.new + counts.preparing + counts.shipping}{' '}
            {L('ta faol buyurtma', 'активных заказов', 'active orders', 'طلبات نشطة')}
          </Text>
        </View>
        <Pressable
          onPress={() => qc.invalidateQueries({ queryKey: ['seller', 'orders'] })}
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.rule,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="refresh" size={18} color={colors.ink} />
        </Pressable>
      </View>

      {/* Status Tabs */}
      <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: 20, paddingBottom: 12 }}>
        {STATUS_TABS.map((tab) => {
          const active = tab.key === activeTab;
          return (
            <Pressable
              key={tab.key}
              onPress={() => setActiveTab(tab.key)}
              style={{
                flex: 1,
                paddingVertical: 10,
                alignItems: 'center',
                borderRadius: 10,
                backgroundColor: active ? colors.oliveDeep : colors.surface,
                borderWidth: active ? 0 : 1,
                borderColor: colors.rule,
              }}
            >
              <Text
                variant="displayLarge"
                style={{
                  fontFamily: theme.fontFamilies.display,
                  fontSize: 18,
                  fontWeight: '700',
                  color: active ? colors.goldSoft : colors.ink,
                }}
              >
                {counts[tab.key]}
              </Text>
              <Text
                variant="caption"
                style={{
                  fontSize: 10,
                  color: active ? colors.goldSoft : colors.muted,
                  marginTop: 2,
                }}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Order List */}
      <FlatList
        data={filtered}
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
            <Ionicons name="receipt-outline" size={48} color={colors.muted} />
            <Text variant="body" color="muted">{L("Buyurtma yo'q", 'Заказов нет', 'No orders', 'لا توجد طلبات')}</Text>
          </View>
        }
        renderItem={({ item, index }) => {
          const badge = {
            ...STATUS_COLORS[item.status],
            label: STATUS_LABELS[item.status][lang] ?? STATUS_LABELS[item.status].uz,
          };
          return (
            <View
              style={{
                backgroundColor: colors.surface,
                borderRadius: 14,
                padding: 14,
                borderWidth: 1,
                borderColor: colors.rule,
              }}
            >
              {/* Order Header */}
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  marginBottom: 10,
                }}
              >
                <View>
                  <Text
                    variant="bodySmall"
                    color="ink"
                    style={{ fontSize: 14, fontWeight: '600' }}
                  >
                    {item.code}
                  </Text>
                  <Text
                    variant="caption"
                    color="muted"
                    style={{ fontSize: 11, marginTop: 2 }}
                  >
                    {item.time} · {item.customerName}
                  </Text>
                </View>
                <View
                  style={{
                    backgroundColor: badge.bg,
                    borderRadius: 20,
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                  }}
                >
                  <Text
                    variant="caption"
                    style={{ fontSize: 11, fontWeight: '500', color: badge.color }}
                  >
                    {badge.label}
                  </Text>
                </View>
              </View>

              {/* Customer contact row — phone + map + chat links so the
                  seller can act in one tap. Only renders when at least one
                  of the three channels is available. */}
              {(item.customerPhone || item.mapsUrl || item.chatId) && (
                <View
                  style={{
                    flexDirection: 'row',
                    gap: 8,
                    marginBottom: 10,
                  }}
                >
                  {item.customerPhone ? (
                    <Pressable
                      onPress={() => Linking.openURL(`tel:${item.customerPhone}`)}
                      style={{
                        flex: 1,
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6,
                        paddingVertical: 10,
                        borderRadius: 10,
                        backgroundColor: colors.surfaceAlt,
                        borderWidth: 1,
                        borderColor: colors.rule,
                      }}
                    >
                      <Ionicons name="call-outline" size={14} color={colors.ink} />
                      <Text
                        variant="caption"
                        color="ink"
                        style={{ fontSize: 11, fontWeight: '600' }}
                      >
                        {L('Qo\'ng\'iroq', 'Звонок', 'Call', 'اتصال')}
                      </Text>
                    </Pressable>
                  ) : null}
                  {item.mapsUrl ? (
                    <Pressable
                      onPress={() => Linking.openURL(item.mapsUrl!)}
                      style={{
                        flex: 1,
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6,
                        paddingVertical: 10,
                        borderRadius: 10,
                        backgroundColor: colors.surfaceAlt,
                        borderWidth: 1,
                        borderColor: colors.rule,
                      }}
                    >
                      <Ionicons name="location-outline" size={14} color={colors.ink} />
                      <Text
                        variant="caption"
                        color="ink"
                        style={{ fontSize: 11, fontWeight: '600' }}
                      >
                        {L('Xaritada', 'На карте', 'Map', 'الخريطة')}
                      </Text>
                    </Pressable>
                  ) : null}
                  {item.chatId ? (
                    <Pressable
                      onPress={() =>
                        router.push({
                          pathname: '/chat/[id]',
                          params: { id: item.chatId! },
                        } as any)
                      }
                      style={{
                        flex: 1,
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6,
                        paddingVertical: 10,
                        borderRadius: 10,
                        backgroundColor: colors.oliveDeep,
                      }}
                    >
                      <Ionicons name="chatbubble-outline" size={14} color={colors.goldSoft} />
                      <Text
                        variant="caption"
                        style={{ fontSize: 11, fontWeight: '700', color: colors.goldSoft }}
                      >
                        {L('Chat', 'Чат', 'Chat', 'الدردشة')}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              )}

              {/* Delivery address */}
              {item.address ? (
                <Text
                  variant="caption"
                  color="muted"
                  style={{ fontSize: 11, marginBottom: 10 }}
                  numberOfLines={2}
                >
                  📍 {item.address}
                </Text>
              ) : null}

              {/* Product Items */}
              {item.status !== 'shipping' && (
                <View style={{ gap: 8, marginBottom: 12 }}>
                  {item.items.map((prod, i) => (
                    <View
                      key={i}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 8,
                        padding: 8,
                        backgroundColor: colors.surfaceAlt,
                        borderRadius: 8,
                      }}
                    >
                      <View
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 8,
                          backgroundColor: ITEM_BG[index % ITEM_BG.length],
                          flexShrink: 0,
                          overflow: 'hidden',
                        }}
                      >
                        {prod.imageUrl ? (
                          <Image
                            source={{ uri: prod.imageUrl }}
                            style={{ width: '100%', height: '100%' }}
                            resizeMode="contain"
                          />
                        ) : null}
                      </View>
                      <View>
                        <Text
                          variant="bodySmall"
                          color="ink"
                          style={{ fontSize: 12, fontWeight: '500' }}
                        >
                          {prod.name}
                        </Text>
                        <Text variant="caption" color="muted" style={{ fontSize: 11 }}>
                          {[prod.color, prod.size, `${prod.qty} dona`]
                            .filter(Boolean)
                            .join(' · ')}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}

              {/* Footer */}
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <Text
                  variant="displayLarge"
                  color="oliveDeep"
                  style={{
                    fontFamily: theme.fontFamilies.display,
                    fontSize: 18,
                    fontWeight: '700',
                  }}
                >
                  ${item.total}
                </Text>

                {item.status === 'new' && (
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Pressable
                      onPress={() => act(item.id, 'reject')}
                      disabled={statusMutation.isPending}
                      style={{
                        paddingHorizontal: 16,
                        paddingVertical: 8,
                        borderRadius: 8,
                        borderWidth: 1,
                        borderColor: colors.danger,
                        opacity: statusMutation.isPending ? 0.5 : 1,
                      }}
                    >
                      <Text
                        variant="caption"
                        style={{ fontSize: 12, fontWeight: '500', color: colors.danger }}
                      >
                        {L('Rad etish', 'Отклонить', 'Reject', 'رفض')}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => act(item.id, 'accept')}
                      disabled={statusMutation.isPending}
                      style={{
                        paddingHorizontal: 16,
                        paddingVertical: 8,
                        borderRadius: 8,
                        backgroundColor: colors.oliveDeep,
                        opacity: statusMutation.isPending ? 0.5 : 1,
                      }}
                    >
                      <Text
                        variant="caption"
                        style={{ fontSize: 12, fontWeight: '500', color: colors.goldSoft }}
                      >
                        {L('Qabul qilish', 'Принять', 'Accept', 'قبول')}
                      </Text>
                    </Pressable>
                  </View>
                )}

                {item.status === 'preparing' && (
                  <Pressable
                    onPress={() => act(item.id, 'ship')}
                    disabled={statusMutation.isPending}
                    style={{
                      paddingHorizontal: 16,
                      paddingVertical: 8,
                      borderRadius: 8,
                      backgroundColor: '#7A8A5B',
                      opacity: statusMutation.isPending ? 0.5 : 1,
                    }}
                  >
                    <Text
                      variant="caption"
                      style={{ fontSize: 12, fontWeight: '500', color: '#fff' }}
                    >
                      {L("Jo'natishga tayyor", 'Готово к отправке', 'Ready to ship', 'جاهز للشحن')}
                    </Text>
                  </Pressable>
                )}

                {item.status === 'shipping' && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    {item.tracking && (
                      <Text variant="caption" color="muted" style={{ fontSize: 12 }}>
                        Tracking: {item.tracking}
                      </Text>
                    )}
                    <Pressable
                      onPress={() => act(item.id, 'deliver')}
                      disabled={statusMutation.isPending}
                      style={{
                        paddingHorizontal: 16,
                        paddingVertical: 8,
                        borderRadius: 8,
                        backgroundColor: '#363924',
                        opacity: statusMutation.isPending ? 0.5 : 1,
                      }}
                    >
                      <Text
                        variant="caption"
                        style={{ fontSize: 12, fontWeight: '600', color: '#E4CE9A' }}
                      >
                        {L('Yetkazildi', 'Доставлено', 'Delivered', 'تم التسليم')}
                      </Text>
                    </Pressable>
                  </View>
                )}
              </View>
            </View>
          );
        }}
      />
    </Screen>
  );
}
