import { createContext, ReactNode, useContext, useMemo } from 'react';
import { getAppearancePalette, theme } from './theme';
import { AppearanceSettings } from './types';

type BrandColors = typeof theme.colors;

const BrandThemeContext = createContext<BrandColors>(theme.colors);

function withAlpha(hex: string, alpha: string) {
  return `${hex}${alpha}`;
}

export function BrandThemeProvider({ appearance, children }: { appearance?: Partial<AppearanceSettings>; children: ReactNode }) {
  const colors = useMemo(() => {
    const palette = getAppearancePalette(appearance);
    return {
      ...theme.colors,
      background: palette.background,
      surfaceMuted: withAlpha(palette.primary, '12'),
      line: withAlpha(palette.primary, '26'),
      primary: palette.primary,
      primaryDark: palette.primaryDark,
      accent: palette.accent,
      info: palette.primary,
    };
  }, [appearance?.preset]);

  return <BrandThemeContext.Provider value={colors}>{children}</BrandThemeContext.Provider>;
}

export function useBrandColors() {
  return useContext(BrandThemeContext);
}
