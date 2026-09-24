import type { Channel, EpgProgramme } from "@core";
import { BROWSE_SIDE_PADDING, OnNowTimeline, SECTION_ICONS, TV_TEXT, URLImage } from "@ui";
import { Pause, Star } from "lucide-react";

/** What the player knows about the title beyond its name — drives the loading and "You're watching" screens. All optional: providers fill these in unevenly. */
export interface PlaybackInfo {
  plot?: string;
  /** 0-10. */
  rating?: number;
  year?: number;
  /** Wide artwork shown behind the loading screen. */
  backdropUrl?: string;
  /** Portrait poster (films/series). */
  posterUrl?: string;
  /** Channel logo (live TV). */
  logoUrl?: string;
}

/** "2014-11-07" → 2014, or undefined for a missing/garbled date. */
export function yearFromDate(date?: string): number | undefined {
  const year = Number(date?.slice(0, 4));
  return Number.isInteger(year) && year > 1900 ? year : undefined;
}

/**
 * Shown from the moment the player opens until the stream actually starts
 * (instead of a black screen): the backdrop, the poster or channel logo,
 * the title and an indeterminate progress bar. Fades out once playback
 * starts; only opacity and transform animate.
 */
export function PlayerLoadingScreen({
  title,
  subtitle,
  info,
  isLive,
  isVisible,
}: {
  title?: string;
  subtitle?: string;
  info?: PlaybackInfo;
  isLive: boolean;
  isVisible: boolean;
}): JSX.Element {
  const artwork = isLive ? info?.logoUrl : info?.posterUrl;
  return (
    <div
      aria-hidden={!isVisible}
      data-testid="player-loading"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 5,
        background: "#07080b",
        opacity: isVisible ? 1 : 0,
        pointerEvents: "none",
        transition: "opacity 450ms ease-out",
      }}
    >
      {info?.backdropUrl && (
        <img src={info.backdropUrl} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.4 }} />
      )}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          gap: "3rem",
          padding: `3rem ${BROWSE_SIDE_PADDING}`,
          background: "linear-gradient(90deg, rgba(7,8,11,0.92) 0%, rgba(7,8,11,0.6) 60%, rgba(7,8,11,0.3) 100%)",
        }}
      >
        {artwork &&
          (isLive ? (
            <div
              style={{
                width: "16rem",
                height: "10rem",
                flexShrink: 0,
                padding: "1.5rem",
                boxSizing: "border-box",
                borderRadius: "1.25rem",
                background: "rgba(255,255,255,0.08)",
                boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.1)",
              }}
            >
              <URLImage src={artwork} alt="" objectFit="contain" loading="eager" placeholderIcon={SECTION_ICONS.live} />
            </div>
          ) : (
            <div style={{ width: "13rem", aspectRatio: "2 / 3", flexShrink: 0, borderRadius: "1rem", overflow: "hidden", boxShadow: "0 2rem 4rem -1rem rgba(0,0,0,0.8)" }}>
              <URLImage src={artwork} alt="" loading="eager" placeholderIcon={SECTION_ICONS.movies} />
            </div>
          ))}
        <div style={{ minWidth: 0 }}>
          {title && <div style={{ fontSize: "3.25rem", fontWeight: 800, color: "#fff", lineHeight: 1.1 }}>{title}</div>}
          {subtitle && <div style={{ fontSize: "1.625rem", color: "rgba(255,255,255,0.8)", marginTop: "0.625rem" }}>{subtitle}</div>}
          <div style={{ display: "flex", alignItems: "center", gap: "1.25rem", marginTop: "2.25rem" }}>
            <div style={{ position: "relative", width: "16rem", height: "0.375rem", borderRadius: 999, overflow: "hidden", background: "rgba(255,255,255,0.18)" }}>
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  width: "40%",
                  borderRadius: 999,
                  background: "var(--accent)",
                  animation: isVisible ? "player-loading-sweep 1.3s ease-in-out infinite" : "none",
                }}
              />
            </div>
            <span style={{ fontSize: TV_TEXT, color: "rgba(255,255,255,0.75)" }}>{isLive ? "Tuning in…" : "Starting…"}</span>
          </div>
        </div>
      </div>
      <style>{`
        @keyframes player-loading-sweep {
          from { transform: translateX(-100%); }
          to { transform: translateX(250%); }
        }
      `}</style>
    </div>
  );
}

/**
 * Netflix's "You're watching" screen: after a while paused, the picture
 * dims and the title's details take over from the controls. Any key brings
 * the controls back (PlayerScreen handles that).
 */
