import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ClawModule } from './claw/claw.module';
import { ChatModule } from './chat/chat.module';

@Module({
  imports: [ClawModule, ChatModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
