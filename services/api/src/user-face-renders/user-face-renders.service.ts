import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma, ProductStatus, UserFaceRenderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { MlCompositorClient } from '../tryon/ml-compositor.client';

type BodyType = 'slim' | 'medium' | 'full';

/**
 * Owns the "pre-render the buyer's face onto every variant's mannequin"
 * pipeline. Runs once per user shortly after onboarding, then again any
 * time a brand-new published variant appears.
 *
 * Mirrors the StyleJobsService model: callers submit via `enqueueAll`,
 * the worker drains the queue by calling `claimNext` + `processJob`, and
 * the catalog reads `UserFaceRender` rows directly to decorate variant
 * responses with the buyer's `userRenderedUrl`.
 */
@Injectable()
export class UserFaceRendersService {
  private readonly logger = new Logger(UserFaceRendersService.name);

  /** In-process cache of per-user face stamps (soft-oval RGBA PNG). Cleared
   * on service restart; rebuilt lazily from an existing render whenever a
   * subsequent variant job comes in. One slow facefusion per user then
   * drives every later variant through the cheap overlay path. */
  private readonly faceStampCache = new Map<string, Buffer>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly compositor: MlCompositorClient,
  ) {}

  // ─── Public API ──────────────────────────────────────────────────

  /**
   * Persist a freshly captured selfie and body params for `userId`, then
   * enqueue a face-render job for every published-variant the buyer could
   * ever land on. The call returns immediately after queueing — the worker
   * loop drains the jobs in the background.
   */
  async prepare(
    userId: string,
    selfie: Express.Multer.File,
    bodyType: BodyType,
    heightCm: number | null,
    opts: { sellerId?: string | null } = {},
  ) {
    if (!selfie) throw new BadRequestException('FACE_IMAGE_REQUIRED');

    // Store the selfie under the user's prefix. Overwrites any previous one
    // so "Yuzni yangilash" (re-run from inside the Primerka tab) replaces
    // the source every worker tick will read from.
    const saved = await this.storage.save(
      `tryon/selfies/${userId}`,
      selfie.buffer,
      selfie.mimetype || 'image/jpeg',
      'selfie.jpg',
    );

    // Snapshot body + height so the worker — which does not have the mobile
    // store — picks the correct body-matched mannequin.
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        selfieKey: saved.key,
        tryonBodyType: bodyType,
        tryonHeightCm: heightCm,
      },
    });

    // On a re-prepare drop every previous render + queued job so the fresh
    // selfie fully supersedes the old look.
    await this.prisma.$transaction([
      this.prisma.userFaceRender.deleteMany({ where: { userId } }),
      this.prisma.userFaceRenderJob.deleteMany({ where: { userId } }),
    ]);

    // Wipe the previous stamp (both cache and disk).
    this.faceStampCache.delete(userId);
    void this.deleteStoredStamp(userId).catch((err) =>
      this.logger.warn(
        `could not clear old face stamp for ${userId}: ${(err as Error).message}`,
      ),
    );

    // Phase 2 (TZ §4) — face preservation: build the stamp from the user's
    // ACTUAL selfie right now, not from a later facefusion result. This
    // guarantees the face identity (eyes, nose, lips, skin tone, jawline)
    // is the user's own on every variant from the very first render,
    // instead of being a facefusion-warped version of it. The slow
    // facefusion only runs when the selfie-derived stamp cannot be built
    // (e.g. no face detected on the selfie).
    try {
      const stamp = await this.compositor.composeFaceStamp(selfie.buffer);
      this.faceStampCache.set(userId, stamp);
      await this.storage.save(
        `tryon/stamps/${userId}`,
        stamp,
        'image/png',
        'stamp.png',
      );
      this.logger.log(
        `face stamp pre-built from selfie for user ${userId} (${stamp.length} B)`,
      );
    } catch (err) {
      // Not fatal — the worker will fall back to facefusion on the first
      // variant and build the stamp from that result (legacy path).
      this.logger.warn(
        `selfie-direct stamp build failed for ${userId}: ${(err as Error).message}; worker will fall back to facefusion`,
      );
    }

    const queued = await this.enqueueAll(userId, { sellerId: opts.sellerId ?? null });

    this.logger.log(`prepare ${userId}: ${queued} job(s) enqueued`);
    return { enqueued: queued };
  }

  /**
   * Enqueue a pending face-render for every variant the buyer could try on.
   * When `sellerId` is set we scope to that seller's catalog (the onboarding
   * "pick a store" step); otherwise we queue across the whole published
   * catalog. Idempotent — a variant already covered by a done render or an
   * open job is skipped.
   */
  async enqueueAll(
    userId: string,
    opts: { sellerId?: string | null } = {},
  ): Promise<number> {
    const variants = await this.prisma.productVariant.findMany({
      where: {
        product: {
          status: ProductStatus.published,
          ...(opts.sellerId ? { sellerId: opts.sellerId } : {}),
        },
      },
      select: { id: true },
    });
    if (!variants.length) return 0;

    // Rows that already have a render → skip.
    const done = new Set(
      (
        await this.prisma.userFaceRender.findMany({
          where: { userId, variantId: { in: variants.map((v) => v.id) } },
          select: { variantId: true },
        })
      ).map((r) => r.variantId),
    );
    // Rows with an open job (pending/running/failed) → skip, the worker
    // will pick them up.
    const open = new Set(
      (
        await this.prisma.userFaceRenderJob.findMany({
          where: { userId, variantId: { in: variants.map((v) => v.id) } },
          select: { variantId: true },
        })
      ).map((r) => r.variantId),
    );

    const toQueue = variants
      .map((v) => v.id)
      .filter((id) => !done.has(id) && !open.has(id));
    if (!toQueue.length) return 0;

    await this.prisma.userFaceRenderJob.createMany({
      data: toQueue.map((variantId) => ({ userId, variantId })),
      skipDuplicates: true,
    });
    return toQueue.length;
  }

  /**
   * Nuke every existing render + open job for a user so a fresh selfie
   * (new "Yuzni yangilash" run) can re-generate the whole catalogue
   * from scratch. Called at the end of the face re-take flow — without
   * this the service happily keeps old mannequins from the previous
   * face.
   */
  async resetForUser(userId: string): Promise<{ cleared: number; requeued: number }> {
    const [renders, jobs] = await Promise.all([
      this.prisma.userFaceRender.deleteMany({ where: { userId } }),
      this.prisma.userFaceRenderJob.deleteMany({ where: { userId } }),
    ]);
    // Memory cache alone isn't enough — getOrBuildFaceStamp re-hydrates
    // from the disk key `tryon/stamps/<userId>/stamp.png`, which keeps
    // the OLD face identity alive forever. Delete the disk stamp too so
    // the next prepare() call rebuilds it from a fresh selfie.
    this.faceStampCache.delete(userId);
    await this.deleteStoredStamp(userId).catch((err) =>
      this.logger.warn(
        `reset: could not clear disk stamp for ${userId}: ${(err as Error).message}`,
      ),
    );
    const queued = await this.enqueueAll(userId);
    this.logger.log(
      `reset for user ${userId}: cleared ${renders.count} renders, ${jobs.count} jobs; requeued ${queued}`,
    );
    return { cleared: renders.count + jobs.count, requeued: queued };
  }

  /**
   * Belt-and-suspenders: when the buyer adds a product to their Primerka
   * collection, make sure every one of its variants has either a done
   * render or an open job. Covers the edge case where the buyer onboarded
   * before this product was published and the seller's fanout missed
   * them. Idempotent — zero work when everything is already queued.
   */
  async enqueueForProduct(userId: string, productId: string): Promise<number> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { selfieKey: true },
    });
    // No selfie means the user hasn't finished onboarding; the Primerka
    // tab will trigger that flow on open, so there is nothing to queue.
    if (!user?.selfieKey) return 0;

    const variants = await this.prisma.productVariant.findMany({
      where: { productId, product: { status: ProductStatus.published } },
      select: { id: true },
    });
    if (!variants.length) return 0;

    const variantIds = variants.map((v) => v.id);
    const [done, open] = await Promise.all([
      this.prisma.userFaceRender.findMany({
        where: { userId, variantId: { in: variantIds } },
        select: { variantId: true },
      }),
      this.prisma.userFaceRenderJob.findMany({
        where: { userId, variantId: { in: variantIds } },
        select: { variantId: true },
      }),
    ]);
    const covered = new Set([
      ...done.map((r) => r.variantId),
      ...open.map((r) => r.variantId),
    ]);
    const toQueue = variantIds.filter((id) => !covered.has(id));
    if (!toQueue.length) return 0;

    await this.prisma.userFaceRenderJob.createMany({
      data: toQueue.map((variantId) => ({ userId, variantId })),
      skipDuplicates: true,
    });
    this.logger.log(
      `on-demand enqueue for product ${productId}, user ${userId}: ${toQueue.length} job(s)`,
    );
    return toQueue.length;
  }

  /**
   * Fan-out helper for the catalog side: when a seller approves a style job
   * and the product goes from draft to published, every onboarded buyer
   * needs a face-swapped render for its variants. Enqueues one job per
   * (user-with-selfie × variant) pair; duplicates are skipped.
   *
   * At scale this scan should move to a background cron scoped to buyers
   * who opted into the seller's store; left in-line for now because the
   * current catalog is small.
   */
  async fanoutForProduct(productId: string): Promise<number> {
    const variants = await this.prisma.productVariant.findMany({
      where: { productId },
      select: { id: true },
    });
    if (!variants.length) return 0;
    const users = await this.prisma.user.findMany({
      where: { selfieKey: { not: null } },
      select: { id: true },
    });
    if (!users.length) return 0;

    const rows: { userId: string; variantId: string }[] = [];
    for (const u of users) {
      for (const v of variants) {
        rows.push({ userId: u.id, variantId: v.id });
      }
    }
    const { count } = await this.prisma.userFaceRenderJob.createMany({
      data: rows,
      skipDuplicates: true,
    });
    this.logger.log(
      `fanout for product ${productId}: queued ${count} job(s) across ${users.length} user(s)`,
    );
    return count;
  }

  /** Catalog-side read: map of variantId → url for a user. */
  async rendersForUser(userId: string): Promise<Map<string, string>> {
    const rows = await this.prisma.userFaceRender.findMany({
      where: { userId },
      select: { variantId: true, url: true },
    });
    return new Map(rows.map((r) => [r.variantId, r.url]));
  }

  /** Mobile `/tryon/my-renders` payload — includes pending counts so the
   *  UI can show a "still cooking" hint. */
  async statusForUser(userId: string) {
    const [done, pending, running, failed, user] = await Promise.all([
      this.prisma.userFaceRender.findMany({
        where: { userId },
        select: { variantId: true, url: true },
      }),
      this.prisma.userFaceRenderJob.count({
        where: { userId, status: 'pending' },
      }),
      this.prisma.userFaceRenderJob.count({
        where: { userId, status: 'running' },
      }),
      this.prisma.userFaceRenderJob.count({
        where: { userId, status: 'failed' },
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { selfieKey: true, tryonBodyType: true, tryonHeightCm: true },
      }),
    ]);
    return {
      hasSelfie: !!user?.selfieKey,
      bodyType: user?.tryonBodyType ?? null,
      heightCm: user?.tryonHeightCm ?? null,
      renders: done.map((r) => ({ variantId: r.variantId, url: r.url })),
      pending,
      running,
      failed,
    };
  }

  // ─── Worker API ─────────────────────────────────────────────────

  /** Atomically claim one pending job. Returns null when the queue is
   *  empty. Mirrors StyleJobsService.claimNext. */
  async claimNext(): Promise<Prisma.UserFaceRenderJobGetPayload<{}> | null> {
    return this.prisma.$transaction(async (tx) => {
      const next = await tx.userFaceRenderJob.findFirst({
        where: { status: 'pending' },
        orderBy: { createdAt: 'asc' },
      });
      if (!next) return null;
      return tx.userFaceRenderJob.update({
        where: { id: next.id },
        data: {
          status: 'running',
          startedAt: new Date(),
          attempts: { increment: 1 },
        },
      });
    });
  }

  /**
   * Actually run the facefusion swap for one claimed job: fetch the user's
   * selfie + the body-matched mannequin, run the swap, upload the result,
   * write a `UserFaceRender` row, flip the job to done.
   */
  async processJob(jobId: string): Promise<void> {
    const job = await this.prisma.userFaceRenderJob.findUnique({
      where: { id: jobId },
      include: {
        user: {
          select: { selfieKey: true, tryonBodyType: true, tryonHeightCm: true },
        },
        variant: {
          include: {
            product: {
              select: {
                id: true,
                styledImageUrl: true,
                coverUrl: true,
              },
            },
          },
        },
      },
    });
    if (!job) return;

    try {
      if (!job.user?.selfieKey) {
        throw new Error('NO_SELFIE_ON_USER');
      }

      const bodyType = (job.user.tryonBodyType as BodyType) ?? 'medium';
      const heightCm = job.user.tryonHeightCm ?? null;
      const mannequinUrl =
        (await this.pickBodyMatchedMannequin(
          job.variant.product.id,
          bodyType,
          heightCm,
        )) ??
        job.variant.product.styledImageUrl ??
        job.variant.product.coverUrl;
      if (!mannequinUrl) throw new Error('STYLED_IMAGE_MISSING');

      const res = await fetch(mannequinUrl);
      if (!res.ok) throw new Error(`mannequin fetch HTTP ${res.status}`);
      const mannequinBytes = Buffer.from(await res.arrayBuffer());
      const mannequinMime = res.headers.get('content-type') ?? 'image/jpeg';
      const mannequinFile = {
        buffer: mannequinBytes,
        mimetype: mannequinMime,
        filename: 'mannequin.jpg',
      };

      // Try the cheap path first: if we already have a face stamp for this
      // user (either in process memory or re-derivable from any existing
      // render), overlay it in ~2 s instead of spending 2 min on a fresh
      // facefusion swap. The slow path only runs once per user, ever.
      const stamp = await this.getOrBuildFaceStamp(job.userId, job.user.selfieKey);
      let jpeg: Buffer | null = null;
      // The compositor keeps the mannequin's alpha channel (PNG in,
      // PNG out) so we store the overlay with the right extension and
      // the mobile hero can show its boutique backdrop through it.
      let outContentType = 'image/jpeg';
      let outExt = 'jpg';
      if (stamp) {
        try {
          const overlay = await this.compositor.composeFaceOverlay(mannequinFile, stamp);
          jpeg = overlay.buffer;
          outContentType = overlay.contentType || 'image/jpeg';
          outExt = outContentType === 'image/png' ? 'png' : 'jpg';
          this.logger.log(
            `overlay path for ${job.variantId} (${jpeg.length} B, ${outContentType})`,
          );
        } catch (overlayErr) {
          // Mannequin had no detectable face (or overlay crashed) — fall
          // through to a full facefusion run so this one variant still
          // gets a proper render.
          const detail = (overlayErr as { message?: string })?.message ?? '';
          this.logger.warn(`overlay fell back to facefusion: ${detail}`);
        }
      }

      if (!jpeg) {
        const selfieBytes = await this.storage.read(job.user.selfieKey);
        const fusion = await this.compositor.composeFacefusion(mannequinFile, {
          buffer: selfieBytes,
          mimetype: 'image/jpeg',
          originalname: 'selfie.jpg',
        } as unknown as Express.Multer.File);
        jpeg = fusion.buffer;
        outContentType = fusion.contentType || 'image/jpeg';
        outExt = outContentType === 'image/png' ? 'png' : 'jpg';
        this.logger.log(
          `facefusion path for ${job.variantId} (${jpeg.length} B, ${outContentType})`,
        );

        // First successful swap for this user → cache its face as a stamp
        // AND persist it to storage so every later variant (even across
        // process restarts) takes the cheap overlay path.
        if (!this.faceStampCache.has(job.userId)) {
          try {
            const freshStamp = await this.compositor.composeFaceStamp(jpeg);
            this.faceStampCache.set(job.userId, freshStamp);
            try {
              await this.storage.save(
                `tryon/stamps/${job.userId}`,
                freshStamp,
                'image/png',
                'stamp.png',
              );
            } catch (saveErr) {
              this.logger.warn(
                `persist face stamp failed for ${job.userId}: ${(saveErr as Error).message}`,
              );
            }
            this.logger.log(
              `face stamp cached (facefusion-derived) for user ${job.userId} (${freshStamp.length} B)`,
            );
          } catch (stampErr) {
            const detail = (stampErr as { message?: string })?.message ?? '';
            this.logger.warn(`face stamp build failed: ${detail}`);
          }
        }
      }

      const saved = await this.storage.save(
        `tryon/renders/${job.userId}`,
        jpeg,
        outContentType,
        `${job.variantId}.${outExt}`,
      );

      await this.prisma.$transaction([
        this.prisma.userFaceRender.upsert({
          where: {
            userId_variantId: { userId: job.userId, variantId: job.variantId },
          },
          create: {
            userId: job.userId,
            variantId: job.variantId,
            url: saved.url,
          },
          update: { url: saved.url },
        }),
        this.prisma.userFaceRenderJob.update({
          where: { id: job.id },
          data: {
            status: UserFaceRenderStatus.done,
            finishedAt: new Date(),
            errorMessage: null,
          },
        }),
      ]);

      this.logger.log(
        `rendered ${job.variantId} for user ${job.userId} (${(jpeg.length / 1024).toFixed(1)} KB)`,
      );
    } catch (err) {
      const message = (err as Error).message ?? 'unknown';
      this.logger.warn(
        `user-face-render job ${job.id} failed: ${message}`,
      );
      await this.prisma.userFaceRenderJob.update({
        where: { id: job.id },
        data: {
          status: UserFaceRenderStatus.failed,
          finishedAt: new Date(),
          errorMessage: message,
        },
      });
    }
  }

  // ─── Internals ──────────────────────────────────────────────────

  /**
   * Return the buyer's face stamp if one has already been built from a
   * previous facefusion result. Two tiers:
   *   1. In-process memory cache.
   *   2. Persistent storage at `tryon/stamps/<userId>/stamp.png`.
   * Returns null on first-time users — caller falls through to a fresh
   * facefusion swap, whose output is then cropped into the stamp and
   * written to both tiers for every later variant.
   */
  private async getOrBuildFaceStamp(
    userId: string,
    _selfieKey: string,
  ): Promise<Buffer | null> {
    const cached = this.faceStampCache.get(userId);
    if (cached) return cached;

    const stampKey = `tryon/stamps/${userId}/stamp.png`;
    try {
      const stored = await this.storage.read(stampKey);
      this.faceStampCache.set(userId, stored);
      this.logger.log(
        `face stamp loaded from storage for user ${userId} (${stored.length} B)`,
      );
      return stored;
    } catch {
      return null;
    }
  }

  /**
   * Drop the user's persistent stamp PNG so a re-prepare triggers a
   * fresh facefusion-derived build. Storage drivers raise when the key
   * does not exist — we treat that as "nothing to drop" and move on.
   */
  private async deleteStoredStamp(userId: string): Promise<void> {
    const stampKey = `tryon/stamps/${userId}/stamp.png`;
    const anyStorage = this.storage as unknown as {
      delete?: (key: string) => Promise<void>;
      remove?: (key: string) => Promise<void>;
    };
    if (typeof anyStorage.delete === 'function') await anyStorage.delete(stampKey);
    else if (typeof anyStorage.remove === 'function') await anyStorage.remove(stampKey);
  }

  private heightBand(cm: number | null): 'short' | 'mid' | 'tall' {
    if (!cm || cm <= 160) return 'short';
    if (cm <= 170) return 'mid';
    return 'tall';
  }

  private async pickBodyMatchedMannequin(
    productId: string,
    bodyType: BodyType,
    heightCm: number | null,
  ): Promise<string | null> {
    const job = await this.prisma.productStyleJob.findFirst({
      where: {
        productId,
        status: 'done',
        resultVariants: { not: Prisma.JsonNull },
      },
      orderBy: { finishedAt: 'desc' },
      select: { resultVariants: true },
    });
    const variants = job?.resultVariants as
      | Record<string, string>
      | null
      | undefined;
    if (!variants) return null;
    const band = this.heightBand(heightCm);
    return (
      variants[`${bodyType}-${band}`] ??
      variants[`${bodyType}-mid`] ??
      variants['medium-mid'] ??
      Object.values(variants)[0] ??
      null
    );
  }
}
