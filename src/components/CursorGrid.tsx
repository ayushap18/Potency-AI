/**
 * CursorGrid.tsx — Chase AI-inspired cursor-tracking background
 * 
 * Renders a fixed grid pattern with a radial-gradient spotlight
 * that follows the cursor. Uses CSS mask-image for the effect.
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
      spotlightRef.current.style.maskImage = 
        `radial-gradient(280px circle at ${x}px ${y}px, black, transparent)`;
      spotlightRef.current.style.webkitMaskImage = 
        `radial-gradient(280px circle at ${x}px ${y}px, black, transparent)`;
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

  const gridSize = 60;
  const isDark = mode === 'dark';

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

      {/* Subtle base grid (always visible) */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          opacity: isDark ? 0.4 : 0.5,
          backgroundImage: `
            linear-gradient(var(--grid-color) 1px, transparent 1px),
            linear-gradient(90deg, var(--grid-color) 1px, transparent 1px)
          `,
          backgroundSize: `${gridSize}px ${gridSize}px`,
        }}
      />

      {/* Cross marks at intersections (subtle) */}
      <svg
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          opacity: isDark ? 0.25 : 0.3,
        }}
      >
        <defs>
          <pattern
            id="cross-pattern"
            width={gridSize}
            height={gridSize}
            patternUnits="userSpaceOnUse"
          >
            {/* Horizontal dash */}
            <line
              x1={gridSize / 2 - 4} y1={gridSize / 2}
              x2={gridSize / 2 + 4} y2={gridSize / 2}
              stroke={isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)'}
              strokeWidth="0.8"
            />
            {/* Vertical dash */}
            <line
              x1={gridSize / 2} y1={gridSize / 2 - 4}
              x2={gridSize / 2} y2={gridSize / 2 + 4}
              stroke={isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)'}
              strokeWidth="0.8"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#cross-pattern)" />
      </svg>

      {/* Bright spotlight layer — follows cursor */}
      <div
        ref={spotlightRef}
        style={{
          position: 'absolute',
          inset: 0,
          opacity: isDark ? 0.6 : 0.45,
          backgroundImage: `
            linear-gradient(var(--grid-dot) 1px, transparent 1px),
            linear-gradient(90deg, var(--grid-dot) 1px, transparent 1px)
          `,
          backgroundSize: `${gridSize}px ${gridSize}px`,
          maskImage: 'radial-gradient(280px circle at -9999px -9999px, black, transparent)',
          WebkitMaskImage: 'radial-gradient(280px circle at -9999px -9999px, black, transparent)',
          transition: 'none',
          willChange: 'mask-image, -webkit-mask-image',
        }}
      />

      {/* Spotlight cross marks — follows cursor */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          maskImage: spotlightRef.current?.style.maskImage || 'radial-gradient(280px circle at -9999px -9999px, black, transparent)',
          WebkitMaskImage: spotlightRef.current?.style.webkitMaskImage || 'radial-gradient(280px circle at -9999px -9999px, black, transparent)',
        }}
      >
        <svg
          style={{
            width: '100%',
            height: '100%',
            opacity: isDark ? 0.5 : 0.4,
          }}
        >
          <use href="#cross-pattern" />
          <rect width="100%" height="100%" fill="url(#cross-pattern)" />
        </svg>
      </div>

      {/* Ambient glow blobs */}
      <div
        style={{
          position: 'absolute',
          top: '-10%',
          right: '-5%',
          width: '35%',
          height: '35%',
          borderRadius: '50%',
          background: isDark
            ? 'radial-gradient(ellipse, rgba(255,255,255,0.02) 0%, transparent 70%)'
            : 'radial-gradient(ellipse, rgba(0,0,0,0.02) 0%, transparent 70%)',
          filter: 'blur(60px)',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: '-10%',
          left: '-5%',
          width: '30%',
          height: '30%',
          borderRadius: '50%',
          background: isDark
            ? 'radial-gradient(ellipse, rgba(255,255,255,0.015) 0%, transparent 70%)'
            : 'radial-gradient(ellipse, rgba(0,0,0,0.015) 0%, transparent 70%)',
          filter: 'blur(60px)',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}
