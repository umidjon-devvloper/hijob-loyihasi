import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser, CurrentUserInfo } from '../auth/current-user.decorator';
import { SellerService } from './seller.service';
import { CreateProductDto, UpdateSellerProfileDto } from './dto';

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_FILES = 8;

@ApiTags('seller')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('seller', 'admin')
@Controller('seller')
export class SellerController {
  constructor(private readonly seller: SellerService) {}

  @Get('products')
  list(@CurrentUser() user: CurrentUserInfo) {
    return this.seller.listProducts(user.id);
  }

  @Get('profile')
  getProfile(@CurrentUser() user: CurrentUserInfo) {
    return this.seller.getProfile(user.id);
  }

  @Patch('profile')
  updateProfile(
    @CurrentUser() user: CurrentUserInfo,
    @Body() dto: UpdateSellerProfileDto,
  ) {
    return this.seller.updateProfile(user.id, dto);
  }

  @Get('analytics')
  analytics(@CurrentUser() user: CurrentUserInfo) {
    return this.seller.getAnalytics(user.id);
  }

  // Compact stats shape consumed by the mobile seller dashboard. Different
  // from /analytics so the mobile card row stays stable even if analytics
  // grows new fields.
  @Get('stats')
  stats(@CurrentUser() user: CurrentUserInfo) {
    return this.seller.getStats(user.id);
  }

  @Get('orders')
  orders(@CurrentUser() user: CurrentUserInfo) {
    return this.seller.listOrders(user.id);
  }

  @Patch('orders/:id/status')
  setOrderStatus(
    @CurrentUser() user: CurrentUserInfo,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: { action: 'accept' | 'reject' | 'ship' | 'deliver' },
  ) {
    const allowed = ['accept', 'reject', 'ship', 'deliver'];
    if (!allowed.includes(body?.action)) {
      throw new BadRequestException('INVALID_ACTION');
    }
    return this.seller.setOrderStatus(user.id, id, body.action);
  }

  @Post('products')
  create(@CurrentUser() user: CurrentUserInfo, @Body() dto: CreateProductDto) {
    return this.seller.createProduct(user.id, dto);
  }

  @Patch('products/:id')
  updateProduct(
    @CurrentUser() user: CurrentUserInfo,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body()
    body: {
      titleUz?: string;
      titleRu?: string;
      basePriceUsd?: number;
      descriptionUz?: string;
      descriptionRu?: string;
      sceneId?: string | null;
    },
  ) {
    return this.seller.updateProduct(user.id, id, body);
  }

  @Delete('products/:id')
  deleteProduct(
    @CurrentUser() user: CurrentUserInfo,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.seller.deleteProduct(user.id, id);
  }

  @Post('products/:id/submit')
  submit(
    @CurrentUser() user: CurrentUserInfo,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.seller.submit(user.id, id);
  }

  @Post('uploads')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FilesInterceptor('files', MAX_FILES, { limits: { fileSize: MAX_IMAGE_BYTES } }),
  )
  upload(
    @CurrentUser() user: CurrentUserInfo,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    if (!files || files.length === 0) throw new BadRequestException('NO_FILES');
    return this.seller.uploadImages(user.id, files);
  }
}
