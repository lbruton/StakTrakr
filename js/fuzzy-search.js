// Fuzzy Search Engine Module for StakTrakr
// Provides typo-tolerant, partial, and order-independent search utilities

/**
 * Normalize a string by stripping special characters and optionally lowercasing
 *
 * @param {string} str - Input string
 * @param {boolean} [caseSensitive=false] - Preserve case if true
 * @returns {string} Normalized string
 */
const normalizeString = (str, caseSensitive = false) => {
  if (typeof str !== "string") return "";
  let normalized = str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove diacritics
    .replace(/[^\w\s]/g, " ") // remove special chars
    .replace(/\s+/g, " ")
    .trim();
  return caseSensitive ? normalized : normalized.toLowerCase();
};

/**
 * Tokenize a string into individual words
 *
 * @param {string} str - Input string
 * @param {boolean} [caseSensitive=false] - Preserve case if true
 * @returns {string[]} Array of words
 */
const tokenizeWords = (str, caseSensitive = false) => {
  const normalized = normalizeString(str, caseSensitive);
  return normalized ? normalized.split(/\s+/) : [];
};

/**
 * Generate character n-grams from a string
 *
 * @param {string} str - Input string
 * @param {number} [n=2] - Length of n-gram
 * @param {boolean} [caseSensitive=false] - Preserve case if true
 * @returns {string[]} Array of n-grams
 */
const generateNGrams = (str, n = 2, caseSensitive = false) => {
  const normalized = normalizeString(str, caseSensitive).replace(/\s+/g, "");
  if (!normalized) return [];
  if (normalized.length <= n) return [normalized];
  const grams = [];
  for (let i = 0; i <= normalized.length - n; i++) {
    grams.push(normalized.slice(i, i + n));
  }
  return grams;
};

/**
 * Calculate Levenshtein distance between two strings
 *
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} Edit distance
 */
const calculateLevenshteinDistance = (str1, str2) => {
  const a = typeof str1 === "string" ? str1 : "";
  const b = typeof str2 === "string" ? str2 : "";
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;

  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
};

/**
 * Calculates fuzzy similarity between query and target strings
 *
 * @param {string} query - User search input
 * @param {string} target - Inventory item name to match against
 * @param {Object} [options={}] - Configuration options
 * @param {number} [options.threshold=0.6] - Minimum similarity score
 * @param {boolean} [options.caseSensitive=false] - Case sensitive matching
 * @returns {number} Similarity score between 0 and 1
 *
 * @example
 * fuzzyMatch("Ame", "American Silver Eagle") // returns ~0.7
 * fuzzyMatch("Eagle Amer", "American Silver Eagle") // returns ~0.8
 */
const fuzzyMatch = (query, target, options = {}) => {
  try {
    if (typeof query !== "string" || typeof target !== "string") {
      console.warn("fuzzyMatch: Invalid input types");
      return 0;
    }

    const { threshold = 0.6, caseSensitive = false } = options; // Default threshold favoring precision
    const q = normalizeString(query, caseSensitive);
    const t = normalizeString(target, caseSensitive);
    if (!q || !t) return 0;

    // Levenshtein similarity (best substring match)
    let minDist = Infinity;
    if (t.length >= q.length) {
      for (let i = 0; i <= t.length - q.length; i++) {
        const slice = t.slice(i, i + q.length);
        const d = calculateLevenshteinDistance(q, slice);
        if (d < minDist) minDist = d;
        if (minDist === 0) break;
      }
    } else {
      minDist = calculateLevenshteinDistance(q, t);
    }
    const levScore = q.length ? 1 - minDist / q.length : 0;

    // N-gram similarity (2-grams & 3-grams)
    const qGrams = new Set([...generateNGrams(q, 2, true), ...generateNGrams(q, 3, true)]);
    const tGrams = new Set([...generateNGrams(t, 2, true), ...generateNGrams(t, 3, true)]);
    const inter = [...qGrams].filter((g) => tGrams.has(g));
    const union = new Set([...qGrams, ...tGrams]);
    const ngramScore = union.size ? inter.length / union.size : 0;

    // Word-based similarity
    const qWords = tokenizeWords(q, true);
    const tWords = tokenizeWords(t, true);
    const tokenScores = qWords.map((qw) => {
      let best = 0;
      tWords.forEach((tw) => {
        const d = calculateLevenshteinDistance(qw, tw);
        const l = Math.max(qw.length, tw.length);
        let s = l ? 1 - d / l : 0;
        if (tw[0] !== qw[0]) {
          s -= 0.3; // heavy penalty for mismatched first letter
        } else if (
          tw.slice(0, Math.min(2, tw.length, qw.length)) !==
          qw.slice(0, Math.min(2, tw.length, qw.length))
        ) {
          s -= 0.1; // lighter penalty for differing prefix
        }
        if (s > best) best = s;
      });
      return Math.max(0, best);
    });
    const wordScore = tokenScores.length
      ? tokenScores.reduce((sum, s) => sum + s, 0) / tokenScores.length
      : 0;

    const score = 0.3 * levScore + 0.3 * ngramScore + 0.4 * wordScore; // prioritize token accuracy
    return score >= threshold ? score : 0;
  } catch (error) {
    console.error("fuzzyMatch error:", error);
    return 0; // Safe fallback
  }
};

/**
 * Search through an array of targets and return fuzzy matches
 *
 * @param {string} query - Search query
 * @param {string[]} targets - Array of strings to search
 * @param {Object} [options={}] - Configuration options
 * @param {number} [options.threshold=0.6] - Minimum similarity score
 * @param {number} [options.maxResults=Infinity] - Maximum results to return
 * @param {boolean} [options.caseSensitive=false] - Case sensitive matching
 * @returns {Array.<{text: string, score: number}>} Array of results
 */
const fuzzySearch = (query, targets, options = {}) => {
  if (!Array.isArray(targets)) {
    console.warn("fuzzySearch: targets must be an array");
    return [];
  }
  const { threshold = 0.6, maxResults = Infinity, caseSensitive = false } = options;
  const results = [];
  targets.forEach((t) => {
    const score = fuzzyMatch(query, t, { threshold, caseSensitive });
    if (score > 0) {
      results.push({ text: t, score });
    }
  });
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, maxResults);
};

// Exporting functions for external use in Node.js
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    normalizeString,
    tokenizeWords,
    generateNGrams,
    calculateLevenshteinDistance,
    fuzzyMatch,
    fuzzySearch,
  };
}

// Expose functions to the browser global scope
if (typeof window !== "undefined") {
  window.normalizeString = normalizeString;
  window.tokenizeWords = tokenizeWords;
  window.generateNGrams = generateNGrams;
  window.calculateLevenshteinDistance = calculateLevenshteinDistance;
  window.fuzzyMatch = fuzzyMatch;
  window.fuzzySearch = fuzzySearch;
}
