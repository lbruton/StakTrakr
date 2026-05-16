module.exports = [
  {
    files: ["js/**/*.js", "sw.js", "sw-router.js"],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "script",
    },
    rules: {
      "no-undef": "off",
    },
  },
  {
    files: ["tests/unit/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      "no-undef": "off",
    },
  },
];
