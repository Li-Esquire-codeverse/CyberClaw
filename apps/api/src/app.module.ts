import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ClawModule } from './claw/claw.module';

@Module({
  imports: [ClawModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
