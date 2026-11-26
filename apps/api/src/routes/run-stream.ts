import type { FastifyReply } from 'fastify';
import { runEventSchema } from '@gard/contracts';
import type { WorkflowRepository } from '../agent/ports.js';

type Batch = Awaited<ReturnType<WorkflowRepository['events']>>;
// The caller authenticates the first batch before headers are sent. Every subsequent
// read revalidates the session, so an expired identity cannot keep reading forever.
export async function streamRunEvents(
  reply: FastifyReply,
  initial: Batch,
  cursor: number,
  read: (after: number) => Promise<Batch>,
  streams: Set<() => void>,
) {
  reply.hijack();
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  let closed = false;
  let wake: (() => void) | undefined;
  const close = () => {
    closed = true;
    wake?.();
    if (!reply.raw.writableEnded) reply.raw.end();
  };
  streams.add(close);
  reply.raw.once('close', close);
  let heartbeats = 0;
  async function write(value: string) {
    if (closed) return;
    if (reply.raw.write(value)) return;
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        reply.raw.off('drain', done);
        reply.raw.off('close', done);
        resolve();
      };
      const timer = setTimeout(() => {
        close();
        done();
      }, 15_000);
      reply.raw.once('drain', done);
      reply.raw.once('close', done);
    });
  }
  try {
    await write('retry: 2000\n\n');
    let batch = initial;
    while (!closed) {
      for (const raw of batch.data) {
        const event = runEventSchema.parse(raw);
        if (event.seq <= cursor) continue;
        await write(`id: ${event.seq}\nevent: run-event\ndata: ${JSON.stringify(event)}\n\n`);
        cursor = event.seq;
        if (closed) break;
      }
      if (
        !['queued', 'running'].includes(batch.run.status) &&
        cursor >= batch.run.lastEventSequence
      )
        break;
      if (cursor < batch.run.lastEventSequence) {
        batch = await read(cursor);
        continue;
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, 1000);
        function done() {
          clearTimeout(timer);
          wake = undefined;
          resolve();
        }
        wake = done;
      });
      if (closed) break;
      if (++heartbeats % 15 === 0) await write(': heartbeat\n\n');
      batch = await read(cursor);
    }
  } catch {
    // A reconnect rechecks auth before sending headers; never serialize raw errors.
  } finally {
    streams.delete(close);
    reply.raw.off('close', close);
    close();
  }
}
