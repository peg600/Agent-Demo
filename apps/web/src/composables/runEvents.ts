import { runEventSchema, type RunEvent } from '@gard/contracts';

// Streaming responses can split both UTF-8 characters and SSE lines at arbitrary offsets.
export function createRunEventParser(runId: string, after = 0) {
  let pending = '';
  let cursor = after;
  return {
    get cursor() {
      return cursor;
    },
    push(chunk: string): RunEvent[] {
      pending += chunk;
      if (pending.length > 131072) throw new Error('Event stream frame too large');
      const events: RunEvent[] = [];
      while (true) {
        const separator = /\r?\n\r?\n/.exec(pending);
        if (!separator || separator.index === undefined) break;
        const frame = pending.slice(0, separator.index);
        pending = pending.slice(separator.index + separator[0].length);
        let eventName = '';
        let id = '';
        const data: string[] = [];
        for (const line of frame.split(/\r?\n/)) {
          if (line.startsWith(':')) continue;
          const split = line.indexOf(':');
          const field = split < 0 ? line : line.slice(0, split);
          const value = split < 0 ? '' : line.slice(split + 1).replace(/^ /, '');
          if (field === 'event') eventName = value;
          if (field === 'id') id = value;
          if (field === 'data') data.push(value);
        }
        if (eventName !== 'run-event') continue;
        const event = runEventSchema.parse(JSON.parse(data.join('\n')));
        if (event.runId !== runId || id !== String(event.seq))
          throw new Error('Unexpected event identity');
        if (event.seq <= cursor) continue;
        if (event.seq !== cursor + 1) throw new Error('Event sequence gap');
        cursor = event.seq;
        events.push(event);
      }
      return events;
    },
  };
}
