import fs from 'node:fs';
import path from 'node:path';

export const DATA_FILES = ['routes.json', 'linked.json'];
export const COUNTRIES = JSON.parse(fs.readFileSync(new URL('./countries.json', import.meta.url), 'utf8'));

/** Explicit file allowlist, shared by development serving and build packaging. */
export function catalogueFiles(root) {
  return Object.entries(COUNTRIES).flatMap(([id, country]) => DATA_FILES.map((name) => ({
    country: id,
    file: `data/${id}/${name}`,
    source: path.join(root, country.inputDirectory, name),
    required: country.required,
  })));
}

export function publishedCatalogues(root) {
  const files = catalogueFiles(root);
  for (const id of Object.keys(COUNTRIES)) {
    const group = files.filter((entry) => entry.country === id);
    const existing = group.filter((entry) => fs.existsSync(entry.source));
    if ((group[0].required || existing.length) && existing.length !== group.length) {
      throw new Error(`Incomplete ${id} catalogue: both routes.json and linked.json are required`);
    }
  }
  const published = files.filter((entry) => fs.existsSync(entry.source));
  for (const { country, source } of published) {
    const { meta = {} } = JSON.parse(fs.readFileSync(source, 'utf8'));
    if (meta.country != null ? meta.country !== country : country !== 'nl') {
      throw new Error(`Catalogue country mismatch: ${source}`);
    }
    if (meta.schema_version != null ? meta.schema_version !== 1 : country !== 'nl') {
      throw new Error(`Unsupported or missing catalogue schema_version: ${source}`);
    }
  }
  return published;
}
