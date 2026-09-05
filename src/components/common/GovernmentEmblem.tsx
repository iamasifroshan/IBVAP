import React from 'react';

export const GovernmentEmblem: React.FC<{ className?: string; size?: number; variant?: 'gold' | 'light' | 'dark' }> = ({
  className = '',
  size = 36,
  variant = 'light'
}) => {
  const fillColor = variant === 'gold' ? '#D4AF37' : variant === 'dark' ? '#0F2742' : '#FFFFFF';
  const strokeColor = variant === 'gold' ? '#B8860B' : variant === 'dark' ? '#1F3A5A' : 'rgba(255,255,255,0.7)';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Government Emblem of India"
    >
      {/* Central Pillar Capital & Base */}
      <rect x="24" y="68" width="52" height="6" rx="2" fill={fillColor} />
      <rect x="20" y="74" width="60" height="4" rx="1.5" fill={fillColor} fillOpacity="0.85" />
      <rect x="16" y="78" width="68" height="5" rx="2" fill={fillColor} />

      {/* Ashoka Chakra in Base */}
      <circle cx="50" cy="71" r="5" stroke={strokeColor} strokeWidth="1.2" fill="none" />
      <circle cx="50" cy="71" r="1.5" fill={fillColor} />
      {/* Chakra Spokes */}
      {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((deg) => (
        <line
          key={deg}
          x1="50"
          y1="71"
          x2={50 + 4.8 * Math.cos((deg * Math.PI) / 180)}
          y2={71 + 4.8 * Math.sin((deg * Math.PI) / 180)}
          stroke={strokeColor}
          strokeWidth="0.7"
        />
      ))}

      {/* Flanking Animals Silhouettes */}
      {/* Bull on left */}
      <ellipse cx="32" cy="71" rx="4" ry="2" fill={fillColor} fillOpacity="0.8" />
      {/* Galloping Horse on right */}
      <ellipse cx="68" cy="71" rx="4" ry="2" fill={fillColor} fillOpacity="0.8" />

      {/* Central Lion (Front Facing) */}
      <path
        d="M42 22 C42 16 46 12 50 12 C54 12 58 16 58 22 C58 28 56 34 56 40 L54 68 L46 68 L44 40 C44 34 42 28 42 22 Z"
        fill={fillColor}
      />
      {/* Lion Mane & Features */}
      <path
        d="M40 26 C36 26 34 32 36 38 C38 44 44 48 45 54 L48 68 L42 68 C38 58 34 50 34 40 C34 30 38 22 44 18 C47 21 49 24 50 24 C51 24 53 21 56 18 C62 22 66 30 66 40 C66 50 62 58 58 68 L52 68 L55 54 C56 48 62 44 64 38 C66 32 64 26 60 26"
        fill={fillColor}
        fillOpacity="0.95"
      />
      {/* Left Lion Profile */}
      <path
        d="M34 24 C28 26 24 32 26 38 C28 44 32 48 35 52 L36 68 L32 68 C28 60 24 52 23 42 C22 32 26 24 34 20 Z"
        fill={fillColor}
        fillOpacity="0.85"
      />
      {/* Right Lion Profile */}
      <path
        d="M66 24 C72 26 76 32 74 38 C72 44 68 48 65 52 L64 68 L68 68 C72 60 76 52 77 42 C78 32 74 24 66 20 Z"
        fill={fillColor}
        fillOpacity="0.85"
      />

      {/* Crowns / Tuft details */}
      <circle cx="50" cy="11" r="2.5" fill={fillColor} />
      <circle cx="34" cy="18" r="2" fill={fillColor} fillOpacity="0.9" />
      <circle cx="66" cy="18" r="2" fill={fillColor} fillOpacity="0.9" />

      {/* Bell Capital Base Text/Motto Representation: Satyameva Jayate line */}
      <path d="M26 88 L74 88" stroke={fillColor} strokeWidth="1.5" strokeLinecap="round" />
      <path d="M34 93 L66 93" stroke={fillColor} strokeWidth="1.2" strokeLinecap="round" strokeOpacity="0.75" />
    </svg>
  );
};
