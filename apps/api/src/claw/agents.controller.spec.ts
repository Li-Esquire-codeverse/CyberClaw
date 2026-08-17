import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { AgentsController } from './agents.controller';
import { ClawConfigService } from './claw-config.service';
import { ClawAgent } from './claw.types';

describe('AgentsController', () => {
  let controller: AgentsController;
  const service = {
    listAgents: jest.fn(),
    getAgent: jest.fn(),
    createAgent: jest.fn(),
    updateAgent: jest.fn(),
    deleteAgent: jest.fn(),
  };

  const sampleAgent: ClawAgent = {
    id: 'ag_abc123',
    name: 'assistant',
    tools: [],
    enabled: true,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [AgentsController],
      providers: [{ provide: ClawConfigService, useValue: service }],
    }).compile();

    controller = moduleRef.get(AgentsController);
  });

  it('lists agents', () => {
    service.listAgents.mockReturnValue([sampleAgent]);
    expect(controller.list()).toEqual([sampleAgent]);
    expect(service.listAgents).toHaveBeenCalledTimes(1);
  });

  it('returns an agent by id', () => {
    service.getAgent.mockReturnValue(sampleAgent);
    expect(controller.get('ag_abc123')).toEqual(sampleAgent);
  });

  it('throws 404 for a missing agent', () => {
    service.getAgent.mockReturnValue(undefined);
    expect(() => controller.get('ag_nope')).toThrow(NotFoundException);
  });

  it('creates an agent via service', async () => {
    service.createAgent.mockResolvedValue(sampleAgent);
    const dto = { name: 'assistant', tools: ['web-search'] };
    await expect(controller.create(dto)).resolves.toEqual(sampleAgent);
    expect(service.createAgent).toHaveBeenCalledWith(dto);
  });

  it('propagates service conflicts on create', async () => {
    service.createAgent.mockRejectedValue(new ConflictException('already exists'));
    await expect(controller.create({ name: 'dup' })).rejects.toThrow(ConflictException);
  });

  it('updates an agent', async () => {
    service.updateAgent.mockResolvedValue({ ...sampleAgent, enabled: false });
    const dto = { name: 'renamed', enabled: false };
    await expect(controller.update('ag_abc123', dto)).resolves.toMatchObject({
      enabled: false,
    });
    expect(service.updateAgent).toHaveBeenCalledWith('ag_abc123', dto);
  });

  it('propagates reference validation errors on update', async () => {
    service.updateAgent.mockRejectedValue(new ConflictException('关联的工具不存在: nope'));
    await expect(
      controller.update('ag_abc123', { tools: ['nope'] }),
    ).rejects.toThrow(ConflictException);
  });

  it('deletes an agent', async () => {
    service.deleteAgent.mockResolvedValue(undefined);
    await expect(controller.remove('ag_abc123')).resolves.toEqual({ ok: true });
    expect(service.deleteAgent).toHaveBeenCalledWith('ag_abc123');
  });
});
