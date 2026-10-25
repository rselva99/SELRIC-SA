---
name: i18n-check
description: Check that every English translation key in src/i18n/translations.js has a Spanish twin and vice versa, by running node scripts/i18n_parity.mjs, and fix any gap. Use after editing translations.js or adding t('…') keys to a page, and before reporting any batch.
---

# EN/ES parity check

```bash
node scripts/i18n_parity.mjs
```

- Prints `EN <n> / ES <n> parity` and exits 0 when both trees have the same paths.
- Otherwise prints `MISMATCH` with the paths missing in `es` and in `en`, and exits 1.

## Fixing a mismatch
1. For each missing path, add the key in the other language at the same place in the tree
   (same parent object, same order as its sibling).
2. Write the Spanish as a native speaker would; keep `{variables}` identical in both strings.
3. A count key (`fooOne`) needs both forms in both languages.
4. Re-run until it prints `parity`.

## Also check, when a page changed
- Every `t('…')` the page calls exists: `grep -o "t('[^']*'" <file> | sort -u` and look each up.
- No user-visible English literal was left in JSX where the page is otherwise translated.
