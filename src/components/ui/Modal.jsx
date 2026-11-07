import { Sheet } from './Sheet';

// Every Business dialog. It is the shared Sheet (the one Ganadería uses) in
// the business tone: a portal into <body>, full screen on a phone, a panel of
// `size` on desktop; Escape and the backdrop close it, focus stays inside
// while it is open and returns afterwards. The footer stays put while the
// body scrolls, so the primary action is always reachable.
export default function Modal({ open, onClose, title, description, children, footer, size = 'md' }) {
  return (
    <Sheet open={open} onClose={onClose} title={title} subtitle={description} footer={footer} size={size} tone="business">
      {children}
    </Sheet>
  );
}
