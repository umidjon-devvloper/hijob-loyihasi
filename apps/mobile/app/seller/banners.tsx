import { useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Screen } from '../../src/components/Screen';
import { Text } from '../../src/components/Text';
import { useTheme } from '../../src/theme/ThemeProvider';
import { api } from '../../src/api/client';
import { errorMessage, errorTitle } from '../../src/lib/api-errors';
import { safeBack } from '../../src/lib/safe-back';

interface Template {
  id: string;
  bgUrl: string;
  previewUrl: string | null;
  nameUz: string | null;
  nameRu: string | null;
  textStyle: 'light' | 'dark';
}

interface Banner {
  id: string;
  templateId: string | null;
  customImageUrl: string | null;
  title: string | null;
  subtitle: string | null;
  productId: string | null;
  ctaLabelUz: string | null;
  ctaLabelRu: string | null;
  isActive: boolean;
  isApproved: boolean;
  template: Template | null;
}

export default function SellerBannersScreen() {
  const { colors, theme, scheme } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { i18n } = useTranslation();
  const lang = (i18n.language?.slice(0, 2) ?? 'uz') as 'uz' | 'ru' | 'en' | 'ar';
  const L = (uz: string, ru: string, en: string, ar: string) =>
    ({ uz, ru, en, ar }[lang] ?? uz);

  const [editing, setEditing] = useState<Partial<Banner> | null>(null);

  const templatesQ = useQuery<Template[]>({
    queryKey: ['banner-templates'],
    queryFn: async () => (await api.get<Template[]>('/banner-templates')).data,
  });
  const bannersQ = useQuery<Banner[]>({
    queryKey: ['seller-banners'],
    queryFn: async () => (await api.get<Banner[]>('/seller/banners')).data,
  });

  const subscriptionQ = useQuery<{ isActive: boolean }>({
    queryKey: ['seller-subscription'],
    queryFn: async () => (await api.get('/seller/subscription')).data,
  });
  const subscriptionActive = subscriptionQ.data?.isActive ?? false;

  const saveMutation = useMutation({
    mutationFn: async (dto: Partial<Banner>) => {
      if (dto.id) {
        return (await api.patch(`/seller/banners/${dto.id}`, dto)).data;
      }
      return (await api.post('/seller/banners', dto)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['seller-banners'] });
      setEditing(null);
      Alert.alert('✓', L('Saqlandi', 'Сохранено', 'Saved', 'تم الحفظ'));
    },
    onError: (e: any) => Alert.alert(errorTitle(), errorMessage(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/seller/banners/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['seller-banners'] }),
    onError: (e: any) => Alert.alert(errorTitle(), errorMessage(e)),
  });

  const uploadCustom = useMutation({
    mutationFn: async (uri: string) => {
      const fd = new FormData();
      const name = uri.split('/').pop() || 'banner.jpg';
      const type = /\.png$/i.test(name) ? 'image/png' : 'image/jpeg';
      fd.append('files', { uri, name, type } as any);
      const res = await api.post<{ files: Array<{ url: string }> }>('/seller/uploads', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return res.data.files[0]?.url;
    },
    onSuccess: (url) => url && setEditing((v) => ({ ...v, customImageUrl: url, templateId: null })),
    onError: (e: any) => Alert.alert(errorTitle(), errorMessage(e)),
  });

  async function pickCustomImage() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Ruxsat kerak', 'Galereyaga ruxsat bering');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [16, 9],
      quality: 0.9,
    });
    if (res.canceled || !res.assets?.[0]?.uri) return;
    uploadCustom.mutate(res.assets[0].uri);
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: 48 }} showsVerticalScrollIndicator={false}>
        <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pressable
            onPress={() => safeBack()}
            style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceGlass, borderWidth: 1, borderColor: colors.rule, alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="arrow-back" size={18} color={colors.ink} />
          </Pressable>
          <Text variant="displayLarge" style={{ fontSize: 22, fontWeight: '700', fontFamily: theme.fontFamilies.display, color: colors.ink }}>
            {L('Bannerlar', 'Баннеры', 'Banners', 'اللافتات')}
          </Text>
        </View>

        <View style={{ paddingHorizontal: 20 }}>
          {!subscriptionActive && (
            <View style={{
              padding: 14, marginBottom: 14, borderRadius: 14,
              borderWidth: 1, borderColor: colors.gold,
              backgroundColor: 'rgba(201, 169, 110, 0.08)',
              flexDirection: 'row', gap: 10, alignItems: 'flex-start',
            }}>
              <Ionicons name="lock-closed" size={18} color={colors.gold} style={{ marginTop: 2 }} />
              <View style={{ flex: 1 }}>
                <Text variant="body" style={{ color: colors.ink, fontWeight: '700', fontSize: 13 }}>
                  {L('Obuna kerak', 'Нужна подписка', 'Subscription required', 'الاشتراك مطلوب')}
                </Text>
                <Text variant="caption" color="muted" style={{ fontSize: 12, marginTop: 2, lineHeight: 17 }}>
                  {L(
                    "Banner yaratish va bosh sahifaga chiqarish — obunachilar uchun. Avval obunani faollashtiring.",
                    'Создание баннеров доступно только по подписке. Активируйте подписку, чтобы продолжить.',
                    'Banner creation is a subscriber feature. Activate your subscription to continue.',
                    'إنشاء اللافتات متاح للمشتركين. فعّل اشتراكك للمتابعة.'
                  )}
                </Text>
                <Pressable
                  onPress={() => router.push('/seller/subscription')}
                  style={{ marginTop: 8, alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.gold }}
                >
                  <Text variant="caption" style={{ fontSize: 11, color: colors.oliveDeep, fontWeight: '700' }}>
                    {L('Obunaga o\'tish', 'Открыть подписку', 'Open subscription', 'فتح الاشتراك')}
                  </Text>
                </Pressable>
              </View>
            </View>
          )}
          <Text variant="caption" color="muted" style={{ fontSize: 12, marginBottom: 16, lineHeight: 18 }}>
            {L(
              'Siz tayyor shablonlardan foydalanishingiz yoki o\'z rasm yuklashingiz mumkin. Admin tasdiqlagandan keyin banner bosh sahifada ko\'rinadi.',
              'Используйте готовый шаблон или загрузите своё изображение. Баннер появится на главной после одобрения админом.',
              'Pick a ready template or upload your own image. Admin approval publishes it on the home page.',
              'استخدم قالبًا جاهزًا أو ارفع صورتك. تظهر اللافتة في الصفحة الرئيسية بعد موافقة المسؤول.'
            )}
          </Text>

          {/* My banners */}
          {bannersQ.isLoading ? (
            <ActivityIndicator color={scheme === 'dark' ? colors.gold : colors.oliveDeep} />
          ) : (
            (bannersQ.data ?? []).map((b) => (
              <View key={b.id} style={{ marginBottom: 14, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: colors.rule, backgroundColor: colors.surface }}>
                {(b.customImageUrl || b.template?.bgUrl) ? (
                  <Image source={{ uri: b.customImageUrl ?? b.template!.bgUrl }} style={{ width: '100%', aspectRatio: 16 / 9 }} resizeMode="cover" />
                ) : (
                  <View style={{ width: '100%', aspectRatio: 16 / 9, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="image-outline" size={32} color={colors.muted} />
                  </View>
                )}
                <View style={{ padding: 12 }}>
                  {b.title && (
                    <Text variant="body" style={{ fontWeight: '600', color: colors.ink, fontSize: 14 }}>{b.title}</Text>
                  )}
                  {b.subtitle && (
                    <Text variant="caption" color="muted" style={{ fontSize: 12, marginTop: 2 }}>{b.subtitle}</Text>
                  )}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
                    <View style={{
                      paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6,
                      backgroundColor: b.isActive ? 'rgba(122,138,91,0.15)' : 'rgba(0,0,0,0.08)',
                    }}>
                      <Text variant="caption" style={{ fontSize: 10, fontWeight: '700', color: b.isActive ? '#7A8A5B' : colors.muted }}>
                        {b.isActive ? L('FAOL', 'АКТИВ', 'ACTIVE', 'نشط') : L('O\'CHIQ', 'ОТКЛ', 'OFF', 'إيقاف')}
                      </Text>
                    </View>
                    <View style={{
                      paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6,
                      backgroundColor: b.isApproved ? 'rgba(201,169,110,0.2)' : 'rgba(217,162,75,0.15)',
                    }}>
                      <Text variant="caption" style={{ fontSize: 10, fontWeight: '700', color: b.isApproved ? '#A88848' : '#D9A24B' }}>
                        {b.isApproved ? L('TASDIQLANGAN', 'ОДОБРЕНО', 'APPROVED', 'موافق عليه') : L('KUTMOQDA', 'ОЖИДАЕТ', 'PENDING', 'قيد الانتظار')}
                      </Text>
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                    <Pressable
                      onPress={() => setEditing(b)}
                      style={{ flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: colors.surface2, alignItems: 'center', borderWidth: 1, borderColor: colors.rule }}
                    >
                      <Text variant="caption" style={{ color: colors.ink, fontWeight: '600', fontSize: 12 }}>
                        {L('Tahrir', 'Изменить', 'Edit', 'تعديل')}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => Alert.alert(
                        L('O\'chirish', 'Удалить', 'Delete', 'حذف'),
                        '?',
                        [
                          { text: L('Bekor', 'Отмена', 'Cancel', 'إلغاء'), style: 'cancel' },
                          { text: L('O\'chirish', 'Удалить', 'Delete', 'حذف'), style: 'destructive', onPress: () => deleteMutation.mutate(b.id) },
                        ],
                      )}
                      style={{ paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, backgroundColor: 'rgba(184,84,80,0.1)' }}
                    >
                      <Ionicons name="trash-outline" size={16} color="#B85450" />
                    </Pressable>
                  </View>
                </View>
              </View>
            ))
          )}

          <Pressable
            onPress={() => {
              if (!subscriptionActive) {
                Alert.alert(
                  L('Obuna kerak', 'Нужна подписка', 'Subscription required', 'الاشتراك مطلوب'),
                  L(
                    'Banner yaratish uchun avval obunani faollashtiring.',
                    'Чтобы создать баннер, активируйте подписку.',
                    'Activate your subscription to create a banner.',
                    'فعّل اشتراكك لإنشاء لافتة.'
                  ),
                  [
                    { text: L('Bekor', 'Отмена', 'Cancel', 'إلغاء'), style: 'cancel' },
                    { text: L('Obunaga o\'tish', 'К подписке', 'Open subscription', 'فتح الاشتراك'), onPress: () => router.push('/seller/subscription') },
                  ],
                );
                return;
              }
              setEditing({});
            }}
            style={{
              marginTop: 8, padding: 16, borderRadius: 14,
              backgroundColor: subscriptionActive ? colors.oliveDeep : colors.surface2,
              borderWidth: subscriptionActive ? 0 : 1,
              borderColor: colors.rule,
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
              opacity: subscriptionActive ? 1 : 0.6,
            }}
          >
            <Ionicons name={subscriptionActive ? 'add-circle' : 'lock-closed'} size={20} color={subscriptionActive ? colors.goldSoft : colors.muted} />
            <Text variant="body" style={{ color: subscriptionActive ? colors.goldSoft : colors.muted, fontWeight: '700', fontSize: 15 }}>
              {L('Yangi banner', 'Новый баннер', 'New banner', 'لافتة جديدة')}
            </Text>
          </Pressable>
        </View>

        {/* Editor */}
        {editing !== null && (
          <View style={{ marginTop: 24, marginHorizontal: 20, padding: 16, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.gold }}>
            <Text variant="body" style={{ color: colors.ink, fontWeight: '700', fontSize: 15, marginBottom: 12 }}>
              {editing.id ? L('Bannerni tahrirlash', 'Редактировать баннер', 'Edit banner', 'تعديل اللافتة') : L('Yangi banner', 'Новый баннер', 'New banner', 'لافتة جديدة')}
            </Text>

            {/* Custom upload */}
            <Pressable
              onPress={pickCustomImage}
              disabled={uploadCustom.isPending}
              style={{ padding: 14, borderRadius: 10, borderWidth: 1, borderColor: colors.rule, borderStyle: 'dashed', alignItems: 'center', marginBottom: 12 }}
            >
              {uploadCustom.isPending ? (
                <ActivityIndicator color={colors.gold} />
              ) : editing.customImageUrl ? (
                <Image source={{ uri: editing.customImageUrl }} style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 8 }} resizeMode="cover" />
              ) : (
                <>
                  <Ionicons name="cloud-upload-outline" size={28} color={colors.muted} />
                  <Text variant="caption" color="muted" style={{ fontSize: 12, marginTop: 6 }}>
                    {L('O\'zim rasm yuklayman (16:9)', 'Загружу своё фото (16:9)', 'Upload my own image (16:9)', 'ارفع صورتي (16:9)')}
                  </Text>
                </>
              )}
            </Pressable>

            {/* OR template picker */}
            <Text variant="caption" color="muted" style={{ fontSize: 11, letterSpacing: 1, fontWeight: '600', marginBottom: 8 }}>
              {L('YOKI SHABLON TANLANG', 'ИЛИ ВЫБЕРИТЕ ШАБЛОН', 'OR PICK A TEMPLATE', 'أو اختر قالبًا')}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 12 }}>
              {(templatesQ.data ?? []).map((t) => {
                const active = editing.templateId === t.id;
                return (
                  <Pressable
                    key={t.id}
                    onPress={() => setEditing((v) => ({ ...v, templateId: t.id, customImageUrl: null }))}
                    style={{
                      width: 160, borderRadius: 10, overflow: 'hidden',
                      borderWidth: active ? 2 : 1,
                      borderColor: active ? colors.gold : colors.rule,
                    }}
                  >
                    <Image source={{ uri: t.previewUrl ?? t.bgUrl }} style={{ width: '100%', aspectRatio: 16 / 9 }} resizeMode="cover" />
                    {(t.nameUz || t.nameRu) && (
                      <View style={{ padding: 6, backgroundColor: colors.surface2 }}>
                        <Text variant="caption" style={{ fontSize: 10, color: colors.ink }} numberOfLines={1}>
                          {lang === 'ru' ? (t.nameRu ?? t.nameUz) : (t.nameUz ?? t.nameRu)}
                        </Text>
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* Fields */}
            <Text variant="caption" color="muted" style={{ fontSize: 11, fontWeight: '600', marginBottom: 4 }}>
              {L('SARLAVHA', 'ЗАГОЛОВОК', 'TITLE', 'العنوان')}
            </Text>
            <TextInput
              value={editing.title ?? ''}
              onChangeText={(v) => setEditing((e) => ({ ...e, title: v }))}
              placeholder={L('Masalan: Yangi kolleksiya', 'Например: Новая коллекция', 'e.g. New collection', 'مثال: المجموعة الجديدة')}
              placeholderTextColor={colors.muted}
              style={{ borderWidth: 1, borderColor: colors.rule, borderRadius: 10, padding: 12, color: colors.ink, marginBottom: 10, fontSize: 14 }}
            />

            <Text variant="caption" color="muted" style={{ fontSize: 11, fontWeight: '600', marginBottom: 4 }}>
              {L('QO\'SHIMCHA MATN', 'ПОДЗАГОЛОВОК', 'SUBTITLE', 'العنوان الفرعي')}
            </Text>
            <TextInput
              value={editing.subtitle ?? ''}
              onChangeText={(v) => setEditing((e) => ({ ...e, subtitle: v }))}
              placeholder={L('Qisqa tavsif', 'Короткое описание', 'Short description', 'وصف قصير')}
              placeholderTextColor={colors.muted}
              multiline
              style={{ borderWidth: 1, borderColor: colors.rule, borderRadius: 10, padding: 12, color: colors.ink, marginBottom: 10, minHeight: 60, fontSize: 14 }}
            />

            {/* Toggle active */}
            <Pressable
              onPress={() => setEditing((e) => ({ ...e, isActive: !e?.isActive }))}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 10, backgroundColor: colors.surface2, marginBottom: 12 }}
            >
              <View style={{ width: 20, height: 20, borderRadius: 4, borderWidth: 2, borderColor: editing.isActive ? colors.gold : colors.rule, backgroundColor: editing.isActive ? colors.gold : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                {editing.isActive && <Ionicons name="checkmark" size={14} color={colors.oliveDeep} />}
              </View>
              <Text variant="body" style={{ color: colors.ink, fontSize: 13, flex: 1 }}>
                {L('Faol — bosh sahifada ko\'rsatiladi', 'Активен — показывать на главной', 'Active — show on home', 'نشط — عرض على الصفحة الرئيسية')}
              </Text>
            </Pressable>

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable
                onPress={() => setEditing(null)}
                style={{ flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: colors.surface2, alignItems: 'center', borderWidth: 1, borderColor: colors.rule }}
              >
                <Text variant="caption" style={{ color: colors.ink, fontWeight: '600', fontSize: 13 }}>
                  {L('Bekor', 'Отмена', 'Cancel', 'إلغاء')}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => saveMutation.mutate(editing)}
                disabled={saveMutation.isPending || (!editing.templateId && !editing.customImageUrl)}
                style={{ flex: 2, paddingVertical: 12, borderRadius: 10, backgroundColor: colors.gold, alignItems: 'center', opacity: saveMutation.isPending || (!editing.templateId && !editing.customImageUrl) ? 0.5 : 1 }}
              >
                {saveMutation.isPending ? (
                  <ActivityIndicator color={colors.oliveDeep} />
                ) : (
                  <Text variant="caption" style={{ color: colors.oliveDeep, fontWeight: '700', fontSize: 13 }}>
                    {L('Saqlash', 'Сохранить', 'Save', 'حفظ')}
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
