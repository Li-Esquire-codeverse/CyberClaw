import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('ClawConfig (e2e)', () => {
  let app: INestApplication<App>;
  let tempDir: string;

  beforeAll(async () => {
    // 指向临时配置目录，避免测试写入仓库根目录的 CyberClaw.json
    tempDir = mkdtempSync(join(tmpdir(), 'cyberclaw-e2e-'));
    process.env.CYBERCLAW_CONFIG_FILE = join(tempDir, 'CyberClaw.json');

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.CYBERCLAW_CONFIG_FILE;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('rejects empty object config save (would wipe config)', () => {
    return request(app.getHttpServer())
      .post('/api/claw/config')
      .send({})
      .expect(400);
  });

  it('rejects config missing keys', () => {
    return request(app.getHttpServer())
      .post('/api/claw/config')
      .send({ agents: [] })
      .expect(400);
  });

  it('accepts a well-formed config and persists it', async () => {
    const config = {
      agents: [],
      models: [],
      tools: [],
    };
    const res = await request(app.getHttpServer())
      .post('/api/claw/config')
      .send(config)
      .expect(201);
    expect(res.body).toEqual({ ok: true });

    const got = await request(app.getHttpServer())
      .get('/api/claw/config')
      .expect(200);
    expect(got.body).toMatchObject({ agents: [], models: [] });
  });
});
