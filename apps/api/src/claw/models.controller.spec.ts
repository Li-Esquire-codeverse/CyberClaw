import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ModelsController } from './models.controller';
import { ClawConfigService } from './claw-config.service';
import { ClawModel } from './claw.types';

describe('ModelsController', () => {
  let controller: ModelsController;
  const service = {
    listModels: jest.fn(),
    getModel: jest.fn(),
    createModel: jest.fn(),
    updateModel: jest.fn(),
    deleteModel: jest.fn(),
  };

  const sampleModel: ClawModel = {
    id: 'mdl_abc123',
    provider: 'deepseek',
    name: '生产 DeepSeek',
    model: 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: 'sk-test',
    enabled: true,
    isDefault: true,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [ModelsController],
      providers: [{ provide: ClawConfigService, useValue: service }],
    }).compile();

    controller = moduleRef.get(ModelsController);
  });

  it('lists models', () => {
    service.listModels.mockReturnValue([sampleModel]);
    expect(controller.list()).toEqual([sampleModel]);
  });

  it('returns a model by id', () => {
    service.getModel.mockReturnValue(sampleModel);
    expect(controller.get('mdl_abc123')).toEqual(sampleModel);
  });

  it('throws 404 for a missing model', () => {
    service.getModel.mockReturnValue(undefined);
    expect(() => controller.get('mdl_nope')).toThrow(NotFoundException);
  });

  it('creates a model', async () => {
    service.createModel.mockResolvedValue(sampleModel);
    const dto = {
      provider: 'deepseek',
      name: '生产 DeepSeek',
      model: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com/v1',
    };
    await expect(controller.create(dto)).resolves.toEqual(sampleModel);
    expect(service.createModel).toHaveBeenCalledWith(dto);
  });

  it('updates a model', async () => {
    service.updateModel.mockResolvedValue({ ...sampleModel, isDefault: false });
    const dto = { apiKey: 'sk-new', isDefault: false };
    await expect(controller.update('mdl_abc123', dto)).resolves.toMatchObject({
      isDefault: false,
    });
    expect(service.updateModel).toHaveBeenCalledWith('mdl_abc123', dto);
  });

  it('propagates name conflicts on update', async () => {
    service.updateModel.mockRejectedValue(new ConflictException('already exists'));
    await expect(
      controller.update('mdl_abc123', { name: 'dup' }),
    ).rejects.toThrow(ConflictException);
  });

  it('propagates conflicts from the service', async () => {
    service.deleteModel.mockRejectedValue(new ConflictException('被引用'));
    await expect(controller.remove('mdl_abc123')).rejects.toThrow(ConflictException);
  });

  it('deletes a model', async () => {
    service.deleteModel.mockResolvedValue(undefined);
    await expect(controller.remove('mdl_abc123')).resolves.toEqual({ ok: true });
  });
});
