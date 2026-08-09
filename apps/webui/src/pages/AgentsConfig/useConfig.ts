import { message } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import {
  CyberClawConfig,
  defaultConfig,
  loadConfig,
  saveConfig,
} from '@/services/cyberclaw';

/**
 * 共享配置状态 Hook
 * 三个配置页面（Agents / Models / Tools）共用同一份配置，
 * 读取时优先请求后端，失败回退本地；保存时双写。
 */
export function useConfig() {
  const [config, setConfig] = useState<CyberClawConfig>(defaultConfig());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadConfig().then((cfg) => {
      setConfig(cfg);
      setLoading(false);
    });
  }, []);

  const persist = useCallback(
    async (next: CyberClawConfig) => {
      setConfig(next);
      const res = await saveConfig(next);
      if (res.remote) {
        message.success('配置已保存到 CyberClaw.json');
      } else {
        message.warning('后端未连接，配置已保存到本地（接入后端后将同步保存）');
      }
      return res;
    },
    [],
  );

  return { config, setConfig, persist, loading };
}
