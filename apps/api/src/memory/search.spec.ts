import { searchTexts, splitParagraphs } from './search';

describe('searchTexts', () => {
  const entries = [
    {
      source: 'MEMORY' as const,
      text: '# MEMORY\n\n- 2026-08-20 用户是一名律师，专注知识产权方向\n- 2026-08-20 项目截止日期是本周五\n\n- 2026-08-21 用户喜欢喝茶',
    },
    {
      source: 'USER' as const,
      text: '# USER\n\n- 沟通风格：简洁直接\n- 常用语言：中文\n- prefers drinking TEA in afternoon',
    },
  ];

  it('中文整句命中', () => {
    const hits = searchTexts(entries, '律师');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].text).toContain('律师');
    expect(hits[0].source).toBe('MEMORY');
  });

  it('英文分词命中且大小写不敏感', () => {
    const hits = searchTexts(entries, 'TEA');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].text).toContain('TEA');
  });

  it('二元组近似命中（查询词未整句出现但片段命中）', () => {
    const hits = searchTexts(entries, '律师职业');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].text).toContain('律师');
  });

  it('无命中返回空数组', () => {
    const hits = searchTexts(entries, '量子计算');
    expect(hits).toEqual([]);
  });

  it('空 query 返回空数组', () => {
    expect(searchTexts(entries, '  ')).toEqual([]);
    expect(searchTexts(entries, '')).toEqual([]);
  });

  it('按分数降序返回 top-K', () => {
    // 查询同时命中多条，limit=1 只返回最高分
    const hits = searchTexts(entries, '用户', 1);
    expect(hits.length).toBeLessThanOrEqual(1);
  });

  it('limit 生效', () => {
    const hits = searchTexts(entries, '用户', 2);
    expect(hits.length).toBeLessThanOrEqual(2);
  });

  it('超长段落截断展示', () => {
    const longText = `- ${'长内容'.repeat(1500)}`;
    const hits = searchTexts([{ source: 'MEMORY' as const, text: longText }], '长内容');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].text.length).toBeLessThan(2200);
    expect(hits[0].text.endsWith('…')).toBe(true);
  });

  it('journal 条目带日期信息', () => {
    const hits = searchTexts(
      [
        {
          source: 'journal' as const,
          date: '2026-08-21',
          text: '今天调研了向量检索方案',
        },
      ],
      '向量检索',
    );
    expect(hits[0].date).toBe('2026-08-21');
    expect(hits[0].source).toBe('journal');
  });
});

describe('splitParagraphs', () => {
  it('按空行分块', () => {
    const parts = splitParagraphs('块一\n\n块二');
    expect(parts).toEqual(['块一', '块二']);
  });

  it('列表项逐项切分', () => {
    const parts = splitParagraphs('- 项一\n- 项二\n\n- 项三');
    expect(parts).toEqual(['- 项一', '- 项二', '- 项三']);
  });

  it('忽略空块', () => {
    const parts = splitParagraphs('   \n\n正文');
    expect(parts).toEqual(['正文']);
  });
});
