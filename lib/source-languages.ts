export const SOURCE_LANGUAGES = ["ru", "nl"] as const;

export type SourceLanguage = (typeof SOURCE_LANGUAGES)[number];

export const SOURCE_LANGUAGE_NAMES: Record<SourceLanguage, string> = {
  ru: "Russian",
  nl: "Dutch",
};
