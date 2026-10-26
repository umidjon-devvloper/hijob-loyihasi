import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../src/components/Screen';
import { Text } from '../src/components/Text';
import { useTheme } from '../src/theme/ThemeProvider';
import { api } from '../src/api/client';
import { errorMessage, errorTitle } from '../src/lib/api-errors';
import { safeBack } from '../src/lib/safe-back';
import { formatUsdAsUzs, formatUzs, useUzsRate, usdToUzs } from '../src/lib/currency';
import * as Location from 'expo-location';

// Backend contracts (/cart, /addresses, /orders/checkout).
interface CartItem {
  id: string;
  variantId?: string;
  productTitle: string;
  productImage: string;
  color: string;
  size: string;
  priceUsd: number;
  quantity: number;
}
interface CartResponse {
  items: CartItem[];
  subtotalUsd: number;
  itemCount: number;
}
interface Address {
  id: string;
  label: string | null;
  city: string;
  district: string;
  street: string;
  building: string;
  apartment: string | null;
  latitude?: number | null;
  longitude?: number | null;
  isDefault: boolean;
}

type DeliveryType = 'delivery' | 'pickup' | 'proba' | 'reserve' | 'hold';

// There is no in-app payment anymore — the seller contacts the buyer after
// the order lands. The backend contract still wants a paymentMethod enum,
// so every order ships this placeholder; it is never surfaced in the UI.
const DEFAULT_PAYMENT_METHOD = 'click' as const;

const DELIVERY_FEES: Record<DeliveryType, number> = {
  delivery: 5,
  pickup: 0,
  proba: 5,
  reserve: 0,
  hold: 0,
};

