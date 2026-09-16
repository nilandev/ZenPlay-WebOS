import { useEffect, useState } from "react";

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
            filter: "blur(40px) brightness(0.4)",
            opacity: index === topLayerIndex && url ? 1 : 0,
            transition: "opacity 500ms ease-in-out",
          }}
        />
      ))}
      <div style={{ position: "absolute", inset: 0, background: "rgba(11,11,15,0.35)" }} />
    </div>
  );
}
