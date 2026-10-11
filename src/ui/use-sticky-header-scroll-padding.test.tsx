import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { useStickyHeaderScrollPadding } from "./use-sticky-header-scroll-padding.js";

function Screen({ showHeader }: { showHeader: boolean }): JSX.Element {
  const headerRef = useStickyHeaderScrollPadding();
  return <div>{showHeader && <div ref={headerRef}>Movies</div>}</div>;
}

afterEach(cleanup);

describe("useStickyHeaderScrollPadding", () => {
  it("pads the page's scroll root by the header's height while the header is mounted, so focus scrolling stops below it", () => {
    render(<Screen showHeader />);
    expect(document.documentElement.style.scrollPaddingTop).toMatch(/^calc\(\d+px \+ 1\.75rem\)$/);
    expect(document.documentElement.style.scrollPaddingBottom).toBe("1.75rem");
  });

  it("clears the padding when the header goes away (e.g. a series detail page) and when the screen unmounts", () => {
    const { rerender, unmount } = render(<Screen showHeader />);
    rerender(<Screen showHeader={false} />);
    expect(document.documentElement.style.scrollPaddingTop).toBe("");

    rerender(<Screen showHeader />);
    unmount();
    expect(document.documentElement.style.scrollPaddingTop).toBe("");
    expect(document.documentElement.style.scrollPaddingBottom).toBe("");
  });
});
