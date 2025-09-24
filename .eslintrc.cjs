module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  rules: {
    // Strict no-any rule
    '@typescript-eslint/no-explicit-any': 'error',

    // Unused variables/imports
    '@typescript-eslint/no-unused-vars': 'error',
    'no-unused-vars': 'off',

    // Code quality
    '@typescript-eslint/no-non-null-assertion': 'error',

    // Import rules
    '@typescript-eslint/consistent-type-imports': 'error',
  },
  env: {
    node: true,
    es2022: true,
  },
};
