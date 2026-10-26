import { Module } from '@nestjs/common';
import { SellerController } from './seller.controller';
import { SellerService } from './seller.service';
import { MlGarmentClient } from './ml-garment.client';
import { StyleJobsModule } from '../style-jobs/style-jobs.module';

@Module({
  // Pulled in so createProduct can kick off a mannequin-dress job in
  // the background (StyleJobsService.submit) right after a new product
  // lands in the DB. StyleJobsModule has no reverse dependency on
  // SellerModule, so no forwardRef needed.
  imports: [StyleJobsModule],
  controllers: [SellerController],
  providers: [SellerService, MlGarmentClient],
})
export class SellerModule {}
