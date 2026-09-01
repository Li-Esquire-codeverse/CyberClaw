import type {
  BrowserLocatorLike,
  BrowserPageLike,
  BrowserSessionLike,
  BrowserSessionFactory,
} from './browser.executor';

/**
 * browser 执行器单测：Playwright 整体注入假 page（goto/title/bodyText/locator），
 * 真实浏览器调用不进入单测（spec 5.1）。
 *
 * 说明：browser.executor 模块级持有单例缓存（sessionPromise），
 * 每个用例用 jest.isolateModules 重新加载模块以获得干净单例。
 */

interface FakeLocatorHandlers {
  click?: jest.Mock;
  fill?: jest.Mock;
  innerText?: jest.Mock;
}

function makeFakePage(handlers: {
  goto?: jest.Mock;
  title?: jest.Mock;
  bodyText?: jest.Mock;
  locators?: Record<string, FakeLocatorHandlers>;
}): BrowserPageLike {
  const defaultLocator: FakeLocatorHandlers = {
    click: jest.fn(async () => undefined),
    fill: jest.fn(async () => undefined),
    innerText: jest.fn(async () => 'fake text'),
  };
  return {
    goto: handlers.goto ?? jest.fn(async () => undefined),
    title: handlers.title ?? jest.fn(async () => 'Example Domain'),
    bodyText: handlers.bodyText ?? jest.fn(async () => 'hello world body'),
    locator: (selector) => {
      const l = handlers.locators?.[selector] ?? defaultLocator;
      return {
        click: (l.click ?? defaultLocator.click) as BrowserLocatorLike['click'],
        fill: (l.fill ?? defaultLocator.fill) as BrowserLocatorLike['fill'],
        innerText: (l.innerText ??
          defaultLocator.innerText) as BrowserLocatorLike['innerText'],
      };
    },
  };
}

type ExecutorModule = typeof import('./browser.executor');
type Executor = ReturnType<ExecutorModule['createBrowserExecutor']>;

