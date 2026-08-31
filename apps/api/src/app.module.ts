import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ClawModule } from './claw/claw.module';
import { ChatModule } from './chat/chat.module';
import { ChannelsModule } from './channels/channels.module';
import { ScheduleModule } from './schedule/schedule.module';
import { RoutingModule } from './routing/routing.module';
import { OpenAiModule } from './openai/openai.module';

@Module({
  imports: [ClawModule, ChatModule, ChannelsModule, ScheduleModule, RoutingModule, OpenAiModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
