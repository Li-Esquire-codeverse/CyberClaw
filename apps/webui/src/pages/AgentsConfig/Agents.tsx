import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import { PageContainer, ProCard } from '@ant-design/pro-components';
import {
  Button,
  Card,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import React, { useEffect, useState } from 'react';
import { type ClawAgent, loadConfig, updateAgentApi } from '@/services/cyberclaw';
import { useConfig } from './useConfig';

const { TextArea } = Input;

/** 智能体卡片最多展示的工具 Tag 数，超出折叠为 +N */
const MAX_TOOL_TAGS = 4;

/** 卡片内标签统一定宽，超出省略号截断，悬浮展示完整文案 */
const TAG_STYLE: React.CSSProperties = {
  width: 88,
  maxWidth: 88,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  marginInlineEnd: 0,
};

interface AgentFormValues {
  name: string;
  description?: string;
  systemPrompt?: string;
  modelId?: string;
  tools?: string[];
  enabled?: boolean;
}

const AgentsPage: React.FC = () => {
  const { config, setConfig, persist, loading } = useConfig();
  const [form] = Form.useForm<AgentFormValues>();
  const [editingAgent, setEditingAgent] = useState<ClawAgent | null>(null);
  const [saving, setSaving] = useState(false);
  const [editForm] = Form.useForm<AgentFormValues>();

  const enabledTools = config.tools.filter((t) => t.enabled);
  const enabledModels = config.models.filter((m) => m.enabled);
  // 用于列表展示：包含已停用的模型（历史关联可能指向已停用模型）
  const modelMap = new Map(config.models.map((m) => [m.id, m]));
  // 工具名 -> 显示名（工具区展示更短的 label）
  const toolLabelMap = new Map(config.tools.map((t) => [t.name, t.label]));

  const handleCreate = async (values: AgentFormValues) => {
    const agent: ClawAgent = {
      id: `agent-${Date.now()}`,
      name: values.name,
      description: values.description,
      systemPrompt: values.systemPrompt,
      modelId: values.modelId,
      tools: values.tools || [],
      enabled: values.enabled ?? true,
      createdAt: new Date().toISOString(),
    };
    const res = await persist({ ...config, agents: [...config.agents, agent] });
    if (!res.ok) return;
    message.success('智能体创建成功');
    form.resetFields();
  };

  const toggleAgent = async (id: string, enabled: boolean) => {
    await persist({
      ...config,
      agents: config.agents.map((a) => (a.id === id ? { ...a, enabled } : a)),
    });
  };

  const removeAgent = async (id: string) => {
    const res = await persist({ ...config, agents: config.agents.filter((a) => a.id !== id) });
    if (!res.ok) return;
    message.success('智能体已删除');
  };

  const openEdit = (agent: ClawAgent) => {
    setEditingAgent(agent);
  };

  // Modal 内容在 destroyOnHidden 下异步挂载，需在渲染完成后预填表单
  useEffect(() => {
    if (editingAgent) {
      editForm.setFieldsValue({
        name: editingAgent.name,
        description: editingAgent.description,
        systemPrompt: editingAgent.systemPrompt,
        modelId: editingAgent.modelId,
        tools: editingAgent.tools,
        enabled: editingAgent.enabled,
      });
    }
  }, [editingAgent, editForm]);

  const handleEditFinish = async (values: AgentFormValues) => {
    if (!editingAgent) return;
    setSaving(true);
    const res = await updateAgentApi(editingAgent.id, values);
    setSaving(false);
    if (!res.ok) {
      message.error(res.error || '更新失败');
      return;
    }
    setEditingAgent(null);
    editForm.resetFields();
    // 走单资源接口更新成功后，重新拉取后端最新配置
    const fresh = await loadConfig();
    setConfig(fresh);
    message.success('智能体已更新');
  };

  return (
    <PageContainer
      title="创建智能体"
      content="配置 AI 智能体的名称、系统提示词、关联模型与可用工具。"
    >
      <ProCard
        title="新建智能体"
        extra={<RobotOutlined style={{ fontSize: 18, color: '#1677ff' }} />}
        loading={loading}
        style={{ marginBottom: 16 }}
      >
        <Form<AgentFormValues>
          form={form}
          layout="vertical"
          onFinish={handleCreate}
          initialValues={{ enabled: true }}
        >
          <Form.Item
            name="name"
            label="智能体名称"
            rules={[{ required: true, message: '请输入智能体名称' }]}
          >
            <Input placeholder="例如：代码助手" maxLength={50} />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input placeholder="简单描述这个智能体的用途" maxLength={200} />
          </Form.Item>
          <Form.Item name="systemPrompt" label="系统提示词（System Prompt）">
            <TextArea
              rows={5}
              placeholder="设定智能体的角色、行为准则与能力边界…"
            />
          </Form.Item>
          <Form.Item
            name="modelId"
            label="关联大模型"
            rules={[{ required: true, message: '请选择关联大模型' }]}
            extra={
              enabledModels.length === 0
                ? '请先在「Models」页配置并启用大模型（关联大模型为必填项）'
                : '关联大模型为必填项'
            }
          >
            <Select
              placeholder="选择该智能体使用的模型"
              options={enabledModels.map((m) => ({
                label: `${m.name} (${m.provider})`,
                value: m.id,
              }))}
              disabled={enabledModels.length === 0}
            />
          </Form.Item>
          <Form.Item
            name="tools"
            label="可用工具"
            extra={enabledTools.length === 0 ? '请先在「Tools」页启用工具' : undefined}
          >
            <Select
              mode="multiple"
              placeholder="选择该智能体可调用的工具"
              options={enabledTools.map((t) => ({ label: t.label, value: t.name }))}
              allowClear
            />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch checkedChildren="启用" unCheckedChildren="停用" />
          </Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            icon={<PlusOutlined />}
            disabled={enabledModels.length === 0}
          >
            创建智能体
          </Button>
        </Form>
      </ProCard>

      <ProCard title="智能体列表">
        {config.agents.length === 0 ? (
          <Empty description="还没有智能体，先创建一个吧" />
        ) : (
          <List
            grid={{ gutter: 16, column: 3, xs: 1, sm: 1, md: 2, lg: 2, xl: 3 }}
            dataSource={config.agents}
            renderItem={(agent) => (
              <List.Item>
                <Card
                  size="small"
                  style={{ width: '100%', minWidth: 0 }}
                  title={
                    <Space>
                      <RobotOutlined style={{ color: '#1677ff' }} />
                      {agent.name}
                    </Space>
                  }
                  extra={
                    <Space>
                      <Switch
                        size="small"
                        checked={agent.enabled}
                        onChange={(checked) => toggleAgent(agent.id, checked)}
                      />
                      <Button
                        type="text"
                        size="small"
                        icon={<EditOutlined />}
                        onClick={() => openEdit(agent)}
                        aria-label={`编辑 ${agent.name}`}
                      />
                      <Popconfirm
                        title="确认删除该智能体？"
                        onConfirm={() => removeAgent(agent.id)}
                      >
                        <Button
                          type="text"
                          danger
                          size="small"
                          icon={<DeleteOutlined />}
                        />
                      </Popconfirm>
                    </Space>
                  }
                >
                  <Typography.Paragraph
                    type="secondary"
                    ellipsis={{ rows: 2, tooltip: agent.description || '暂无描述' }}
                    style={{ marginBottom: 8 }}
                  >
                    {agent.description || '暂无描述'}
                  </Typography.Paragraph>
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'nowrap',
                      overflow: 'hidden',
                      gap: 4,
                      marginBottom: 4,
                      minWidth: 0,
                    }}
                  >
                    {(() => {
                      const model = agent.modelId ? modelMap.get(agent.modelId) : undefined;
                      const modelText = model
                        ? `${model.name} · ${model.provider}`
                        : '未关联模型';
                      return (
                        <Tooltip title={model ? `${model.name} · ${model.provider}` : undefined}>
                          <Tag color={model?.enabled ? 'cyan' : 'orange'} style={TAG_STYLE}>
                            {modelText}
                          </Tag>
                        </Tooltip>
                      );
                    })()}
                    {agent.tools.length > 0 ? (
                      <span
                        style={{
                          display: 'flex',
                          flexWrap: 'nowrap',
                          overflow: 'hidden',
                          gap: 4,
                          minWidth: 0,
                        }}
                      >
                        {agent.tools.slice(0, MAX_TOOL_TAGS).map((t) => {
                          const label = toolLabelMap.get(t) ?? t;
                          return (
                            <Tooltip key={t} title={label}>
                              <Tag color="blue" style={TAG_STYLE}>
                                {label}
                              </Tag>
                            </Tooltip>
                          );
                        })}
                        {agent.tools.length > MAX_TOOL_TAGS && (
                          <Tag
                            color="blue"
                            style={{ marginInlineEnd: 0, flexShrink: 0 }}
                          >
                            +{agent.tools.length - MAX_TOOL_TAGS}
                          </Tag>
                        )}
                      </span>
                    ) : (
                      <Tag style={TAG_STYLE}>未绑定工具</Tag>
                    )}
                  </div>
                </Card>
              </List.Item>
            )}
          />
        )}
      </ProCard>

      <Modal
        title="编辑智能体"
        open={!!editingAgent}
        onOk={() => editForm.submit()}
        onCancel={() => {
          setEditingAgent(null);
          editForm.resetFields();
        }}
        confirmLoading={saving}
        destroyOnHidden
      >
        <Form<AgentFormValues>
          form={editForm}
          layout="vertical"
          onFinish={handleEditFinish}
        >
          <Form.Item
            name="name"
            label="智能体名称"
            rules={[{ required: true, message: '请输入智能体名称' }]}
          >
            <Input placeholder="例如：代码助手" maxLength={50} />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input placeholder="简单描述这个智能体的用途" maxLength={200} />
          </Form.Item>
          <Form.Item name="systemPrompt" label="系统提示词（System Prompt）">
            <TextArea rows={4} placeholder="设定智能体的角色、行为准则与能力边界…" />
          </Form.Item>
          <Form.Item
            name="modelId"
            label="关联大模型"
            rules={[{ required: true, message: '请选择关联大模型' }]}
            extra={enabledModels.length === 0 ? '请先在「Models」页配置并启用大模型' : undefined}
          >
            <Select
              placeholder="选择该智能体使用的模型"
              options={enabledModels.map((m) => ({
                label: `${m.name} (${m.provider})`,
                value: m.id,
              }))}
              disabled={enabledModels.length === 0}
            />
          </Form.Item>
          <Form.Item name="tools" label="可用工具">
            <Select
              mode="multiple"
              placeholder="选择该智能体可调用的工具"
              options={enabledTools.map((t) => ({ label: t.label, value: t.name }))}
              allowClear
            />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch checkedChildren="启用" unCheckedChildren="停用" />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
};

export default AgentsPage;
