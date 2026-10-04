declare module 'virtual:funroads-release' {
  export const BUILD_ID: string;
  export const CATALOGUES: Record<string, { file: string; integrity: string }>;
}
