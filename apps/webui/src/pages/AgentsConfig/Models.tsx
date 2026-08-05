import {
  ApiOutlined,
  DeleteOutlined,
  PlusOutlined,
  StarFilled,
  StarOutlined,
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
import { ClawModel } from '@/services/cyberclaw';
import { useConfig } from './useConfig';

interface ModelFormValues {
  provider: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  model: string;
  enabled?: boolean;
}

const PROVIDERS = [
  { label: 'OpenAI', value: 'openai' },
  { label: 'DeepSeek', value: 'deepseek' },
  { label: '通义千问 (Qwen)', value: 'qwen' },
  { label: 'Ollama (本地)', value: 'ollama' },
  { label: '自定义 (OpenAI 兼容)', value: 'custom' },
];

const DEFAULT_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  ollama: 'http://localhost:11434/v1',
  custom: '',
};

const ModelsPage: React.FC = () => {
  const { config, persist, loading } = useConfig();
  const [form] = Form.useForm<ModelFormValues>();

  const handleProviderChange = (provider: string) => {
    form.setFieldsValue({ baseUrl: DEFAULT_BASE_URLS[provider] || '' });
  };

  const handleCreate = async (values: ModelFormValues) => {
    const model: ClawModel = {
      id: `model-${Date.now()}`,
      provider: values.provider,
      name: values.name,
      model: values.model,
      baseUrl: values.baseUrl,
      apiKey: values.apiKey || '',
      enabled: values.enabled ?? true,
      isDefault: config.models.length === 0,
    };
    await persist({ ...config, models: [...config.models, model] });
    message.success('模型配置已添加');
    form.resetFields();
  };

  const toggleModel = async (id: string, enabled: boolean) => {
    await persist({
      ...config,
      models: config.models.map((m) => (m.id === id ? { ...m, enabled } : m)),
    });
  };

  const setDefault = async (id: string) => {
    await persist({
      ...config,
      models: config.models.map((m) => ({ ...m, isDefault: m.id === id })),
    });
    message.success('已设为默认模型');
  };

  const removeModel = async (id: string) => {
    await persist({ ...config, models: config.models.filter((m) => m.id !== id) });
    message.success('模型配置已删除');
  };

  return (
    <PageContainer
      title="大模型配置"
      content="配置接入的大模型服务（OpenAI 兼容接口），供智能体对话使用。"
    >
      <ProCard
        title="添加模型"
        extra={<ApiOutlined style={{ fontSize: 18, color: '#1677ff' }} />}
        loading={loading}
        style={{ marginBottom: 16 }}
      >
        <Form<ModelFormValues>
          form={form}
          layout="vertical"
          onFinish={handleCreate}
          initialValues={{ provider: 'openai', enabled: true }}
        >
          <Form.Item
            name="provider"
            label="服务商"
            rules={[{ required: true, message: '请选择服务商' }]}
          >
            <Select options={PROVIDERS} onChange={handleProviderChange} />
          </Form.Item>
          <Form.Item
            name="name"
            label="配置名称"
            rules={[{ required: true, message: '请输入配置名称' }]}
          >
            <Input placeholder="例如：生产 DeepSeek" maxLength={50} />
          </Form.Item>
          <Form.Item
            name="baseUrl"
            label="Base URL"
            rules={[{ required: true, message: '请输入接口地址' }]}
          >
            <Input placeholder="https://api.deepseek.com/v1" />
          </Form.Item>
          <Form.Item name="apiKey" label="API Key">
            <Input.Password placeholder="sk-…" autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            name="model"
            label="模型名称"
            rules={[{ required: true, message: '请输入模型名称' }]}
          >
            <Input placeholder="例如：deepseek-chat / gpt-4o" />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch checkedChildren="启用" unCheckedChildren="停用" />
          </Form.Item>
          <Button type="primary" htmlType="submit" icon={<PlusOutlined />}>
            添加模型
          </Button>
        </Form>
      </ProCard>

      <ProCard title="已配置模型">
        {config.models.length === 0 ? (
          <Empty description="还没有模型配置，先添加一个吧" />
        ) : (
          <List
            grid={{ gutter: 16, xs: 1, sm: 1, md: 2, lg: 2, xl: 3 }}
            dataSource={config.models}
            renderItem={(model) => (
              <List.Item>
                <Card
                  size="small"
                  title={
                    <Space>
                      <ApiOutlined style={{ color: '#1677ff' }} />
                      {model.name}
                      {model.isDefault && <Tag color="gold">默认</Tag>}
                    </Space>
                  }
                  extra={
                    <Space>
                      <Switch
                        size="small"
                        checked={model.enabled}
                        onChange={(checked) => toggleModel(model.id, checked)}
                      />
                      <Button
                        type="text"
                        size="small"
                        icon={model.isDefault ? <StarFilled style={{ color: '#faad14' }} /> : <StarOutlined />}
                        onClick={() => setDefault(model.id)}
                      />
                      <Popconfirm
                        title="确认删除该模型配置？"
                        onConfirm={() => removeModel(model.id)}
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
                  <Typography.Paragraph type="secondary" style={{ marginBottom: 4 }}>
                    {model.provider} · {model.model}
                  </Typography.Paragraph>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }} copyable>
                    {model.baseUrl}
                  </Typography.Text>
                </Card>
              </List.Item>
            )}
          />
        )}
      </ProCard>
    </PageContainer>
  );
};

export default ModelsPage;
