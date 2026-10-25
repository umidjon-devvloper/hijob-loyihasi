import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

interface UpsertBannerInput {
  templateId?: string | null;
  customImageUrl?: string | null;
  title?: string | null;
  subtitle?: string | null;
  productId?: string | null;
  ctaLabelUz?: string | null;
  ctaLabelRu?: string | null;
  isActive?: boolean;
}

@Injectable()
export class BannersService {
  private readonly logger = new Logger(BannersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subs: SubscriptionsService,
  ) {}

  /**
   * TZ Phase 7 — banner creation and activation are a paid-subscription
   * feature. Admins bypass this so they can seed demo rows. Sellers get
   * a 403 PAYMENT_REQUIRED-like refusal until their subscription is
   * active, with the error code the mobile client surfaces as "Obuna
   * yoqilishi kerak".
   */
  private async requireActiveSubscription(sellerId: string) {
    const active = await this.subs.isSellerActive(sellerId);
    if (!active) {
      throw new ForbiddenException('SUBSCRIPTION_REQUIRED');
    }
  }

  // ─── Templates (public read, admin write) ──────────────────────

  listTemplates() {
    return this.prisma.bannerTemplate.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createTemplate(data: {
    bgUrl: string;
    previewUrl?: string | null;
    nameUz?: string | null;
    nameRu?: string | null;
    textStyle?: 'light' | 'dark';
  }) {
    return this.prisma.bannerTemplate.create({
      data: {
        bgUrl: data.bgUrl,
        previewUrl: data.previewUrl ?? data.bgUrl,
        nameUz: data.nameUz,
        nameRu: data.nameRu,
        textStyle: data.textStyle ?? 'light',
      },
    });
  }

  async deleteTemplate(id: string) {
    const t = await this.prisma.bannerTemplate.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('TEMPLATE_NOT_FOUND');
    return this.prisma.bannerTemplate.update({
      where: { id },
      data: { isActive: false },
    });
  }

  // ─── Seller banners ───────────────────────────────────────────

  async requireSeller(userId: string) {
    const seller = await this.prisma.seller.findUnique({ where: { userId } });
    if (!seller) throw new ForbiddenException('SELLER_PROFILE_MISSING');
    return seller;
  }

  async listMine(userId: string) {
    const seller = await this.requireSeller(userId);
    return this.prisma.sellerBanner.findMany({
      where: { sellerId: seller.id },
      orderBy: { createdAt: 'desc' },
      include: { template: true },
    });
  }

  async createMine(userId: string, dto: UpsertBannerInput) {
    const seller = await this.requireSeller(userId);
    await this.requireActiveSubscription(seller.id);
    if (!dto.templateId && !dto.customImageUrl) {
      throw new BadRequestException('TEMPLATE_OR_IMAGE_REQUIRED');
    }
    return this.prisma.sellerBanner.create({
      data: {
        sellerId: seller.id,
        templateId: dto.templateId ?? null,
        customImageUrl: dto.customImageUrl ?? null,
        title: dto.title ?? null,
        subtitle: dto.subtitle ?? null,
        productId: dto.productId ?? null,
        ctaLabelUz: dto.ctaLabelUz ?? null,
        ctaLabelRu: dto.ctaLabelRu ?? null,
        // Fresh banners start inactive; seller flips the switch after
        // reviewing the preview. Admin still has to approve before it
        // reaches the home carousel.
        isActive: dto.isActive ?? false,
      },
    });
  }

  async updateMine(userId: string, id: string, dto: UpsertBannerInput) {
    const seller = await this.requireSeller(userId);
    const row = await this.prisma.sellerBanner.findUnique({ where: { id } });
    if (!row || row.sellerId !== seller.id) throw new NotFoundException('BANNER_NOT_FOUND');
    // Turning a banner ON requires an active subscription; turning it OFF
    // is always allowed so a seller whose plan expires can still hide
    // their banner without being blocked.
    if (dto.isActive === true) {
      await this.requireActiveSubscription(seller.id);
    }
    return this.prisma.sellerBanner.update({
      where: { id },
      data: {
        ...(dto.templateId !== undefined && { templateId: dto.templateId }),
        ...(dto.customImageUrl !== undefined && { customImageUrl: dto.customImageUrl }),
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.subtitle !== undefined && { subtitle: dto.subtitle }),
        ...(dto.productId !== undefined && { productId: dto.productId }),
        ...(dto.ctaLabelUz !== undefined && { ctaLabelUz: dto.ctaLabelUz }),
        ...(dto.ctaLabelRu !== undefined && { ctaLabelRu: dto.ctaLabelRu }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  async deleteMine(userId: string, id: string) {
    const seller = await this.requireSeller(userId);
    const row = await this.prisma.sellerBanner.findUnique({ where: { id } });
    if (!row || row.sellerId !== seller.id) throw new NotFoundException('BANNER_NOT_FOUND');
    await this.prisma.sellerBanner.delete({ where: { id } });
    return { deleted: true };
  }

  // ─── Admin moderation ─────────────────────────────────────────

  async adminListPending() {
    return this.prisma.sellerBanner.findMany({
      where: { isActive: true, isApproved: false },
      orderBy: { createdAt: 'desc' },
      include: {
        seller: { select: { id: true, brandName: true } },
        template: true,
      },
    });
  }

  async adminApprove(id: string, approve: boolean) {
    const row = await this.prisma.sellerBanner.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('BANNER_NOT_FOUND');
    return this.prisma.sellerBanner.update({
      where: { id },
      data: { isApproved: approve },
    });
  }

  // ─── Public (buyer home) ──────────────────────────────────────

  async listActivePublic() {
    const now = new Date();
    const rows = await this.prisma.sellerBanner.findMany({
      where: {
        isActive: true,
        isApproved: true,
        // Only sellers whose paid subscription is active right now.
        seller: {
          subscriptions: {
            some: {
              status: 'active',
              endAt: { gt: now },
            },
          },
        },
        OR: [
          { startAt: null, endAt: null },
          { startAt: { lte: now }, endAt: null },
          { startAt: null, endAt: { gte: now } },
          { startAt: { lte: now }, endAt: { gte: now } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: {
        template: { select: { bgUrl: true, textStyle: true } },
        seller: { select: { id: true, brandName: true, logoUrl: true } },
      },
    });
    return rows.map((b) => ({
      id: b.id,
      sellerId: b.sellerId,
      sellerBrand: b.seller.brandName,
      sellerLogo: b.seller.logoUrl,
      imageUrl: b.customImageUrl ?? b.template?.bgUrl ?? null,
      textStyle: b.template?.textStyle ?? 'light',
      title: b.title,
      subtitle: b.subtitle,
      productId: b.productId,
      ctaLabelUz: b.ctaLabelUz,
      ctaLabelRu: b.ctaLabelRu,
    }));
  }
}
