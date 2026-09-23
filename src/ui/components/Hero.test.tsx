import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useFocusStore } from "../focus/focus-store.js";
import { HERO_PLAY_FOCUS_ID, HERO_ROTATE_MS, Hero, type HeroContent } from "./Hero.js";

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
});

afterEach(() => {
  cleanup();
  useFocusStore.getState().clearGraph("test");
});

const movie: HeroContent = { title: "Some Movie", subtitle: "Action, 2024" };
const withTags: HeroContent = { title: "Blade Runner 2049", tags: ["Sci-Fi", "Thriller"] };
const liveChannel: HeroContent = { title: "Sports Channel", subtitle: "Big Match", isLive: true };

describe("Hero", () => {
  it("renders nothing while isLoading is true, regardless of content", () => {
    const { container } = render(<Hero platform="web" content={[movie]} isLoading activeIndex={0} onActiveIndexChange={() => {}} onPlay={() => {}} />);
    expect(container.textContent).toBe("");
  });

  it("renders the branded fallback banner when loading has finished with no candidates", () => {
    render(<Hero platform="web" content={[]} isLoading={false} activeIndex={0} onActiveIndexChange={() => {}} onPlay={() => {}} />);
    expect(screen.getByText(/your picks will appear here/i)).toBeTruthy();
    expect(screen.queryByText("Play")).toBeNull();
  });

  it("renders the candidate at activeIndex, with a LIVE badge only for a live candidate", () => {
    render(<Hero platform="web" content={[movie, liveChannel]} isLoading={false} activeIndex={1} onActiveIndexChange={() => {}} onPlay={() => {}} />);
    expect(screen.getByText("Sports Channel")).toBeTruthy();
    expect(screen.getByText("Big Match")).toBeTruthy();
    expect(screen.getByText("LIVE")).toBeTruthy();
  });

  it("renders genre tags as separate pills when present, instead of subtitle", () => {
    render(<Hero platform="web" content={[withTags]} isLoading={false} activeIndex={0} onActiveIndexChange={() => {}} onPlay={() => {}} />);
    expect(screen.getByText("Sci-Fi")).toBeTruthy();
    expect(screen.getByText("Thriller")).toBeTruthy();
  });

  it("falls back to subtitle when there are no tags", () => {
    render(<Hero platform="web" content={[movie]} isLoading={false} activeIndex={0} onActiveIndexChange={() => {}} onPlay={() => {}} />);
    expect(screen.getByText("Action, 2024")).toBeTruthy();
  });

  it("renders no Details button — Play is the only action", () => {
    render(<Hero platform="web" content={[movie]} isLoading={false} activeIndex={0} onActiveIndexChange={() => {}} onPlay={() => {}} />);
    expect(screen.getByText("Play")).toBeTruthy();
    expect(screen.queryByText("Details")).toBeNull();
  });

  it("calls onPlay for the currently active candidate when the Play button is clicked", () => {
    const onPlay = vi.fn();
    render(<Hero platform="web" content={[movie]} isLoading={false} activeIndex={0} onActiveIndexChange={() => {}} onPlay={onPlay} />);

    fireEvent.click(screen.getByText("Play"));
    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it("renders the previous and next candidates as decorative, non-interactive peek cards alongside the active one", () => {
    const third: HeroContent = { title: "Third Title" };
    render(<Hero platform="web" content={[movie, liveChannel, third]} isLoading={false} activeIndex={0} onActiveIndexChange={() => {}} onPlay={() => {}} />);

    // Active candidate (movie) renders its full title/subtitle text; the
    // previous (third, wrapping) and next (liveChannel) candidates render as
    // two peek cards, and only the active card carries a Play button.
    expect(screen.getAllByTestId("hero-peek-card")).toHaveLength(2);
    expect(screen.getAllByText("Play")).toHaveLength(1);
    expect(screen.queryByText("Sports Channel")).toBeNull();
    expect(screen.queryByText("Third Title")).toBeNull();
  });

  it("does not render peek cards when there is only one candidate", () => {
    render(<Hero platform="web" content={[movie]} isLoading={false} activeIndex={0} onActiveIndexChange={() => {}} onPlay={() => {}} />);
    expect(screen.queryAllByTestId("hero-peek-card")).toHaveLength(0);
  });

  it("auto-advances activeIndex on a timer when there are multiple candidates and Play doesn't have focus", () => {
    vi.useFakeTimers();
    const onActiveIndexChange = vi.fn();
    render(
      <Hero platform="web" content={[movie, liveChannel]} isLoading={false} activeIndex={0} onActiveIndexChange={onActiveIndexChange} onPlay={() => {}} />,
    );

    act(() => {
      vi.advanceTimersByTime(HERO_ROTATE_MS);
    });

    expect(onActiveIndexChange).toHaveBeenCalledWith(1);
    vi.useRealTimers();
  });

  it("gives the Play button a 250ms cubic-bezier(0.25, 1, 0.5, 1) transition including border-color", () => {
    render(<Hero platform="web" content={[movie]} isLoading={false} activeIndex={0} onActiveIndexChange={() => {}} onPlay={() => {}} />);
    const playButton = screen.getByText("Play").closest("button") as HTMLElement;
    expect(playButton.style.transition).toContain("transform 250ms cubic-bezier(0.25, 1, 0.5, 1)");
    expect(playButton.style.transition).toContain("border-color 250ms cubic-bezier(0.25, 1, 0.5, 1)");
  });

  it("crossfades the active card's backdrop across two stacked layers when the candidate changes", () => {
    // A single-candidate list so only the active card's CrossfadeBackdrop
    // renders images — no peek cards' own URLImage instances to account for.
    const first: HeroContent = { title: "First Title", backdropUrl: "http://example.com/first.jpg" };
    const second: HeroContent = { title: "Second Title", backdropUrl: "http://example.com/second.jpg" };
    const { container, rerender } = render(
      <Hero platform="web" content={[first]} isLoading={false} activeIndex={0} onActiveIndexChange={() => {}} onPlay={() => {}} />,
    );

    // Only one backdrop layer exists before any candidate change.
    expect(container.querySelectorAll("img").length).toBe(1);

    rerender(<Hero platform="web" content={[second]} isLoading={false} activeIndex={0} onActiveIndexChange={() => {}} onPlay={() => {}} />);

    // The outgoing layer is kept mounted (opacity-faded, not unmounted) alongside the incoming one, so both backdrop images exist during the crossfade.
    const images = container.querySelectorAll("img") as NodeListOf<HTMLImageElement>;
    expect(images.length).toBe(2);
    expect(Array.from(images).some((img) => img.src.includes("second.jpg"))).toBe(true);
  });

  it("rotates the carousel with Left/Right D-pad presses while Play has focus", () => {
    const onActiveIndexChange = vi.fn();
    render(
      <Hero
        platform="web"
        content={[movie, liveChannel]}
        isLoading={false}
        activeIndex={0}
        onActiveIndexChange={onActiveIndexChange}
        onPlay={() => {}}
      />,
    );

    act(() => {
      useFocusStore.getState().setGraph("test", [{ id: HERO_PLAY_FOCUS_ID, neighbors: {} }]);
      useFocusStore.getState().focus(HERO_PLAY_FOCUS_ID);
    });

    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(onActiveIndexChange).toHaveBeenCalledWith(1);

    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(onActiveIndexChange).toHaveBeenCalledWith(1); // wraps from index 0 back to the last candidate
  });

  it("does not rotate the carousel on Left/Right when Play does not have focus", () => {
    const onActiveIndexChange = vi.fn();
    render(
      <Hero
        platform="web"
        content={[movie, liveChannel]}
        isLoading={false}
        activeIndex={0}
        onActiveIndexChange={onActiveIndexChange}
        onPlay={() => {}}
      />,
    );

    fireEvent.keyDown(document, { key: "ArrowRight" });
    fireEvent.keyDown(document, { key: "ArrowLeft" });

    expect(onActiveIndexChange).not.toHaveBeenCalled();
  });

  it("does not auto-advance while the Play button has focus", () => {
    vi.useFakeTimers();
    const onActiveIndexChange = vi.fn();
    render(
      <Hero platform="web" content={[movie, liveChannel]} isLoading={false} activeIndex={0} onActiveIndexChange={onActiveIndexChange} onPlay={() => {}} />,
    );

    act(() => {
      useFocusStore.getState().setGraph("test", [{ id: HERO_PLAY_FOCUS_ID, neighbors: {} }]);
      useFocusStore.getState().focus(HERO_PLAY_FOCUS_ID);
    });

    act(() => {
      vi.advanceTimersByTime(HERO_ROTATE_MS * 2);
    });

    expect(onActiveIndexChange).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
