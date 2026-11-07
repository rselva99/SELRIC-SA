// Business name drawn on every PDF header. AuthContext sets it once the
// signed-in user's organization loads, so each workspace's reports carry its
// own name. Falls back to the product name if nothing has been set.
// Its own module so the sign-in path does not pull the PDF library
// (reports.js and jsPDF) into the first load.
let current = 'SelRic';
export function setReportBusinessName(name) {
  current = String(name || '').trim() || 'SelRic';
}
export const reportBusinessName = () => current;
