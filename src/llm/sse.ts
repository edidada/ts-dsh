import { TextDecoder } from 'node:util';

export interface SseFrame {
  data: string;
  event?: string;
  id?: string;
}

/** 把字节流增量解码成字符串；跨 chunk 的多字节 UTF-8 不会断字。 */
export async function* decodeBytes(source: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  for await (const chunk of source) {
    const text = decoder.decode(chunk, { stream: true });
    if (text) yield text;
  }
  const tail = decoder.decode();
  if (tail) yield tail;
}

function parseFrame(raw: string): SseFrame | null {
  let data = '';
  let event: string | undefined;
  let id: string | undefined;
  for (const line of raw.split('\n')) {
    if (line === '' || line.startsWith(':')) continue; // 注释行与空行
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') data += (data ? '\n' : '') + value;
    else if (field === 'event') event = value;
    else if (field === 'id') id = value;
  }
  if (data === '' && !event) return null;
  return { data, ...(event ? { event } : {}), ...(id ? { id } : {}) };
}

/**
 * SSE 帧解析：帧以空行分隔，统一 CRLF/CR 为 LF。
 * 支持跨 chunk 半包、多行 data、注释行、event/id 字段。
 * 流结束时若缓冲区残留一帧（没有结尾空行）也会产出。
 */
export async function* parseSSE(source: AsyncIterable<string>): AsyncGenerator<SseFrame> {
  let buffer = '';
  let carry = '';
  for await (const piece of source) {
    let text = carry + piece;
    carry = '';
    // 结尾的裸 \r 可能是被 chunk 切开的 CRLF，留到下一轮再判定
    if (text.endsWith('\r')) {
      carry = '\r';
      text = text.slice(0, -1);
    }
    buffer += text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    let separator = buffer.indexOf('\n\n');
    while (separator >= 0) {
      const raw = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      const frame = parseFrame(raw);
      if (frame) yield frame;
      separator = buffer.indexOf('\n\n');
    }
  }
  if (carry) buffer += '\n';
  const tail = parseFrame(buffer);
  if (tail) yield tail;
}
