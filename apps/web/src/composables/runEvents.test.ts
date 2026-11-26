import { describe, expect, it } from 'vitest';
import { createRunEventParser } from './runEvents.js';

const runId = '8fece395-e4ac-4428-9736-bda38e398597';
const eventId = '5a073b77-cc23-4dba-a497-4d3b65d0946f';
function frame(seq: number, message = '正在检索知识', id = runId) {
  return `id: ${seq}\nevent: run-event\ndata: ${JSON.stringify({ id: eventId, runId: id, seq, type: 'task.started', message, taskId: 'question-1', createdAt: '2026-11-27T00:00:00Z' })}\n\n`;
}

describe('durable workflow SSE parser', () => {
  it('accepts arbitrarily split CRLF frames and ignores heartbeats', () => {
    const parser = createRunEventParser(runId);
    const text = `: heartbeat\r\n\r\n${frame(1).replaceAll('\n', '\r\n')}`;
    const received = [];
    for (const char of text) received.push(...parser.push(char));
    expect(received).toHaveLength(1);
    expect(received[0]?.message).toBe('正在检索知识');
    expect(parser.cursor).toBe(1);
  });
  it('deduplicates replayed events after a reconnect without duplicating answer text', () => {
    const parser = createRunEventParser(runId, 2);
    expect(parser.push(frame(1) + frame(2) + frame(3)).map((event) => event.seq)).toEqual([3]);
    expect(parser.push(frame(3) + frame(4)).map((event) => event.seq)).toEqual([4]);
  });
  it('rejects gaps and foreign run identities instead of showing unrelated output', () => {
    expect(() => createRunEventParser(runId).push(frame(2))).toThrow('sequence gap');
    expect(() => createRunEventParser(runId).push(frame(1, 'other', eventId))).toThrow('identity');
    expect(() => createRunEventParser(runId).push(frame(1).replace('id: 1', 'id: 2'))).toThrow(
      'identity',
    );
  });
  it('does not advance the cursor for malformed data or unfinished frames', () => {
    const parser = createRunEventParser(runId);
    expect(parser.push(frame(1).slice(0, -1))).toEqual([]);
    expect(parser.cursor).toBe(0);
    expect(parser.push('\n')).toHaveLength(1);
    expect(() => parser.push('event: run-event\ndata: {}\n\n')).toThrow();
    expect(parser.cursor).toBe(1);
  });
  it('bounds an unterminated frame', () => {
    expect(() => createRunEventParser(runId).push('x'.repeat(131073))).toThrow('too large');
  });
});
