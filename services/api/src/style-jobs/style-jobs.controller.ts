import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import sharp from 'sharp';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser, CurrentUserInfo } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { StorageService } from '../storage/storage.service';
import { StyleJobsService, DressMannequinInput } from './style-jobs.service';
import { StyleJobStatus } from '@prisma/client';

@ApiTags('style-jobs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class StyleJobsController {
  constructor(
    private readonly jobs: StyleJobsService,
    private readonly storage: StorageService,
  ) {}

  // Seller submits a "dress the mannequin" job for one of their products.
  @Post('seller/products/:id/dress-mannequin')
  submit(
    @CurrentUser() user: CurrentUserInfo,
    @Param('id') productId: string,
    @Body() body: DressMannequinInput,
  ) {
    return this.jobs.submit(user.id, productId, body);
  }

  // Seller polls for the latest status chip.
  @Get('seller/products/:id/dress-mannequin')
  latest(
    @CurrentUser() user: CurrentUserInfo,
    @Param('id') productId: string,
  ) {
    return this.jobs.latestForProduct(user.id, productId);
  }

  // Seller confirms the 9-variant render → the fallback URL goes to
  // product.styledImageUrl (catalog cover) and, if still draft, the
  // product is published globally. The 9 variants stay on the job for
  // the Primerka screen to pick a body-matched render.
  @Post('seller/products/:id/approve-styled')
  approve(
    @CurrentUser() user: CurrentUserInfo,
    @Param('id', new ParseUUIDPipe()) productId: string,
  ) {
    return this.jobs.approveForProduct(user.id, productId);
  }

  // Admin / moderator sees everything in the queue.
  @Get('admin/style-jobs')
  @Roles('admin', 'moderator')
  listAll(
    @Query('status') status?: StyleJobStatus,
    @Query('limit') limit?: string,
  ) {
    return this.jobs.listAll(status, limit ? Number(limit) : 50);
  }

  // Developer / human-in-the-loop AI panel: operator fetches the oldest
  // pending job, generates a GPT image externally (or edits in Photoshop),
  // then posts the finished render back via /ai-complete.
  @Patch('admin/style-jobs/:id/ai-complete')
  @Roles('admin', 'moderator')
  aiComplete(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: { resultUrl: string },
  ) {
    return this.jobs.markDone(id, body.resultUrl);
  }

  // Mark the job failed with an operator note. Lets the dev panel flag jobs
  // that GPT refused (nudity filter, bad input, etc.) so the seller sees a
  // real error instead of the job sitting in 'pending' forever.
  @Patch('admin/style-jobs/:id/ai-fail')
  @Roles('admin', 'moderator')
  aiFail(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: { message: string },
  ) {
    return this.jobs.markFailed(id, body.message ?? 'operator rejected');
  }

  // Chrome extension flow: operator (or auto worker) fetched the finished
  // image from ChatGPT and sends the actual bytes. We persist to our own
  // storage so the catalog image URL doesn't depend on OpenAI's temporary
  // CDN, then flip the job to done.
  @Post('admin/style-jobs/:id/upload-result')
  @Roles('admin', 'moderator')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 16 * 1024 * 1024 } }))
  async uploadResult(
    @Param('id', new ParseUUIDPipe()) id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('FILE_REQUIRED');
    const stored = await this.storage.save(
      `style-results/${id}`,
      file.buffer,
      file.mimetype || 'image/jpeg',
      file.originalname || `${id}.jpg`,
    );
    return this.jobs.markDone(id, stored.url);
  }

  // Extension flow for 3×3 grid: the content script sliced the generated
  // composite into 9 body-type×height cells. Each cell arrives as a field
  // named after its sizeKey (slim-short, slim-mid, …, full-tall). We store
  // all 9 URLs into `resultVariants` and use medium-mid as the fallback
  // `resultUrl` so legacy single-image displays still render something.
  @Post('admin/style-jobs/:id/upload-variants')
  @Roles('admin', 'moderator')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'slim-short', maxCount: 1 },
        { name: 'slim-mid', maxCount: 1 },
        { name: 'slim-tall', maxCount: 1 },
        { name: 'medium-short', maxCount: 1 },
        { name: 'medium-mid', maxCount: 1 },
        { name: 'medium-tall', maxCount: 1 },
        { name: 'full-short', maxCount: 1 },
        { name: 'full-mid', maxCount: 1 },
        { name: 'full-tall', maxCount: 1 },
      ],
      { limits: { fileSize: 16 * 1024 * 1024 } },
    ),
  )
  async uploadVariants(
    @Param('id', new ParseUUIDPipe()) id: string,
    @UploadedFiles() files: Record<string, Express.Multer.File[] | undefined>,
  ) {
    const variants: Record<string, string> = {};
    for (const sizeKey of Object.keys(files)) {
      const file = files[sizeKey]?.[0];
      if (!file) continue;
      // Browser already renders a crisp 1500×2000 PNG at a uniform scale.
      // The only remaining softness comes from the mobile detail page
      // rendering at ~1200 CSS px × 3× DPR = ~3600 real px, which still
      // oversamples the image. A SINGLE lanczos3 upscale to a stable
      // 2000-wide target plus a strong unsharp mask gives perceptibly
      // crisper edges on hems, zips, logos and hijab wraps without
      // introducing ringing.
      let processed: Buffer;
      try {
        processed = await sharp(file.buffer, { failOn: 'none' })
          .resize({ width: 2000, kernel: sharp.kernel.lanczos3, withoutEnlargement: true })
          .sharpen({ sigma: 1.2, m1: 0.8, m2: 3.0 })
          .png({ compressionLevel: 7, adaptiveFiltering: true })
          .toBuffer();
      } catch {
        processed = file.buffer;
      }
      const stored = await this.storage.save(
        `style-results/${id}/${sizeKey}`,
        processed,
        'image/png',
        `${sizeKey}.png`,
      );
      variants[sizeKey] = stored.url;
    }
    if (Object.keys(variants).length === 0) throw new BadRequestException('NO_FILES');
    const fallback = variants['medium-mid'] ?? Object.values(variants)[0]!;
    return this.jobs.markDoneWithVariants(id, fallback, variants);
  }
}
