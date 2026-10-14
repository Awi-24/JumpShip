import { useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { isDesktop, TitlebarSlot } from '../desktop';

/** Page buttons that live in the window's title bar on desktop and inline (in the page header) in a browser. */
export default function TitlebarActions({ children }: { children: ReactNode }) {
  const slot = useContext(TitlebarSlot);
  if (!isDesktop) return <>{children}</>;
  return slot ? createPortal(children, slot) : null;
}
