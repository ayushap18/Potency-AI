/**
 * CursorGrid.tsx — Chase AI-inspired cursor-tracking background
 * 
 * Renders a dense grid pattern (matching newgrid_2.1 / 2.2 reference images)
 * with a tight radial-gradient spotlight that follows the cursor.
 * The grid is barely visible by default and sharply illuminated only near the cursor.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useTheme } from '../context/ThemeContext';

export function CursorGrid() {
  const { mode, backgroundStyle } = useTheme();
  const spotlightRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const mouseRef = useRef({ x: -9999, y: -9999 });

  const updateSpotlight = useCallback(() => {
    if (spotlightRef.current) {
      const { x, y } = mouseRef.current;
      // Tight, sharp spotlight — 180px hard circle, fading from 180-240px
      spotlightRef.current.style.maskImage =
        `radial-gradient(200px circle at ${x}px ${y}px, black 0%, black 60%, transparent 100%)`;
      spotlightRef.current.style.webkitMaskImage =
        `radial-gradient(200px circle at ${x}px ${y}px, black 0%, black 60%, transparent 100%)`;
    }
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY };
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(updateSpotlight);
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      cancelAnimationFrame(rafRef.current);
    };
  }, [updateSpotlight]);

  if (backgroundStyle === 'none') {
    return (
      <div
        className="cursor-grid-container"
        style={{ background: 'var(--bg-primary)' }}
      />
    );
  }

  // Dense grid matching the newgrid reference images (tighter spacing)
  const gridSize = 28;
  const isDark = mode === 'dark';

  // Grid line colors — matching the reference images
  const gridLineColor = isDark
    ? 'rgba(255, 255, 255, 0.18)'
    : 'rgba(0, 0, 0, 0.15)';

  const spotlightGridColor = isDark
    ? 'rgba(255, 255, 255, 0.55)'
    : 'rgba(0, 0, 0, 0.45)';

  return (
    <div className="cursor-grid-container">
      {/* Base background color */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'var(--bg-primary)',
        }}
      />

      {/* Always-visible faint grid — nearly invisible, just barely perceptible */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          opacity: isDark ? 0.25 : 0.3,
          backgroundImage: `
            linear-gradient(${gridLineColor} 1px, transparent 1px),
            linear-gradient(90deg, ${gridLineColor} 1px, transparent 1px)
          `,
          backgroundSize: `${gridSize}px ${gridSize}px`,
        }}
      />

      {/* Bright spotlight grid layer — follows cursor, sharp edge */}
      <div
        ref={spotlightRef}
        style={{
          position: 'absolute',
          inset: 0,
          opacity: isDark ? 0.85 : 0.75,
          backgroundImage: `
            linear-gradient(${spotlightGridColor} 1px, transparent 1px),
            linear-gradient(90deg, ${spotlightGridColor} 1px, transparent 1px)
          `,
          backgroundSize: `${gridSize}px ${gridSize}px`,
          maskImage: 'radial-gradient(200px circle at -9999px -9999px, black 0%, black 60%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(200px circle at -9999px -9999px, black 0%, black 60%, transparent 100%)',
          transition: 'none',
          willChange: 'mask-image, -webkit-mask-image',
        }}
      />
    </div>
  );
}
