// jsdom doesn't implement scrolling; the router's scroll restoration calls it on navigation.
window.scrollTo = () => undefined;
