import { LANGUAGE_DEFINITIONS } from './language-data';

const INFERRED_MEDIA_LANGUAGE_TAGS = [
  'en',
  'fr',
  'de',
  'sq',
] as const;

const RELEASE_LANGUAGE_ALIASES: Partial<Record<
  typeof INFERRED_MEDIA_LANGUAGE_TAGS[number],
  readonly string[]
>> = {
  fr: ['truefrench', 'vff', 'vfq', 'vf2'],
};

function escapeRegex(value: string): string {
  return value.replace(
    /[.*+?^$()|[\]\\{}]/g,
    (character) => '\\' + character,
  );
}

function mediaAliases(
  tag: typeof INFERRED_MEDIA_LANGUAGE_TAGS[number],
): string[] {
  const definition = LANGUAGE_DEFINITIONS.find(
    (language) => language.canonicalTag === tag,
  );
  if (!definition) return [];

  return [
    ...definition.aliases.filter((alias) => alias.length >= 3),
    ...(definition.nativeName ? [definition.nativeName] : []),
    ...(RELEASE_LANGUAGE_ALIASES[tag] ?? []),
  ];
}

export function inferMediaLanguages(label: string): string[] {
  const languages: string[] = [];

  for (const tag of INFERRED_MEDIA_LANGUAGE_TAGS) {
    const detected = mediaAliases(tag).some((alias) => (
      new RegExp(
        `(?:^|[^A-Za-z0-9])${escapeRegex(alias)}(?:$|[^A-Za-z0-9])`,
        'i',
      ).test(label)
    ));
    if (detected) languages.push(tag);
  }

  return languages;
}
