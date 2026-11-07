// Fuzzy-match a raw bank description against the supplier→category map.
// Normalises both sides (lowercase, strip digits + punctuation) and checks
// whether any known supplier name is a substring of the description.
// Returns the best-matching category string, or '' if nothing matches.
export function fuzzyMatchCategory(description, supplierMap) {
  if (!description || !supplierMap || Object.keys(supplierMap).length === 0) return '';

  const normalize = (s) =>
    s.toLowerCase()
      .replace(/\d+/g, '')
      .replace(/[^a-z\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  const normDesc = normalize(description);

  // Exact lowercase match wins immediately
  if (supplierMap[description.toLowerCase()]) return supplierMap[description.toLowerCase()];

  // Partial: prefer the longest matching supplier name found inside the description
  let bestCategory = '';
  let bestLen = 0;

  for (const [supplier, category] of Object.entries(supplierMap)) {
    const normSupplier = normalize(supplier);
    if (normSupplier.length < 3) continue;
    if (normDesc.includes(normSupplier) && normSupplier.length > bestLen) {
      bestCategory = category;
      bestLen = normSupplier.length;
    }
  }

  return bestCategory;
}
