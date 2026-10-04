export interface CatalogueFile {
  country: string;
  file: string;
  source: string;
  required: boolean;
}
export const DATA_FILES: string[];
export const COUNTRIES: Record<string, { inputDirectory: string; required: boolean }>;
export function catalogueFiles(root: string): CatalogueFile[];
export function publishedCatalogues(root: string): CatalogueFile[];
