import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ToolsController } from './tools.controller';
import { ClawConfigService } from './claw-config.service';
import { ClawTool } from './claw.types';

describe('ToolsController', () => {
  let controller: ToolsController;
  const service = {
    listTools: jest.fn(),
    getTool: jest.fn(),
    createTool: jest.fn(),
    updateTool: jest.fn(),
    deleteTool: jest.fn(),
  };

  const sampleTool: ClawTool = {
    name: 'web-search',
    label: '网页搜索',
    description: '搜索引擎检索',
    builtin: true,
    enabled: true,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [ToolsController],
      providers: [{ provide: ClawConfigService, useValue: service }],
    }).compile();

    controller = moduleRef.get(ToolsController);
  });

  it('lists tools', () => {
    service.listTools.mockReturnValue([sampleTool]);
    expect(controller.list()).toEqual([sampleTool]);
  });

  it('returns a tool by name', () => {
    service.getTool.mockReturnValue(sampleTool);
    expect(controller.get('web-search')).toEqual(sampleTool);
  });

  it('throws 404 for a missing tool', () => {
    service.getTool.mockReturnValue(undefined);
    expect(() => controller.get('nope')).toThrow(NotFoundException);
  });

  it('creates a tool', async () => {
    service.createTool.mockResolvedValue({ ...sampleTool, builtin: false });
    const dto = { name: 'custom-calc', label: '计算器' };
    await expect(controller.create(dto)).resolves.toMatchObject({ builtin: false });
    expect(service.createTool).toHaveBeenCalledWith(dto);
  });

  it('updates a tool', async () => {
    service.updateTool.mockResolvedValue({ ...sampleTool, enabled: false });
    await expect(controller.update('web-search', { enabled: false })).resolves.toMatchObject({
      enabled: false,
    });
  });

  it('propagates builtin delete conflicts', async () => {
    service.deleteTool.mockRejectedValue(new ConflictException('内置工具不可删除'));
    await expect(controller.remove('web-search')).rejects.toThrow(ConflictException);
  });

  it('deletes a tool', async () => {
    service.deleteTool.mockResolvedValue(undefined);
    await expect(controller.remove('custom-calc')).resolves.toEqual({ ok: true });
  });
});
