import { afterEach, describe, expect, it } from "vitest";
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