export default function CheckoutScreen() {
  const { colors, theme, scheme } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { i18n } = useTranslation();
  const isRu = (i18n.language?.slice(0, 2) ?? 'uz') === 'ru';
  const params = useLocalSearchParams<{ deliveryMethod?: string }>();

  // Map the cart-tab's local delivery name onto the backend enum (the cart
  // uses "courier" / "pickup" / "proba"; the checkout contract calls the
  // first one "delivery").
  const initialDelivery: DeliveryType =
    params.deliveryMethod === 'pickup' ? 'pickup' : params.deliveryMethod === 'proba' ? 'proba' : 'delivery';

  const [deliveryType, setDeliveryType] = useState<DeliveryType>(initialDelivery);
  const [addressId, setAddressId] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [newAddressModal, setNewAddressModal] = useState(false);

  const cartQ = useQuery<CartResponse>({
    queryKey: ['cart'],
    queryFn: async () => (await api.get('/cart')).data,
  });

  const addressesQ = useQuery<Address[]>({
    queryKey: ['addresses'],
    queryFn: async () => (await api.get('/addresses')).data,
  });

  // react-query v5 dropped onSuccess on useQuery — auto-select the default
  // address (or the first one) in an effect once the list arrives.
  useEffect(() => {
    if (addressId) return;
    const list = addressesQ.data;
    if (!list || list.length === 0) return;
    const first = list[0];
    if (!first) return;
    setAddressId(list.find((a) => a.isDefault)?.id ?? first.id);
  }, [addressesQ.data, addressId]);

  const items = cartQ.data?.items ?? [];
  const uzsRate = useUzsRate();
  const subtotal = cartQ.data?.subtotalUsd ?? 0;
  const deliveryFee = DELIVERY_FEES[deliveryType];
  const total = subtotal + deliveryFee;

  const checkout = useMutation({
    mutationFn: async () => {
      if (!addressId) throw new Error('Manzilni tanlang');
      if (items.length === 0) throw new Error('Savat bo\'sh');
      // Backend expects variantId. The cart endpoint historically returned
      // item.id as the variant id; keep that unless it later splits the two.
      const checkoutItems = items.map((it) => ({
        variantId: it.variantId ?? it.id,
        quantity: it.quantity,
      }));
      const { data } = await api.post('/orders/checkout', {
        items: checkoutItems,
        addressId,
        deliveryType,
        // Pickup / Reserve / Hold have no "speed" — the seller agrees the
        // handover time with the buyer in chat afterwards.
        deliverySpeed:
          deliveryType === 'pickup' || deliveryType === 'reserve' || deliveryType === 'hold'
            ? undefined
            : 'tomorrow',
        paymentMethod: DEFAULT_PAYMENT_METHOD,
        comment: comment.trim() || undefined,
      });
      return data as { orderId: string; totalUsd: number; paymentUrl: string };
    },
    onSuccess: async (order) => {
      await qc.invalidateQueries({ queryKey: ['cart'] });
      await qc.invalidateQueries({ queryKey: ['orders'] });
      Alert.alert(
        isRu ? 'Заказ отправлен' : 'Buyurtma yuborildi',
        isRu
          ? 'Продавец скоро свяжется с вами, чтобы согласовать оплату и доставку.'
          : "Sotuvchi tez orada siz bilan aloqaga chiqadi — to'lov va yetkazishni kelishib olasiz.",
        [
          {
            text: 'OK',
            onPress: () =>
              router.replace({ pathname: '/orders/[id]', params: { id: order.orderId } }),
          },
        ],
      );
    },
    onError: (e: any) => {
      Alert.alert(errorTitle(), errorMessage(e));
    },
  });

  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{ paddingBottom: 160 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={false}
              onRefresh={() => {
                cartQ.refetch();
                addressesQ.refetch();
              }}
              tintColor={colors.oliveDeep}
              colors={[colors.oliveDeep]}
            />
          }
        >
          {/* Header */}
          <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 20, flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            <Pressable
              onPress={() => safeBack()}
              style={{
                width: 40, height: 40, borderRadius: 20,
                backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.rule,
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Ionicons name="arrow-back" size={18} color={colors.ink} />
            </Pressable>
            <Text variant="displayLarge" color="oliveDeep" style={{ fontSize: 22, fontWeight: '700', fontFamily: theme.fontFamilies.display }}>
              {isRu ? 'Оформление заказа' : 'Buyurtmani rasmiylashtirish'}
            </Text>
          </View>

          {/* Address */}
          <SectionLabel>{isRu ? 'Адрес доставки' : 'Yetkazish manzili'}</SectionLabel>
          <View style={{ paddingHorizontal: 20, marginBottom: 20 }}>
            {addressesQ.isLoading ? (
              <View style={{ padding: 16, alignItems: 'center' }}>
                <ActivityIndicator color={scheme === 'dark' ? colors.gold : colors.oliveDeep} />
              </View>
            ) : (addressesQ.data ?? []).length === 0 ? (
              <Pressable
                onPress={() => setNewAddressModal(true)}
                style={{
                  padding: 16, borderRadius: 18, borderWidth: 1, borderStyle: 'dashed',
                  borderColor: colors.rule, alignItems: 'center',
                }}
              >
                <Ionicons name="add-circle-outline" size={24} color={colors.ink} />
                <Text variant="bodySmall" color="ink" style={{ fontSize: 14, fontWeight: '600', marginTop: 6 }}>
                  Yangi manzil qo'shish
                </Text>
                <Text variant="caption" color="muted" style={{ fontSize: 12, marginTop: 2 }}>
                  Buyurtma uchun manzil kerak
                </Text>
              </Pressable>
            ) : (
              <View style={{ gap: 10 }}>
                {(addressesQ.data ?? []).map((addr) => (
                  <Pressable
                    key={addr.id}
                    onPress={() => setAddressId(addr.id)}
                    style={{
                      backgroundColor: colors.surface, borderRadius: 16,
                      borderWidth: addressId === addr.id ? 2 : 1,
                      borderColor: addressId === addr.id ? colors.oliveDeep : colors.rule,
                      padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12,
                    }}
                  >
                    <View style={{
                      width: 36, height: 36, borderRadius: 10,
                      backgroundColor: 'rgba(54,57,36,0.06)', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Ionicons name="home-outline" size={18} color={colors.ink} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text variant="bodySmall" color="ink" style={{ fontSize: 14, fontWeight: '600' }}>
                        {addr.label ?? addr.district}
                      </Text>
                      <Text variant="caption" color="muted" style={{ fontSize: 12, marginTop: 2 }}>
                        {addr.city}, {addr.street}, {addr.building}{addr.apartment ? `, ${addr.apartment}` : ''}
                      </Text>
                    </View>
                    {addressId === addr.id && (
                      <Ionicons name="checkmark-circle" size={22} color={colors.ink} />
                    )}
                  </Pressable>
                ))}
                <Pressable
                  onPress={() => setNewAddressModal(true)}
                  style={{
                    paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}
                >
                  <Ionicons name="add" size={16} color={colors.ink} />
                  <Text variant="caption" color="oliveDeep" style={{ fontSize: 13, fontWeight: '600' }}>
                    Yangi manzil
                  </Text>
                </Pressable>
              </View>
            )}
          </View>

          {/* Delivery Method */}
          <SectionLabel>{isRu ? 'Способ доставки' : 'Yetkazish usuli'}</SectionLabel>
          <View style={{ paddingHorizontal: 20, marginBottom: 20 }}>
            <View style={{ backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.rule, overflow: 'hidden' }}>
              {(() => {
                const items = [
                  { id: 'delivery' as const, label: isRu ? 'Курьер' : 'Kuryer', sub: isRu ? `1-2 дня · $${DELIVERY_FEES.delivery}` : `1-2 kun · $${DELIVERY_FEES.delivery}`, icon: 'bicycle-outline' as const },
                  { id: 'pickup' as const, label: isRu ? 'Самовывоз' : 'Olib ketish', sub: isRu ? 'Из магазина · бесплатно' : 'Do\'kondan · bepul', icon: 'storefront-outline' as const },
                  { id: 'proba' as const, label: isRu ? 'Проба (примерка)' : 'Proba (kiyib ko\'rish)', sub: isRu ? `Курьер · $${DELIVERY_FEES.proba}` : `Kuryer kelsin · $${DELIVERY_FEES.proba}`, icon: 'shirt-outline' as const },
                  { id: 'reserve' as const, label: isRu ? 'Бронь' : 'Bron qilish', sub: isRu ? 'Магазин свяжется' : 'Do\'kon bog\'lanadi · bepul', icon: 'bookmark-outline' as const },
                  { id: 'hold' as const, label: isRu ? 'Отложить' : 'Saqlab turish', sub: isRu ? 'Магазин свяжется' : 'Muddat kelishiladi · bepul', icon: 'time-outline' as const },
                ];
                return items.map((m, i) => {
                const selected = deliveryType === m.id;
                return (
                  <Pressable
                    key={m.id}
                    onPress={() => setDeliveryType(m.id)}
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: 12,
                      padding: 14, paddingHorizontal: 16,
                      borderBottomWidth: i < items.length - 1 ? 1 : 0, borderBottomColor: colors.rule,
                      backgroundColor: selected ? 'rgba(54,57,36,0.04)' : 'transparent',
                    }}
                  >
                    <View style={{
                      width: 36, height: 36, borderRadius: 10,
                      backgroundColor: 'rgba(54,57,36,0.06)', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Ionicons name={m.icon} size={18} color={colors.ink} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text variant="bodySmall" color="ink" style={{ fontSize: 14, fontWeight: '500' }}>{m.label}</Text>
                      <Text variant="caption" color="muted" style={{ fontSize: 11 }}>{m.sub}</Text>
                    </View>
                    <View style={{
                      width: 22, height: 22, borderRadius: 11,
                      borderWidth: 2, borderColor: selected ? colors.oliveDeep : colors.rule,
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                      {selected && <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: colors.oliveDeep }} />}
                    </View>
                  </Pressable>
                );
                });
              })()}
            </View>
          </View>

          {/* Payment used to be here. The marketplace does not take payment
              in-app any more — the seller contacts the buyer after the order
              lands and they agree on money + handover together. */}

          {/* Items */}
          <SectionLabel>{isRu ? 'Товары' : 'Mahsulotlar'} ({items.length})</SectionLabel>
          <View style={{ paddingHorizontal: 20, marginBottom: 20 }}>
            <View style={{ backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.rule, padding: 16 }}>
              {cartQ.isLoading ? (
                <ActivityIndicator color={scheme === 'dark' ? colors.gold : colors.oliveDeep} />
              ) : items.length === 0 ? (
                <Text variant="caption" color="muted" style={{ fontSize: 13 }}>{isRu ? 'Корзина пуста' : "Savat bo'sh"}</Text>
              ) : (
                items.map((item, i) => (
                  <View
                    key={item.id}
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: 12,
                      paddingVertical: 10,
                      borderBottomWidth: i < items.length - 1 ? 1 : 0, borderBottomColor: colors.rule,
                    }}
                  >
                    <View style={{
                      width: 48, height: 56, borderRadius: 10, overflow: 'hidden',
                      backgroundColor: 'rgba(138,141,91,0.1)', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {item.productImage ? (
                        <Image
                          source={{ uri: item.productImage }}
                          style={{ width: '100%', height: '100%' }}
                          resizeMode="contain"
                        />
                      ) : (
                        <Ionicons name="shirt-outline" size={20} color={colors.olive} />
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text variant="bodySmall" color="ink" style={{ fontSize: 13, fontWeight: '500' }} numberOfLines={1}>
                        {item.productTitle}
                      </Text>
                      <Text variant="caption" color="muted" style={{ fontSize: 11, marginTop: 2 }}>
                        {item.color} · {item.size}
                      </Text>
                      <Text variant="bodySmall" color="oliveDeep" style={{ fontSize: 13, fontWeight: '600', marginTop: 4 }}>
                        {formatUsdAsUzs(item.priceUsd, uzsRate)}
                      </Text>
                    </View>
                    <View style={{ backgroundColor: 'rgba(54,57,36,0.06)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}>
                      <Text variant="caption" color="oliveDeep" style={{ fontSize: 12, fontWeight: '600' }}>×{item.quantity}</Text>
                    </View>
                  </View>
                ))
              )}
            </View>
          </View>

          {/* Comment */}
          <SectionLabel>{isRu ? 'Комментарий (необязательно)' : 'Izoh (ixtiyoriy)'}</SectionLabel>
          <View style={{ paddingHorizontal: 20, marginBottom: 20 }}>
            <TextInput
              value={comment}
              onChangeText={setComment}
              placeholder="Kuryerga ko'rsatma qoldiring"
              placeholderTextColor={colors.muted}
              multiline
              maxLength={500}
              style={{
                backgroundColor: colors.surface,
                borderRadius: 16, borderWidth: 1, borderColor: colors.rule,
                padding: 14, minHeight: 72,
                fontSize: 14, color: colors.ink, textAlignVertical: 'top',
                fontFamily: theme.fontFamilies.body,
              }}
            />
          </View>

          {/* Summary */}
          <View style={{ paddingHorizontal: 20, marginBottom: 20 }}>
            <View style={{ backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.rule, padding: 16 }}>
              <Row label={isRu ? 'Товары' : 'Mahsulotlar'} value={formatUsdAsUzs(subtotal, uzsRate)} />
              <Row
                label="Yetkazish"
                value={deliveryFee === 0 ? (isRu ? 'Бесплатно' : 'Bepul') : formatUsdAsUzs(deliveryFee, uzsRate)}
                accent={deliveryFee === 0 ? colors.success : undefined}
              />
              <View style={{ height: 1, backgroundColor: colors.rule, marginVertical: 10 }} />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text variant="body" color="oliveDeep" style={{ fontSize: 15, fontWeight: '700' }}>Jami</Text>
                <Text variant="body" color="oliveDeep" style={{ fontSize: 15, fontWeight: '700' }}>{formatUsdAsUzs(total, uzsRate)}</Text>
              </View>
            </View>
          </View>
        </ScrollView>

        {/* Bottom CTA */}
        <View style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          paddingHorizontal: 20, paddingTop: 14, paddingBottom: 34,
          backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.rule,
        }}>
          {(() => {
            const canSubmit = items.length > 0 && !!addressId && !checkout.isPending;
            // Even when disabled we keep the oliveDeep fill — the greyed-out
            // "rule" shade blended into the surface and the CTA looked almost
            // invisible. Only the opacity drops so it still reads as disabled.
            return (
              <Pressable
                onPress={() => checkout.mutate()}
                disabled={!canSubmit}
                style={{
                  height: 52, borderRadius: 16,
                  backgroundColor: colors.oliveDeep,
                  alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8,
                  opacity: canSubmit ? 1 : 0.55,
                }}
              >
                {checkout.isPending ? (
                  <ActivityIndicator color={colors.goldSoft} />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle" size={20} color={colors.goldSoft} />
                    <Text variant="body" style={{ fontSize: 15, fontWeight: '700', color: colors.goldSoft, fontFamily: theme.fontFamilies.display }}>
                      {isRu ? 'Отправить заказ' : "Buyurtma yuborish"} · {formatUsdAsUzs(total, uzsRate)}
                    </Text>
                  </>
                )}
              </Pressable>
            );
          })()}
          <Text
            variant="caption"
            color="muted"
            style={{ fontSize: 11, textAlign: 'center', marginTop: 8 }}
          >
            {isRu
              ? 'Продавец скоро свяжется с вами'
              : "Sotuvchi tez orada aloqaga chiqadi"}
          </Text>
        </View>
      </KeyboardAvoidingView>

      {newAddressModal && (
        <NewAddressModal
          onClose={() => setNewAddressModal(false)}
          onCreated={(a) => {
            setAddressId(a.id);
            setNewAddressModal(false);
            qc.invalidateQueries({ queryKey: ['addresses'] });
          }}
        />
      )}
    </Screen>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ paddingHorizontal: 20, marginBottom: 8 }}>
      <Text
        variant="caption"
        color="muted"
        style={{ fontSize: 11, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', paddingLeft: 4 }}
      >
        {children}
      </Text>
    </View>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
      <Text variant="bodySmall" color="muted" style={{ fontSize: 13 }}>{label}</Text>
      <Text variant="bodySmall" style={{ fontSize: 13, color: accent ?? colors.ink }}>{value}</Text>
    </View>
  );
}

interface NewAddressModalProps {
  onClose: () => void;
  onCreated: (a: Address) => void;
}

function NewAddressModal({ onClose, onCreated }: NewAddressModalProps) {
  const { colors, theme, scheme } = useTheme();
  const [label, setLabel] = useState('Uy');
  const [city, setCity] = useState('Toshkent');
  const [district, setDistrict] = useState('');
  const [street, setStreet] = useState('');
  const [building, setBuilding] = useState('');
  const [apartment, setApartment] = useState('');
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locating, setLocating] = useState(false);

  const pickCurrentLocation = async () => {
    try {
      setLocating(true);
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          'Ruxsat kerak',
          "Joylashuvni aniqlash uchun ilovaga ruxsat bering.",
        );
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });

      // Reverse-geocode so the city / district / street fields fill in on
      // their own; the user can still tweak anything that's off.
      try {
        const places = await Location.reverseGeocodeAsync(pos.coords);
        const p = places[0];
        if (p) {
          if (p.city && !city) setCity(p.city);
          if (p.district && !district) setDistrict(p.district);
          if (p.street && !street) setStreet(p.street);
          if (p.streetNumber && !building) setBuilding(p.streetNumber);
        }
      } catch {
        // Reverse geocode is best-effort; the coords alone are enough for
        // the seller to pin the drop-off.
      }
    } catch (e: any) {
      Alert.alert('Xato', e?.message ?? 'Joylashuvni aniqlab bo\'lmadi');
    } finally {
      setLocating(false);
    }
  };

  const create = useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/addresses', {
        label: label.trim() || undefined,
        city: city.trim(),
        district: district.trim(),
        street: street.trim(),
        building: building.trim(),
        apartment: apartment.trim() || undefined,
        latitude: coords?.latitude,
        longitude: coords?.longitude,
      });
      return data as Address;
    },
    onSuccess: onCreated,
    onError: (e: any) => {
      Alert.alert(errorTitle(), errorMessage(e));
    },
  });

  const canSubmit = city.trim() && district.trim() && street.trim() && building.trim();

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={{
            backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24,
            paddingHorizontal: 20, paddingTop: 18, paddingBottom: 34,
          }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <Text variant="body" color="oliveDeep" style={{ fontSize: 18, fontWeight: '700', fontFamily: theme.fontFamilies.display }}>
                Yangi manzil
              </Text>
              <Pressable onPress={onClose} hitSlop={10}>
                <Ionicons name="close" size={24} color={colors.ink} />
              </Pressable>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ maxHeight: 440 }}>
              <Pressable
                onPress={pickCurrentLocation}
                disabled={locating}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  backgroundColor: coords ? colors.success + '22' : colors.surface,
                  borderWidth: 1,
                  borderColor: coords ? colors.success : colors.rule,
                  borderRadius: 12,
                  paddingVertical: 12,
                  marginBottom: 14,
                  opacity: locating ? 0.6 : 1,
                }}
              >
                {locating ? (
                  <ActivityIndicator color={colors.oliveDeep} size="small" />
                ) : (
                  <Ionicons
                    name={coords ? 'checkmark-circle' : 'location'}
                    size={18}
                    color={coords ? colors.success : colors.oliveDeep}
                  />
                )}
                <Text
                  variant="bodySmall"
                  style={{
                    fontSize: 13,
                    fontWeight: '600',
                    color: coords ? colors.success : colors.oliveDeep,
                  }}
                >
                  {coords
                    ? 'Joylashuv olindi ✓'
                    : 'Joriy joylashuvni olish'}
                </Text>
              </Pressable>
              <AddrField label="Nom (uy, ish...)" value={label} onChange={setLabel} />
              <AddrField label="Shahar" value={city} onChange={setCity} />
              <AddrField label="Tuman" value={district} onChange={setDistrict} placeholder="Chilonzor" />
              <AddrField label="Ko'cha" value={street} onChange={setStreet} placeholder="Bunyodkor" />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <AddrField label="Uy" value={building} onChange={setBuilding} placeholder="12A" />
                </View>
                <View style={{ flex: 1 }}>
                  <AddrField label="Xonadon" value={apartment} onChange={setApartment} placeholder="45" />
                </View>
              </View>
            </ScrollView>

            <Pressable
              onPress={() => create.mutate()}
              disabled={!canSubmit || create.isPending}
              style={{
                height: 52, borderRadius: 16, marginTop: 18,
                // Keep the oliveDeep fill even when disabled — the greyed
                // rule shade blended into the sheet and the CTA vanished.
                backgroundColor: colors.oliveDeep,
                alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8,
                opacity: canSubmit && !create.isPending ? 1 : 0.55,
              }}
            >
              {create.isPending ? (
                <ActivityIndicator color={colors.goldSoft} />
              ) : (
                <Text variant="body" style={{ fontSize: 15, fontWeight: '700', color: colors.goldSoft, fontFamily: theme.fontFamilies.display }}>
                  Saqlash
                </Text>
              )}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function AddrField({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  const { colors, theme, scheme } = useTheme();
  return (
    <View style={{ marginBottom: 12 }}>
      <Text variant="caption" color="muted" style={{ fontSize: 11, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        style={{
          backgroundColor: colors.surface,
          borderRadius: 12, borderWidth: 1, borderColor: colors.rule,
          paddingHorizontal: 12, paddingVertical: 11,
          fontSize: 14, color: colors.ink,
          fontFamily: theme.fontFamilies.body,
        }}
      />
    </View>
  );
}
