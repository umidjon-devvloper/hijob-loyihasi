import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt.guard';
import {
  CurrentUser,
  CurrentUserInfo,
} from '../auth/current-user.decorator';
import { UserFaceRendersService } from './user-face-renders.service';

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

@ApiTags('tryon')
@Controller('tryon')
export class UserFaceRendersController {
  constructor(private readonly svc: UserFaceRendersService) {}

  /**
   * Called once at the end of the onboarding flow. Takes the buyer's
   * selfie + body picker snapshot, persists it, and queues a facefusion
   * swap for every variant they could land on. Returns the number of
   * queued jobs so the mobile UI can show "AI kiydiryapti…" progress.
   */
  @Post('prepare')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('face', { limits: { fileSize: MAX_IMAGE_BYTES } }),
  )
  prepare(
    @CurrentUser() user: CurrentUserInfo,
    @Body()
    dto: {
      bodyType?: string;
      heightCm?: string | number;
      sellerId?: string | null;
    },
    @UploadedFile() face: Express.Multer.File,
  ) {
    if (!face) throw new BadRequestException('FACE_IMAGE_REQUIRED');
    const bodyType =
      dto.bodyType === 'slim' || dto.bodyType === 'full'
        ? dto.bodyType
        : 'medium';
    const heightCm =
      typeof dto.heightCm === 'string'
        ? Number(dto.heightCm) || null
        : typeof dto.heightCm === 'number'
          ? dto.heightCm
          : null;
    return this.svc.prepare(user.id, face, bodyType, heightCm, {
      sellerId: dto.sellerId ?? null,
    });
  }

  /**
   * Primerka tab polls this when it opens so it knows which variants are
   * already rendered and how many are still cooking. The `renders` map is
   * also merged client-side onto the catalog payload — no per-product
   * network roundtrip per selection.
   */
  @Get('my-renders')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  myRenders(@CurrentUser() user: CurrentUserInfo) {
    return this.svc.statusForUser(user.id);
  }

  /**
   * Belt-and-suspenders: mobile calls this when the buyer adds a product
   * to their Primerka collection. If the product's variants are already
   * covered by a done render or an open job this is a no-op; otherwise
   * the missing variants are queued so the Primerka tab shows the
   * face-swapped mannequin within a few seconds of the buyer opening it.
   */
  /**
   * Called after a buyer re-takes their selfie ("Yuzni yangilash").
   * Deletes every existing render + open job for the user and queues
   * the whole catalogue again with the new selfie — otherwise the old
   * mannequins would stay cached forever.
   */
  @Post('reset')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  reset(@CurrentUser() user: CurrentUserInfo) {
    return this.svc.resetForUser(user.id);
  }

  @Post('enqueue-product/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  enqueueProduct(
    @CurrentUser() user: CurrentUserInfo,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.svc.enqueueForProduct(user.id, id).then((queued) => ({ queued }));
  }
}
