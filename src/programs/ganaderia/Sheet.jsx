import { Sheet as BaseSheet, ActionSheet as BaseActionSheet } from '../../components/ui/Sheet';

// The herd's overlays are the app's shared sheets (components/ui/Sheet.jsx)
// in the finca tone: paper, ink and the 560 px panel on desktop.
export const Sheet = (props) => <BaseSheet tone="finca" {...props} />;
export const ActionSheet = (props) => <BaseActionSheet tone="finca" {...props} />;
