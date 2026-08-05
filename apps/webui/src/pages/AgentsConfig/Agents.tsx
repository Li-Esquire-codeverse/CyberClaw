import {
  DeleteOutlined,
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
  Popconfirm,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
  message,
} from 'antd';
import React from 'react';
import { ClawAgent } from '@/services/cyberclaw';
import { useConfig } from './useConfig';

const { TextArea } = Input;

interface AgentFormValues {
  name: string;
  description?: string;
  systemPrompt?: string;
  modelId?: string;
  tools?: string[];
  enabled?: boolean;
}

const AgentsPage: React.FC = () => {
  const { config, persist, loading } = useConfig();
  const [form] = Form.useForm<AgentFormValues>();

  const enabledTools = config.tools.filter((t) => t.enabled);
  const enabledModels = config.models.filter((m) => m.enabled);

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
    await persist({ ...config, agents: [...config.agents, agent] });
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
    await persist({ ...config, agents: config.agents.filter((a) => a.id !== id) });
    message.success('智能体已删除');
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
            extra={enabledModels.length === 0 ? '请先在「Models」页配置并启用大模型' : undefined}
          >
            <Select
              placeholder="选择该智能体使用的模型"
              options={enabledModels.map((m) => ({
                label: `${m.name} (${m.provider})`,
                value: m.id,
              }))}
              allowClear
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
          <Button type="primary" htmlType="submit" icon={<PlusOutlined />}>
            创建智能体
          </Button>
        </Form>
      </ProCard>

      <ProCard title="智能体列表">
        {config.agents.length === 0 ? (
          <Empty description="还没有智能体，先创建一个吧" />
        ) : (
          <List
            grid={{ gutter: 16, xs: 1, sm: 1, md: 2, lg: 2, xl: 3 }}
            dataSource={config.agents}
            renderItem={(agent) => (
              <List.Item>
                <Card
                  size="small"
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
                  <Typography.Paragraph type="secondary" ellipsis={{ rows: 2 }} style={{ marginBottom: 8 }}>
                    {agent.description || '暂无描述'}
                  </Typography.Paragraph>
                  <Space size={[4, 4]} wrap>
                    {agent.tools.length > 0 ? (
                      agent.tools.map((t) => (
                        <Tag key={t} color="blue">
                          {t}
                        </Tag>
                      ))
                    ) : (
                      <Tag>未绑定工具</Tag>
                    )}
                  </Space>
                </Card>
              </List.Item>
            )}
          />
        )}
      </ProCard>
    </PageContainer>
  );
};

export default AgentsPage;
