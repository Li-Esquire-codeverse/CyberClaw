import { translateExecutor } from './translate.executor';

function mockFetchOnce(status: number, body: string, ok = status >= 200 && status < 300): jest.Mock {
  const fn = jest.fn().mockResolvedValue({
    ok,
    status,
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(JSON.parse(body)),
  });
  jest.spyOn(globalThis, 'fetch').mockImplementation(fn as unknown as typeof fetch);
  return fn;
}

describe('translateExecutor', () => {
  const realEnv = { ...process.env };

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = { ...realEnv };
  });

  it('缺少 text 参数时返回工具错误', async () => {
    const result = await translateExecutor({});
    expect(result).toContain('[工具错误]');
    expect(result).toContain('text');
  });

  it('超过长度上限时返回工具错误', async () => {
    const result = await translateExecutor({ text: 'x'.repeat(2001) });
    expect(result).toContain('[工具错误]');
    expect(result).toContain('2000');
  });

  it('走 Google 免费端点翻译并拼接译文片段', async () => {
    const fn = mockFetchOnce(
      200,
      JSON.stringify([
        [
          ['你好', 'hello'],
          ['世界', 'world'],
        ],
        'en',
      ]),
    );

    const result = await translateExecutor({
      text: 'hello world',
      targetLang: 'zh-CN',
    });

    expect(fn).toHaveBeenCalledWith(
      expect.stringContaining(
        'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN',
      ),
      expect.any(Object),
    );
    expect(result).toBe('你好世界');
  });

  it('Google 失败时兜底 MyMemory', async () => {
    const fn = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: () => Promise.resolve({}) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            responseData: { translatedText: 'Bonjour le monde' },
            responseStatus: 200,
          }),
      });
    jest.spyOn(globalThis, 'fetch').mockImplementation(fn as unknown as typeof fetch);

    const result = await translateExecutor({
      text: 'Hello world',
      sourceLang: 'en',
      targetLang: 'fr',
    });

    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn.mock.calls[1][0]).toContain(
      'https://api.mymemory.translated.net/get?q=Hello%20world&langpair=en|fr',
    );
    expect(result).toBe('Bonjour le monde');
  });

  it('MyMemory 未返回译文时返回工具错误', async () => {
    const fn = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: () => Promise.resolve({}) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            responseData: { translatedText: '' },
            responseStatus: 403,
            responseDetails: 'INVALID QUERY',
          }),
      });
    jest.spyOn(globalThis, 'fetch').mockImplementation(fn as unknown as typeof fetch);

    const result = await translateExecutor({ text: 'hello' });

    expect(result).toContain('[工具错误]');
  });

  it('两个提供商都失败时返回工具错误', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('ENOTFOUND translate.googleapis.com'));

    const result = await translateExecutor({ text: 'hello' });

    expect(result).toContain('[工具错误]');
    expect(result).toContain('ENOTFOUND');
  });
});
