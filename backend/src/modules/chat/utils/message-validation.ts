import { BadRequestException } from '@nestjs/common';

const CONTROL_CHARS_REGEX = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

interface ValidationOptions {
  maxGraphemes?: number;
  maxBytes?: number;
}

function splitGraphemes(value: string): string[] {
  const maybeSegmenter = (Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: 'grapheme' }) => { segment: (input: string) => Iterable<{ segment: string }> } }).Segmenter;

  if (maybeSegmenter) {
    const segmenter = new maybeSegmenter(undefined, { granularity: 'grapheme' });
    return Array.from(segmenter.segment(value), (entry) => entry.segment);
  }

  return Array.from(value);
}

export function validateAndSanitizeChatContent(raw: string, options: ValidationOptions = {}): string {
  const maxGraphemes = options.maxGraphemes ?? 500;
  const maxBytes = options.maxBytes ?? 2_000;

  const sanitized = raw
    .replace(/\r\n/g, '\n')
    .replace(CONTROL_CHARS_REGEX, '')
    .trim();

  if (!sanitized) {
    throw new BadRequestException('Message cannot be empty');
  }

  const graphemeCount = splitGraphemes(sanitized).length;
  if (graphemeCount > maxGraphemes) {
    throw new BadRequestException(`Message exceeds max length of ${maxGraphemes} characters`);
  }

  const byteLength = Buffer.byteLength(sanitized, 'utf8');
  if (byteLength > maxBytes) {
    throw new BadRequestException(`Message exceeds max payload of ${maxBytes} bytes`);
  }

  return sanitized;
}
