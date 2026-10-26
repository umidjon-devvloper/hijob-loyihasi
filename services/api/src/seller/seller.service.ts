import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto';
import { CategoryId, ProductStatus } from '@prisma/client';
import { StorageService } from '../storage/storage.service';
import { GarmentCategory, MlGarmentClient } from './ml-garment.client';

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

@Injectable()
export class SellerService {
  private readonly logger = new Logger(SellerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly mlGarment: MlGarmentClient,
  ) {}

  /**
   * After a product is created we walk every variant, ask ml-garment to build a
   * template from its first image, and persist the mask + landmarks. Fail-open:
   * a broken template must never block the seller from creating the product.
   */
  private async buildGarmentTemplatesForProduct(
    productId: string,
    category: GarmentCategory,
  ) {
    if (!this.mlGarment.isEnabled()) return;

    const variants = await this.prisma.productVariant.findMany({
      where: { productId, garmentTemplate: null },
    });

    for (const variant of variants) {
      const imageUrl = variant.images[0];
      if (!imageUrl) continue;

      try {
        const buffer = await this.fetchImage(imageUrl);
        const template = await this.mlGarment.extract(
          { buffer, mimetype: 'image/jpeg', originalname: 'variant.jpg' },
          category,
        );

        // Persist the two PNGs so the compositor can read them straight from the CDN.
        const canonical = await this.storage.save(
          `garment/${variant.id}`,
          Buffer.from(template.canonical_png_base64, 'base64'),
          'image/png',
          'canonical.png',
        );
        const mask = await this.storage.save(
          `garment/${variant.id}`,
          Buffer.from(template.mask_png_base64, 'base64'),
          'image/png',
          'mask.png',
        );

        await this.prisma.garmentTemplate.create({
          data: {
            variantId: variant.id,
            canonicalImageKey: canonical.key,
            alphaMaskKey: mask.key,
            landmarks: template.landmarks as object,
            standardPose: template.standard_pose as object,
            colorPalette: template.color_palette as unknown as object,
          },
        });
        this.logger.log(`built garment template for variant ${variant.id}`);
      } catch (err) {
        this.logger.warn(
          `garment template failed for variant ${variant.id}: ${(err as Error).message}`,
        );
      }
    }
  }

  private async fetchImage(url: string): Promise<Buffer> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async uploadImages(userId: string, files: Express.Multer.File[]) {
    const seller = await this.requireSeller(userId);
    if (!files || files.length === 0) throw new BadRequestException('NO_FILES');

    const results = await Promise.all(
      files.map(async (f) => {
        if (!ALLOWED_MIME.has(f.mimetype)) {
          throw new BadRequestException(`UNSUPPORTED_MIME:${f.mimetype}`);
        }
        if (f.size > MAX_IMAGE_BYTES) {
          throw new BadRequestException(`TOO_LARGE:${f.originalname}`);
        }
        const saved = await this.storage.save(
          `seller/${seller.id}`,
          f.buffer,
          f.mimetype,
          f.originalname,
        );
        return { name: f.originalname, ...saved };
      }),
    );

    return { files: results };
  }

  private async requireSeller(userId: string) {
    const seller = await this.prisma.seller.findUnique({ where: { userId } });
    if (!seller) throw new ForbiddenException('SELLER_PROFILE_MISSING');
    return seller;
  }

