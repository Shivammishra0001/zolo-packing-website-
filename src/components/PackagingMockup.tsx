import { memo } from "react";

type PackagingMockupProps = {
  type: "mailer" | "shipping" | "pizza" | "cosmetic" | "pouch" | "jar" | "tube" | "rigid" | "tuck" | "bag";
  color?: string;
  className?: string;
};

function BoxMailer({ color = "#c9a876" }: { color?: string }) {
  const shadow = color === "#000000" ? "#1a1a1a" : color === "#ffffff" ? "#d4d4d4" : shadeColor(color, -20);
  const lid = color === "#000000" ? "#262626" : color === "#ffffff" ? "#f0f0f0" : shadeColor(color, 15);
  return (
    <svg viewBox="0 0 400 300" className="w-full h-full">
      <defs>
        <linearGradient id={`g-${color.replace('#','')}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={lid} />
          <stop offset="100%" stopColor={shadow} />
        </linearGradient>
        <linearGradient id={`g2-${color.replace('#','')}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={color} />
          <stop offset="100%" stopColor={shadow} />
        </linearGradient>
      </defs>
      {/* Shadow under box */}
      <ellipse cx="200" cy="270" rx="150" ry="10" fill="rgba(0,0,0,0.08)" />
      {/* Back face */}
      <path d="M 60 80 L 200 40 L 340 80 L 340 220 L 200 260 L 60 220 Z" fill={`url(#g-${color.replace('#','')})`} />
      {/* Bottom face */}
      <path d="M 60 220 L 200 260 L 340 220 L 200 260 Z" fill={shadeColor(shadow, -15)} />
      {/* Right face */}
      <path d="M 200 100 L 340 80 L 340 220 L 200 260 Z" fill={shadeColor(color, -10)} />
      {/* Left face */}
      <path d="M 60 80 L 200 120 L 200 260 L 60 220 Z" fill={color} />
      {/* Front face */}
      <path d="M 60 80 L 200 120 L 340 80 L 340 220 L 200 260 L 60 220 Z" fill="none" stroke={shadeColor(shadow, -20)} strokeWidth="1" />
      {/* Lid */}
      <path d="M 60 80 L 200 40 L 340 80 L 200 120 Z" fill={lid} />
      {/* Logo strip */}
      <rect x="150" y="160" width="100" height="8" rx="2" fill="rgba(0,0,0,0.15)" />
      <rect x="165" y="180" width="70" height="4" rx="2" fill="rgba(0,0,0,0.1)" />
    </svg>
  );
}

function PouchMockup({ color = "#c9a876" }: { color?: string }) {
  return (
    <svg viewBox="0 0 300 400" className="w-full h-full">
      <defs>
        <linearGradient id={`pg-${color.replace('#','')}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={shadeColor(color, 15)} />
          <stop offset="50%" stopColor={color} />
          <stop offset="100%" stopColor={shadeColor(color, -20)} />
        </linearGradient>
      </defs>
      {/* Shadow */}
      <ellipse cx="150" cy="380" rx="110" ry="8" fill="rgba(0,0,0,0.08)" />
      {/* Body */}
      <path d="M 50 80 Q 50 70 60 70 L 240 70 Q 250 70 250 80 L 240 370 Q 240 380 230 380 L 70 380 Q 60 380 60 370 Z" fill={`url(#pg-${color.replace('#','')})`} />
      {/* Top seal */}
      <rect x="55" y="50" width="190" height="20" rx="3" fill={shadeColor(color, -25)} />
      {/* Tear notch */}
      <path d="M 145 50 L 150 55 L 155 50 Z" fill="#ff4444" />
      {/* Zipper line */}
      <line x1="70" y1="95" x2="230" y2="95" stroke={shadeColor(color, -30)} strokeWidth="2" />
      <line x1="70" y1="100" x2="230" y2="100" stroke={shadeColor(color, -30)} strokeWidth="1" strokeDasharray="2 2" />
      {/* Label */}
      <rect x="90" y="140" width="120" height="100" rx="4" fill="rgba(255,255,255,0.3)" />
      <rect x="110" y="160" width="80" height="6" rx="2" fill="rgba(0,0,0,0.2)" />
      <rect x="115" y="175" width="70" height="3" rx="1.5" fill="rgba(0,0,0,0.1)" />
      <rect x="120" y="185" width="60" height="3" rx="1.5" fill="rgba(0,0,0,0.1)" />
      <circle cx="150" cy="220" r="8" fill="rgba(0,0,0,0.15)" />
      {/* Shine */}
      <path d="M 80 110 Q 90 200 80 350" stroke="rgba(255,255,255,0.2)" strokeWidth="3" fill="none" />
    </svg>
  );
}

function PizzaBox({ color = "#c9a876" }: { color?: string }) {
  return (
    <svg viewBox="0 0 400 300" className="w-full h-full">
      <defs>
        <linearGradient id={`pb-${color.replace('#','')}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={shadeColor(color, 15)} />
          <stop offset="100%" stopColor={shadeColor(color, -15)} />
        </linearGradient>
      </defs>
      <ellipse cx="200" cy="270" rx="170" ry="10" fill="rgba(0,0,0,0.08)" />
      {/* Base */}
      <path d="M 40 120 L 200 170 L 360 120 L 360 260 L 200 310 L 40 260 Z" fill={`url(#pb-${color.replace('#','')})`} />
      {/* Lid (slightly open) */}
      <path d="M 40 120 L 200 170 L 360 120 L 360 80 L 200 130 L 40 80 Z" fill={shadeColor(color, 25)} />
      {/* Inside (visible because lid is open) */}
      <path d="M 40 120 L 200 170 L 360 120 L 360 80 L 200 130 L 40 80 Z" fill={shadeColor(color, 10)} opacity="0.4" />
      {/* Logo stamp */}
      <ellipse cx="200" cy="220" rx="35" ry="35" fill="rgba(0,0,0,0.12)" />
      <ellipse cx="200" cy="220" rx="25" ry="25" fill="none" stroke="rgba(0,0,0,0.15)" strokeWidth="2" />
    </svg>
  );
}

function CosmeticTube({ color = "#ffffff" }: { color?: string }) {
  const body = color === "#ffffff" ? "#f8f8f8" : color;
  const cap = "#1a1a1a";
  return (
    <svg viewBox="0 0 200 400" className="w-full h-full">
      <ellipse cx="100" cy="380" rx="70" ry="6" fill="rgba(0,0,0,0.08)" />
      {/* Body */}
      <rect x="40" y="60" width="120" height="280" rx="8" fill={body} />
      {/* Gradient overlay */}
      <rect x="40" y="60" width="120" height="280" rx="8" fill="url(#tube-grad)" opacity="0.5" />
      <defs>
        <linearGradient id="tube-grad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="rgba(0,0,0,0.1)" />
          <stop offset="50%" stopColor="rgba(255,255,255,0.3)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0.1)" />
        </linearGradient>
      </defs>
      {/* Cap */}
      <rect x="35" y="30" width="130" height="40" rx="6" fill={cap} />
      <rect x="45" y="70" width="110" height="4" rx="2" fill="rgba(0,0,0,0.15)" />
      {/* Label */}
      <rect x="55" y="130" width="90" height="120" rx="3" fill="rgba(255,255,255,0.7)" />
      <rect x="70" y="150" width="60" height="4" rx="2" fill="rgba(0,0,0,0.3)" />
      <rect x="75" y="162" width="50" height="2" rx="1" fill="rgba(0,0,0,0.15)" />
      <rect x="80" y="170" width="40" height="2" rx="1" fill="rgba(0,0,0,0.15)" />
      <circle cx="100" cy="220" r="12" fill="rgba(0,0,0,0.12)" />
      {/* Crimp */}
      <rect x="40" y="325" width="120" height="15" rx="2" fill="rgba(0,0,0,0.08)" />
    </svg>
  );
}

function GlassJar({ color = "#d4e8d4" }: { color?: string }) {
  return (
    <svg viewBox="0 0 200 300" className="w-full h-full">
      <ellipse cx="100" cy="280" rx="70" ry="6" fill="rgba(0,0,0,0.08)" />
      {/* Glass body */}
      <rect x="45" y="90" width="110" height="180" rx="8" fill="rgba(255,255,255,0.5)" />
      <rect x="45" y="90" width="110" height="180" rx="8" fill={color} opacity="0.4" />
      {/* Glass shine */}
      <rect x="55" y="95" width="8" height="165" rx="4" fill="rgba(255,255,255,0.6)" />
      {/* Neck */}
      <rect x="60" y="60" width="80" height="35" rx="4" fill="rgba(255,255,255,0.6)" />
      {/* Bamboo lid */}
      <ellipse cx="100" cy="60" rx="42" ry="8" fill="#8b6f47" />
      <rect x="58" y="45" width="84" height="15" rx="4" fill="#a88960" />
      {/* Label */}
      <rect x="65" y="130" width="70" height="90" rx="3" fill="rgba(255,255,255,0.9)" />
      <rect x="75" y="145" width="50" height="3" rx="1.5" fill="#0f172a" />
      <rect x="80" y="155" width="40" height="2" rx="1" fill="rgba(0,0,0,0.4)" />
      <rect x="85" y="163" width="30" height="2" rx="1" fill="rgba(0,0,0,0.3)" />
      <circle cx="100" cy="195" r="10" fill="#0f172a" />
    </svg>
  );
}

function RigidBox({ color = "#1a1a1a" }: { color?: string }) {
  return (
    <svg viewBox="0 0 400 300" className="w-full h-full">
      <ellipse cx="200" cy="270" rx="150" ry="10" fill="rgba(0,0,0,0.12)" />
      {/* Shadow side */}
      <path d="M 200 100 L 350 70 L 350 240 L 200 270 Z" fill={shadeColor(color, -20)} />
      {/* Front */}
      <path d="M 50 100 L 200 100 L 200 270 L 50 270 Z" fill={color} />
      {/* Top */}
      <path d="M 50 100 L 200 100 L 350 70 L 200 70 Z" fill={shadeColor(color, 25)} />
      {/* Foil stamping */}
      <rect x="100" y="170" width="60" height="4" rx="2" fill="#c9a876" />
      <rect x="100" y="182" width="40" height="2" rx="1" fill="#c9a876" />
      {/* Magnetic dot */}
      <circle cx="185" cy="180" r="3" fill="#c9a876" />
    </svg>
  );
}

function ShippingBox({ color = "#c9a876" }: { color?: string }) {
  return (
    <svg viewBox="0 0 400 300" className="w-full h-full">
      <ellipse cx="200" cy="270" rx="170" ry="10" fill="rgba(0,0,0,0.08)" />
      <path d="M 40 80 L 200 40 L 360 80 L 360 240 L 200 280 L 40 240 Z" fill={shadeColor(color, -15)} />
      <path d="M 40 80 L 200 120 L 200 280 L 40 240 Z" fill={color} />
      <path d="M 200 120 L 360 80 L 360 240 L 200 280 Z" fill={shadeColor(color, -25)} />
      {/* Flap lines */}
      <line x1="200" y1="40" x2="200" y2="120" stroke={shadeColor(color, -30)} strokeWidth="2" />
      <line x1="200" y1="120" x2="200" y2="280" stroke={shadeColor(color, -30)} strokeWidth="2" />
      {/* Tape */}
      <rect x="180" y="80" width="40" height="200" fill="#c9a876" opacity="0.7" />
      <rect x="180" y="80" width="40" height="200" fill="rgba(0,0,0,0.05)" />
    </svg>
  );
}

function TuckEndBox({ color = "#ffffff" }: { color?: string }) {
  const body = color === "#ffffff" ? "#f5f5f5" : color;
  return (
    <svg viewBox="0 0 400 300" className="w-full h-full">
      <ellipse cx="200" cy="270" rx="160" ry="10" fill="rgba(0,0,0,0.08)" />
      <path d="M 60 60 L 200 100 L 340 60 L 340 240 L 200 280 L 60 240 Z" fill={shadeColor(body, -15)} />
      <path d="M 60 60 L 200 100 L 200 280 L 60 240 Z" fill={body} />
      <path d="M 200 100 L 340 60 L 340 240 L 200 280 Z" fill={shadeColor(body, -30)} />
      {/* Tuck end details */}
      <rect x="190" y="60" width="20" height="40" fill={shadeColor(body, -20)} />
      {/* Logo */}
      <rect x="110" y="160" width="80" height="5" rx="2.5" fill="rgba(0,0,0,0.3)" />
      <rect x="125" y="172" width="50" height="3" rx="1.5" fill="rgba(0,0,0,0.15)" />
    </svg>
  );
}

function ShoppingBag({ color = "#1a1a1a" }: { color?: string }) {
  return (
    <svg viewBox="0 0 300 400" className="w-full h-full">
      <ellipse cx="150" cy="380" rx="110" ry="6" fill="rgba(0,0,0,0.1)" />
      {/* Body */}
      <rect x="40" y="100" width="220" height="280" rx="4" fill={color} />
      {/* Side panels (3D effect) */}
      <path d="M 40 100 L 20 110 L 20 370 L 40 380 Z" fill={shadeColor(color, -20)} />
      <path d="M 260 100 L 280 110 L 280 370 L 260 380 Z" fill={shadeColor(color, 15)} />
      {/* Top */}
      <path d="M 40 100 L 20 110 L 240 110 L 260 100 Z" fill={shadeColor(color, 20)} />
      {/* Handles */}
      <path d="M 90 100 Q 90 60 120 60 Q 150 60 150 100" fill="none" stroke="#a88960" strokeWidth="6" />
      <path d="M 150 100 Q 150 60 180 60 Q 210 60 210 100" fill="none" stroke="#a88960" strokeWidth="6" />
      {/* Logo */}
      <rect x="120" y="200" width="60" height="4" rx="2" fill="#a88960" />
      <rect x="130" y="212" width="40" height="2" rx="1" fill="#a88960" />
    </svg>
  );
}

function shadeColor(color: string, percent: number): string {
  let r = parseInt(color.slice(1, 3), 16);
  let g = parseInt(color.slice(3, 5), 16);
  let b = parseInt(color.slice(5, 7), 16);
  r = Math.max(0, Math.min(255, r + Math.round(255 * percent / 100)));
  g = Math.max(0, Math.min(255, g + Math.round(255 * percent / 100)));
  b = Math.max(0, Math.min(255, b + Math.round(255 * percent / 100)));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function PackagingMockup({ type, color = "#c9a876", className = "" }: PackagingMockupProps) {
  const components: Record<PackagingMockupProps["type"], React.ReactElement> = {
    mailer: <BoxMailer color={color} />,
    shipping: <ShippingBox color={color} />,
    pizza: <PizzaBox color={color} />,
    cosmetic: <TuckEndBox color={color} />,
    pouch: <PouchMockup color={color} />,
    jar: <GlassJar color={color} />,
    tube: <CosmeticTube color={color} />,
    rigid: <RigidBox color={color} />,
    tuck: <TuckEndBox color={color} />,
    bag: <ShoppingBag color={color} />,
  };
  return (
    <div className={className}>
      {components[type]}
    </div>
  );
}

export default memo(PackagingMockup);
export { PackagingMockup };
