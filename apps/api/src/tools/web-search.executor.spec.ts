import { webSearchExecutor } from './web-search.executor';

/** 模拟 fetch 响应 */
function mockFetchOnce(
  status: number,
  body: string,
  ok = status >= 200 && status < 300,
): jest.Mock {
  const fn = jest.fn().mockResolvedValue({
    ok,
    status,
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(JSON.parse(body)),
  });
  jest.spyOn(globalThis, 'fetch').mockImplementation(fn as unknown as typeof fetch);
  return fn;
}

describe('webSearchExecutor', () => {
  const realEnv = { ...process.env };

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = { ...realEnv };
  });

  it('缺少 query 参数时返回工具错误', async () => {
    const result = await webSearchExecutor({});
    expect(result).toContain('[工具错误]');
    expect(result).toContain('query');
  });

  it('配置 TAVILY_API_KEY 时走 Tavily API 并格式化结果', async () => {
    process.env.TAVILY_API_KEY = 'tvly-test';
    const fn = mockFetchOnce(
      200,
      JSON.stringify({
        results: [
          { title: '结果一', url: 'https://a.example', content: '摘要内容 A' },
          { title: '结果二', url: 'https://b.example', content: '摘要内容 B' },
        ],
      }),
    );

    const result = await webSearchExecutor({ query: '测试搜索', numResults: 2 });

    expect(fn).toHaveBeenCalledWith(
      'https://api.tavily.com/search',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"query":"测试搜索"'),
      }),
    );
    expect(result).toContain('1. 结果一');
    expect(result).toContain('https://a.example');
    expect(result).toContain('摘要内容 A');
    expect(result).not.toContain('[工具错误]');
  });

  it('配置 BRAVE_API_KEY 时走 Brave API', async () => {
    process.env.BRAVE_API_KEY = 'bsk-test';
    const fn = mockFetchOnce(
      200,
      JSON.stringify({
        web: {
          results: [
            { title: 'Brave 结果', url: 'https://brave.example', description: '描述' },
          ],
        },
      }),
    );

    const result = await webSearchExecutor({ query: 'hello' });

    expect(fn).toHaveBeenCalledWith(
      expect.stringContaining('https://api.search.brave.com/res/v1/web/search?q=hello'),
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Subscription-Token': 'bsk-test' }),
      }),
    );
    expect(result).toContain('Brave 结果');
  });

  it('无 API key 时走 Bing HTML 搜索（国内可达）', async () => {
    const html = `
      <li class="b_algo">
        <h2><a href="https://bing.example/openclaw">Bing 标题 A</a></h2>
        <p>Bing 摘要 A</p>
      </li>
      <li class="b_algo">
        <h2><a href="https://bing.example/two">Bing 标题 B</a></h2>
        <p>Bing 摘要 B</p>
      </li>`;
    const fn = mockFetchOnce(200, html);

    const result = await webSearchExecutor({ query: 'openclaw' });

    expect(fn).toHaveBeenCalledWith(
      expect.stringContaining('https://cn.bing.com/search?q=openclaw'),
      expect.any(Object),
    );
    expect(result).toContain('Bing 标题 A');
    expect(result).toContain('https://bing.example/openclaw');
    expect(result).toContain('Bing 摘要 A');
    expect(result).toContain('Bing 标题 B');
  });

  it('无 API key 时走 DuckDuckGo HTML 搜索', async () => {
    const html = `
      <div class="result results_links">
        <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fddg.example%2Fpage&amp;rut=abc">DDG 标题</a>
        <a class="result__snippet" href="...">DDG 摘要文本</a>
      </div>`;
    const fn = mockFetchOnce(200, html);

    const result = await webSearchExecutor({ query: 'openclaw' });

    expect(fn).toHaveBeenCalledWith(
      expect.stringContaining('https://html.duckduckgo.com/html/?q=openclaw'),
      expect.any(Object),
    );
    expect(result).toContain('DDG 标题');
    expect(result).toContain('https://ddg.example/page');
    expect(result).toContain('DDG 摘要文本');
  });

  it('上游返回非 2xx 时返回工具错误（含原因）', async () => {
    process.env.TAVILY_API_KEY = 'tvly-test';
    mockFetchOnce(429, '{"error":"rate limited"}', false);

    const result = await webSearchExecutor({ query: 'x' });

    expect(result).toContain('[工具错误]');
    expect(result).toContain('429');
  });

  it('网络异常（fetch reject）时返回工具错误', async () => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await webSearchExecutor({ query: 'x' });

    expect(result).toContain('[工具错误]');
    expect(result).toContain('ECONNREFUSED');
  });
});
