import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { BannersService } from './banners.service';
import { BannersController } from './banners.controller';

@Module({
  imports: [PrismaModule, SubscriptionsModule],
  providers: [BannersService],
  controllers: [BannersController],
})
export class BannersModule {}
