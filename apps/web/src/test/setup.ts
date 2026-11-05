import { configure } from '@testing-library/react';

// jsdom doesn't implement scrolling; the router's scroll restoration calls it on navigation.
window.scrollTo = () => undefined;

// The first render of a routed page can take over a second when the machine is busy (e.g. all
// workspaces testing at once, with the rich-text editor in the bundle); shorter waits made such tests flaky.
configure({ asyncUtilTimeout: 10_000 });

// jsdom has no ResizeObserver; Radix (checkbox, popover) measures elements with it.
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
