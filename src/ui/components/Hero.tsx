import { useEffect, useState } from "react";
import { Play } from "lucide-react";
import { resolveRemoteAction, type PlatformId } from "@core";
import { Focusable } from "../focus/Focusable.js";
import { useFocusStore } from "../focus/focus-store.js";
import { URLImage } from "./URLImage.js";

/** How long the active card's backdrop crossfades between candidates — see CrossfadeBackdrop. */
const BACKDROP_CROSSFADE_MS = 500;

export const HERO_PLAY_FOCUS_ID = "hero-play";

/** How often the hero rotates to the next candidate — paused while Play has focus, see HomeScreen's usage. */
export const HERO_ROTATE_MS = 10_000;

export interface HeroContent {
  title: string;
  backdropUrl?: string;
  /** Small secondary line for content the pill-tag shape doesn't fit — "S2 E4" for a resumed episode, or a live programme's title for a highlighted channel. Not shown alongside tags (a VOD candidate uses tags; a live/resume candidate uses subtitle). */
  subtitle?: string;
  /** Genre/category chips (e.g. "Sci-Fi", "Thriller") — commonly empty today since Xtream's VOD summary listing doesn't carry genre data; wired through so the UI is ready once a source for it exists. */
  tags?: string[];
  /** Present only for a live channel candidate — rendered as a badge instead of/alongside subtitle. */
  isLive?: boolean;
}

export interface HeroProps {
  platform: PlatformId;
  /** Ranked candidates for the auto-cycle rotation — content[0] is shown first. Empty means "nothing to show yet", not necessarily "still loading" (see isLoading). */
  content: HeroContent[];
  /** True only until the very first successful curation pass completes — drives the skeleton vs. the branded fallback banner. */
  isLoading: boolean;
  /**
   * Index of the candidate currently on screen, and the setter to advance
   * it — lifted up to the caller (HomeScreen) rather than kept as Hero's
   * own internal state, so a D-pad Select press (routed through
   * HomeScreen's useRemoteInput, which only ever sees a focused id, not a
   * click event) can resolve "which candidate is showing right now" the
   * same way a mouse click on the Play button's onClick does.
   */
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onPlay: () => void;
}

/** Peek cards shown on each side of the active card — 2 on the left, 2 on the right, for 5 visible cards total. */
const PEEK_COUNT_PER_SIDE = 2;

/**
 * Cinematic hero: a peeking 5-card carousel (Apple TV / streaming-app
 * style) — the active candidate centered at full size, with up to two
 * upcoming/previous candidates on each side, progressively smaller and more
 * dimmed further from center, as a preview of what's coming next in the
 * auto-rotation. The side cards are decorative only (not focusable, no Play
 * button of their own) — matching the reference design, where only the
 * centered card carries an action. Auto-cycles through home-curation.ts's
 * ranked candidates every HERO_ROTATE_MS while Play doesn't have focus
 * (same "don't fight the user's navigation" rule as a carousel pausing on
 * hover). Three distinct states:
 *  - isLoading: HeroSkeleton (rendered by the caller, not here — see
 *    HomeScreen) while the very first curation pass is still in flight.
 *  - content.length === 0 after loading: the branded fallback banner below,
 *    so a provider with literally nothing resolvable (empty catalog, no
 *    EPG, no watch history) never shows a blank void — spec Scenario A's
 *    "fallback hero data" requirement.
 *  - content.length > 0: the real rotating carousel.
 */
