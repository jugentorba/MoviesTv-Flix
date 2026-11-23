export const PLAYBACK_RESOURCE_KEYS = [
  'playback.play',
  'playback.findingSources',
  'playback.noSources',
  'playback.failed',
  'playback.providersUnavailable',
  'playback.close',
  'playback.changeSource',
  'playback.sources',
  'playback.selected',
  'playback.download',
  'playback.subtitles',
  'playback.off',
  'playback.subtitleFailed',
  'playback.audio',
  'playback.nextEpisode',
  'playback.manageProviders',
  'playback.embeddedSubtitles',
  'playback.addonSubtitles',
  'playback.fullscreen',
] as const;

const english = [
  'Play',
  'Finding sources…',
  'No playback sources found',
  'Playback failed',
  'Playback providers are unavailable',
  'Close',
  'Change source',
  'Sources',
  'Selected',
  'Download',
  'Subtitles',
  'Off',
  'Could not load subtitles',
  'Audio',
  'Next episode',
  'Open providers',
  'Embedded subtitles',
  'Add-on subtitles',
  'Fullscreen',
] as const;

const playLabels: Record<string, string> = {
  en: 'Play', sq: 'Luaj', fr: 'Lire', de: 'Abspielen', it: 'Riproduci', es: 'Reproducir',
  'pt-BR': 'Reproduzir', 'pt-PT': 'Reproduzir', tr: 'Oynat', nl: 'Afspelen', pl: 'Odtwórz',
  ro: 'Redă', cs: 'Přehrát', sk: 'Prehrať', hu: 'Lejátszás', sv: 'Spela', da: 'Afspil',
  fi: 'Toista', no: 'Spill av', el: 'Αναπαραγωγή', bg: 'Възпроизвеждане', hr: 'Reproduciraj',
  bs: 'Reproduciraj', 'sr-Latn': 'Pusti', sl: 'Predvajaj', mk: 'Пушти', ru: 'Воспроизвести',
  uk: 'Відтворити', ar: 'تشغيل', he: 'נגן', fa: 'پخش', hi: 'चलाएँ', bn: 'চালান', ur: 'چلائیں',
  id: 'Putar', ms: 'Main', vi: 'Phát', th: 'เล่น', 'zh-Hans': '播放', 'zh-Hant': '播放',
  ja: '再生', ko: '재생',
};

const priorityPacks: Record<string, readonly string[]> = {
  en: english,
  sq: ['Luaj', 'Duke kërkuar burime…', 'Nuk u gjetën burime riprodhimi', 'Riprodhimi dështoi', 'Burimet e riprodhimit nuk janë të disponueshme', 'Mbyll', 'Ndrysho burimin', 'Burimet', 'Zgjedhur', 'Shkarko', 'Titrat', 'Fikur', 'Titrat nuk u ngarkuan', 'Audio', 'Episodi tjetër', 'Hap burimet', 'Titrat e videos', 'Titrat nga shtesat', 'Ekran i plotë'],
  fr: ['Lire', 'Recherche de sources…', 'Aucune source de lecture trouvée', 'Échec de la lecture', 'Les sources de lecture sont indisponibles', 'Fermer', 'Changer de source', 'Sources', 'Sélectionné', 'Télécharger', 'Sous-titres', 'Désactivés', 'Impossible de charger les sous-titres', 'Audio', 'Épisode suivant', 'Ouvrir les sources', 'Sous-titres intégrés', 'Sous-titres des extensions', 'Plein écran'],
  de: ['Abspielen', 'Quellen werden gesucht…', 'Keine Wiedergabequellen gefunden', 'Wiedergabe fehlgeschlagen', 'Wiedergabeanbieter sind nicht verfügbar', 'Schließen', 'Quelle wechseln', 'Quellen', 'Ausgewählt', 'Herunterladen', 'Untertitel', 'Aus', 'Untertitel konnten nicht geladen werden', 'Audio', 'Nächste Folge', 'Quellen öffnen', 'Eingebettete Untertitel', 'Add-on-Untertitel', 'Vollbild'],
};

export const PLAYBACK_PACKS: Record<string, readonly string[]> = Object.fromEntries(
  Object.entries(playLabels).map(([locale, play]) => [
    locale,
    priorityPacks[locale] ?? [play, ...english.slice(1)],
  ]),
);
