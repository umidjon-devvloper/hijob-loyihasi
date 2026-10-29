/**
 * Demo akkountlar + mahsulotlar yarattiradi — App Store review paytida
 * Apple reviewer kirib ko'rishi uchun. Idempotent: har safar bir xil
 * ma'lumot bilan ishga tushsa, yangilaydi, dublikat yaratmaydi.
 */
import { PrismaClient, UserRole, ProductStatus, DeliveryType } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const DEMO_ADMIN = {
  phone: '+998900000001',
  username: 'admin',
  password: 'Admin2026!',
  fullName: 'Administrator',
};

const DEMO_SELLER = {
  phone: '+998900000002',
  username: 'demoshop',
  password: 'DemoShop2026!',
  fullName: 'Demo Sotuvchi',
  brandName: 'Demo Hijab Store',
  description: 'App Store review uchun demo do\'kon',
};

const DEMO_BUYER = {
  phone: '+998900000003',
  username: 'demobuyer',
  password: 'DemoBuyer2026!',
  fullName: 'Demo Xaridor',
};

async function upsertUser(
  spec: { phone: string; username: string; password: string; fullName: string },
  role: UserRole,
) {
  const passwordHash = await bcrypt.hash(spec.password, 10);
  return prisma.user.upsert({
    where: { phone: spec.phone },
    update: {
      role,
      username: spec.username,
      passwordHash,
      isActive: true,
      phoneVerified: true,
      fullName: spec.fullName,
    },
    create: {
      phone: spec.phone,
      username: spec.username,
      passwordHash,
      role,
      isActive: true,
      phoneVerified: true,
      fullName: spec.fullName,
      language: 'uz',
    },
  });
}

const DEMO_PRODUCTS = [
  {
    titleRu: 'Шифоновый хиджаб "Нежность"',
    titleUz: 'Shifon hijob "Nozakat"',
    categoryId: 'scarves' as const,
    basePriceUsd: 15,
    bodyFit: null,
    coverUrl: 'https://images.pexels.com/photos/8386649/pexels-photo-8386649.jpeg?auto=compress&cs=tinysrgb&w=800',
    variants: [
      { color: 'Krem', colorHex: '#E6D7C3', size: '110×110', stock: 20 },
      { color: 'Terakot', colorHex: '#B85450', size: '110×110', stock: 15 },
      { color: 'Zaytun', colorHex: '#8A8D5B', size: '140×140', stock: 10 },
    ],
    sceneId: 'beige',
  },
  {
    titleRu: 'Платье "Элегантность"',
    titleUz: 'Ko\'ylak "Nazokat"',
    categoryId: 'dresses' as const,
    basePriceUsd: 45,
    bodyFit: 'regular' as const,
    coverUrl: 'https://images.pexels.com/photos/2866077/pexels-photo-2866077.jpeg?auto=compress&cs=tinysrgb&w=800',
    variants: [
      { color: 'Qora', colorHex: '#1B1B1B', size: 'M', stock: 8 },
      { color: 'Ko\'k', colorHex: '#1E3A5F', size: 'L', stock: 6 },
    ],
    sceneId: 'olive',
  },
  {
    titleRu: 'Атласный хиджаб "Шарм"',
    titleUz: 'Atlas hijob "Jozibadorlik"',
    categoryId: 'scarves' as const,
    basePriceUsd: 22,
    bodyFit: null,
    coverUrl: 'https://images.pexels.com/photos/8386648/pexels-photo-8386648.jpeg?auto=compress&cs=tinysrgb&w=800',
    variants: [
      { color: 'Lavanda', colorHex: '#B57EDC', size: '110×110', stock: 12 },
      { color: 'Qum', colorHex: '#D4C3A0', size: '140×140', stock: 7 },
    ],
    sceneId: 'blue',
  },
];

