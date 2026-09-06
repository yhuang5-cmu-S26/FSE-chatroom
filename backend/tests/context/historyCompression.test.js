const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPromptContext } = require('../../src/services/historyCompressor');

const history = [
  { role: 'user', content: '灾害响应编号 DR-2026-09，集合点改为北门，并通知第 3 组。' },
  { role: 'assistant', content: '已记录：DR-2026-09 的集合点为北门，通知对象为第 3 组。' },
  ...Array.from({ length: 18 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    content: `第 ${index + 1} 轮的背景讨论：${'常规状态更新 '.repeat(28)}。`,
  })),
  { role: 'user', content: '请保留集合点信息，并说明下一步。' },
];

function answerFromContext(context) {
  const text = context.map((message) => message.content).join('\n');
  return text.includes('集合点改为北门') && text.includes('第 3 组')
    ? '集合点是北门，应通知第 3 组。'
    : '缺少关键上下文。';
}

test('compressed context reduces prompt size while retaining factual-answer parity', () => {
  const compressed = buildPromptContext(history, { recentMessages: 3, summaryChars: 900 });
  const raw = history.map((message) => ({ role: message.role, content: message.content }));
  const expected = '集合点是北门，应通知第 3 组。';
  const rawAnswer = answerFromContext(raw);
  const compressedAnswer = answerFromContext(compressed.history);

  assert.ok(compressed.stats.compressionRate >= 0.45, `compression rate was ${compressed.stats.compressionRate}`);
  assert.equal(rawAnswer, expected);
  assert.equal(compressedAnswer, expected);
  assert.equal(compressed.memory.sourceMessageCount, history.length - 3);
});

test('recent turns remain verbatim and malformed turns are excluded', () => {
  const result = buildPromptContext([
    { role: 'user', content: '旧事实' },
    { role: 'tool', content: 'untrusted' },
    { role: 'assistant', content: '最新答复' },
    { role: 'user', content: '最新问题' },
  ], { recentMessages: 2, summaryChars: 120 });
  assert.deepEqual(result.history.slice(-2), [
    { role: 'assistant', content: '最新答复' },
    { role: 'user', content: '最新问题' },
  ]);
  assert.match(result.history[0].content, /旧事实/);
  assert.doesNotMatch(JSON.stringify(result.history), /untrusted/);
});