  async getAnalytics(userId: string) {
    const seller = await this.requireSeller(userId);

    const [products, variantAgg, tryOnCount, orderStats] = await Promise.all([
      this.prisma.product.count({ where: { sellerId: seller.id } }),
      this.prisma.productVariant.aggregate({
        where: { product: { sellerId: seller.id } },
        _sum: { stock: true },
        _count: true,
      }),
      this.prisma.tryOnSession.count({
        where: { variant: { product: { sellerId: seller.id } } },
      }),
      this.prisma.orderItem.aggregate({
        where: { variant: { product: { sellerId: seller.id } } },
        _sum: { quantity: true, priceSnapshot: true },
        _count: true,
      }),
    ]);

    // 7-day daily try-on trend so the dashboard can draw a mini-chart.
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const dailyRows = await this.prisma.$queryRaw<Array<{ day: Date; count: bigint }>>`
      SELECT date_trunc('day', ts.created_at) AS day, COUNT(*)::bigint AS count
      FROM tryon_sessions ts
      JOIN product_variants pv ON pv.id = ts.variant_id
      JOIN products p ON p.id = pv.product_id
      WHERE p.seller_id = ${seller.id}::uuid AND ts.created_at >= ${sevenDaysAgo}
      GROUP BY 1
      ORDER BY 1 ASC
    `;

    // Fill missing days so the chart is always 7 buckets long.
    const trend: Array<{ day: string; count: number }> = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 3600 * 1000);
      const key = d.toISOString().slice(0, 10);
      const row = dailyRows.find((r) => r.day.toISOString().slice(0, 10) === key);
      trend.push({ day: key, count: row ? Number(row.count) : 0 });
    }

    // Top 5 most-tried variants (helps the seller understand what's trending).
    const topRows = await this.prisma.$queryRaw<
      Array<{ variant_id: string; title: string; color: string; count: bigint }>
    >`
      SELECT ts.variant_id::text, p.title_ru AS title, pv.color, COUNT(*)::bigint AS count
      FROM tryon_sessions ts
      JOIN product_variants pv ON pv.id = ts.variant_id
      JOIN products p ON p.id = pv.product_id
      WHERE p.seller_id = ${seller.id}::uuid
      GROUP BY ts.variant_id, p.title_ru, pv.color
      ORDER BY count DESC
      LIMIT 5
    `;

    return {
      totals: {
        products,
        variants: variantAgg._count,
        stock: variantAgg._sum.stock ?? 0,
        tryOnSessions: tryOnCount,
        orderItems: orderStats._count,
        orderUnits: Number(orderStats._sum.quantity ?? 0),
        grossUsd: Number(orderStats._sum.priceSnapshot ?? 0),
      },
      tryOnTrend7d: trend,
      topVariants: topRows.map((r) => ({
        variantId: r.variant_id,
        title: r.title,
        color: r.color,
        count: Number(r.count),
      })),
    };
  }

  // Compact dashboard stats. activeOrders counts orders that still need the
  // seller's attention (confirmed/preparing/shipping); delivered/cancelled are
  // excluded so the counter represents real work-in-flight.
  async getStats(userId: string) {
    const seller = await this.requireSeller(userId);
    const [productCount, orderAgg, activeOrdersCount, tryOnCount] = await Promise.all([
      this.prisma.product.count({ where: { sellerId: seller.id } }),
      this.prisma.orderItem.aggregate({
        where: { variant: { product: { sellerId: seller.id } } },
        _sum: { quantity: true, priceSnapshot: true },
      }),
      this.prisma.order.count({
        where: {
          orderStatus: { in: ['pending', 'confirmed', 'processing', 'shipped', 'proba_scheduled'] as any },
          items: { some: { variant: { product: { sellerId: seller.id } } } },
        },
      }),
      this.prisma.tryOnSession.count({
        where: { variant: { product: { sellerId: seller.id } } },
      }),
    ]);
    return {
      totalProducts: productCount,
      activeOrders: activeOrdersCount,
      revenue: Number(orderAgg._sum.priceSnapshot ?? 0),
      tryOnCount,
    };
  }

  // Orders list filtered by the seller: an order is "the seller's" if any of
  // its line items references one of their variants. Items from other sellers
  // are excluded from the response so each seller only sees their own line.
  async listOrders(userId: string) {
    const seller = await this.requireSeller(userId);
    const orders = await this.prisma.order.findMany({
      where: {
        items: { some: { variant: { product: { sellerId: seller.id } } } },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        items: {
          where: { variant: { product: { sellerId: seller.id } } },
          include: {
            variant: { include: { product: { select: { titleRu: true, coverUrl: true } } } },
          },
        },
        user: { select: { id: true, fullName: true, username: true, phone: true } },
        address: true,
      },
      take: 100,
    });

    // One-shot lookup of each buyer's chat with this seller — the panel
    // uses the id to deep-link straight into the thread the checkout
    // flow auto-created.
    const buyerIds = Array.from(new Set(orders.map((o) => o.user.id)));
    const chats = buyerIds.length
      ? await this.prisma.chat.findMany({
          where: { sellerId: seller.id, buyerUserId: { in: buyerIds } },
          select: { id: true, buyerUserId: true },
        })
      : [];
    const chatByBuyer = new Map(chats.map((c) => [c.buyerUserId, c.id]));

    return orders.map((o) => {
      const snap = (o.addressSnapshot ?? null) as Record<string, any> | null;
      const addr = o.address;
      const lat =
        (addr?.latitude != null ? Number(addr.latitude) : null) ??
        (snap?.latitude != null ? Number(snap.latitude) : null);
      const lng =
        (addr?.longitude != null ? Number(addr.longitude) : null) ??
        (snap?.longitude != null ? Number(snap.longitude) : null);
      const addressLine = [
        addr?.city ?? snap?.city,
        addr?.district ?? snap?.district,
        addr?.street ?? snap?.street,
        addr?.building ?? snap?.building,
        addr?.apartment ?? snap?.apartment,
      ]
        .filter(Boolean)
        .join(', ');
      return {
        id: o.id,
        code: o.id.slice(0, 8).toUpperCase(),
        customerName: o.user.fullName || `@${o.user.username}`,
        customerPhone: o.user.phone,
        time: o.createdAt.toISOString(),
        status: this.mapOrderStatus(o.orderStatus),
        total: o.items.reduce((sum, it) => sum + Number(it.priceSnapshot) * it.quantity, 0),
        tracking: null as string | null,
        deliveryType: o.deliveryType,
        address: addressLine || null,
        location: lat != null && lng != null ? { latitude: lat, longitude: lng } : null,
        mapsUrl: lat != null && lng != null ? `https://maps.google.com/?q=${lat},${lng}` : null,
        chatId: chatByBuyer.get(o.user.id) ?? null,
        items: o.items.map((it) => ({
          name: it.titleSnapshot ?? it.variant.product.titleRu,
          color: it.colorSnapshot ?? it.variant.color,
          size: it.sizeSnapshot ?? it.variant.size,
          qty: it.quantity,
          imageUrl: it.imageSnapshot ?? it.variant.product.coverUrl,
        })),
      };
    });
  }

  // Collapses the backend's richer order lifecycle into the four buckets the
  // mobile seller tab shows: new, preparing, shipping, delivered. Unmatched
  // values fall back to 'new' so a lifecycle change never breaks the UI.
  private mapOrderStatus(status: string): 'new' | 'preparing' | 'shipping' | 'delivered' {
    switch (status) {
      case 'confirmed':
      case 'processing':
        return 'preparing';
      case 'shipped':
      case 'proba_scheduled':
        return 'shipping';
      case 'delivered':
        return 'delivered';
      default:
        return 'new';
    }
  }

  // Seller accepts / rejects / advances an order. We only let the seller
  // touch orders that contain at least one of their own line items, and
  // we only allow transitions that make sense for the seller side of the
  // flow (buyers handle payment/cancel elsewhere).
  async setOrderStatus(
    userId: string,
    orderId: string,
    action: 'accept' | 'reject' | 'ship' | 'deliver',
  ) {
    const seller = await this.requireSeller(userId);
    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        items: { some: { variant: { product: { sellerId: seller.id } } } },
      },
      select: { id: true, orderStatus: true },
    });
    if (!order) throw new NotFoundException('ORDER_NOT_FOUND');
    const nextStatus = {
      accept: 'confirmed',
      reject: 'cancelled',
      ship: 'shipped',
      deliver: 'delivered',
    }[action];
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { orderStatus: nextStatus as any },
      select: { id: true, orderStatus: true },
    });
    return {
      id: updated.id,
      orderStatus: updated.orderStatus,
      status: this.mapOrderStatus(updated.orderStatus),
    };
  }

  async listProducts(userId: string) {
    const seller = await this.requireSeller(userId);
    const rows = await this.prisma.product.findMany({
      where: { sellerId: seller.id },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { variants: true } },
        variants: { select: { stock: true } },
      },
    });

    return rows.map((p) => ({
      id: p.id,
      titleRu: p.titleRu,
      titleUz: p.titleUz,
      categoryId: p.categoryId,
      basePriceUsd: Number(p.basePriceUsd),
      // Prefer the mannequin-styled image so the seller sees the exact
      // card the buyer sees (mannequin wearing the item). Falls back to
      // the raw upload while the dress-mannequin job is still pending.
      coverUrl: p.styledImageUrl ?? p.coverUrl,
      rawCoverUrl: p.coverUrl,
      status: p.status,
      createdAt: p.createdAt.toISOString(),
      publishedAt: p.publishedAt?.toISOString() ?? null,
      popularityScore: p.popularityScore,
      variantCount: p._count.variants,
      totalStock: p.variants.reduce((sum, v) => sum + v.stock, 0),
      sceneId: ((p.attributes as Record<string, unknown>) ?? {})['sceneId'] ?? null,
    }));
  }

  async createProduct(userId: string, dto: CreateProductDto) {
    const seller = await this.requireSeller(userId);

    // Guard against duplicate SKUs across all products.
    const skus = dto.variants.map((v) => v.sku);
    if (new Set(skus).size !== skus.length) {
      throw new BadRequestException('DUPLICATE_SKU_IN_REQUEST');
    }
    const existingSku = await this.prisma.productVariant.findFirst({
      where: { sku: { in: skus } },
      select: { sku: true },
    });
    if (existingSku) throw new ConflictException(`SKU_ALREADY_EXISTS:${existingSku.sku}`);

    const created = await this.prisma.product.create({
      data: {
        sellerId: seller.id,
        categoryId: dto.categoryId as CategoryId,
        titleRu: dto.titleRu,
        titleUz: dto.titleUz ?? null,
        descriptionRu: dto.descriptionRu ?? null,
        basePriceUsd: dto.basePriceUsd,
        coverUrl: dto.coverUrl,
        gallery: [],
        attributes: (dto.attributes ?? {}) as object,
        filters: this.buildFiltersFromVariants(dto.variants),
        bodyFit: dto.bodyFit ?? null,
        status: ProductStatus.draft,
        popularityScore: 0,
        variants: {
          create: dto.variants.map((v) => ({
            color: v.color,
            colorHex: v.colorHex,
            size: v.size,
            priceUsd: v.priceUsd ?? dto.basePriceUsd,
            stock: v.stock,
            sku: v.sku,
            images: v.images ?? [],
          })),
        },
      },
    });

    // Run garment-template extraction in the background — don't block the response.
    void this.buildGarmentTemplatesForProduct(created.id, dto.categoryId).catch((e) =>
      this.logger.error(`garment templates failed: ${e.message}`),
    );

    return { id: created.id };
  }

  async getProfile(userId: string) {
    const seller = await this.requireSeller(userId);
    return {
      id: seller.id,
      brandName: seller.brandName,
      logoUrl: seller.logoUrl,
      description: seller.description,
      country: seller.country,
      city: seller.city,
      district: seller.district,
      addressLine: seller.addressLine,
      latitude: seller.latitude ? Number(seller.latitude) : null,
      longitude: seller.longitude ? Number(seller.longitude) : null,
      verified: seller.verified,
      isTop: seller.isTop,
      isPremium: seller.isPremium,
      rating: Number(seller.rating),
      reviewsCount: seller.reviewsCount,
    };
  }

  async updateProfile(
    userId: string,
    dto: {
      brandName?: string;
      description?: string;
      logoUrl?: string;
      country?: string;
      city?: string;
      district?: string;
      addressLine?: string;
      latitude?: number;
      longitude?: number;
    },
  ) {
    const seller = await this.requireSeller(userId);
    const updated = await this.prisma.seller.update({
      where: { id: seller.id },
      data: {
        ...(dto.brandName !== undefined && { brandName: dto.brandName }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.logoUrl !== undefined && { logoUrl: dto.logoUrl }),
        ...(dto.country !== undefined && { country: dto.country }),
        ...(dto.city !== undefined && { city: dto.city }),
        ...(dto.district !== undefined && { district: dto.district }),
        ...(dto.addressLine !== undefined && { addressLine: dto.addressLine }),
        ...(dto.latitude !== undefined && { latitude: dto.latitude }),
        ...(dto.longitude !== undefined && { longitude: dto.longitude }),
      },
    });
    return {
      id: updated.id,
      brandName: updated.brandName,
      logoUrl: updated.logoUrl,
      description: updated.description,
      country: updated.country,
      city: updated.city,
      district: updated.district,
      addressLine: updated.addressLine,
      latitude: updated.latitude ? Number(updated.latitude) : null,
      longitude: updated.longitude ? Number(updated.longitude) : null,
      verified: updated.verified,
      isTop: updated.isTop,
      isPremium: updated.isPremium,
    };
  }

  async updateProduct(
    userId: string,
    productId: string,
    dto: {
      titleUz?: string;
      titleRu?: string;
      basePriceUsd?: number;
      descriptionUz?: string;
      descriptionRu?: string;
      sceneId?: string | null;
    },
  ) {
    const seller = await this.requireSeller(userId);
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('PRODUCT_NOT_FOUND');
    if (product.sellerId !== seller.id) throw new ForbiddenException('NOT_YOUR_PRODUCT');

    // sceneId lives inside the free-form attributes JSON — one of the three
    // podium backdrops the seller picked in add-product. Null clears it.
    let nextAttributes: Record<string, unknown> | undefined;
    if (dto.sceneId !== undefined) {
      const prev = (product.attributes as Record<string, unknown>) ?? {};
      nextAttributes = { ...prev, sceneId: dto.sceneId };
    }

    const updated = await this.prisma.product.update({
      where: { id: productId },
      data: {
        ...(dto.titleUz !== undefined && { titleUz: dto.titleUz }),
        ...(dto.titleRu !== undefined && { titleRu: dto.titleRu }),
        ...(dto.basePriceUsd !== undefined && { basePriceUsd: dto.basePriceUsd }),
        ...(dto.descriptionUz !== undefined && { descriptionUz: dto.descriptionUz }),
        ...(dto.descriptionRu !== undefined && { descriptionRu: dto.descriptionRu }),
        ...(nextAttributes !== undefined && { attributes: nextAttributes as object }),
      },
    });
    return { id: updated.id, status: updated.status };
  }

  async deleteProduct(userId: string, productId: string) {
    const seller = await this.requireSeller(userId);
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('PRODUCT_NOT_FOUND');
    if (product.sellerId !== seller.id) throw new ForbiddenException('NOT_YOUR_PRODUCT');

    // Soft delete: flip to archived so order history, saved items and
    // style jobs don't break with FK violations.
    await this.prisma.product.update({
      where: { id: productId },
      data: { status: ProductStatus.archived },
    });
    return { ok: true };
  }

  async submit(userId: string, productId: string) {
    const seller = await this.requireSeller(userId);
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('PRODUCT_NOT_FOUND');
    if (product.sellerId !== seller.id) throw new ForbiddenException('NOT_YOUR_PRODUCT');
    if (product.status !== ProductStatus.draft && product.status !== ProductStatus.rejected) {
      throw new BadRequestException('ONLY_DRAFT_CAN_BE_SUBMITTED');
    }

    // MVP: auto-publish (moderator flow comes later).
    const updated = await this.prisma.product.update({
      where: { id: productId },
      data: {
        status: ProductStatus.published,
        publishedAt: new Date(),
      },
    });

    return { id: updated.id, status: updated.status };
  }

  private buildFiltersFromVariants(variants: CreateProductDto['variants']) {
    const colors = Array.from(new Set(variants.map((v) => v.color)));
    const sizes = Array.from(new Set(variants.map((v) => v.size)));
    return { color: colors, size: sizes };
  }
}
