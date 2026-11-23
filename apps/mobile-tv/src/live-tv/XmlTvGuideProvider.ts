import {
  pruneGuideProgrammes,
  type GuideChannel,
  type GuideProgramme,
  type GuideSnapshot,
} from '@moviestv/live-tv';
import {
  defaultHttpFetcher,
  type HttpFetcher,
} from '../addons/HttpJsonLoader';
import {
  DEFAULT_GUIDE_MAX_URL_LENGTH,
  fetchBoundedText,
} from './HttpTextLoader';

interface ParsedTag {
  kind: 'open' | 'close';
  name: string;
  selfClosing: boolean;
  attributes: Record<string, string>;
}

interface ChannelDraft {
  id: string | undefined;
  displayNames: string[];
  countryCode?: string;
}

interface ProgrammeDraft {
  channelId: string | undefined;
  start: string | undefined;
  stop: string | undefined;
  title?: string;
  subtitle?: string;
  description?: string;
}

interface Capture {
  field: 'display-name' | 'country' | 'title' | 'sub-title' | 'desc';
  depth: number;
  chunks: string[];
  length: number;
  overflow: boolean;
}

const MAX_CHANNEL_ID_LENGTH = 512;
const MAX_DISPLAY_NAME_LENGTH = 500;
const MAX_DISPLAY_NAMES_PER_CHANNEL = 20;
const MAX_PROGRAMME_TITLE_LENGTH = 500;
const MAX_PROGRAMME_SUBTITLE_LENGTH = 500;
const MAX_PROGRAMME_DESCRIPTION_LENGTH = 4_000;
const MAX_XMLTV_TIMESTAMP_LENGTH = 64;

function fieldLimit(field: Capture['field']): number {
  if (field === 'display-name') return MAX_DISPLAY_NAME_LENGTH;
  if (field === 'country') return 2;
  if (field === 'title') return MAX_PROGRAMME_TITLE_LENGTH;
  if (field === 'sub-title') return MAX_PROGRAMME_SUBTITLE_LENGTH;
  return MAX_PROGRAMME_DESCRIPTION_LENGTH;
}

function safeAttribute(
  value: string | undefined,
  maxLength: number,
): string | undefined {
  const normalized = value?.trim();
  return normalized
    && normalized.length <= maxLength
    && !/[\u0000-\u001f\u007f]/.test(normalized)
    ? normalized
    : undefined;
}

function normalizedGuideUrl(rawUrl: string): string {
  try {
    const input = rawUrl.trim();
    if (!input || input.length > DEFAULT_GUIDE_MAX_URL_LENGTH) {
      throw new Error('invalid');
    }
    const url = new URL(input);
    if (
      url.protocol !== 'https:'
      || Boolean(url.username)
      || Boolean(url.password)
    ) {
      throw new Error('invalid');
    }
    url.hash = '';
    if (url.href.length > DEFAULT_GUIDE_MAX_URL_LENGTH) {
      throw new Error('invalid');
    }
    return url.href;
  } catch {
    throw new Error('Guide URL must be HTTPS without embedded credentials');
  }
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function parseXmlTvTimestamp(value: string): number {
  const match = value.trim().match(
    /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-])(\d{2})(\d{2}))?$/,
  );
  if (!match) throw new Error('Invalid XMLTV timestamp');

  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    sign,
    offsetHourText,
    offsetMinuteText,
  ] = match;

  const year = Number(yearText);
  if (year < 1900 || year > 2200) throw new Error('Invalid XMLTV timestamp');
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);

  if (
    month < 1
    || month > 12
    || day < 1
    || day > daysInMonth(year, month)
    || hour > 23
    || minute > 59
    || second > 59
  ) {
    throw new Error('Invalid XMLTV timestamp');
  }

  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  let timestamp = date.getTime();

  if (sign && offsetHourText && offsetMinuteText) {
    const offsetHours = Number(offsetHourText);
    const offsetMinutes = Number(offsetMinuteText);
    if (offsetHours > 23 || offsetMinutes > 59) {
      throw new Error('Invalid XMLTV timestamp');
    }
    const offsetMs = (offsetHours * 60 + offsetMinutes) * 60 * 1000;
    timestamp += sign === '+' ? -offsetMs : offsetMs;
  }

  return timestamp;
}

