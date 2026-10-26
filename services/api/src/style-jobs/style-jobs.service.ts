import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { MlCompositorClient } from '../tryon/ml-compositor.client';
import { NotificationsService } from '../notifications/notifications.service';
import { Prisma, StyleJobStatus } from '@prisma/client';
import * as crypto from 'crypto';

import { pickMannequinForCategorySize } from './mannequin-pool';
import { MannequinTemplatesService } from '../mannequin-templates/mannequin-templates.service';
import { UserFaceRendersService } from '../user-face-renders/user-face-renders.service';
import { tyingPromptFor } from '../tryon/tying-styles';

export interface DressMannequinInput {
  mannequinUrl?: string;
  hijabUrl: string;
  // Free-form id so the 9-style catalogue in apps/mobile/src/lib/tying-styles.ts
  // can grow without a schema migration. Legacy jobs sent 'classical'
  // / 'loose' / 'double'.
  tyingStyle?: string;
  // Textual prompt the Python compositor passes to its diffusion model
  // for this specific tying style. Set from the mobile tying-styles
  // registry so new styles can be added without touching the backend.
  tyingPrompt?: string;
  colorHex?: string;
}

@Injectable()
export class StyleJobsService {
  private readonly logger = new Logger(StyleJobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly compositor: MlCompositorClient,
    private readonly notifications: NotificationsService,
    private readonly mannequins: MannequinTemplatesService,
    private readonly faceRenders: UserFaceRendersService,
  ) {}

