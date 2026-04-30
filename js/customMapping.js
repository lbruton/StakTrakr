/**
 * Custom Mapping Module
 * Provides a simple regex-based rule engine for mapping imported
 * field names to application fields.
 */

/**
 * @typedef {Object} MappingRule
 * @property {RegExp} regex Pattern to match against field names
 * @property {string} field Target field identifier
 */

const CustomMapping = (() => {
  /** @type {MappingRule[]} */
  let mappings = [];

  /**
   * Adds a new mapping rule.
   * @param {string} pattern Regex pattern as a string
   * @param {string} field Field name to map to
   * @returns {void}
   */
  function addMapping(pattern, field) {
    try {
      const regex = new RegExp(pattern, "i");
      mappings.push({ regex, field });
    } catch (error) {
      console.warn("Invalid regex pattern:", pattern, error);
    }
  }

  /**
   * Attempts to map an input field name using stored rules.
   * @param {string} name Field name to test
   * @returns {string|null} Mapped field or null if no rule matches
   */
  function mapField(name) {
    for (const rule of mappings) {
      if (rule.regex.test(name)) {
        return rule.field;
      }
    }
    return null;
  }

  /**
   * Removes all custom mapping rules.
   * @returns {void}
   */
  function clear() {
    mappings = [];
  }

  /**
   * Returns a simplified view of current mappings.
   * @returns {Array<{regex:string, field:string}>}
   */
  function list() {
    return mappings.map((m) => ({ regex: m.regex.toString(), field: m.field }));
  }

  return { addMapping, mapField, clear, list };
})();

// Expose globally for prototype UI hooks
window.CustomMapping = CustomMapping;
