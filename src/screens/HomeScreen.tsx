import { useEffect } from "react";
import { Clapperboard, Heart, History as HistoryIcon, ListVideo, RadioTower, Settings as SettingsIcon, Tv, type LucideIcon } from "lucide-react";
import type { PlatformId, Profile } from "@core";
import { Clock, Focusable, ProfileSwitcher, useFocusStore, useRemoteInput } from "@ui";
import type { FocusNode } from "@ui";

export interface HomeTile {
  id: string;
  label: string;
  icon: LucideIcon;
}

const PRIMARY_TILES: HomeTile[] = [
  { id: "live", label: "Live", icon: RadioTower },
  { id: "movies", label: "Movies", icon: Clapperboard },
  { id: "series", label: "Series", icon: Tv },
];

const SECONDARY_TILES: HomeTile[] = [
  { id: "guide", label: "Guide", icon: ListVideo },
  { id: "favourites", label: "My Favourite", icon: Heart },
  { id: "history", label: "History", icon: HistoryIcon },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

const SCOPE = "home-grid";

/**
 * Home hub shown after profile selection: a Netflix/Apple-TV-style launcher
 * rather than jumping straight into a content tab. Two uneven rows (3 big
 * primary tiles, 4 smaller secondary ones) don't fit the uniform-column
 * assumption of buildGridFocusGraph, so up/down neighbors are mapped by
 * proportional index instead of a shared column count.
 */
function buildHomeFocusGraph(): FocusNode[] {
  const primaryIds = PRIMARY_TILES.map((t) => t.id);
  const secondaryIds = SECONDARY_TILES.map((t) => t.id);

  const primaryNodes: FocusNode[] = primaryIds.map((id, index) => ({
    id,
    neighbors: {
      left: index > 0 ? primaryIds[index - 1] : undefined,
      right: index < primaryIds.length - 1 ? primaryIds[index + 1] : undefined,
      down: secondaryIds[Math.min(index, secondaryIds.length - 1)],
    },
  }));

  const secondaryNodes: FocusNode[] = secondaryIds.map((id, index) => ({
    id,
    neighbors: {
      left: index > 0 ? secondaryIds[index - 1] : undefined,
      right: index < secondaryIds.length - 1 ? secondaryIds[index + 1] : undefined,
      up: primaryIds[Math.min(index, primaryIds.length - 1)],
    },
  }));

  return [...primaryNodes, ...secondaryNodes];
}

export interface HomeScreenProps {
  platform: PlatformId;
  profile: Profile;
  profiles: Profile[];
  onSelectTile: (tileId: string) => void;
  onSelectProfile: (profile: Profile) => void;
  onManageProfiles: () => void;
}

export function HomeScreen({ platform, profile, profiles, onSelectTile, onSelectProfile, onManageProfiles }: HomeScreenProps): JSX.Element {
  const setGraph = useFocusStore((state) => state.setGraph);
  const clearGraph = useFocusStore((state) => state.clearGraph);

  useEffect(() => {
    setGraph(SCOPE, buildHomeFocusGraph(), PRIMARY_TILES[0].id);
    return () => clearGraph(SCOPE);
  }, [setGraph, clearGraph]);

  useRemoteInput(platform, {
    onSelect: (focusedId) => {
      if (focusedId) onSelectTile(focusedId);
    },
  });

  return (
    <div
      style={{
        minHeight: "100vh",
        padding: "40px 64px 64px",
        display: "flex",
        flexDirection: "column",
        gap: 40,
        position: "relative",
        backgroundColor: "#08090b",
        backgroundImage:
          "radial-gradient(ellipse 1100px 900px at 30% 30%, rgba(59,90,220,0.22), transparent 60%), " +
          "radial-gradient(ellipse 1000px 850px at 70% 30%, rgba(130,60,200,0.18), transparent 60%), " +
          "radial-gradient(ellipse 1050px 900px at 50% 80%, rgba(20,140,140,0.18), transparent 60%)",
        backgroundSize: "180% 180%, 180% 180%, 180% 180%",
        backgroundRepeat: "no-repeat",
        animation: "home-mesh-drift 26s ease-in-out infinite",
      }}
    >
      <style>{`
        @keyframes home-mesh-drift {
          0%   { background-position: 0% 0%, 100% 0%, 50% 100%; }
          50%  { background-position: 30% 40%, 70% 30%, 40% 70%; }
          100% { background-position: 0% 0%, 100% 0%, 50% 100%; }
        }
      `}</style>
      <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <ProfileSwitcher profile={profile} profiles={profiles} onSelectProfile={onSelectProfile} onManageProfiles={onManageProfiles} />
        <Clock />
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: 44, marginTop: 56, padding: "8px 48px" }}>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${PRIMARY_TILES.length}, 1fr)`, gap: 36 }}>
          {PRIMARY_TILES.map((tile) => (
            <HomeTileCard key={tile.id} tile={tile} height={270} iconSize={52} labelSize={24} onSelect={() => onSelectTile(tile.id)} />
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: `repeat(${SECONDARY_TILES.length}, 1fr)`, gap: 32 }}>
          {SECONDARY_TILES.map((tile) => (
            <HomeTileCard key={tile.id} tile={tile} height={175} iconSize={34} labelSize={17} onSelect={() => onSelectTile(tile.id)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function HomeTileCard({
  tile,
  height,
  iconSize,
  labelSize,
  onSelect,
}: {
  tile: HomeTile;
  height: number;
  iconSize: number;
  labelSize: number;
  onSelect: () => void;
}): JSX.Element {
  const isFocused = useFocusStore((state) => state.focusedId === tile.id);
  const Icon = tile.icon;

  return (
    <Focusable id={tile.id}>
      <div style={{ position: "relative" }}>
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: -60,
            borderRadius: 60,
            background: "radial-gradient(closest-side, rgba(130,190,255,0.85) 0%, rgba(130,190,255,0.35) 45%, rgba(130,190,255,0) 75%)",
            filter: "blur(20px)",
            opacity: isFocused ? 1 : 0,
            transform: isFocused ? "scale(1)" : "scale(0.8)",
            transition: "opacity 260ms ease-out, transform 260ms ease-out",
            pointerEvents: "none",
          }}
        />
        <button
          type="button"
          onClick={onSelect}
          style={{
            position: "relative",
            width: "100%",
            height,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 14,
            border: isFocused ? "1px solid rgba(255,255,255,0.55)" : "1px solid rgba(255,255,255,0.06)",
            borderRadius: 24,
            background: isFocused
              ? "linear-gradient(160deg, rgba(52,54,60,0.7) 0%, rgba(20,21,25,0.75) 100%)"
              : "linear-gradient(160deg, rgba(30,31,36,0.6) 0%, rgba(12,13,16,0.65) 100%)",
            backdropFilter: "blur(24px) saturate(120%)",
            WebkitBackdropFilter: "blur(24px) saturate(120%)",
            boxShadow: isFocused
              ? "inset 0 1px 0 rgba(255,255,255,0.4), 0 30px 60px -12px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06)"
              : "inset 0 1px 0 rgba(255,255,255,0.12), 0 10px 24px -8px rgba(0,0,0,0.5)",
            transform: isFocused ? "scale(1.09) translateY(-6px)" : "scale(1)",
            transition: "transform 220ms cubic-bezier(0.2, 0.8, 0.3, 1), box-shadow 220ms ease-out, border-color 220ms ease-out, background 220ms ease-out",
            cursor: "pointer",
            overflow: "hidden",
          }}
        >
          <Icon
            size={iconSize}
            strokeWidth={1.5}
            color="var(--text)"
            style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.35))", position: "relative" }}
          />
          <span
            style={{
              fontSize: labelSize,
              fontWeight: 600,
              color: "var(--text)",
              letterSpacing: 0.2,
              position: "relative",
            }}
          >
            {tile.label}
          </span>
        </button>
      </div>
    </Focusable>
  );
}