async function createDemoProducts(sellerId: string) {
  for (let i = 0; i < DEMO_PRODUCTS.length; i++) {
    const p = DEMO_PRODUCTS[i]!;
    // Avval shu nomdagi mahsulotni topib ko'ramiz — qayta urugaga yo'l qo'ymaymiz.
    const existing = await prisma.product.findFirst({
      where: { sellerId, titleRu: p.titleRu },
    });
    if (existing) {
      console.log(`• Skip (exists): ${p.titleRu}`);
      continue;
    }

    const created = await prisma.product.create({
      data: {
        sellerId,
        categoryId: p.categoryId,
        titleRu: p.titleRu,
        titleUz: p.titleUz,
        basePriceUsd: p.basePriceUsd,
        coverUrl: p.coverUrl,
        gallery: [],
        attributes: { sceneId: p.sceneId } as object,
        filters: {},
        bodyFit: p.bodyFit,
        status: ProductStatus.published,
        popularityScore: 10 - i,
        publishedAt: new Date(),
        variants: {
          create: p.variants.map((v, j) => ({
            color: v.color,
            colorHex: v.colorHex,
            size: v.size,
            priceUsd: p.basePriceUsd,
            stock: v.stock,
            sku: `DEMO-${i + 1}-${j + 1}-${v.color.toUpperCase().slice(0, 3)}`,
            images: [p.coverUrl],
          })),
        },
      },
    });
    console.log(`✅ Mahsulot: ${p.titleRu} (${created.id})`);
  }
}

async function main() {
  console.log('🌱 Demo akkountlar yaratilmoqda...\n');

  const admin = await upsertUser(DEMO_ADMIN, UserRole.admin);
  console.log(`✅ Admin: ${admin.phone} / ${admin.username}`);

  const sellerUser = await upsertUser(DEMO_SELLER, UserRole.seller);
  console.log(`✅ Seller user: ${sellerUser.phone} / ${sellerUser.username}`);

  const seller = await prisma.seller.upsert({
    where: { userId: sellerUser.id },
    update: {
      brandName: DEMO_SELLER.brandName,
      description: DEMO_SELLER.description,
      verified: true,
      isTop: true,
    },
    create: {
      userId: sellerUser.id,
      brandName: DEMO_SELLER.brandName,
      description: DEMO_SELLER.description,
      verified: true,
      isTop: true,
      rating: 4.8,
      reviewsCount: 24,
      country: 'Uzbekistan',
      city: 'Toshkent',
      district: 'Chilonzor',
    },
  });
  console.log(`✅ Shop: ${seller.brandName}`);

  // Buyer akkountiga ham seller role beramiz — Apple reviewer bitta
  // akkountdan ham xaridor ham sotuvchi tabini ko'ra oladi (role-
  // switcher). Shop profili ham yarattamiz.
  const buyer = await upsertUser(DEMO_BUYER, UserRole.seller);
  console.log(`✅ Buyer (seller access): ${buyer.phone} / ${buyer.username}`);

  await prisma.seller.upsert({
    where: { userId: buyer.id },
    update: {
      brandName: 'Demo Shop (Buyer)',
      description: 'Demo xaridor akkountining do\'koni',
      verified: true,
    },
    create: {
      userId: buyer.id,
      brandName: 'Demo Shop (Buyer)',
      description: 'Demo xaridor akkountining do\'koni',
      verified: true,
      rating: 5,
      reviewsCount: 10,
      country: 'Uzbekistan',
      city: 'Toshkent',
      district: 'Yunusobod',
    },
  });
  console.log(`✅ Buyer uchun shop ham yaratildi\n`);

  console.log('🛒 Demo mahsulotlar yaratilmoqda...\n');
  await createDemoProducts(seller.id);

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📱 APP STORE REVIEW UCHUN:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`\n👤 XARIDOR (buyer):`);
  console.log(`   Phone:    ${DEMO_BUYER.phone}`);
  console.log(`   Username: ${DEMO_BUYER.username}`);
  console.log(`   Password: ${DEMO_BUYER.password}`);
  console.log(`\n🏪 SOTUVCHI (seller):`);
  console.log(`   Phone:    ${DEMO_SELLER.phone}`);
  console.log(`   Username: ${DEMO_SELLER.username}`);
  console.log(`   Password: ${DEMO_SELLER.password}`);
  console.log(`\n🛠  ADMIN:`);
  console.log(`   Phone:    ${DEMO_ADMIN.phone}`);
  console.log(`   Username: ${DEMO_ADMIN.username}`);
  console.log(`   Password: ${DEMO_ADMIN.password}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
