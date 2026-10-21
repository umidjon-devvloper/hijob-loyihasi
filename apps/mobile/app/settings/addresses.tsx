import { useState } from 'react';
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
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../../src/components/Screen';
import { Text } from '../../src/components/Text';
import { useTheme } from '../../src/theme/ThemeProvider';
import { api } from '../../src/api/client';
import { errorMessage, errorTitle } from '../../src/lib/api-errors';
import { safeBack } from '../../src/lib/safe-back';

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

export default function AddressesScreen() {
  const { colors, theme } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { i18n } = useTranslation();
  const isRu = (i18n.language?.slice(0, 2) ?? 'uz') === 'ru';
  const [modal, setModal] = useState<null | 'new'>(null);

  const { data, isLoading, isError, refetch } = useQuery<Address[]>({
    queryKey: ['addresses'],
    queryFn: async () => (await api.get<Address[]>('/addresses')).data,
  });

  const removeAddr = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/addresses/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['addresses'] }),
    onError: (e: any) => Alert.alert(errorTitle(), errorMessage(e)),
  });

  const setDefault = useMutation({
    mutationFn: async (id: string) => {
      await api.patch(`/addresses/${id}`, { isDefault: true });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['addresses'] }),
  });

  const items = data ?? [];

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
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
            {isRu ? 'Адреса' : 'Manzillar'}
          </Text>
        </View>

        {isLoading ? (
          <View style={{ padding: 40, alignItems: 'center' }}>
            <ActivityIndicator color={colors.oliveDeep} />
          </View>
        ) : isError ? (
          <View style={{ padding: 40, alignItems: 'center', gap: 8 }}>
            <Ionicons name="cloud-offline-outline" size={40} color={colors.muted} />
            <Text variant="body" color="muted" style={{ fontSize: 14 }}>{isRu ? 'Не удалось загрузить' : "Yuklab bo'lmadi"}</Text>
            <Pressable onPress={() => refetch()} style={{ marginTop: 8, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: colors.oliveDeep }}>
              <Text variant="bodySmall" style={{ fontSize: 13, fontWeight: '600', color: colors.goldSoft }}>{isRu ? 'Повторить' : 'Qaytadan'}</Text>
            </Pressable>
          </View>
        ) : items.length === 0 ? (
          <View style={{ padding: 40, alignItems: 'center', gap: 8 }}>
            <Ionicons name="location-outline" size={40} color={colors.muted} />
            <Text variant="body" color="muted" style={{ fontSize: 14 }}>{isRu ? 'Список адресов пуст' : "Manzillar ro'yxati bo'sh"}</Text>
          </View>
        ) : (
          <View style={{ paddingHorizontal: 20, gap: 12 }}>
            {items.map((a) => (
              <View
                key={a.id}
                style={{
                  padding: 14, borderRadius: 16,
                  backgroundColor: colors.surface,
                  borderWidth: 1, borderColor: colors.rule,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                  <View style={{
                    width: 36, height: 36, borderRadius: 10,
                    backgroundColor: 'rgba(54,57,36,0.06)',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Ionicons name="home-outline" size={18} color={colors.oliveDeep} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text variant="bodySmall" color="ink" style={{ fontSize: 14, fontWeight: '600' }}>
                        {a.label ?? a.district}
                      </Text>
                      {a.isDefault && (
                        <View style={{ backgroundColor: 'rgba(201,169,110,0.18)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                          <Text variant="caption" style={{ fontSize: 10, fontWeight: '700', color: colors.gold }}>{isRu ? 'ОСНОВНОЙ' : 'ASOSIY'}</Text>
                        </View>
                      )}
                    </View>
                    <Text variant="caption" color="muted" style={{ fontSize: 12, marginTop: 2 }}>
                      {a.city}, {a.street}, {a.building}{a.apartment ? `, ${a.apartment}` : ''}
                    </Text>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                  {!a.isDefault && (
                    <Pressable
                      onPress={() => setDefault.mutate(a.id)}
                      style={{ flex: 1, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.surfaceAlt, alignItems: 'center' }}
                    >
                      <Text variant="caption" style={{ fontSize: 12, fontWeight: '600', color: colors.oliveDeep }}>{isRu ? 'Сделать основным' : 'Asosiy qilish'}</Text>
                    </Pressable>
                  )}
                  <Pressable
                    onPress={() =>
                      Alert.alert(
                        isRu ? 'Удалить' : "O'chirish",
                        isRu
                          ? `Удалить адрес «${a.label ?? a.district}»?`
                          : `"${a.label ?? a.district}" manzilini o'chirasizmi?`,
                        [
                          { text: isRu ? 'Нет' : "Yo'q", style: 'cancel' },
                          { text: isRu ? 'Да' : 'Ha', style: 'destructive', onPress: () => removeAddr.mutate(a.id) },
                        ],
                      )
                    }
                    style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, backgroundColor: 'rgba(184,84,80,0.08)', alignItems: 'center' }}
                  >
                    <Text variant="caption" style={{ fontSize: 12, fontWeight: '600', color: colors.danger }}>{isRu ? 'Удалить' : "O'chirish"}</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <View style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        paddingHorizontal: 20, paddingTop: 14, paddingBottom: 34,
        backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.rule,
      }}>
        <Pressable
          onPress={() => setModal('new')}
          style={{ height: 52, borderRadius: 16, backgroundColor: colors.oliveDeep, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 }}
        >
          <Ionicons name="add" size={20} color={colors.goldSoft} />
          <Text variant="body" style={{ fontSize: 15, fontWeight: '700', color: colors.goldSoft, fontFamily: theme.fontFamilies.display }}>
            {isRu ? 'Добавить адрес' : "Yangi manzil qo'shish"}
          </Text>
        </Pressable>
      </View>

      {modal === 'new' && <NewAddressModal onClose={() => setModal(null)} onCreated={() => { setModal(null); qc.invalidateQueries({ queryKey: ['addresses'] }); }} />}
    </Screen>
  );
}

interface NewAddrProps { onClose: () => void; onCreated: () => void; }

function NewAddressModal({ onClose, onCreated }: NewAddrProps) {
  const { colors, theme } = useTheme();
  const { i18n } = useTranslation();
  const isRu = (i18n.language?.slice(0, 2) ?? 'uz') === 'ru';
  const [label, setLabel] = useState(isRu ? 'Дом' : 'Uy');
  const [city, setCity] = useState('Toshkent');
  const [district, setDistrict] = useState('');
  const [street, setStreet] = useState('');
  const [building, setBuilding] = useState('');
  const [apartment, setApartment] = useState('');

  const create = useMutation({
    mutationFn: async () => {
      await api.post('/addresses', {
        label: label.trim() || undefined,
        city: city.trim(),
        district: district.trim(),
        street: street.trim(),
        building: building.trim(),
        apartment: apartment.trim() || undefined,
      });
    },
    onSuccess: onCreated,
    onError: (e: any) => Alert.alert(errorTitle(), errorMessage(e)),
  });

  const can = city.trim() && district.trim() && street.trim() && building.trim();

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={{ backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 34 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <Text variant="body" color="oliveDeep" style={{ fontSize: 18, fontWeight: '700', fontFamily: theme.fontFamilies.display }}>{isRu ? 'Новый адрес' : 'Yangi manzil'}</Text>
              <Pressable onPress={onClose} hitSlop={10}><Ionicons name="close" size={24} color={colors.ink} /></Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ maxHeight: 440 }}>
              <AddrField label={isRu ? 'Название (дом, работа...)' : "Nom (uy, ish...)"} value={label} onChange={setLabel} />
              <AddrField label={isRu ? 'Город' : 'Shahar'} value={city} onChange={setCity} />
              <AddrField label={isRu ? 'Район' : 'Tuman'} value={district} onChange={setDistrict} placeholder="Chilonzor" />
              <AddrField label={isRu ? 'Улица' : "Ko'cha"} value={street} onChange={setStreet} placeholder="Bunyodkor" />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}><AddrField label={isRu ? 'Дом' : 'Uy'} value={building} onChange={setBuilding} placeholder="12A" /></View>
                <View style={{ flex: 1 }}><AddrField label={isRu ? 'Квартира' : 'Xonadon'} value={apartment} onChange={setApartment} placeholder="45" /></View>
              </View>
            </ScrollView>
            <Pressable
              onPress={() => create.mutate()}
              disabled={!can || create.isPending}
              style={{ height: 52, borderRadius: 16, marginTop: 18, backgroundColor: can ? colors.oliveDeep : colors.rule, alignItems: 'center', justifyContent: 'center' }}
            >
              {create.isPending ? (
                <ActivityIndicator color={colors.goldSoft} />
              ) : (
                <Text variant="body" style={{ fontSize: 15, fontWeight: '700', color: colors.goldSoft, fontFamily: theme.fontFamilies.display }}>{isRu ? 'Сохранить' : 'Saqlash'}</Text>
              )}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function AddrField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const { colors, theme } = useTheme();
  return (
    <View style={{ marginBottom: 12 }}>
      <Text variant="caption" color="muted" style={{ fontSize: 11, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        style={{
          backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.rule,
          paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, color: colors.ink,
          fontFamily: theme.fontFamilies.body,
        }}
      />
    </View>
  );
}
