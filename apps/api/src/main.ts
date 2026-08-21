// 必须在任何业务模块 import 之前加载 .env（副作用 import，置于最顶部）
import './config/env';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 与前端契约一致：所有接口挂在 /api 前缀下
  app.setGlobalPrefix('api');

  // 开发期允许跨域（webui 由 antd-pro dev server 提供）
  app.enableCors();

  // 统一 DTO 校验：剔除未声明字段
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  await app.listen(3000);
}
bootstrap();