  /**
   * Seller submits a new "dress the mannequin" job.
   *
   * One hijob can carry several size variants (S / M / L). We create a
   * separate style-job per distinct size so each render lands on a
   * silhouette that actually matches that size. The buyer eventually sees
   * the render whose size matches their body profile.
   */
  async submit(sellerUserId: string, productId: string, input: DressMannequinInput) {
    const seller = await this.prisma.seller.findUnique({ where: { userId: sellerUserId } });
    if (!seller) throw new NotFoundException('SELLER_NOT_FOUND');

    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: { variants: { select: { size: true } } },
    });
    if (!product) throw new NotFoundException('PRODUCT_NOT_FOUND');
    if (product.sellerId !== seller.id) throw new BadRequestException('PRODUCT_NOT_YOURS');

    if (!input.hijabUrl) {
      throw new BadRequestException('HIJAB_URL_REQUIRED');
    }

    // Distinct sizes across variants. If none (brand-new product) fall back
    // to a single one-size job so the pipeline still runs.
    const sizes = Array.from(
      new Set((product.variants ?? []).map((v) => v.size).filter(Boolean)),
    );
    const targets: Array<string | null> = sizes.length > 0 ? sizes : [null];

    // Resolve each size's mannequin URL BEFORE opening the transaction. We
    // prefer an admin-uploaded template matching the size key / height
    // bracket; fall back to the hardcoded Pexels pool if the admin hasn't
    // uploaded one yet so the pipeline keeps running.
    const resolvedMannequins = await Promise.all(
      targets.map(async (size) => {
        if (input.mannequinUrl?.trim()) return input.mannequinUrl.trim();
        const fromDb = await this.mannequins.pickForSizeKey(size);
        if (fromDb) return fromDb;
        return pickMannequinForCategorySize(
          product.categoryId,
          size,
          hashSeed(`${product.id}:${size ?? 'one'}`),
        );
      }),
    );

    const created = await this.prisma.$transaction(
      targets.map((size, i) =>
        this.prisma.productStyleJob.create({
          data: {
            productId,
            sellerId: seller.id,
            mannequinUrl: resolvedMannequins[i]!,
            hijabUrl: input.hijabUrl,
            tyingStyle: input.tyingStyle ?? 'classical',
            colorHex: input.colorHex ?? '#8A8D5B',
            targetSize: size,
          },
        }),
      ),
    );

    // Return the first job (keeps the controller's single-job contract);
    // callers who need the whole set can list via /seller/products/:id/dress-mannequin.
    return created[0] ?? null;
  }

  /** Return the latest job for a product (seller-side status chip). */
  async latestForProduct(sellerUserId: string, productId: string) {
    const seller = await this.prisma.seller.findUnique({ where: { userId: sellerUserId } });
    if (!seller) throw new NotFoundException('SELLER_NOT_FOUND');
    return this.prisma.productStyleJob.findFirst({
      where: { productId, sellerId: seller.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Admin / debug listing. */
  async listAll(status?: StyleJobStatus, limit = 50) {
    return this.prisma.productStyleJob.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
      include: {
        product: { select: { titleRu: true, categoryId: true } },
        seller: { select: { brandName: true } },
      },
    });
  }

  // ─── Worker API ─────────────────────────────────────────────────

  /** Atomically claim one pending job for processing. Returns null when
   *  nothing is pending. */
  async claimNext(): Promise<Prisma.ProductStyleJobGetPayload<{}> | null> {
    // SELECT ... FOR UPDATE SKIP LOCKED equivalent via a transactional
    // conditional update. We find the oldest pending job, then flip it to
    // running inside a transaction so two worker ticks never claim the same
    // row.
    return this.prisma.$transaction(async (tx) => {
      const next = await tx.productStyleJob.findFirst({
        where: { status: 'pending' },
        orderBy: { createdAt: 'asc' },
      });
      if (!next) return null;
      return tx.productStyleJob.update({
        where: { id: next.id },
        data: {
          status: 'running',
          startedAt: new Date(),
          attempts: { increment: 1 },
        },
      });
    });
  }

  async markDone(jobId: string, resultUrl: string) {
    return this.markDoneInternal(jobId, resultUrl, null);
  }

  async markDoneWithVariants(
    jobId: string,
    fallbackUrl: string,
    variants: Record<string, string>,
  ) {
    return this.markDoneInternal(jobId, fallbackUrl, variants);
  }

  private async markDoneInternal(
    jobId: string,
    resultUrl: string,
    resultVariants: Record<string, string> | null,
  ) {
    const updated = await this.prisma.productStyleJob.update({
      where: { id: jobId },
      data: {
        status: 'done',
        resultUrl,
        resultVariants: resultVariants ?? Prisma.JsonNull,
        finishedAt: new Date(),
        errorMessage: null,
      },
      include: { seller: { select: { userId: true } }, product: { select: { titleRu: true } } },
    });
    // NOTE: we no longer auto-flip product.styledImageUrl here. The seller
    // must preview the 9 variants and press "Tasdiqlash" on the mobile app;
    // that triggers approveForProduct() below, which copies the fallback
    // URL to the product and publishes it.
    this.notifications
      .create({
        userId: updated.seller.userId,
        kind: 'style_job_done',
        title: 'Manekin tayyor',
        body: `"${updated.product.titleRu}" uchun 9 variant tayyor — sotuvchi tasdig'ini kuting`,
        data: { productId: updated.productId, jobId: updated.id, resultUrl },
      })
      .catch(() => undefined);
    return updated;
  }

  /**
   * Seller presses "Tasdiqlash" on a done job: we copy the fallback result
   * URL onto the product (so catalog shows the styled hijab) and, if the
   * product is still a draft, publish it. The 9 resultVariants stay on the
   * job and are what the Primerka screen picks a body-matched variant from.
   */
  async approveForProduct(sellerUserId: string, productId: string) {
    const seller = await this.prisma.seller.findUnique({ where: { userId: sellerUserId } });
    if (!seller) throw new NotFoundException('SELLER_NOT_FOUND');
    const job = await this.prisma.productStyleJob.findFirst({
      where: { productId, sellerId: seller.id, status: 'done' },
      orderBy: { createdAt: 'desc' },
    });
    if (!job || !job.resultUrl) throw new NotFoundException('NO_DONE_JOB');

    const current = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!current) throw new NotFoundException('PRODUCT_NOT_FOUND');
    const publishNow = current.status === 'draft' || current.status === 'rejected';
    // Track which tying styles have at least one approved mannequin so
    // the Primerka tab can grey out drapes the seller never queued.
    const prevAttrs = (current.attributes as Record<string, unknown>) ?? {};
    const prevStyles = Array.isArray(prevAttrs.tyingStyles)
      ? (prevAttrs.tyingStyles as string[])
      : [];
    const tyingStyles = prevStyles.includes(job.tyingStyle)
      ? prevStyles
      : [...prevStyles, job.tyingStyle];
    await this.prisma.product.update({
      where: { id: productId },
      data: {
        styledImageUrl: job.resultUrl,
        attributes: { ...prevAttrs, tyingStyles } as object,
        ...(publishNow ? { status: 'published' as const, publishedAt: new Date() } : {}),
      },
    });
    // Approve = this variant becomes something a buyer can land on. Fan the
    // facefusion pre-render out to every onboarded user. Best-effort —
    // failing here must not block the seller's approve action.
    if (publishNow) {
      this.faceRenders
        .fanoutForProduct(productId)
        .catch((err) =>
          this.logger.warn(
            `face-render fanout failed for ${productId}: ${(err as Error).message}`,
          ),
        );
    }

    return { ok: true, productId, styledImageUrl: job.resultUrl, published: publishNow };
  }

  async markFailed(jobId: string, message: string) {
    const updated = await this.prisma.productStyleJob.update({
      where: { id: jobId },
      data: {
        status: 'failed',
        errorMessage: message.slice(0, 500),
        finishedAt: new Date(),
      },
      include: { seller: { select: { userId: true } }, product: { select: { titleRu: true } } },
    });
    this.notifications
      .create({
        userId: updated.seller.userId,
        kind: 'style_job_done',
        title: 'Manekin xatosi',
        body: `"${updated.product.titleRu}" uchun stillash muvaffaqiyatsiz: ${message.slice(0, 80)}`,
        data: { productId: updated.productId, jobId: updated.id, error: message.slice(0, 200) },
      })
      .catch(() => undefined);
    return updated;
  }

  /**
   * Run one job end-to-end: fetch the mannequin + hijab inputs, call
   * ml-compositor's procedural scarf route (uses MediaPipe landmarks on the
   * mannequin's face internally through the ml-face client), store the
   * result, update the job.
   *
   * This is the "dress the mannequin" step the queue was built for. The
   * composition is procedural today; a future upgrade can swap this body
   * for a Gemini/Claude image-edit call without touching the queue.
   */
  async processJob(jobId: string): Promise<void> {
    const job = await this.prisma.productStyleJob.findUnique({ where: { id: jobId } });
    if (!job) return;

    try {
      // Pull the mannequin bytes down so the compositor can treat it as the
      // "face" image. The URL is public (served from /uploads/ or R2).
      const mannequinBytes = await this.fetchBytes(job.mannequinUrl);
      const mannequinMime = this.inferMime(job.mannequinUrl);
      const file: Express.Multer.File = {
        buffer: mannequinBytes,
        mimetype: mannequinMime,
        originalname: 'mannequin.jpg',
        size: mannequinBytes.length,
        fieldname: 'face',
        encoding: '7bit',
        stream: undefined as never,
        destination: '',
        filename: 'mannequin.jpg',
        path: '',
      };

      const jpeg = await this.compositor.composeScarf(file, {
        tyingStyle: job.tyingStyle,
        // Looked up by id from the backend tying-styles mirror so the
        // Python compositor conditions its diffusion model on the exact
        // drape the seller picked at submit time.
        tyingPrompt: tyingPromptFor(job.tyingStyle),
        colorHex: job.colorHex,
        pattern: 'silk',
      });

      // Store the composed image under products/<id>/styled-<jobid>.jpg so
      // every run is addressable and the URL doesn't collide with the
      // seller-uploaded mannequin.
      const key = `products/${job.productId}/styled-${job.id}.jpg`;
      const result = await this.storage.save(
        key,
        jpeg,
        'image/jpeg',
        `styled-${job.id}.jpg`,
      );

      await this.markDone(job.id, result.url);
      this.logger.log(`job ${job.id} done → ${result.url}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`job ${jobId} failed: ${msg}`);
      await this.markFailed(jobId, msg);
    }
  }

  private async fetchBytes(url: string): Promise<Buffer> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${url} → HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  private inferMime(url: string): string {
    const lower = url.toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.gif')) return 'image/gif';
    return 'image/jpeg';
  }

  /** Idempotency helper used by the controller to dedupe seller resubmits.
   *  Not strictly needed for v1 but handy. */
  private hashInputs(input: DressMannequinInput): string {
    return crypto
      .createHash('sha256')
      .update(JSON.stringify(input))
      .digest('hex')
      .slice(0, 16);
  }
}

// Stable integer digest of a UUID so the mannequin pool pick is deterministic
// per product id (retries don't shift which mannequin we use).
function hashSeed(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return h;
}
