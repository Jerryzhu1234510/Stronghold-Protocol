import { useEffect, useRef } from '../../vendor/hooks.module.js';

/** Close a non-modal panel without consuming the underlying board/control tap. */
export function useOutsideDismiss(ref, onClose, except = '') {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const dismiss = event => {
      if (!ref.current || ref.current.contains(event.target) || (except && event.target?.closest?.(except))) return;
      close.current?.();
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [ref, except]);
}
