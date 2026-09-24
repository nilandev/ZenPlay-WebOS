import { useEffect, useState } from "react";
import { useFocusStore } from "../focus/focus-store.js";
import { LITE_EFFECTS } from "../perf-tier.js";

export interface FocusBackdropProps {
  imageUrl?: string;
}

/**
 * Full-bleed, heavily blurred/dimmed backdrop that crossfades to match
 * whatever the user currently has focused — the Apple TV "ambient artwork"
 * effect that gives browse screens depth without a busy foreground.
 * Crossfades two stacked layers instead of swapping `background-image`
 * directly, since a hard swap causes a visible pop on TV-class GPUs.
 */
export function FocusBackdrop({ imageUrl }: FocusBackdropProps): JSX.Element {
  const [layers, setLayers] = useState<[string | undefined, string | undefined]>([imageUrl, undefined]);
  const [topLayerIndex, setTopLayerIndex] = useState(0);

  useEffect(() => {
    if (imageUrl === layers[topLayerIndex]) return;
    const nextIndex = topLayerIndex === 0 ? 1 : 0;
    setLayers((prev) => {
      const updated: [string | undefined, string | undefined] = [...prev] as [string | undefined, string | undefined];
      updated[nextIndex] = imageUrl;
      return updated;
    });
    setTopLayerIndex(nextIndex);
    // imageUrl is the only dependency that should retrigger this; layers/topLayerIndex are read via functional updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl]);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: -1, overflow: "hidden" }}>
      {layers.map((url, index) => (
        <div
          key={index}
          style={{
            position: "absolute",
            inset: -40,
            backgroundImage: url ? `url(${url})` : undefined,
            backgroundSize: "cover",
            backgroundPosition: "center",
            // A 40px blur over a full-screen layer (twice, mid-crossfade) is
            // one of the most expensive things a TV GPU can be asked to do.
            // Under LITE_EFFECTS the art is dimmed by opacity + the scrim
            // below instead — sharper, but the same "ambient art" read.
            filter: LITE_EFFECTS ? undefined : "blur(40px) brightness(0.4)",
            opacity: index === topLayerIndex && url ? (LITE_EFFECTS ? 0.3 : 1) : 0,
            transition: "opacity 500ms ease-in-out",
          }}
        />
      ))}
      <div style={{ position: "absolute", inset: 0, background: LITE_EFFECTS ? "rgba(11,11,15,0.6)" : "rgba(11,11,15,0.35)" }} />
    </div>
  );
}

/**
 * FocusBackdrop driven straight from the focus store: resolves the focused
 * node to an image URL inside its own selector, so only this component
 * re-renders as focus moves — the screen hosting it (e.g. VodScreen's grid
 * of hundreds of cards) doesn't need to subscribe to focusedId at all just
 * to feed the backdrop.
 */
export function FocusTrackingBackdrop({ getImageUrl }: { getImageUrl: (focusedId: string | null) => string | undefined }): JSX.Element {
  const imageUrl = useFocusStore((state) => getImageUrl(state.focusedId));
  return <FocusBackdrop imageUrl={imageUrl} />;
}
