import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
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
  isDefault: boolean;
}

type DeliveryType = 'delivery' | 'pickup' | 'proba';
type PaymentMethod = 'click' | 'payme' | 'uzcard' | 'humo' | 'visa' | 'mastercard';

const PAYMENT_METHODS: Array<{ id: PaymentMethod; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { id: 'click', label: 'Click', icon: 'wallet-outline' },
  { id: 'payme', label: 'Payme', icon: 'card-outline' },
  { id: 'uzcard', label: 'Uzcard', icon: 'card-outline' },
  { id: 'humo', label: 'Humo', icon: 'card-outline' },
];

const DELIVERY_FEES: Record<DeliveryType, number> = {
  delivery: 5,
  pickup: 0,
  proba: 5,
};

export default function CheckoutScreen() {
  const { colors, theme } = useTheme();
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
  const [payment, setPayment] = useState<PaymentMethod>('click');
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
        deliverySpeed: deliveryType === 'pickup' ? undefined : 'tomorrow',
        paymentMethod: payment,
        comment: comment.trim() || undefined,
      });
      return data as { orderId: string; totalUsd: number; paymentUrl: string };
    },
    onSuccess: async (order) => {
      await qc.invalidateQueries({ queryKey: ['cart'] });
      await qc.invalidateQueries({ queryKey: ['orders'] });
      router.replace({ pathname: '/orders/[id]', params: { id: order.orderId } });
    },
    onError: (e: any) => {
      Alert.alert(errorTitle(), errorMessage(e));
    },
  });

  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ paddingBottom: 160 }} showsVerticalScrollIndicator={false}>
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
                <ActivityIndicator color={colors.oliveDeep} />
              </View>
            ) : (addressesQ.data ?? []).length === 0 ? (
              <Pressable
                onPress={() => setNewAddressModal(true)}
                style={{
                  padding: 16, borderRadius: 18, borderWidth: 1, borderStyle: 'dashed',
                  borderColor: colors.rule, alignItems: 'center',
                }}
              >
                <Ionicons name="add-circle-outline" size={24} color={colors.oliveDeep} />
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
                      <Ionicons name="home-outline" size={18} color={colors.oliveDeep} />
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
                      <Ionicons name="checkmark-circle" size={22} color={colors.oliveDeep} />
                    )}
                  </Pressable>
                ))}
                <Pressable
                  onPress={() => setNewAddressModal(true)}
                  style={{
                    paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}
                >
                  <Ionicons name="add" size={16} color={colors.oliveDeep} />
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
              {([
                { id: 'delivery' as const, label: 'Kuryer', sub: `1-2 kun · $${DELIVERY_FEES.delivery}`, icon: 'bicycle-outline' as const },
                { id: 'pickup' as const, label: 'Olib ketish', sub: 'Do\'kondan · bepul', icon: 'storefront-outline' as const },
                { id: 'proba' as const, label: 'Proba (kiyib ko\'rish)', sub: `Kuryer kelsin · $${DELIVERY_FEES.proba}`, icon: 'shirt-outline' as const },
              ]).map((m, i) => {
                const selected = deliveryType === m.id;
                return (
                  <Pressable
                    key={m.id}
                    onPress={() => setDeliveryType(m.id)}
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: 12,
                      padding: 14, paddingHorizontal: 16,
                      borderBottomWidth: i < 2 ? 1 : 0, borderBottomColor: colors.rule,
                      backgroundColor: selected ? 'rgba(54,57,36,0.04)' : 'transparent',
                    }}
                  >
                    <View style={{
                      width: 36, height: 36, borderRadius: 10,
                      backgroundColor: 'rgba(54,57,36,0.06)', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Ionicons name={m.icon} size={18} color={colors.oliveDeep} />
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
              })}
            </View>
          </View>

          {/* Payment */}
          <SectionLabel>{isRu ? 'Способ оплаты' : "To'lov usuli"}</SectionLabel>
          <View style={{ paddingHorizontal: 20, marginBottom: 20 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {PAYMENT_METHODS.map((p) => {
                const selected = payment === p.id;
                return (
                  <Pressable
                    key={p.id}
                    onPress={() => setPayment(p.id)}
                    style={{
                      flexBasis: '48%',
                      backgroundColor: colors.surface,
                      borderRadius: 14,
                      borderWidth: selected ? 2 : 1,
                      borderColor: selected ? colors.oliveDeep : colors.rule,
                      padding: 14,
                      flexDirection: 'row', alignItems: 'center', gap: 10,
                    }}
                  >
                    <Ionicons name={p.icon} size={20} color={colors.oliveDeep} />
                    <Text variant="bodySmall" color="ink" style={{ fontSize: 14, fontWeight: '600' }}>{p.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Items */}
          <SectionLabel>{isRu ? 'Товары' : 'Mahsulotlar'} ({items.length})</SectionLabel>
          <View style={{ paddingHorizontal: 20, marginBottom: 20 }}>
            <View style={{ backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.rule, padding: 16 }}>
              {cartQ.isLoading ? (
                <ActivityIndicator color={colors.oliveDeep} />
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
                        <View style={{ width: '100%', height: '100%', backgroundColor: colors.rule }} />
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
                        ${item.priceUsd.toFixed(2)}
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
              <Row label="Mahsulotlar" value={`$${subtotal.toFixed(2)}`} />
              <Row
                label="Yetkazish"
                value={deliveryFee === 0 ? 'Bepul' : `$${deliveryFee.toFixed(2)}`}
                accent={deliveryFee === 0 ? colors.success : undefined}
              />
              <View style={{ height: 1, backgroundColor: colors.rule, marginVertical: 10 }} />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text variant="body" color="oliveDeep" style={{ fontSize: 15, fontWeight: '700' }}>Jami</Text>
                <Text variant="body" color="oliveDeep" style={{ fontSize: 15, fontWeight: '700' }}>${total.toFixed(2)}</Text>
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
          <Pressable
            onPress={() => checkout.mutate()}
            disabled={checkout.isPending || items.length === 0 || !addressId}
            style={{
              height: 52, borderRadius: 16,
              backgroundColor: items.length === 0 || !addressId ? colors.rule : colors.oliveDeep,
              alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8,
              opacity: checkout.isPending ? 0.7 : 1,
            }}
          >
            {checkout.isPending ? (
              <ActivityIndicator color={colors.goldSoft} />
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={20} color={colors.goldSoft} />
                <Text variant="body" style={{ fontSize: 15, fontWeight: '700', color: colors.goldSoft, fontFamily: theme.fontFamilies.display }}>
                  Buyurtma berish · ${total.toFixed(2)}
                </Text>
              </>
            )}
          </Pressable>
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
  const { colors, theme } = useTheme();
  const [label, setLabel] = useState('Uy');
  const [city, setCity] = useState('Toshkent');
  const [district, setDistrict] = useState('');
  const [street, setStreet] = useState('');
  const [building, setBuilding] = useState('');
  const [apartment, setApartment] = useState('');

  const create = useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/addresses', {
        label: label.trim() || undefined,
        city: city.trim(),
        district: district.trim(),
        street: street.trim(),
        building: building.trim(),
        apartment: apartment.trim() || undefined,
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
                backgroundColor: canSubmit ? colors.oliveDeep : colors.rule,
                alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8,
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
  const { colors, theme } = useTheme();
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