function assertSafeXml(xml: string): void {
  if (
    /<!\s*DOCTYPE/i.test(xml)
    || /<!\s*ENTITY/i.test(xml)
  ) {
    throw new Error('Unsafe XMLTV document');
  }
}

function codePoint(value: string, radix: number): string {
  const point = Number.parseInt(value, radix);
  const validXmlCodePoint = point === 0x9
    || point === 0xa
    || point === 0xd
    || (point >= 0x20 && point <= 0xd7ff)
    || (point >= 0xe000 && point <= 0xfffd)
    || (point >= 0x10000 && point <= 0x10ffff);

  if (!Number.isInteger(point) || !validXmlCodePoint) {
    throw new Error('Malformed XMLTV');
  }
  return String.fromCodePoint(point);
}

function decodeXml(value: string): string {
  let output = '';

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    if (char !== '&') {
      output += char;
      continue;
    }

    const end = value.indexOf(';', index + 1);
    if (end < 0) throw new Error('Malformed XMLTV');

    const entity = value.slice(index + 1, end);
    if (entity === 'amp') output += '&';
    else if (entity === 'lt') output += '<';
    else if (entity === 'gt') output += '>';
    else if (entity === 'quot') output += '"';
    else if (entity === 'apos') output += "'";
    else if (/^#x[0-9a-fA-F]+$/.test(entity)) {
      output += codePoint(entity.slice(2), 16);
    } else if (/^#\d+$/.test(entity)) {
      output += codePoint(entity.slice(1), 10);
    } else {
      throw new Error('Malformed XMLTV');
    }

    index = end;
  }

  return output;
}

function parseAttributes(raw: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  let rest = raw.trim();

  while (rest) {
    const nameMatch = rest.match(/^([A-Za-z_:][\w:.-]*)\s*=\s*/);
    if (!nameMatch) throw new Error('Malformed XMLTV');

    const name = nameMatch[1]!;
    rest = rest.slice(nameMatch[0].length);
    const quote = rest[0];
    if (quote !== '"' && quote !== "'") throw new Error('Malformed XMLTV');

    const end = rest.indexOf(quote, 1);
    if (end < 0) throw new Error('Malformed XMLTV');

    if (Object.prototype.hasOwnProperty.call(attributes, name)) {
      throw new Error('Malformed XMLTV');
    }
    attributes[name] = decodeXml(rest.slice(1, end));
    rest = rest.slice(end + 1).trim();
  }

  return attributes;
}

function parseTag(raw: string): ParsedTag {
  const close = raw.match(/^<\/\s*([A-Za-z_:][\w:.-]*)\s*>$/);
  if (close) {
    return {
      kind: 'close',
      name: close[1]!,
      selfClosing: false,
      attributes: {},
    };
  }

  const open = raw.match(
    /^<\s*([A-Za-z_:][\w:.-]*)([\s\S]*?)\s*(\/?)>$/,
  );
  if (!open) throw new Error('Malformed XMLTV');

  return {
    kind: 'open',
    name: open[1]!,
    selfClosing: open[3] === '/',
    attributes: parseAttributes(open[2] ?? ''),
  };
}

function nextMarkupEnd(xml: string, start: number): number {
  let quote: '"' | "'" | null = null;
  for (let index = start; index < xml.length; index += 1) {
    const char = xml[index]!;
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '>') return index;
  }
  return -1;
}

function normalizeText(chunks: readonly string[]): string | undefined {
  const value = chunks.join('').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  return value || undefined;
}

function safeCountry(value: string | undefined): string | undefined {
  return value && /^[A-Za-z]{2}$/.test(value)
    ? value.toUpperCase()
    : undefined;
}

function captureField(
  name: string,
): Capture['field'] | null {
  if (
    name === 'display-name'
    || name === 'country'
    || name === 'title'
    || name === 'sub-title'
    || name === 'desc'
  ) return name;
  return null;
}

