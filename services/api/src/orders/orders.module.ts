import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { ChatsModule } from '../chats/chats.module';

@Module({
  imports: [NotificationsModule, ChatsModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
