import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { URLImage } from "./URLImage.js";

afterEach(() => {
  cleanup();
});

describe("URLImage", () => {
  it("renders the placeholder immediately when no src is given", () => {
    render(<URLImage alt="Some Movie" />);
    expect(screen.queryByRole("img")).toBeNull();
    // The placeholder icon is aria-hidden, so assert via the container's SVG instead.
    expect(document.querySelector("svg")).toBeTruthy();
  });

  it("crossfades the placeholder out once the image loads successfully", () => {
    render(<URLImage src="http://example.com/poster.jpg" alt="Some Movie" />);
    const img = screen.getByRole("img", { hidden: true }) as HTMLImageElement;
    const placeholder = document.querySelector("svg")?.parentElement as HTMLElement;
    expect(img.style.opacity).toBe("0");
    expect(placeholder.style.opacity).toBe("1");

    fireEvent.load(img);

    expect(img.style.opacity).toBe("1");
    expect(placeholder.style.opacity).toBe("0");
  });

  it("falls back to the placeholder when the image fails to load (e.g. 404)", () => {
    render(<URLImage src="http://example.com/missing.jpg" alt="Some Movie" />);
    const img = screen.getByRole("img", { hidden: true }) as HTMLImageElement;

    fireEvent.error(img);

    expect(img.style.opacity).toBe("0");
    expect(document.querySelector("svg")).toBeTruthy();
  });

  it("shows an image the browser already has cached as soon as it mounts, without waiting for load", () => {
    const complete = vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
    const width = vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(300);
    try {
      render(<URLImage src="http://example.com/cached.jpg" alt="Cached" />);
      expect((screen.getByRole("img", { hidden: true }) as HTMLImageElement).style.opacity).toBe("1");
    } finally {
      complete.mockRestore();
      width.mockRestore();
    }
  });

  it("retries a failed image a couple of times before settling on the placeholder", () => {
    vi.useFakeTimers();
    try {
      render(<URLImage src="http://example.com/flaky.jpg" alt="Flaky" />);
      const first = screen.getByRole("img", { hidden: true }) as HTMLImageElement;
      fireEvent.error(first);
      act(() => vi.advanceTimersByTime(3000));
      const second = screen.getByRole("img", { hidden: true }) as HTMLImageElement;
      expect(second).not.toBe(first); // a fresh <img>, so the browser asks again
      fireEvent.load(second);
      expect(second.style.opacity).toBe("1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up after its retries", () => {
    vi.useFakeTimers();
    try {
      render(<URLImage src="http://example.com/gone.jpg" alt="Gone" />);
      for (const wait of [3000, 6000]) {
        fireEvent.error(screen.getByRole("img", { hidden: true }));
        act(() => vi.advanceTimersByTime(wait));
      }
      const last = screen.getByRole("img", { hidden: true });
      fireEvent.error(last);
      act(() => vi.advanceTimersByTime(60_000));
      expect(screen.getByRole("img", { hidden: true })).toBe(last);
    } finally {
      vi.useRealTimers();
    }
  });

  it("resets to the loading/placeholder state when src changes", () => {
    const { rerender } = render(<URLImage src="http://example.com/a.jpg" alt="A" />);
    const imgA = screen.getByRole("img", { hidden: true }) as HTMLImageElement;
    fireEvent.load(imgA);
    expect(imgA.style.opacity).toBe("1");

    rerender(<URLImage src="http://example.com/b.jpg" alt="B" />);
    const imgB = screen.getByRole("img", { hidden: true }) as HTMLImageElement;
    expect(imgB.style.opacity).toBe("0");
  });

  it("picks the same placeholder variant for the same seed", () => {
    const { container: c1 } = render(<URLImage alt="Same Title" />);
    const svg1 = c1.querySelector("svg")?.outerHTML;
    cleanup();
    const { container: c2 } = render(<URLImage alt="Same Title" />);
    const svg2 = c2.querySelector("svg")?.outerHTML;
    expect(svg1).toBe(svg2);
  });
});

describe("URLImage placeholder icon", () => {
  it("uses the section's icon when one is given, regardless of seed", async () => {
    const { Tv } = await import("lucide-react");
    for (const seed of ["a", "b", "c", "d"]) {
      const { container, unmount } = render(<URLImage alt="" seed={seed} placeholderIcon={Tv} />);
      expect(container.querySelector("svg")?.getAttribute("class")).toContain("lucide-tv");
      unmount();
    }
  });
});
