import {
  ChromeOutlined,
  CodeOutlined,
  ConsoleSqlOutlined,
  DatabaseOutlined,
  FolderOutlined,
  PictureOutlined,
  SearchOutlined,
  TranslationOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import { PageContainer, ProCard } from '@ant-design/pro-components';
import { Card, Col, Row, Space, Switch, Tag, Typography, message } from 'antd';
import React from 'react';
import { ClawTool } from '@/services/cyberclaw';
import { useConfig } from './useConfig';

const ICON_MAP: Record<string, React.ReactNode> = {
  search: <SearchOutlined />,
  chrome: <ChromeOutlined />,
  folder: <FolderOutlined />,
  'console-sql': <ConsoleSqlOutlined />,
  database: <DatabaseOutlined />,
  code: <CodeOutlined />,
  picture: <PictureOutlined />,
  translation: <TranslationOutlined />,
};

const ToolsPage: React.FC = () => {
  const { config, persist, loading } = useConfig();

  const toggleTool = async (name: string, enabled: boolean) => {
    const res = await persist({
      ...config,
      tools: config.tools.map((t) => (t.name === name ? { ...t, enabled } : t)),
    });
    if (!res.ok) return;
    message.success(`${enabled ? '已启用' : '已禁用'}：${name}`);
  };

  return (
    <PageContainer
      title="工具配置"
      content="内置工具开关配置，开启的工具将提供给智能体调用。"
    >
      <ProCard
        title="内置工具"
        loading={loading}
      >
        <Row gutter={[16, 16]}>
          {config.tools.map((tool: ClawTool) => (
            <Col xs={24} sm={12} lg={8} xl={6} key={tool.name}>
              <Card
                hoverable
                title={
                  <Space>
                    <span style={{ color: '#1677ff', fontSize: 18 }}>
                      {ICON_MAP[tool.name] || <ToolOutlined />}
                    </span>
                    <Typography.Text strong>{tool.label}</Typography.Text>
                    {tool.builtin && <Tag color="green">内置</Tag>}
                  </Space>
                }
                extra={
                  <Switch
                    checked={tool.enabled}
                    checkedChildren="启用"
                    unCheckedChildren="禁用"
                    onChange={(checked) => toggleTool(tool.name, checked)}
                  />
                }
              >
                <Typography.Paragraph
                  type="secondary"
                  style={{ marginBottom: 8, minHeight: 44 }}
                >
                  {tool.description}
                </Typography.Paragraph>
                {(() => {
                  const usage = config.agents.filter((a) => a.tools.includes(tool.name)).length;
                  return usage > 0 ? (
                    <Tag color="blue">被 {usage} 个智能体使用</Tag>
                  ) : null;
                })()}
              </Card>
            </Col>
          ))}
        </Row>
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 16 }}>
          当前为内置工具，开启/关闭状态将随配置保存到仓库根目录 CyberClaw.json。
        </Typography.Text>
      </ProCard>
    </PageContainer>
  );
};

export default ToolsPage;
