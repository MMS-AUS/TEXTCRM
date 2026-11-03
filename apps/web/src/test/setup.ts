import { configure } from '@testing-library/react';

// jsdom doesn't implement scrolling; the router's scroll restoration calls it on navigation.
window.scrollTo = () => undefined;

// The first render of a routed page can take over a second when the machine is busy (e.g. all
// workspaces testing at once); the 1 s default made such tests flaky.
configure({ asyncUtilTimeout: 3000 });
