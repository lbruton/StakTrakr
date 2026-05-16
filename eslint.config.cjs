module.exports = [
  {
    files: ["js/**/*.js", "sw.js", "sw-router.js", "tests/unit/**/*.js"],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "script",
    },
    rules: {
      "no-undef": "off",
    },
  },
];
