import { Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../../src/components/Screen';
import { Text } from '../../src/components/Text';
import { useTheme } from '../../src/theme/ThemeProvider';
import { safeBack } from '../../src/lib/safe-back';

interface MenuItem {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  iconColor: string;
  iconBg: string;
  route: string;
  secondary?: string;
}

const LANGUAGE_LABELS: Record<string, string> = {
  uz: "O'zbekcha",
  ru: 'Русский',
};

const TEXT = {
  uz: {
    title: 'Sozlamalar',
    account: 'Hisob',
    settings: 'Sozlamalar',
    support: 'Yordam',
    profileInfo: "Profil ma'lumotlari",
    addresses: 'Manzillarim',
    language: 'Til',
    notifications: 'Bildirishnomalar',
    helpCenter: 'Yordam markazi',
    contactUs: "Biz bilan bog'lanish",
  },
  ru: {
    title: 'Настройки',
    account: 'Аккаунт',
    settings: 'Настройки',
    support: 'Поддержка',
    profileInfo: 'Данные профиля',
    addresses: 'Мои адреса',
    language: 'Язык',
    notifications: 'Уведомления',
    helpCenter: 'Центр помощи',
    contactUs: 'Связаться с нами',
  },
};

function renderSection(title: string, items: MenuItem[], router: ReturnType<typeof useRouter>, colors: any) {
  return (
    <View style={{ paddingHorizontal: 20, marginBottom: 20 }}>
      <Text variant="caption" color="muted" style={{ fontSize: 11, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8, paddingLeft: 4 }}>
        {title}
      </Text>
      <View style={{ backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.rule, overflow: 'hidden' }}>
        {items.map((item, i) => (
          <Pressable
            key={item.label}
            onPress={() => router.push(item.route as any)}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 14,
              padding: 14, paddingHorizontal: 16,
              borderBottomWidth: i < items.length - 1 ? 1 : 0, borderBottomColor: colors.rule,
            }}
          >
            <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: item.iconBg, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name={item.icon} size={20} color={item.iconColor} />
            </View>
            <Text variant="bodySmall" color="ink" style={{ flex: 1, fontSize: 14, fontWeight: '500' }}>{item.label}</Text>
            {item.secondary && (
              <Text variant="caption" color="muted" style={{ fontSize: 12 }}>{item.secondary}</Text>
            )}
            <Ionicons name="chevron-forward" size={16} color={colors.muted} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export default function SettingsScreen() {
  const { colors, theme } = useTheme();
  const router = useRouter();
  const { i18n } = useTranslation();
  const lang = (i18n.language?.slice(0, 2) ?? 'uz') as 'uz' | 'ru';
  const t = TEXT[lang] ?? TEXT.uz;
  const currentLanguageLabel = LANGUAGE_LABELS[lang] ?? LANGUAGE_LABELS.uz;

  const accountItems: MenuItem[] = [
    { label: t.profileInfo, icon: 'person-outline', iconColor: '#8A8D5B', iconBg: 'rgba(138,141,91,0.1)', route: '/settings/profile-details' },
    { label: t.addresses, icon: 'location-outline', iconColor: '#C9A96E', iconBg: 'rgba(201,169,110,0.1)', route: '/settings/addresses' },
  ];

  const settingsItems: MenuItem[] = [
    { label: t.language, icon: 'language-outline', iconColor: '#5F7A94', iconBg: 'rgba(95,122,148,0.1)', route: '/settings/language', secondary: currentLanguageLabel },
    { label: t.notifications, icon: 'notifications-outline', iconColor: '#D9A24B', iconBg: 'rgba(217,162,75,0.1)', route: '/notifications' },
  ];

  const supportItems: MenuItem[] = [
    { label: t.helpCenter, icon: 'help-circle-outline', iconColor: '#7A8A5B', iconBg: 'rgba(122,138,91,0.1)', route: '/settings/help' },
    // "Biz bilan bog'laning" ekrani hozircha o'chirilgan — foydalanuvchi
    // suport flow'ini qayta ko'rib chiqishni so'ragan. Ekran kodi joyida
    // qoladi; menyuga qaytarish uchun shu qatorni yoqib qo'yish yetarli.
  ];

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
          <Text variant="displayLarge" color="oliveDeep" style={{ fontSize: 22, fontWeight: '700', fontFamily: theme.fontFamilies.display }}>
            {t.title}
          </Text>
        </View>

        {renderSection(t.account, accountItems, router, colors)}
        {renderSection(t.settings, settingsItems, router, colors)}
        {renderSection(t.support, supportItems, router, colors)}

        <View style={{ paddingHorizontal: 20, marginTop: 8 }}>
          <Text variant="caption" color="muted" style={{ fontSize: 11, textAlign: 'center' }}>
            Hijob v1.0.0
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}
