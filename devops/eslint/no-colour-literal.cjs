// ESLint rule: no colour literals in js/. Theme colours come from CSS tokens, read through
// getThemeColor()/resolveColor() in js/theme.js. Cases: tests/unit/js-theme-tokens.test.js.

// Colour-bearing style properties: color, any *Color, background, border*, outline*, the
// shadows, fill and stroke. The two lists name the same properties.
const CAMEL_PROPS =
  /^(?:color|[a-z][A-Za-z]*Color|background|border[A-Za-z]*|outline[A-Za-z]*|boxShadow|textShadow|fill|stroke)$/;
const KEBAB_PROPS =
  "color|[a-z-]+-color|background|border(?:-[a-z]+)*|outline(?:-[a-z]+)*|box-shadow|text-shadow|fill|stroke";
const KEBAB_PROP = new RegExp(`^(?:${KEBAB_PROPS})$`, "i");
// The 148 CSS named colours (CSS Color 4).
const NAMED =
  "aliceblue|antiquewhite|aqua|aquamarine|azure|beige|bisque|black|blanchedalmond|blue|blueviolet|brown|burlywood|cadetblue|chartreuse|chocolate|coral|cornflowerblue|cornsilk|crimson|cyan|darkblue|darkcyan|darkgoldenrod|darkgray|darkgreen|darkgrey|darkkhaki|darkmagenta|darkolivegreen|darkorange|darkorchid|darkred|darksalmon|darkseagreen|darkslateblue|darkslategray|darkslategrey|darkturquoise|darkviolet|deeppink|deepskyblue|dimgray|dimgrey|dodgerblue|firebrick|floralwhite|forestgreen|fuchsia|gainsboro|ghostwhite|gold|goldenrod|gray|green|greenyellow|grey|honeydew|hotpink|indianred|indigo|ivory|khaki|lavender|lavenderblush|lawngreen|lemonchiffon|lightblue|lightcoral|lightcyan|lightgoldenrodyellow|lightgray|lightgreen|lightgrey|lightpink|lightsalmon|lightseagreen|lightskyblue|lightslategray|lightslategrey|lightsteelblue|lightyellow|lime|limegreen|linen|magenta|maroon|mediumaquamarine|mediumblue|mediumorchid|mediumpurple|mediumseagreen|mediumslateblue|mediumspringgreen|mediumturquoise|mediumvioletred|midnightblue|mintcream|mistyrose|moccasin|navajowhite|navy|oldlace|olive|olivedrab|orange|orangered|orchid|palegoldenrod|palegreen|paleturquoise|palevioletred|papayawhip|peachpuff|peru|pink|plum|powderblue|purple|rebeccapurple|red|rosybrown|royalblue|saddlebrown|salmon|sandybrown|seagreen|seashell|sienna|silver|skyblue|slateblue|slategray|slategrey|snow|springgreen|steelblue|tan|teal|thistle|tomato|turquoise|violet|wheat|white|whitesmoke|yellow|yellowgreen";

// Nothing inside url(…) is a colour. A quoted URL runs to its closing quote and may hold ")";
// an unquoted URL ends at the first ")". Removing URLs first keeps every check linear.
const URL_PART = /url\(\s*(?:"[^"]*"?|'[^']*'?|[^)]*)\)?/gi;
// Hex of the CSS lengths (3, 4, 6, 8) and every CSS colour function. The lookbehinds skip
// HTML entities (&#128196;) and hyphenated names (contrast-color(, color-mix().
const LITERAL =
  /(?<![&\w])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![0-9a-z])|(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;
const NAMED_FALLBACK = new RegExp(`var\\(--[\\w-]+,\\s*(?:${NAMED})\\s*\\)`, "i");
// A named colour in one CSS declaration; the declaration stops at ; " ' and `.
const NAMED_IN_DECL = new RegExp(
  `(?<![\\w-])(?:${KEBAB_PROPS})\\s*:[^;"'\`]*?(?<![\\w-])(?:${NAMED})(?![\\w-])`,
  "i"
);
// The hyphen and word lookarounds keep token names such as var(--gold) from matching.
const NAMED_IN_VALUE = new RegExp(`(?<![\\w-])(?:${NAMED})(?![\\w-])`, "i");

const USE_TOKEN = "use a CSS token, read through getThemeColor()/resolveColor() in canvas code";

/** True when the node is a member expression of the form `<x>.style`. */
const isStyle = (node) =>
  node?.type === "MemberExpression" && !node.computed && node.property.name === "style";

/** Returns "assign" or "set" when an ancestor writes a colour-bearing style property. */
function colourWriteContext(node) {
  for (let n = node.parent; n; n = n.parent) {
    if (
      n.type === "AssignmentExpression" &&
      n.left.type === "MemberExpression" &&
      isStyle(n.left.object) &&
      CAMEL_PROPS.test(n.left.property.name || "")
    ) {
      return "assign";
    }
    if (
      n.type === "CallExpression" &&
      n.callee.type === "MemberExpression" &&
      isStyle(n.callee.object) &&
      n.callee.property.name === "setProperty" &&
      typeof n.arguments[0]?.value === "string" &&
      KEBAB_PROP.test(n.arguments[0].value)
    ) {
      return "set";
    }
  }
  return null;
}

/** Returns the report message for one string or template part, or null. Checks run in order. */
function messageFor(node, text, kind) {
  const value = text.replace(URL_PART, "");
  if (LITERAL.test(value)) return `Colour literal in ${kind}: ${USE_TOKEN}.`;
  if (NAMED_FALLBACK.test(value)) {
    return "Named-colour var() fallback: use a defined token without a literal fallback.";
  }
  if (value.includes(":") && NAMED_IN_DECL.test(value)) {
    return "Named colour in a generated inline style: use a CSS token or a class.";
  }
  if (!NAMED_IN_VALUE.test(value)) return null;
  const context = colourWriteContext(node);
  if (context === "assign") return "Named colour written to .style: use a CSS token or a class.";
  if (context === "set") {
    return "Named colour passed to style.setProperty: use a CSS token or a class.";
  }
  return null;
}

const rule = {
  meta: {
    type: "suggestion",
    docs: { description: "Disallow colour literals outside the theme token bridge" },
    schema: [],
  },
  create(context) {
    const check = (node, text, kind) => {
      const message = messageFor(node, text, kind);
      if (message) context.report({ node, message });
    };
    return {
      Literal(node) {
        if (typeof node.value === "string") check(node, node.value, "js/");
      },
      TemplateElement(node) {
        check(node, node.value.raw, "a template");
      },
    };
  },
};

module.exports = { rules: { "no-colour-literal": rule } };
