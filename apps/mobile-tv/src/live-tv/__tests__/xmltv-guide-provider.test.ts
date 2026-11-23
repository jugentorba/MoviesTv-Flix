import {
  parseXmlTv,
  parseXmlTvTimestamp,
  XmlTvGuideProvider,
} from '../XmlTvGuideProvider';

const FETCHED_AT = Date.UTC(2026, 8, 14, 18, 0, 0);

const VALID_XML = `<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <channel id="fr2.xmltv">
    <display-name>France 2</display-name>
  </channel>
  <programme
    channel="fr2.xmltv"
    start="20260914200000 +0200"
    stop="20260914204500 +0200"
  >
    <title>Journal</title>
    <sub-title>Edition du soir</sub-title>
    <desc>Actualités</desc>
  </programme>
  <programme
    channel="fr2.xmltv"
    start="20260914204500 +0200"
    stop="20260914220000 +0200"
  >
    <title>Film</title>
  </programme>
</tv>`;

describe('XMLTV guide provider', () => {
  test('parses positive and negative timezone offsets to UTC milliseconds', () => {
    expect(
      parseXmlTvTimestamp('20260914200000 +0200'),
    ).toBe(Date.UTC(2026, 8, 14, 18, 0, 0));

    expect(
      parseXmlTvTimestamp('20260914200000 -0400'),
    ).toBe(Date.UTC(2026, 8, 15, 0, 0, 0));
  });

  test('rejects impossible calendar timestamps instead of normalizing them', () => {
    expect(
      () => parseXmlTvTimestamp('20260230000000 +0000'),
    ).toThrow('Invalid XMLTV timestamp');

    expect(
      () => parseXmlTvTimestamp('20260431000000 +0000'),
    ).toThrow('Invalid XMLTV timestamp');
  });

  test('normalizes channels and programmes', () => {
    const snapshot = parseXmlTv(VALID_XML, FETCHED_AT, 7);

    expect(snapshot.sourceRevision).toBe(7);
    expect(snapshot.fetchedAtMs).toBe(FETCHED_AT);
    expect(snapshot.channels).toEqual([
      {
        id: 'fr2.xmltv',
        displayNames: ['France 2'],
      },
    ]);
    expect(snapshot.programmes).toEqual([
      {
        channelId: 'fr2.xmltv',
        title: 'Journal',
        subtitle: 'Edition du soir',
        description: 'Actualités',
        startAtMs: Date.UTC(2026, 8, 14, 18, 0, 0),
        endAtMs: Date.UTC(2026, 8, 14, 18, 45, 0),
      },
      {
        channelId: 'fr2.xmltv',
        title: 'Film',
        startAtMs: Date.UTC(2026, 8, 14, 18, 45, 0),
        endAtMs: Date.UTC(2026, 8, 14, 20, 0, 0),
      },
    ]);
  });

  test('supports XML entities, numeric references and CDATA text', () => {
    const xml = `<tv>
      <channel id="a&amp;b">
        <display-name><![CDATA[News & More]]></display-name>
        <country>FR</country>
      </channel>
      <programme
        channel="a&amp;b"
        start="20260914200000 +0200"
        stop="20260914210000 +0200"
      >
        <title>Rock &amp; Roll &#x2605;</title>
        <desc>Literal entity text: &amp;foo;</desc>
      </programme>
    </tv>`;

    const snapshot = parseXmlTv(xml, FETCHED_AT, 1);

    expect(snapshot.channels[0]).toEqual({
      id: 'a&b',
      displayNames: ['News & More'],
      countryCode: 'FR',
    });
    expect(snapshot.programmes[0]).toMatchObject({
      channelId: 'a&b',
      title: 'Rock & Roll ★',
      description: 'Literal entity text: &foo;',
    });
  });

  test('bounds XMLTV identity and display fields without discarding valid neighbours', () => {
    const xml = `<tv>
      <channel id="valid">
        <display-name>Valid Channel</display-name>
        <display-name>${'N'.repeat(501)}</display-name>
      </channel>
      <channel id="${'x'.repeat(513)}">
        <display-name>Oversized ID</display-name>
      </channel>
      <programme
        channel="valid"
        start="20260914200000 +0000"
        stop="20260914210000 +0000"
      >
        <title>Good programme</title>
        <sub-title>${'S'.repeat(501)}</sub-title>
        <desc>${'D'.repeat(4_001)}</desc>
      </programme>
      <programme
        channel="valid"
        start="20260914210000 +0000"
        stop="20260914220000 +0000"
      >
        <title>${'T'.repeat(501)}</title>
      </programme>
    </tv>`;

    const snapshot = parseXmlTv(xml, FETCHED_AT, 1);

    expect(snapshot.channels).toEqual([{
      id: 'valid',
      displayNames: ['Valid Channel'],
    }]);
    expect(snapshot.programmes).toEqual([
      expect.objectContaining({
        channelId: 'valid',
        title: 'Good programme',
      }),
    ]);
    expect(snapshot.programmes[0]).not.toHaveProperty('subtitle');
    expect(snapshot.programmes[0]).not.toHaveProperty('description');
  });

  test('bounds XMLTV capture incrementally across fragmented text', () => {
    const fragments = Array.from(
      { length: 600 },
      () => '<![CDATA[x]]>',
    ).join('');
    const xml = `<tv>
      <channel id="valid">
        <display-name>Valid Channel</display-name>
      </channel>
      <programme
        channel="valid"
        start="20260914200000 +0000"
        stop="20260914210000 +0000"
      >
        <title>${fragments}</title>
      </programme>
      <programme
        channel="valid"
        start="20260914210000 +0000"
        stop="20260914220000 +0000"
      >
        <title>Still usable</title>
      </programme>
    </tv>`;

    const snapshot = parseXmlTv(xml, FETCHED_AT, 1);

    expect(snapshot.programmes.map((item) => item.title))
      .toEqual(['Still usable']);
  });

  test('discards invalid and non-positive-duration programmes', () => {
    const xml = `<tv>
      <channel id="x"><display-name>X</display-name></channel>
      <programme
        channel="x"
        start="20260914200000 +0000"
        stop="20260914200000 +0000"
      ><title>Zero</title></programme>
      <programme
        channel="x"
        start="20260914210000 +0000"
        stop="20260914200000 +0000"
      ><title>Negative</title></programme>
      <programme
        channel="x"
        start="bad"
        stop="20260914210000 +0000"
      ><title>Invalid time</title></programme>
      <programme
        channel="x"
        start="20260914220000 +0000"
        stop="20260914223000 +0000"
      ><title>Good</title></programme>
    </tv>`;

    expect(
      parseXmlTv(xml, FETCHED_AT, 1).programmes.map((item) => item.title),
    ).toEqual(['Good']);
  });

  test('rejects unsafe DTD and entity declarations before parsing', () => {
    expect(
      () => parseXmlTv(
        '<!DOCTYPE tv [<!ENTITY x SYSTEM "file:///etc/passwd">]><tv/>',
        FETCHED_AT,
        1,
      ),
    ).toThrow('Unsafe XMLTV document');

    expect(
      () => parseXmlTv(
        '<tv><!ENTITY x "bad"></tv>',
        FETCHED_AT,
        1,
      ),
    ).toThrow('Unsafe XMLTV document');
  });

  test('rejects malformed nesting and invalid entity references', () => {
    expect(
      () => parseXmlTv(
        '<tv><channel id="x"><display-name>X</channel></display-name></tv>',
        FETCHED_AT,
        1,
      ),
    ).toThrow('Malformed XMLTV');

    expect(
      () => parseXmlTv(
        `<tv>
          <channel id="x"><display-name>X</display-name></channel>
          <programme
            channel="x"
            start="20260914200000 +0000"
            stop="20260914210000 +0000"
          ><title>A &unknown; B</title></programme>
        </tv>`,
        FETCHED_AT,
        1,
      ),
    ).toThrow('Malformed XMLTV');

    expect(
      () => parseXmlTv(
        `<tv>
          <channel id="x"><display-name>X</display-name></channel>
          <programme
            channel="x"
            start="20260914200000 +0000"
            stop="20260914210000 +0000"
          ><title>Bad control &#1;</title></programme>
        </tv>`,
        FETCHED_AT,
        1,
      ),
    ).toThrow('Malformed XMLTV');
  });

  test('rejects feeds with no usable schedule data', () => {
    expect(
      () => parseXmlTv('<tv></tv>', FETCHED_AT, 1),
    ).toThrow('XMLTV contains no usable channels/programmes');
  });

  test('loads through bounded text fetch and preserves source revision', async () => {
    const fetcher = jest.fn(async (_url: string) => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => VALID_XML,
    }));
    const provider = new XmlTvGuideProvider(fetcher as any, () => FETCHED_AT);

    const snapshot = await provider.load(
      'https://guide.example/epg.xml#not-sent',
      9,
    );

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://guide.example/epg.xml');
    expect(snapshot.sourceRevision).toBe(9);
    expect(snapshot.programmes[0]?.title).toBe('Journal');
  });

  test('rejects non-HTTPS and credential-bearing guide URLs before fetch', async () => {
    const fetcher = jest.fn();
    const provider = new XmlTvGuideProvider(fetcher as any, () => FETCHED_AT);

    await expect(
      provider.load('http://guide.example/epg.xml', 1),
    ).rejects.toThrow('Guide URL must be HTTPS without embedded credentials');

    await expect(
      provider.load('https://user:pass@guide.example/epg.xml', 1),
    ).rejects.toThrow('Guide URL must be HTTPS without embedded credentials');

    await expect(
      provider.load(
        `https://guide.example/epg.xml?token=${'x'.repeat(5_000)}`,
        1,
      ),
    ).rejects.toThrow('Guide URL');

    expect(fetcher).not.toHaveBeenCalled();
  });
});


test('rejects invalid XMLTV snapshot metadata', () => {
  const xml = '<tv><channel id="x"><display-name>X</display-name></channel><programme channel="x" start="20260921100000 +0000" stop="20260921110000 +0000"><title>Show</title></programme></tv>';
  expect(() => parseXmlTv(xml, Number.NaN, 1)).toThrow('snapshot metadata');
  expect(() => parseXmlTv(xml, 1, 0)).toThrow('snapshot metadata');
  expect(
    () => parseXmlTv(xml, 1, Number.MAX_SAFE_INTEGER + 1),
  ).toThrow('snapshot metadata');
});
