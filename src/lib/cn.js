// Joins the class names that are set. Its own module so the first load (the
// spinner, the gates) does not carry utils.js and date-fns with it.
export function cn(...classes) {
  return classes.filter(Boolean).join(' ');
}