export function PausedInfoOverlay({ title, subtitle, info }: { title?: string; subtitle?: string; info?: PlaybackInfo }): JSX.Element {
  const meta = [
    info?.year ? String(info.year) : null,
    info?.rating ? (
      <span key="rating" style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem" }}>
        <Star size="1.25rem" fill="#f5c518" color="#f5c518" />
        {info.rating.toFixed(1)}
      </span>
    ) : null,
  ].filter(Boolean);

  return (
    <div
      role="status"
      aria-label="You're watching"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 4,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: `3rem ${BROWSE_SIDE_PADDING}`,
        background: "linear-gradient(90deg, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.6) 55%, rgba(0,0,0,0.3) 100%)",
        animation: "player-paused-in 600ms ease-out",
      }}
    >
      <div style={{ fontSize: TV_TEXT, fontWeight: 600, color: "rgba(255,255,255,0.65)", marginBottom: "0.75rem" }}>You're watching</div>
      {title && <div style={{ fontSize: "3.75rem", fontWeight: 800, color: "#fff", lineHeight: 1.08, maxWidth: "70rem" }}>{title}</div>}
      {subtitle && <div style={{ fontSize: "1.75rem", fontWeight: 600, color: "rgba(255,255,255,0.88)", marginTop: "0.75rem" }}>{subtitle}</div>}
      {meta.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: "1.5rem", marginTop: "1.25rem", fontSize: TV_TEXT, fontWeight: 600, color: "rgba(255,255,255,0.8)" }}>
          {meta.map((item, index) => (
            <span key={index}>{item}</span>
          ))}
        </div>
      )}
      {info?.plot && (
        <p
          style={{
            maxWidth: "56rem",
            margin: "1.75rem 0 0",
            fontSize: "1.5rem",
            lineHeight: 1.5,
            color: "rgba(255,255,255,0.82)",
            display: "-webkit-box",
            WebkitLineClamp: 4,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {info.plot}
        </p>
      )}
      <div
        style={{
          position: "absolute",
          left: BROWSE_SIDE_PADDING,
          bottom: "3rem",
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          fontSize: TV_TEXT,
          color: "rgba(255,255,255,0.7)",
        }}
      >
        <Pause size="1.5rem" fill="currentColor" />
        Paused · Press OK to continue
      </div>
      <style>{`
        @keyframes player-paused-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </div>
  );
}

/**
 * Shown for a few seconds after changing channel (CH+/CH−, number keys),
 * top-left like a TV's own zap banner: logo, number and name, and what's
 * on now when the guide knows. Neutral styling — no "LIVE" claim.
 */
export function ChannelBanner({ channel, programme }: { channel: Channel; programme?: EpgProgramme }): JSX.Element {
  return (
    <div
      role="status"
      aria-label="Channel"
      style={{
        position: "absolute",
        top: "2.5rem",
        left: BROWSE_SIDE_PADDING,
        zIndex: 8,
        display: "flex",
        alignItems: "center",
        gap: "1.5rem",
        maxWidth: "60rem",
        padding: "1.25rem 1.75rem 1.25rem 1.25rem",
        borderRadius: "1.25rem",
        background: "rgba(10,11,15,0.88)",
        boxShadow: "0 1.5rem 3rem -1rem rgba(0,0,0,0.7), inset 0 0 0 1px rgba(255,255,255,0.1)",
        animation: "player-banner-in 240ms cubic-bezier(0.2, 0.8, 0.3, 1)",
      }}
    >
      <div style={{ width: "7rem", height: "4.5rem", flexShrink: 0, padding: "0.5rem", boxSizing: "border-box", borderRadius: "0.75rem", background: "rgba(255,255,255,0.08)" }}>
        <URLImage src={channel.logoUrl} alt="" seed={channel.id} objectFit="contain" loading="eager" placeholderIcon={SECTION_ICONS.live} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "1rem", color: "#fff" }}>
          {channel.number !== undefined && <span style={{ fontSize: "2rem", fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{channel.number}</span>}
          <span style={{ fontSize: "1.625rem", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{channel.name}</span>
        </div>
        {programme && (
          <div style={{ marginTop: "0.5rem" }}>
            <div style={{ fontSize: TV_TEXT, fontWeight: 600, color: "rgba(255,255,255,0.9)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: "0.5rem" }}>
              {programme.title}
            </div>
            <OnNowTimeline programme={programme} barWidth="12rem" fontSize="1.125rem" />
          </div>
        )}
      </div>
      <style>{`
        @keyframes player-banner-in {
          from { opacity: 0; transform: translateY(-1rem); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

/** The digits being typed to tune a channel ("10_"), top-right — or "No channel 105" when nothing has that number. */
export function ChannelNumberEntry({ digits, notFound }: { digits: string; notFound: boolean }): JSX.Element {
  return (
    <div
      role="status"
      aria-label="Channel number"
      style={{
        position: "absolute",
        top: "2.5rem",
        right: BROWSE_SIDE_PADDING,
        zIndex: 8,
        padding: "1rem 1.75rem",
        borderRadius: "1.25rem",
        background: "rgba(10,11,15,0.88)",
        boxShadow: "0 1.5rem 3rem -1rem rgba(0,0,0,0.7), inset 0 0 0 1px rgba(255,255,255,0.1)",
        color: "#fff",
        textAlign: "right",
      }}
    >
      {notFound ? (
        <div style={{ fontSize: "1.75rem", fontWeight: 700 }}>No channel {digits}</div>
      ) : (
        <>
          <div style={{ fontSize: "1rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-dim)" }}>Channel</div>
          <div style={{ fontSize: "3.5rem", fontWeight: 800, lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>
            {digits}
            <span style={{ opacity: 0.4 }}>_</span>
          </div>
        </>
      )}
    </div>
  );
}
