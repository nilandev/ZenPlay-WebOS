import type { ReactNode } from "react";

/**
 * Shared animated dark-charcoal + color-wash backdrop used across the
 * profile-related screens (Home, Manage Profiles) so they read as one
 * consistent app rather than each screen inventing its own background.
 * Extracted from HomeScreen's original inline version — see its history
 * for the design rationale (dark charcoal base, subtle drifting color
 * wash rather than a busy image, so on-screen glow effects stay the focal
 * point).
 */
export function MeshBackground({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div
      style={{
        minHeight: "100vh",
        position: "relative",
        backgroundColor: "#08090b",
        backgroundImage:
          "radial-gradient(ellipse 1100px 900px at 30% 30%, rgba(59,90,220,0.22), transparent 60%), " +
          "radial-gradient(ellipse 1000px 850px at 70% 30%, rgba(130,60,200,0.18), transparent 60%), " +
          "radial-gradient(ellipse 1050px 900px at 50% 80%, rgba(20,140,140,0.18), transparent 60%)",
        backgroundSize: "180% 180%, 180% 180%, 180% 180%",
        backgroundRepeat: "no-repeat",
        animation: "mesh-background-drift 26s ease-in-out infinite",
      }}
    >
      <style>{`
        @keyframes mesh-background-drift {
          0%   { background-position: 0% 0%, 100% 0%, 50% 100%; }
          50%  { background-position: 30% 40%, 70% 30%, 40% 70%; }
          100% { background-position: 0% 0%, 100% 0%, 50% 100%; }
        }
      `}</style>
      {children}
    </div>
  );
}
