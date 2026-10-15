import { h, render } from '../../public/vendor/preact.module.js';

/** Capture a component's VNode with the real Preact hook lifecycle, without mounting its UI or passive effects. */
export function snapshotComponent(Component) {
  return props => {
    let tree;
    const container = { nodeType: 1, childNodes: [] };
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
    if (!previous) globalThis.document = {};
    function Probe() { tree = Component(props); return null; }
    try { render(h(Probe), container); return tree; }
    finally {
      render(null, container);
      if (!previous) delete globalThis.document;
    }
  };
}
