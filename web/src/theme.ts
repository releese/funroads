import { createLightTheme, LightTheme } from 'baseui/themes';

// Open-licence Inter (bundled via @fontsource) replaces Base Web's default
// UberMove font stack, which is proprietary and must not be referenced.
export const TEXT_FONT = 'Inter, system-ui, "Helvetica Neue", Arial, sans-serif';

export const tokens = {
  ink: '#000000',
  body: '#5e5e5e',
  mute: '#afafaf',
  hairlineMid: '#4b4b4b',
  canvas: '#ffffff',
  canvasSoft: '#efefef',
  canvasSofter: '#f3f3f3',
  surfacePressed: '#e2e2e2',
  link: '#0000ee',
  radiusCard: '16px',
  radiusButton: '8px',
  radiusPill: '999px',
  space: { xxs: '4px', xs: '6px', sm: '8px', md: '12px', lg: '16px', xl: '20px', x2: '24px', x3: '32px' },
  railWidth: '392px',
  detailWidth: '420px',
  topBar: '56px',
} as const;

const typography = Object.fromEntries(
  Object.entries(LightTheme.typography).map(([k, v]) => [k, { ...(v as object), fontFamily: TEXT_FONT }]),
);

export const theme = createLightTheme({
  colors: {
    backgroundSecondary: tokens.canvasSoft,
    backgroundTertiary: tokens.canvasSofter,
    inputFill: tokens.canvasSoft,
    inputFillActive: tokens.canvasSofter,
    buttonSecondaryFill: tokens.canvasSoft,
    buttonSecondaryHover: tokens.surfacePressed,
    linkText: tokens.link,
    linkVisited: tokens.link,
  },
  typography,
  borders: {
    // DESIGN.md token: text inputs are square.
    inputBorderRadius: '0px',
    inputBorderRadiusMini: '0px',
    buttonBorderRadius: tokens.radiusButton,
    popoverBorderRadius: tokens.radiusCard,
    tagBorderRadius: tokens.radiusPill,
  },
} as never);

export const MQ = {
  mobile: '(max-width: 767.98px)',
  tablet: '(min-width: 768px) and (max-width: 1119.98px)',
  desktop: '(min-width: 1120px)',
  reducedMotion: '(prefers-reduced-motion: reduce)',
  coarsePointer: '(pointer: coarse)',
  narrowWorkspace: '(max-width: 1319.98px)',
  shortViewport: '(max-height: 500px)',
};