export function parseXmlTv(
  xml: string,
  fetchedAtMs: number,
  sourceRevision: number,
): GuideSnapshot {
  if (
    !Number.isFinite(fetchedAtMs)
    || fetchedAtMs < 0
    || !Number.isSafeInteger(sourceRevision)
    || sourceRevision <= 0
  ) {
    throw new Error('Invalid XMLTV snapshot metadata');
  }
  assertSafeXml(xml);

  const stack: string[] = [];
  const channels: GuideChannel[] = [];
  const programmes: GuideProgramme[] = [];
  const MAX_CHANNELS = 20_000;
  const MAX_PROGRAMMES = 250_000;
  const seenChannelIds = new Set<string>();
  let currentChannel: ChannelDraft | null = null;
  let currentProgramme: ProgrammeDraft | null = null;
  let capture: Capture | null = null;
  let rootSeen = false;
  let rootClosed = false;
  let index = 0;

  const appendCapturedText = (text: string, decode: boolean) => {
    if (!capture || capture.overflow) return;
    const chunk = decode ? decodeXml(text) : text;
    const nextLength = capture.length + chunk.length;
    if (nextLength > fieldLimit(capture.field)) {
      capture.overflow = true;
      capture.chunks = [];
      capture.length = nextLength;
      return;
    }
    capture.length = nextLength;
    capture.chunks.push(chunk);
  };

  const appendText = (text: string) => {
    if (capture) {
      appendCapturedText(text, true);
    } else if (!stack.length && text.trim()) {
      throw new Error('Malformed XMLTV');
    }
  };

  const finalizeCapture = (closingDepth: number, closingName: string) => {
    if (
      !capture
      || capture.depth !== closingDepth
      || capture.field !== closingName
    ) return;

    const value = capture.overflow
      ? undefined
      : normalizeText(capture.chunks);
    if (value) {
      if (currentChannel) {
        if (
          capture.field === 'display-name'
          && currentChannel.displayNames.length < MAX_DISPLAY_NAMES_PER_CHANNEL
        ) {
          currentChannel.displayNames.push(value);
        } else if (capture.field === 'country') {
          currentChannel.countryCode = safeCountry(value);
        }
      }

      if (currentProgramme) {
        if (capture.field === 'title') currentProgramme.title = value;
        else if (capture.field === 'sub-title') currentProgramme.subtitle = value;
        else if (capture.field === 'desc') currentProgramme.description = value;
      }
    }
    capture = null;
  };

  const finalizeChannel = () => {
    if (!currentChannel) return;
    const { id, displayNames, countryCode } = currentChannel;
    if (id && displayNames.length && !seenChannelIds.has(id)) {
      seenChannelIds.add(id);
      if (channels.length >= MAX_CHANNELS) throw new Error('XMLTV contains too many channels');
      channels.push({
        id,
        displayNames: [...new Set(displayNames)],
        ...(countryCode ? { countryCode } : {}),
      });
    }
    currentChannel = null;
  };

  const finalizeProgramme = () => {
    if (!currentProgramme) return;
    const {
      channelId,
      start,
      stop,
      title,
      subtitle,
      description,
    } = currentProgramme;
    currentProgramme = null;

    if (!channelId || !start || !stop || !title) return;

    let startAtMs: number;
    let endAtMs: number;
    try {
      startAtMs = parseXmlTvTimestamp(start);
      endAtMs = parseXmlTvTimestamp(stop);
    } catch {
      return;
    }
    if (endAtMs <= startAtMs) return;

    if (programmes.length >= MAX_PROGRAMMES) throw new Error('XMLTV contains too many programmes');
    programmes.push({
      channelId,
      title,
      ...(subtitle ? { subtitle } : {}),
      ...(description ? { description } : {}),
      startAtMs,
      endAtMs,
    });
  };

  while (index < xml.length) {
    const less = xml.indexOf('<', index);
    if (less < 0) {
      appendText(xml.slice(index));
      index = xml.length;
      break;
    }

    appendText(xml.slice(index, less));

    if (xml.startsWith('<!--', less)) {
      const end = xml.indexOf('-->', less + 4);
      if (end < 0) throw new Error('Malformed XMLTV');
      index = end + 3;
      continue;
    }

    if (xml.startsWith('<![CDATA[', less)) {
      const end = xml.indexOf(']]>', less + 9);
      if (end < 0) throw new Error('Malformed XMLTV');
      if (capture) {
        appendCapturedText(xml.slice(less + 9, end), false);
      }
      index = end + 3;
      continue;
    }

    if (xml.startsWith('<?', less)) {
      const end = xml.indexOf('?>', less + 2);
      if (end < 0) throw new Error('Malformed XMLTV');
      index = end + 2;
      continue;
    }

    if (xml.startsWith('<!', less)) {
      throw new Error('Malformed XMLTV');
    }

    const end = nextMarkupEnd(xml, less + 1);
    if (end < 0) throw new Error('Malformed XMLTV');

    const rawTag = xml.slice(less, end + 1);
    const tag = parseTag(rawTag);

    if (tag.kind === 'close') {
      if (!stack.length || stack[stack.length - 1] !== tag.name) {
        throw new Error('Malformed XMLTV');
      }

      const closingDepth = stack.length;
      finalizeCapture(closingDepth, tag.name);

      if (tag.name === 'channel') finalizeChannel();
      if (tag.name === 'programme') finalizeProgramme();

      stack.pop();
      if (tag.name === 'tv' && stack.length === 0) rootClosed = true;
      index = end + 1;
      continue;
    }

    if (!stack.length) {
      if (rootClosed || rootSeen || tag.name !== 'tv') {
        throw new Error('Malformed XMLTV');
      }
      rootSeen = true;
    }

    if (tag.name === 'channel') {
      if (currentChannel || currentProgramme) throw new Error('Malformed XMLTV');
      currentChannel = {
        id: safeAttribute(
          tag.attributes.id,
          MAX_CHANNEL_ID_LENGTH,
        ),
        displayNames: [],
      };
    } else if (tag.name === 'programme') {
      if (currentProgramme || currentChannel) throw new Error('Malformed XMLTV');
      currentProgramme = {
        channelId: safeAttribute(
          tag.attributes.channel,
          MAX_CHANNEL_ID_LENGTH,
        ),
        start: safeAttribute(
          tag.attributes.start,
          MAX_XMLTV_TIMESTAMP_LENGTH,
        ),
        stop: safeAttribute(
          tag.attributes.stop,
          MAX_XMLTV_TIMESTAMP_LENGTH,
        ),
      };
    }

    if (!tag.selfClosing) {
      stack.push(tag.name);
      const field = captureField(tag.name);
      if (field && !capture) {
        capture = {
          field,
          depth: stack.length,
          chunks: [],
          length: 0,
          overflow: false,
        };
      }
    } else {
      if (tag.name === 'channel') finalizeChannel();
      if (tag.name === 'programme') finalizeProgramme();
      if (tag.name === 'tv' && !stack.length) rootClosed = true;
    }

    index = end + 1;
  }

  if (stack.length || !rootSeen || !rootClosed) {
    throw new Error('Malformed XMLTV');
  }

  const validChannelIds = new Set(channels.map((channel) => channel.id));
  const validProgrammes = programmes.filter(
    (programme) => validChannelIds.has(programme.channelId),
  );
  const pruned = pruneGuideProgrammes(validProgrammes, fetchedAtMs);

  if (!channels.length || !pruned.length) {
    throw new Error('XMLTV contains no usable channels/programmes');
  }

  return {
    channels,
    programmes: pruned,
    fetchedAtMs,
    sourceRevision,
  };
}

export class XmlTvGuideProvider {
  constructor(
    private readonly fetcher: HttpFetcher = defaultHttpFetcher,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async load(rawUrl: string, sourceRevision: number): Promise<GuideSnapshot> {
    const url = normalizedGuideUrl(rawUrl);
    const xml = await fetchBoundedText(this.fetcher, url);
    return parseXmlTv(xml, this.now(), sourceRevision);
  }
}
