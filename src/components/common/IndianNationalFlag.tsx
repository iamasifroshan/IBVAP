import React from 'react';

interface IndianNationalFlagProps {
  width?: number;
  height?: number;
  className?: string;
}

/**
 * Official Indian National Flag (Tiranga) SVG Component
 * - Standard 3:2 aspect ratio
 * - Saffron (#FF9933), White (#FFFFFF), India Green (#138808)
 * - Centered 24-spoke Ashoka Chakra in Navy Blue (#000080)
 */
export const IndianNationalFlag: React.FC<IndianNationalFlagProps> = ({
  width = 44,
  height = 29,
  className = ''
}) => {
  // 24 spokes at 15-degree intervals radiating from center (45, 30)
  const spokes = Array.from({ length: 24 }, (_, i) => {
    const angle = (i * 15 * Math.PI) / 180;
    const x1 = 45 + 2.8 * Math.cos(angle);
    const y1 = 30 + 2.8 * Math.sin(angle);
    const x2 = 45 + 8.8 * Math.cos(angle);
    const y2 = 30 + 8.8 * Math.sin(angle);
    return (
      <line
        key={i}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke="#000080"
        strokeWidth="0.85"
        strokeLinecap="round"
      />
    );
  });

  return (
    <div
      className={`inline-block rounded-xs overflow-hidden border border-white/30 shadow-md shrink-0 select-none ${className}`}
      style={{ width, height }}
      title="National Flag of India (Tiranga)"
      aria-label="National Flag of India"
    >
      <svg
        viewBox="0 0 90 60"
        width={width}
        height={height}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full block"
      >
        {/* Top Band: Saffron (Kesari) */}
        <rect width="90" height="20" fill="#FF9933" />

        {/* Middle Band: White */}
        <rect y="20" width="90" height="20" fill="#FFFFFF" />

        {/* Bottom Band: India Green */}
        <rect y="40" width="90" height="20" fill="#138808" />

        {/* Ashoka Chakra: Centered at (45, 30) */}
        {/* Outer Circular Rim */}
        <circle cx="45" cy="30" r="9.0" stroke="#000080" strokeWidth="1.2" fill="none" />

        {/* 24 Radial Spokes */}
        {spokes}

        {/* Central Hub */}
        <circle cx="45" cy="30" r="2.8" fill="#000080" />
        <circle cx="45" cy="30" r="1.1" fill="#FFFFFF" />
      </svg>
    </div>
  );
};
