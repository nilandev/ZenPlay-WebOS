/**
 * The remote handler selects on keyup. When a keydown has already been
 * handled some other way (OK leaving a text field, OK that only reveals the
 * player's hidden controls), its keyup would otherwise also select whatever
 * is focused. Some on-screen keyboards never send the keyup, so the swallow
 * expires on its own.
 */
export function swallowNextKeyUp(): void {
  const swallow = (event: KeyboardEvent) => {
    event.stopImmediatePropagation();
    cleanup();
  };
  const cleanup = () => {
    document.removeEventListener("keyup", swallow, true);
    clearTimeout(timer);
  };
  const timer = setTimeout(cleanup, 600);
  document.addEventListener("keyup", swallow, true);
}
