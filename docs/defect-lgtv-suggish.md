
### Problem Statement & Context
* **Symptom:** The application is performant on desktop browsers, and WebOS simulators, but lags, stutters, or suffers performance degradation on LG webOS TVs.

---

### Required Investigation Areas

Please analyze our code and architectural patterns through the lens of webOS limitations:

1. **JavaScript Engine & Garbage Collection Bottlenecks:**
   * Look for memory-intensive loops, heavy object allocations, or frequent state updates that could trigger aggressive garbage collection cycles on webOS's weaker CPU, starving the main UI thread.
   * Check how large data structures (like EPG guides, large channel lists, or logs) are managed in memory.

2. **DOM Manipulation & Rendering Performance:**
   * Identify excessive DOM reflows/repaints, unoptimized CSS animations, heavy backdrop filters, or complex shadow DOM usage that the webOS browser compositor struggles to hardware-accelerate.

3. **Media Pipeline & Streaming Execution (Crucial for Video Clients):**
   * Examine how media streams (e.g., MPEG-TS, HLS) or `<video>` elements are initialized, buffered, and handled.
   * Check if the app is bypassing native webOS media player hooks by forcing heavy client-side JavaScript parsing or unbuffered MSE (Media Source Extensions) pipelines.

4. **Event Listener & Asynchronous Operations Leaks:**
   * Check for uncleaned timers, dangling requestAnimationFrame loops, or unthrottled remote control keypress events (`keydown`/`keyup`) that spam the event loop on webOS.

---

### Output Format
Structure your response using these exact markdown headers:
1. **Summary** (Core reason for the webOS-specific performance gap)
2. **Platform Discrepancy Analysis** (Why it works on desktop/simulators but fails on webOS hardware)
3. **Identified Code Bottlenecks** (Specific files, functions, or patterns causing the issue)
4. **Targeted Code Refactor / Solution** (Precise code changes to resolve the bottleneck)
5. **webOS Best Practices Checklist** (Preventative measures for embedded TV performance)

---