export function Hero({ platform, content, isLoading, activeIndex, onActiveIndexChange, onPlay }: HeroProps): JSX.Element {
  const isPlayFocused = useFocusStore((state) => state.focusedId === HERO_PLAY_FOCUS_ID);

  useEffect(() => {
    if (content.length <= 1 || isPlayFocused) return;
    const timer = setInterval(() => onActiveIndexChange((activeIndex + 1) % content.length), HERO_ROTATE_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content.length, isPlayFocused, activeIndex]);

  // Left/Right manually rotates the carousel while Play has focus, instead
  // of (or as well as) the auto-rotate timer above — mirrors
  // PlaybackControls.tsx's own capture-phase override of left/right for
  // seeking, the established pattern in this codebase for "this directional
  // key means something other than moving to a neighboring focus node"
  // (see focus-store.ts's move(), which only walks the static graph and has
  // no hook for this). Registered in the capture phase so it runs and
  // calls preventDefault() before HomeScreen's own useRemoteInput (bubble
  // phase) would otherwise call move("left"/"right") and hunt for a
  // neighbor that doesn't exist for this single-node hero. Left goes to the
  // previous candidate, Right to the next — independent of the sidebar's
  // own Left-always-returns-here wiring, since that's a different node
  // (HomeSidebar's own graph) this listener never touches.
  useEffect(() => {
    if (content.length <= 1 || !isPlayFocused) return;
    function onKeyDown(event: KeyboardEvent): void {
      const action = resolveRemoteAction(platform, event);
      if (action !== "left" && action !== "right") return;
      event.preventDefault();
      event.stopPropagation();
      const delta = action === "left" ? -1 : 1;
      onActiveIndexChange((activeIndex + delta + content.length) % content.length);
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [platform, content.length, isPlayFocused, activeIndex, onActiveIndexChange]);

  if (isLoading) return <></>;
  if (content.length === 0) return <HeroFallbackBanner />;

  const current = content[activeIndex] ?? content[0];

  // Up to PEEK_COUNT_PER_SIDE candidates on each side, nearest-to-center
  // first — capped so a carousel with fewer than 5 total candidates never
  // wraps around and shows the same candidate twice.
  const maxPeekPerSide = Math.min(PEEK_COUNT_PER_SIDE, Math.floor((content.length - 1) / 2));
  const leftPeeks = Array.from({ length: maxPeekPerSide }, (_, i) => {
    const distance = i + 1;
    return { content: content[(activeIndex - distance + content.length) % content.length], distance };
  });
  const rightPeeks = Array.from({ length: maxPeekPerSide }, (_, i) => {
    const distance = i + 1;
    return { content: content[(activeIndex + distance) % content.length], distance };
  });

  return (
    <div
      style={{
        position: "relative",
        flex: 1,
        // A real floor, not 0 — inside a column flex container with
        // overflow-y: auto (see HomeScreen), a flex-1 child with
        // minHeight: 0 shrinks to whatever's left after its siblings
        // (shelves, footer) claim their natural height, which never
        // triggers the scrollbar and left the hero squashed thin whenever
        // two shelves rendered below it (see conversation history). This
        // floor is what makes the column scroll past this point instead of
        // continuing to compress the hero.
        minHeight: "20rem",
        marginBottom: "1.5rem",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {leftPeeks.map(({ content: peekContent, distance }) => (
        <PeekCard key={`left-${distance}`} content={peekContent} side="left" distance={distance} />
      ))}
      {rightPeeks.map(({ content: peekContent, distance }) => (
        <PeekCard key={`right-${distance}`} content={peekContent} side="right" distance={distance} />
      ))}
      <ActiveCard content={current} onPlay={onPlay} />
    </div>
  );
}

/**
 * Decorative, non-focusable preview of a nearby carousel item — offset
 * behind the active card and dimmed, progressively smaller/further/dimmer
 * the further it is from the active card (distance 1 = adjacent, 2 =
 * one further out) so the 5-wide carousel reads as receding into the
 * background rather than five equally-weighted cards.
 */
function PeekCard({ content, side, distance }: { content: HeroContent; side: "left" | "right"; distance: 1 | 2 }): JSX.Element {
  const isNear = distance === 1;
  return (
    <div
      aria-hidden
      data-testid="hero-peek-card"
      style={{
        position: "absolute",
        top: isNear ? "10%" : "16%",
        bottom: isNear ? "10%" : "16%",
        [side]: isNear ? "-4%" : "-16%",
        width: "38%",
        // Rounded on every side, same as the active card — clipped by
        // overflow: hidden below so the backdrop image and its gradient
        // never poke past the rounded edge.
        borderRadius: "1.5rem",
        overflow: "hidden",
        opacity: isNear ? 0.55 : 0.3,
        filter: isNear ? "brightness(0.55) saturate(0.9)" : "brightness(0.4) saturate(0.8)",
        transform: isNear ? "scale(0.94)" : "scale(0.86)",
        zIndex: isNear ? 0 : -1,
        pointerEvents: "none",
      }}
    >
      <URLImage src={content.backdropUrl} alt="" seed={content.title} style={{ position: "absolute", inset: 0 }} />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(0deg, rgba(8,9,11,0.9) 0%, rgba(8,9,11,0.15) 60%)",
        }}
      />
    </div>
  );
}

/**
 * Crossfades the active card's backdrop art between candidates — two
 * stacked URLImage layers, only one visible at a time via opacity, same
 * "swap the fade instead of the source" approach as FocusBackdrop.tsx
 * (a hard backgroundImage/src swap pops visibly on TV-class GPUs). Keyed on
 * `seed` (the candidate's title) rather than `src` alone, since two
 * different candidates could in principle share a backdrop URL and still
 * need to be treated as a change.
 */
function CrossfadeBackdrop({ src, seed }: { src?: string; seed: string }): JSX.Element {
  const [layers, setLayers] = useState<Array<{ src?: string; seed: string }>>([{ src, seed }]);
  const [topIndex, setTopIndex] = useState(0);

  useEffect(() => {
    if (layers[topIndex]?.seed === seed) return;
    const nextIndex = topIndex === 0 ? 1 : 0;
    setLayers((prev) => {
      const updated = [...prev];
      updated[nextIndex] = { src, seed };
      return updated;
    });
    setTopIndex(nextIndex);
    // src/seed are the only dependencies that should retrigger this; layers/topIndex are read via functional updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, seed]);

  return (
    <>
      {layers.map((layer, index) => (
        <div
          key={index}
          style={{
            position: "absolute",
            inset: 0,
            opacity: index === topIndex ? 1 : 0,
            transition: `opacity ${BACKDROP_CROSSFADE_MS}ms ease`,
          }}
        >
          <URLImage src={layer.src} alt="" seed={layer.seed} style={{ position: "absolute", inset: 0 }} />
        </div>
      ))}
    </>
  );
}

function ActiveCard({ content, onPlay }: { content: HeroContent; onPlay: () => void }): JSX.Element {
  const isFocused = useFocusStore((state) => state.focusedId === HERO_PLAY_FOCUS_ID);

  return (
    <div
      style={{
        position: "relative",
        zIndex: 1,
        width: "62%",
        height: "100%",
        borderRadius: "1.75rem",
        overflow: "hidden",
        boxShadow: "0 1.5rem 3rem -0.75rem rgba(0,0,0,0.6)",
      }}
    >
      <CrossfadeBackdrop src={content.backdropUrl} seed={content.title} />
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(0deg, rgba(8,9,11,0.9) 0%, rgba(8,9,11,0.35) 55%, rgba(8,9,11,0.05) 80%)",
        }}
      />
      <div
        style={{
          position: "relative",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          padding: "1.75rem 2rem",
          gap: "0.625rem",
        }}
      >
        {content.isLive && (
          <span
            style={{
              alignSelf: "flex-start",
              padding: "0.25rem 0.75rem",
              borderRadius: 999,
              background: "var(--accent, #38bdf8)",
              color: "#08090b",
              fontSize: "0.75rem",
              fontWeight: 700,
              letterSpacing: 0.4,
            }}
          >
            LIVE
          </span>
        )}
        <h1
          style={{
            fontSize: "1.875rem",
            fontWeight: 800,
            color: "var(--text)",
            margin: 0,
            lineHeight: 1.15,
            maxWidth: "75%",
          }}
        >
          {content.title}
        </h1>
        {content.tags && content.tags.length > 0 ? (
          <div style={{ display: "flex", gap: "0.5rem" }}>
            {content.tags.map((tag) => (
              <span
                key={tag}
                style={{
                  padding: "0.25rem 0.75rem",
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.12)",
                  color: "var(--text-dim)",
                  fontSize: "0.8125rem",
                  fontWeight: 600,
                }}
              >
                {tag}
              </span>
            ))}
          </div>
        ) : (
          content.subtitle && <p style={{ fontSize: "0.9375rem", color: "var(--text-dim)", margin: 0 }}>{content.subtitle}</p>
        )}
      </div>

      <div style={{ position: "absolute", right: "1.5rem", bottom: "1.5rem" }}>
        <Focusable id={HERO_PLAY_FOCUS_ID} style={{ width: "auto", height: "auto" }}>
          <button
            type="button"
            onClick={onPlay}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              padding: "0.75rem 1.5rem",
              borderRadius: 999,
              border: isFocused ? "1px solid rgba(255,255,255,0.7)" : "1px solid rgba(255,255,255,0.16)",
              background: isFocused ? "var(--text)" : "rgba(255,255,255,0.92)",
              color: "#08090b",
              fontSize: "1rem",
              fontWeight: 700,
              transform: isFocused ? "scale(1.05)" : "scale(1)",
              boxShadow: isFocused
                ? "0 0 0 3px var(--accent), 0 0.75rem 1.75rem -0.5rem rgba(0,0,0,0.6)"
                : "0 0.375rem 1rem -0.375rem rgba(0,0,0,0.5)",
              transition:
                "transform 250ms cubic-bezier(0.25, 1, 0.5, 1), border-color 250ms cubic-bezier(0.25, 1, 0.5, 1), box-shadow 250ms cubic-bezier(0.25, 1, 0.5, 1), background 250ms cubic-bezier(0.25, 1, 0.5, 1)",
              cursor: "pointer",
            }}
          >
            <Play size="1.25rem" strokeWidth={2} />
            Play
          </button>
        </Focusable>
      </div>
    </div>
  );
}

/**
 * Branded fallback shown when curation genuinely has nothing to rank (empty
 * catalog, no EPG, no watch history) — spec Scenario A's requirement that
 * the hero never renders as a blank void. Not focusable itself (no Play
 * makes sense with no content to act on); MeshBackground already supplies
 * the app's ambient branding behind HomeScreen, so this only needs a short
 * welcome line over it.
 */
function HeroFallbackBanner(): JSX.Element {
  return (
    <div
      style={{
        flex: 1,
        minHeight: "20rem",
        marginBottom: "1.5rem",
        borderRadius: "1.75rem",
        border: "1px solid rgba(255,255,255,0.08)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(160deg, rgba(40,42,48,0.4) 0%, rgba(14,15,18,0.5) 100%)",
      }}
    >
      <p style={{ fontSize: "1.25rem", fontWeight: 600, color: "var(--text-dim)", margin: 0 }}>Welcome — your picks will appear here</p>
    </div>
  );
}
