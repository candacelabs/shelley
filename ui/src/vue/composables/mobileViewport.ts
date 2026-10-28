// Whether the viewport is phone-sized (under 768px), as a shared reactive flag.
//
// Backed by one media query listener rather than reads of window.innerWidth:
// in Chrome reading innerWidth forces a synchronous layout. A tool card mounts
// in place of its placeholder, and Vue removes the placeholder first, so a
// layout forced while the card sets up sees a transcript short by the
// placeholder's height. At the bottom of a short transcript that clamps the
// scroll offset up, which reads as the reader scrolling away.
import { readonly, ref, type Ref } from "vue";

const query = window.matchMedia("(max-width: 767px)");
const mobile = ref(query.matches);
query.addEventListener("change", (e) => (mobile.value = e.matches));

export function useMobileViewport(): Readonly<Ref<boolean>> {
  return readonly(mobile);
}