describe('browserExecutor', () => {
  let factory: jest.MockedFunction<BrowserSessionFactory>;
  let fakePage: BrowserPageLike;
  let fakeClose: jest.Mock;
  let executor: Executor;

  beforeEach(() => {
    fakeClose = jest.fn(async () => undefined);
    factory = jest.fn(async () => ({ page: fakePage, close: fakeClose }));
    // 重新加载模块（清空模块级 sessionPromise 单例缓存）
    jest.isolateModules(() => {
      const mod = jest.requireActual<ExecutorModule>('./browser.executor');
      executor = mod.createBrowserExecutor(factory);
    });
  });

  function setPage(page: BrowserPageLike): void {
    fakePage = page;
    factory.mockResolvedValue({ page: fakePage, close: fakeClose });
  }

  // ---- 参数校验 ----

  it('缺少 action 参数时返回工具错误', async () => {
    setPage(makeFakePage({}));
    const result = await executor({ url: 'https://example.com' });
    expect(result).toContain('[工具错误]');
    expect(result).toContain('action');
  });

  it('不支持的 action 返回工具错误', async () => {
    setPage(makeFakePage({}));
    const result = await executor({ action: 'scroll' });
    expect(result).toContain('[工具错误]');
    expect(result).toContain('scroll');
  });

  // ---- navigate ----

  it('navigate 缺少 url 返回工具错误且不启动浏览器', async () => {
    setPage(makeFakePage({}));
    const result = await executor({ action: 'navigate' });
    expect(result).toContain('[工具错误]');
    expect(result).toContain('url');
    expect(factory).not.toHaveBeenCalled();
  });

  it('navigate 拒绝非 http/https url 且不启动浏览器', async () => {
    setPage(makeFakePage({}));
    const result = await executor({
      action: 'navigate',
      url: 'file:///etc/passwd',
    });
    expect(result).toContain('[工具错误]');
    expect(result).toContain('http:// 或 https://');
    expect(factory).not.toHaveBeenCalled();
  });

  it('navigate 输出标题 + 正文，goto 带 15s 超时', async () => {
    setPage(makeFakePage({}));
    const result = await executor({
      action: 'navigate',
      url: 'https://example.com',
    });
    expect(result).toContain('Example Domain');
    expect(result).toContain('hello world body');
    expect(fakePage.goto).toHaveBeenCalledWith('https://example.com', {
      timeout: 15000,
    });
  });

  it('navigate 正文超过 8000 字符被截断并提示', async () => {
    setPage(makeFakePage({ bodyText: jest.fn(async () => 'x'.repeat(10_000)) }));
    const result = await executor({
      action: 'navigate',
      url: 'https://example.com',
    });
    expect(result).toContain('内容过长已截断');
    expect(result.length).toBeGreaterThan(8000);
    expect(result.length).toBeLessThan(9000);
  });

  // ---- click / type / extract ----

  it('click 缺少 selector 返回工具错误', async () => {
    setPage(makeFakePage({}));
    const result = await executor({ action: 'click' });
    expect(result).toContain('[工具错误]');
    expect(result).toContain('selector');
  });

  it('click 通过 locator 点击并带 5s 超时', async () => {
    const click = jest.fn(async () => undefined);
    setPage(makeFakePage({ locators: { '#btn': { click } } }));
    const result = await executor({ action: 'click', selector: '#btn' });
    expect(result).toContain('已点击');
    expect(click).toHaveBeenCalledWith({ timeout: 5000 });
  });

  it('type 缺少 selector/text 返回工具错误', async () => {
    setPage(makeFakePage({}));
    const noSel = await executor({ action: 'type', text: 'hi' });
    expect(noSel).toContain('[工具错误]');
    expect(noSel).toContain('selector');
    const noText = await executor({ action: 'type', selector: '#input' });
    expect(noText).toContain('[工具错误]');
    expect(noText).toContain('text');
  });

  it('type 通过 locator.fill 输入文本', async () => {
    const fill = jest.fn(async () => undefined);
    setPage(makeFakePage({ locators: { '#input': { fill } } }));
    const result = await executor({
      action: 'type',
      selector: '#input',
      text: '你好',
    });
    expect(result).toContain('输入文本');
    expect(fill).toHaveBeenCalledWith('你好', { timeout: 5000 });
  });

  it('extract 返回 selector 元素文本', async () => {
    const innerText = jest.fn(async () => 'extracted content');
    setPage(makeFakePage({ locators: { '.result': { innerText } } }));
    const result = await executor({ action: 'extract', selector: '.result' });
    expect(result).toBe('extracted content');
    expect(innerText).toHaveBeenCalledWith({ timeout: 5000 });
  });

  it('extract 无文本返回占位提示', async () => {
    const innerText = jest.fn(async () => '   ');
    setPage(makeFakePage({ locators: { '.empty': { innerText } } }));
    const result = await executor({ action: 'extract', selector: '.empty' });
    expect(result).toContain('无可提取文本');
  });

  // ---- 降级与错误 ----

  it('浏览器二进制缺失（launch 阶段）返回明确降级提示', async () => {
    factory.mockRejectedValue(
      new Error(
        "Executable doesn't exist at C:\\Users\\x\\AppData\\Local\\ms-playwright\\chromium-1140\\chrome-win\\chrome.exe\nRun the following command to download new browsers: npx playwright install",
      ),
    );
    const result = await executor({
      action: 'navigate',
      url: 'https://example.com',
    });
    expect(result).toContain('browser 工具未就绪');
    expect(result).toContain('npx playwright install chromium');
    expect(result).not.toContain('[工具错误]'); // 降级不是工具错误（P6）
  });

  it('二进制缺失在 goto 阶段（profile 损坏）同样降级', async () => {
    setPage(
      makeFakePage({
        goto: jest.fn(async () => {
          throw new Error(
            'browserType.launchPersistentContext: ERR_BROWSER_NOT_INSTALLED',
          );
        }),
      }),
    );
    const result = await executor({
      action: 'navigate',
      url: 'https://example.com',
    });
    expect(result).toContain('browser 工具未就绪');
  });

  it('超时错误返回工具错误并附超时提示', async () => {
    setPage(
      makeFakePage({
        goto: jest.fn(async () => {
          throw new Error('Navigation timeout of 15000 ms exceeded');
        }),
      }),
    );
    const result = await executor({
      action: 'navigate',
      url: 'https://example.com',
    });
    expect(result).toContain('[工具错误]');
    expect(result).toContain('操作超时');
  });

  it('页面导航失败返回工具错误', async () => {
    setPage(
      makeFakePage({
        goto: jest.fn(async () => {
          throw new Error('net::ERR_NAME_NOT_RESOLVED');
        }),
      }),
    );
    const result = await executor({
      action: 'navigate',
      url: 'https://example.com',
    });
    expect(result).toContain('[工具错误]');
    expect(result).toContain('net::ERR_NAME_NOT_RESOLVED');
  });

  it('launch 失败后单例缓存清空，下次调用可重试', async () => {
    setPage(makeFakePage({}));
    factory.mockRejectedValueOnce(new Error('launch boom'));
    const first = await executor({ action: 'click', selector: '#x' });
    expect(first).toContain('[工具错误]');
    expect(first).toContain('launch boom');

    // 第二次：工厂恢复成功 → 单例缓存已清，重新 launch
    const result = await executor({ action: 'click', selector: '#btn' });
    expect(result).toContain('已点击');
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('多次调用复用同一单例（工厂只调用一次）', async () => {
    setPage(makeFakePage({}));
    await executor({ action: 'click', selector: '#a' });
    await executor({ action: 'extract', selector: '.x' });
    await executor({ action: 'click', selector: '#b' });
    expect(factory).toHaveBeenCalledTimes(1);
  });
});
